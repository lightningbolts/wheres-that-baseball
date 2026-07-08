import { describe, expect, it } from "vitest";

import { allPitchesThroughPoint } from "@/lib/mlb/allGamePitches";
import type { LiveGameState, PlayByPlayEntry, PlayPitch } from "@/types/mlb-live";

function pitch(n: number, overrides: Partial<PlayPitch> = {}): PlayPitch {
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
    hasPlateLocation: true,
    strikeZoneTop: 3.5,
    strikeZoneBottom: 1.5,
    ...overrides,
  };
}

function makePlay(
  atBatIndex: number,
  pitches: PlayPitch[],
  overrides: Partial<PlayByPlayEntry> = {},
): PlayByPlayEntry {
  return {
    atBatIndex,
    inning: 1,
    halfInning: "top",
    batterId: atBatIndex + 1,
    batterName: `Batter ${atBatIndex}`,
    batterHits: 0,
    batterAtBats: 0,
    event: "Single",
    awayScore: 0,
    homeScore: 0,
    outs: 0,
    bases: {},
    onFirst: false,
    onSecond: false,
    onThird: false,
    situationBefore: {
      awayScore: 0,
      homeScore: 0,
      outs: 0,
      bases: {},
      onFirst: false,
      onSecond: false,
      onThird: false,
    },
    isScoringPlay: false,
    isAtBat: true,
    description: "Single",
    detail: {
      atBatIndex,
      batterId: atBatIndex + 1,
      batterName: `Batter ${atBatIndex}`,
      batterHits: 0,
      batterAtBats: 0,
      pitcherName: "Pitcher",
      pitcherId: 99,
      event: "Single",
      description: "Single",
      inning: 1,
      halfInning: "top",
      awayScore: 0,
      homeScore: 0,
      isScoringPlay: false,
      pitches,
      hit: null,
    },
    ...overrides,
  };
}

function makeBaseState(plays: PlayByPlayEntry[], overrides: Partial<LiveGameState> = {}): LiveGameState {
  return {
    gamePk: 1,
    venueId: null,
    venueName: null,
    gameStatus: "Live",
    awayTeam: "Away",
    awayAbbrev: "AWY",
    homeTeam: "Home",
    homeAbbrev: "HOM",
    awayRuns: 0,
    homeRuns: 0,
    batterId: 3,
    batterName: "Current Batter",
    onDeckId: null,
    onDeckName: "—",
    inHoleId: null,
    inHoleName: "—",
    offenseTeamId: null,
    battingOrderSlot: null,
    pitcherId: 99,
    pitcherName: "Pitcher",
    inning: 1,
    inningHalf: "Top",
    inningState: "Middle",
    balls: 0,
    strikes: 0,
    outs: 0,
    onFirst: false,
    onSecond: false,
    onThird: false,
    awayAbsChallengesRemaining: 2,
    homeAbsChallengesRemaining: 2,
    atBatPitches: [],
    plays,
    ...overrides,
  } as LiveGameState;
}

describe("allPitchesThroughPoint", () => {
  it("returns completed at-bat pitches when no live AB is in progress", () => {
    const state = makeBaseState([
      makePlay(0, [pitch(1), pitch(2)]),
      makePlay(1, [pitch(1)]),
    ]);

    const result = allPitchesThroughPoint(state);

    expect(result).toHaveLength(3);
    expect(result.filter((p) => p.isCurrentAtBat)).toHaveLength(1);
    expect(result[2].isCurrentAtBat).toBe(true);
    expect(result.map((p) => p.chartKey)).toEqual(["ab-0-p-0", "ab-0-p-1", "ab-1-p-0"]);
  });

  it("appends in-progress at-bat pitches for live games", () => {
    const state = makeBaseState([makePlay(0, [pitch(1), pitch(2)])], {
      atBatPitches: [pitch(1), pitch(2)],
      batterId: 3,
    });

    const result = allPitchesThroughPoint(state, {
      currentAtBatPitches: [pitch(1), pitch(2)],
    });

    expect(result).toHaveLength(4);
    expect(result.slice(0, 2).every((p) => !p.isCurrentAtBat)).toBe(true);
    expect(result.slice(2).every((p) => p.isCurrentAtBat)).toBe(true);
  });

  it("does not duplicate pitches when the current AB is already logged", () => {
    const state = makeBaseState(
      [makePlay(0, [pitch(1)]), makePlay(1, [pitch(1), pitch(2)])],
      {
        batterId: 2,
        atBatPitches: [pitch(1), pitch(2)],
      },
    );

    const result = allPitchesThroughPoint(state, {
      currentAtBatPitches: [pitch(1), pitch(2)],
    });

    expect(result).toHaveLength(3);
    expect(result.filter((p) => p.isCurrentAtBat)).toHaveLength(2);
  });

  it("slices plays through a selected at-bat for historical replay", () => {
    const state = makeBaseState([
      makePlay(0, [pitch(1)]),
      makePlay(1, [pitch(1), pitch(2)]),
      makePlay(2, [pitch(1)]),
    ]);

    const result = allPitchesThroughPoint(state, { throughAtBatIndex: 1 });

    expect(result).toHaveLength(3);
    expect(result.filter((p) => p.isCurrentAtBat)).toHaveLength(2);
    expect(result[0].isCurrentAtBat).toBe(false);
    expect(result[1].isCurrentAtBat).toBe(true);
    expect(result[2].isCurrentAtBat).toBe(true);
  });

  it("skips non-at-bat plays when aggregating", () => {
    const steal = makePlay(1, [], {
      isAtBat: false,
      description: "Stolen base",
    });
    const state = makeBaseState([makePlay(0, [pitch(1)]), steal, makePlay(2, [pitch(1)])]);

    const result = allPitchesThroughPoint(state, { throughAtBatIndex: 2 });

    expect(result).toHaveLength(2);
    expect(result[0].chartKey).toBe("ab-0-p-0");
    expect(result[1].chartKey).toBe("ab-2-p-0");
  });
});
