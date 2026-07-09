import { describe, expect, it } from "vitest";

import { computeCallItGameStats } from "@/lib/mlb/callItGameStats";
import type { LiveGameState, PlayPitch } from "@/types/mlb-live";

function pitch(n: number): PlayPitch {
  return {
    pitchNumber: n,
    typeCode: "FF",
    typeDescription: "Four-Seam Fastball",
    callDescription: "Called Strike",
    callCode: "C",
    balls: 0,
    strikes: n,
    startSpeed: 95,
    plateX: 0,
    plateZ: 2.5,
    isStrike: true,
    isBall: false,
    isInPlay: false,
    isOut: false,
    isPitch: true,
    strikeZoneTop: 3.5,
    strikeZoneBottom: 1.5,
  };
}

describe("computeCallItGameStats", () => {
  it("computes per-team pitch pace from completed at-bats", () => {
    const gameState = {
      awayAbbrev: "AWY",
      homeAbbrev: "HOM",
      inning: 2,
      inningHalf: "Bottom",
      atBatPitches: [],
      plays: [
        {
          atBatIndex: 0,
          inning: 1,
          halfInning: "Top",
          batterId: 1,
          batterName: "A",
          awayScore: 0,
          homeScore: 0,
          isAtBat: true,
          situationBefore: {
            awayScore: 0,
            homeScore: 0,
            outs: 0,
            bases: {},
            onFirst: false,
            onSecond: false,
            onThird: false,
          },
          detail: { pitches: [pitch(1), pitch(2)] },
        },
        {
          atBatIndex: 1,
          inning: 1,
          halfInning: "Bottom",
          batterId: 2,
          batterName: "B",
          awayScore: 0,
          homeScore: 0,
          isAtBat: true,
          situationBefore: {
            awayScore: 0,
            homeScore: 0,
            outs: 0,
            bases: {},
            onFirst: false,
            onSecond: false,
            onThird: false,
          },
          detail: { pitches: [pitch(1)] },
        },
      ],
    } as unknown as LiveGameState;

    const stats = computeCallItGameStats(gameState);
    expect(stats?.away.pitchesSeen).toBe(2);
    expect(stats?.home.pitchesSeen).toBe(1);
    expect(stats?.away.pitchesThrown).toBe(1);
    expect(stats?.home.pitchesThrown).toBe(2);
    expect(stats?.away.pitchesSeenPerInning).toBeCloseTo(2, 5);
    expect(stats?.home.pitchesSeenPerInning).toBeCloseTo(1, 5);
  });
});
