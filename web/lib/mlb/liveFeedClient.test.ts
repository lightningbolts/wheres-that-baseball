import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchDirectSnapshot,
  fetchLiveSnapshot,
  fetchLiveSnapshotPreferringMlb,
  fetchMLBLiveFeed,
  resetBrowserLiveFeedCacheForTest,
} from "@/lib/mlb/liveFeed";
import { mlbLiveFeedUrl } from "@/lib/mlb/liveFeedEndpoints";
import type { MLBLiveFeedResponse } from "@/types/mlb-live";

const GAME_PK = 776123;

const MINIMAL_FEED: MLBLiveFeedResponse = {
  gameData: {
    status: { abstractGameState: "Live" },
    teams: {
      away: { name: "Away", abbreviation: "AWY" },
      home: { name: "Home", abbreviation: "HME" },
    },
  },
  liveData: {
    linescore: {
      currentInning: 3,
      inningState: "Top",
      teams: { away: { runs: 1 }, home: { runs: 0 } },
    },
    plays: {
      allPlays: [],
      currentPlay: {
        matchup: {
          batter: { id: 1, fullName: "Batter" },
          pitcher: { id: 2, fullName: "Pitcher" },
        },
        count: { balls: 2, strikes: 1, outs: 1 },
        about: { inning: 3, halfInning: "top" },
      },
    },
  },
};

function jsonResponse(body: unknown, init?: { status?: number; etag?: string }): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: {
      "Content-Type": "application/json",
      ...(init?.etag ? { etag: init.etag } : {}),
    },
  });
}

afterEach(() => {
  resetBrowserLiveFeedCacheForTest();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("browser MLB live feed", () => {
  it("fetches statsapi.mlb.com and does not hit Netlify snapshot routes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(MINIMAL_FEED, { etag: '"v1"' }));
    vi.stubGlobal("fetch", fetchMock);

    const snapshot = await fetchLiveSnapshotPreferringMlb(GAME_PK, 0);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requested = String(fetchMock.mock.calls[0]?.[0]);
    expect(requested).toBe(mlbLiveFeedUrl(GAME_PK));
    expect(requested).not.toContain("/api/game/");
    expect(requested).not.toContain("/api/games");
    expect(snapshot.boxScore === undefined || snapshot.boxScore === null || typeof snapshot.boxScore === "object").toBe(
      true,
    );
    expect(snapshot.plays?.from).toBe(0);
    expect(snapshot.awayAbbrev).toBe("AWY");
  });

  it("sends If-None-Match and reuses the cached feed on 304", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(MINIMAL_FEED, { etag: '"abc"' }))
      .mockResolvedValueOnce(new Response(null, { status: 304, headers: { etag: '"abc"' } }));
    vi.stubGlobal("fetch", fetchMock);

    const first = await fetchMLBLiveFeed(GAME_PK);
    const second = await fetchMLBLiveFeed(GAME_PK);

    expect(first).toEqual(MINIMAL_FEED);
    expect(second).toEqual(MINIMAL_FEED);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondHeaders = fetchMock.mock.calls[1]?.[1]?.headers as HeadersInit;
    expect(secondHeaders).toMatchObject({ "If-None-Match": '"abc"' });
  });

  it("includes boxScore on direct snapshots", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(MINIMAL_FEED)));
    const snapshot = await fetchDirectSnapshot(GAME_PK, null);
    expect("boxScore" in snapshot).toBe(true);
  });

  it("falls back to the Netlify snapshot route only after MLB fetch fails", async () => {
    const proxyBody = {
      gamePk: GAME_PK,
      gameStatus: "Live",
      awayTeam: "Away",
      homeTeam: "Home",
      awayAbbrev: "AWY",
      homeAbbrev: "HME",
      venueId: null,
      venueName: null,
      linescore: MINIMAL_FEED.liveData.linescore,
      currentPlay: MINIMAL_FEED.liveData.plays.currentPlay,
      allPlaysCount: 0,
      awayPitcher: null,
      homePitcher: null,
      awayAbsChallengesUsed: 0,
      homeAbsChallengesUsed: 0,
      boxScore: null,
      plays: { from: 0, total: 0, plays: [] },
    };

    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("statsapi.mlb.com")) {
        throw new TypeError("Failed to fetch");
      }
      return jsonResponse(proxyBody);
    });
    vi.stubGlobal("fetch", fetchMock);

    const snapshot = await fetchLiveSnapshotPreferringMlb(GAME_PK, 0);
    expect(snapshot.awayAbbrev).toBe("AWY");

    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls[0]).toBe(mlbLiveFeedUrl(GAME_PK));
    expect(urls[1]).toContain(`/api/game/${GAME_PK}/live/snapshot`);

    fetchMock.mockClear();
    await fetchLiveSnapshot(GAME_PK);
    const cooldownUrls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(cooldownUrls.every((url) => url.includes("/api/game/"))).toBe(true);
    expect(cooldownUrls.some((url) => url.includes("statsapi.mlb.com"))).toBe(false);
  });
});
