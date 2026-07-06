import { describe, expect, it } from "vitest";

import { compactStoredGameState, isParsedStateWrapper, wrapGameStateForStorage } from "@/lib/games/gameStorage";
import { isStoredFeedComplete, type FeedCheckRow } from "@/lib/games/feedComplete";
import { parseStoredGameState } from "@/lib/games/gameState";
import type { LiveGameState, MLBLiveFeedResponse } from "@/types/mlb-live";

function minimalFeed(status = "Final"): MLBLiveFeedResponse {
  return {
    gameData: {
      status: { abstractGameState: status },
      teams: {
        away: { id: 1, name: "Away", abbreviation: "AWY" },
        home: { id: 2, name: "Home", abbreviation: "HOM" },
      },
    },
    liveData: {
      linescore: {
        currentInning: 1,
        inningState: "Top",
        teams: { away: { runs: 0 }, home: { runs: 0 } },
      },
      plays: {
        allPlays: [
          {
            result: { event: "Single", description: "Single", awayScore: 0, homeScore: 0 },
            about: { atBatIndex: 0, inning: 1, halfInning: "top", isComplete: true },
            matchup: {
              batter: { id: 10, fullName: "Batter" },
              pitcher: { id: 20, fullName: "Pitcher" },
            },
            count: { balls: 0, strikes: 0, outs: 0 },
            playEvents: [],
          },
        ],
        currentPlay: {
          matchup: { batter: { fullName: "Batter" }, pitcher: { fullName: "Pitcher" } },
          count: { balls: 0, strikes: 0, outs: 0 },
          about: { inning: 1, halfInning: "top" },
        },
      },
      boxscore: {
        teams: {
          away: { team: { id: 1 }, players: { ID1: { person: { fullName: "P1" } } } },
          home: { team: { id: 2 }, players: { ID2: { person: { fullName: "P2" } } } },
        },
      } as MLBLiveFeedResponse["liveData"]["boxscore"],
    },
  };
}

describe("gameStorage", () => {
  it("stores final games as parsed state", () => {
    const wrapped = wrapGameStateForStorage(42, minimalFeed("Final"), "Final");
    expect(isParsedStateWrapper(wrapped)).toBe(true);
    if (isParsedStateWrapper(wrapped)) {
      expect(wrapped.parsed.gamePk).toBe(42);
      expect(wrapped.parsed.plays.length).toBeGreaterThan(0);
    }
  });

  it("parses stored parsed state without re-parsing feed", () => {
    const wrapped = wrapGameStateForStorage(42, minimalFeed("Final"), "Final");
    const state = parseStoredGameState(wrapped, 42);
    expect(state?.awayAbbrev).toBe("AWY");
  });

  it("compacts bloated final feeds to parsed state", () => {
    const bloated = { mlbFeed: minimalFeed("Final") };
    const compact = compactStoredGameState(bloated, 42, "Final");
    expect(compact).not.toBeNull();
    expect(compact!.format).toBe("parsed");
    expect(isParsedStateWrapper(compact!.payload)).toBe(true);
  });

  it("accepts parsed storage in feed completeness checks", () => {
    const wrapped = wrapGameStateForStorage(42, minimalFeed("Final"), "Final");
    expect(
      isStoredFeedComplete({
        status: "Final",
        away_score: 0,
        home_score: 0,
        feed_synced_at: new Date().toISOString(),
        game_state: wrapped,
        game_date: "2026-01-01",
      } as unknown as FeedCheckRow),
    ).toBe(false);
  });
});
