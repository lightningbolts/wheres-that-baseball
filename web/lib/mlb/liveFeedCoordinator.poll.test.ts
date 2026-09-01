import { afterEach, describe, expect, it, vi } from "vitest";

import { subscribeLiveFeed } from "@/lib/mlb/liveFeedCoordinator";
import { resetBrowserLiveFeedCacheForTest } from "@/lib/mlb/liveFeed";
import { mlbLiveFeedUrl } from "@/lib/mlb/liveFeedEndpoints";
import type { MLBLiveFeedResponse } from "@/types/mlb-live";

vi.mock("@/lib/mlb/gamedayWebsocket", () => ({
  subscribeGamedayWebsocket: () => ({ unsubscribe: () => undefined }),
}));

vi.mock("@/lib/mlb/liveFeedRealtime", () => ({
  subscribeGameStateRealtime: () => ({ unsubscribe: () => undefined }),
  snapshotFromRealtimeFeed: vi.fn(),
}));

const GAME_PK = 824902;

const MINIMAL_FEED: MLBLiveFeedResponse = {
  gameData: {
    status: { abstractGameState: "Live" },
    teams: {
      away: { name: "Mets", abbreviation: "NYM" },
      home: { name: "Braves", abbreviation: "ATL" },
    },
  },
  liveData: {
    linescore: {
      currentInning: 1,
      inningState: "Top",
      teams: { away: { runs: 0 }, home: { runs: 0 } },
    },
    plays: {
      allPlays: [],
      currentPlay: {
        matchup: {
          batter: { id: 1, fullName: "Batter" },
          pitcher: { id: 2, fullName: "Pitcher" },
        },
        count: { balls: 0, strikes: 0, outs: 0 },
        about: { inning: 1, halfInning: "top" },
      },
    },
  },
};

afterEach(() => {
  resetBrowserLiveFeedCacheForTest();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("liveFeedCoordinator happy path", () => {
  it("polls MLB directly instead of /api/game/.../snapshot", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(MINIMAL_FEED), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const unsubscribe = subscribeLiveFeed(GAME_PK, () => undefined);
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    unsubscribe();

    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => url === mlbLiveFeedUrl(GAME_PK))).toBe(true);
    expect(urls.some((url) => url.includes("/api/game/"))).toBe(false);
    expect(urls.some((url) => url.includes("/api/games"))).toBe(false);
  });
});
