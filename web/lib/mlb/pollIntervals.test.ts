import { describe, expect, it } from "vitest";

import { mergeAllPlaysForTest } from "@/lib/mlb/liveFeedCoordinator";
import {
  POLL_ACTIVE_MS,
  POLL_BREAK_MS,
  POLL_HIDDEN_MS,
  POLL_IDLE_MS,
  adaptivePollIntervalMs,
} from "@/lib/mlb/pollIntervals";
import type { AllPlayRaw, MLBLiveFeedResponse } from "@/types/mlb-live";

function feedStub(liveData: MLBLiveFeedResponse["liveData"]): MLBLiveFeedResponse {
  return {
    gameData: {
      status: { abstractGameState: "Live" },
      teams: {
        away: { name: "Away", abbreviation: "AWY" },
        home: { name: "Home", abbreviation: "HME" },
      },
    },
    liveData,
  };
}

function playsWithCurrent(currentPlay: AllPlayRaw): MLBLiveFeedResponse["liveData"]["plays"] {
  return { currentPlay: currentPlay as MLBLiveFeedResponse["liveData"]["plays"]["currentPlay"] };
}

describe("adaptivePollIntervalMs", () => {
  it("uses hidden interval when tab is hidden", () => {
    expect(adaptivePollIntervalMs(null, true)).toBe(POLL_HIDDEN_MS);
  });

  it("uses active interval during incomplete at-bat", () => {
    const feed = feedStub({
      linescore: { inningState: "Top" },
      plays: playsWithCurrent({
        about: { isComplete: false, inning: 1, halfInning: "top" },
        matchup: { batter: { id: 1, fullName: "B" }, pitcher: { id: 2, fullName: "P" } },
      }),
    });

    expect(adaptivePollIntervalMs(feed, false)).toBe(POLL_ACTIVE_MS);
  });

  it("uses break interval between innings", () => {
    const feed = feedStub({
      linescore: { inningState: "Middle" },
      plays: playsWithCurrent({
        about: { isComplete: true, inning: 3, halfInning: "top" },
      }),
    });

    expect(adaptivePollIntervalMs(feed, false)).toBe(POLL_BREAK_MS);
  });

  it("uses idle interval when play has a result", () => {
    const feed = feedStub({
      linescore: { inningState: "Top" },
      plays: playsWithCurrent({
        about: { isComplete: true, inning: 1, halfInning: "top" },
        result: { event: "Single", description: "Single" },
        matchup: { batter: { id: 1, fullName: "B" }, pitcher: { id: 2, fullName: "P" } },
      }),
    });

    expect(adaptivePollIntervalMs(feed, false)).toBe(POLL_IDLE_MS);
  });
});

describe("mergeAllPlaysForTest", () => {
  it("appends incremental play chunks", () => {
    const first = [{ about: { atBatIndex: 0 } }];
    const second = [{ about: { atBatIndex: 1 } }];
    const merged = mergeAllPlaysForTest(first, 1, second, 2);
    expect(merged).toHaveLength(2);
  });
});
