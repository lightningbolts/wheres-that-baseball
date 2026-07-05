import { describe, expect, it } from "vitest";

import { findPlayByAtBatIndex } from "@/lib/games/replay";
import type { PlayByPlayEntry } from "@/types/mlb-live";

function play(partial: Partial<PlayByPlayEntry> & Pick<PlayByPlayEntry, "atBatIndex">): PlayByPlayEntry {
  return {
    batterId: 1,
    batterName: "Test Batter",
    batterHits: 1,
    batterAtBats: 3,
    event: "Single",
    description: "Test Batter singles.",
    inning: 1,
    halfInning: "top",
    awayScore: 0,
    homeScore: 0,
    outs: 0,
    onFirst: false,
    onSecond: false,
    onThird: false,
    bases: { first: null, second: null, third: null },
    isScoringPlay: false,
    isAtBat: true,
    detail: {
      atBatIndex: partial.atBatIndex,
      batterId: 1,
      batterName: "Test Batter",
      batterHits: 1,
      batterAtBats: 3,
      pitcherName: "Pitcher",
      pitcherId: 2,
      event: "Single",
      description: "Test Batter singles.",
      inning: 1,
      halfInning: "top",
      awayScore: 0,
      homeScore: 0,
      isScoringPlay: false,
      pitches: [],
    },
    situationBefore: {
      awayScore: 0,
      homeScore: 0,
      outs: 0,
      onFirst: false,
      onSecond: false,
      onThird: false,
      bases: { first: null, second: null, third: null },
    },
    ...partial,
  };
}

describe("findPlayByAtBatIndex", () => {
  it("returns the plate appearance, not an in-progress game event with the same index", () => {
    const plays = [
      play({
        atBatIndex: 12,
        isAtBat: false,
        event: "Stolen Base",
        description: "Runner steals second.",
      }),
      play({
        atBatIndex: 12,
        isAtBat: true,
        event: "Single",
        description: "Test Batter singles.",
      }),
    ];

    expect(findPlayByAtBatIndex(plays, 12)?.event).toBe("Single");
  });
});
