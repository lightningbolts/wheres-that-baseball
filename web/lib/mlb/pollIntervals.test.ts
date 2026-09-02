import { describe, expect, it } from "vitest";

import { mergeAllPlaysForTest } from "@/lib/mlb/liveFeedCoordinator";
import {
  MAX_IN_FLIGHT,
  POLL_ACTIVE_MS,
  POLL_BREAK_MS,
  POLL_HIDDEN_MS,
  POLL_IDLE_MS,
  POLL_REALTIME_FALLBACK_MS,
  adaptivePollIntervalMs,
  effectivePollIntervalMs,
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

  it("keeps adaptive intervals even when push is connected", () => {
    const feed = feedStub({
      linescore: { inningState: "Top" },
      plays: playsWithCurrent({
        about: { isComplete: false, inning: 1, halfInning: "top" },
        matchup: { batter: { id: 1, fullName: "B" }, pitcher: { id: 2, fullName: "P" } },
      }),
    });

    expect(effectivePollIntervalMs(feed, false, true)).toBe(POLL_ACTIVE_MS);
    expect(effectivePollIntervalMs(null, false, true)).toBe(POLL_ACTIVE_MS);
  });

  it("does not stretch idle polling when push is connected", () => {
    const idle = feedStub({
      linescore: { inningState: "Top" },
      plays: playsWithCurrent({
        about: { isComplete: true, inning: 1, halfInning: "top" },
        result: { event: "Single", description: "Single" },
        matchup: { batter: { id: 1, fullName: "B" }, pitcher: { id: 2, fullName: "P" } },
      }),
    });
    expect(effectivePollIntervalMs(idle, false, true)).toBe(POLL_IDLE_MS);
    expect(effectivePollIntervalMs(idle, false, false)).toBe(POLL_IDLE_MS);
  });

  it("does not stretch a hidden tab past the hidden interval", () => {
    expect(effectivePollIntervalMs(null, true, true)).toBe(POLL_HIDDEN_MS);
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

describe("Gameday-speed constants", () => {
  it("keeps active at-bat polling at 100ms with overlapping in-flight fetches", () => {
    expect(POLL_ACTIVE_MS).toBe(100);
    expect(MAX_IN_FLIGHT).toBe(2);
    expect(POLL_IDLE_MS).toBe(500);
    expect(POLL_BREAK_MS).toBe(800);
    expect(POLL_HIDDEN_MS).toBe(2_000);
    expect(POLL_REALTIME_FALLBACK_MS).toBe(3_000);
  });
});
