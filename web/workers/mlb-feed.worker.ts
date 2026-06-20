/**
 * Fetches and parses the MLB live feed off the main thread.
 * Pitch polls omit allPlays payload; PBP sync passes playsFrom for new rows only.
 */

import type {
  MlbFeedWorkerFailure,
  MlbFeedWorkerPayload,
  MlbFeedWorkerRequest,
  MlbFeedWorkerSuccess,
} from "@/types/mlb-feed-worker";

const MLB_FEED_BASE = "https://statsapi.mlb.com/api/v1.1";

self.onmessage = (event: MessageEvent<MlbFeedWorkerRequest>) => {
  void handleRequest(event.data);
};

async function handleRequest({ requestId, gamePk, playsFrom }: MlbFeedWorkerRequest) {
  try {
    const response = await fetch(`${MLB_FEED_BASE}/game/${gamePk}/feed/live`, {
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`MLB live feed failed: ${response.status}`);
    }

    const feed = (await response.json()) as {
      metaData?: { timeStamp?: string };
      gameData: {
        status: { abstractGameState: string };
        teams: {
          away: { name: string; abbreviation?: string };
          home: { name: string; abbreviation?: string };
        };
        venue?: { id?: number; name?: string };
      };
      liveData: {
        linescore: unknown;
        plays: {
          currentPlay: unknown;
          allPlays?: unknown[];
        };
      };
    };

    const teams = feed.gameData.teams;
    const allPlays = feed.liveData.plays.allPlays ?? [];
    const payload: MlbFeedWorkerPayload = {
      requestId,
      gamePk,
      gameStatus: feed.gameData.status.abstractGameState,
      awayTeam: teams.away.name,
      homeTeam: teams.home.name,
      awayAbbrev: teams.away.abbreviation ?? teams.away.name.slice(0, 3).toUpperCase(),
      homeAbbrev: teams.home.abbreviation ?? teams.home.name.slice(0, 3).toUpperCase(),
      venueId: feed.gameData.venue?.id ?? null,
      venueName: feed.gameData.venue?.name ?? null,
      linescore: feed.liveData.linescore,
      currentPlay: feed.liveData.plays.currentPlay,
      allPlaysCount: allPlays.length,
      feedTimeStamp: feed.metaData?.timeStamp ?? null,
    };

    if (playsFrom != null && playsFrom >= 0 && playsFrom < allPlays.length) {
      payload.playsFrom = playsFrom;
      payload.newPlays = allPlays.slice(playsFrom);
    } else if (playsFrom === 0 && allPlays.length > 0) {
      payload.playsFrom = 0;
      payload.newPlays = allPlays;
    }

    const message: MlbFeedWorkerSuccess = { ok: true, payload };
    self.postMessage(message);
  } catch (err) {
    const message: MlbFeedWorkerFailure = {
      ok: false,
      requestId,
      error: err instanceof Error ? err.message : "Worker fetch failed",
    };
    self.postMessage(message);
  }
};
