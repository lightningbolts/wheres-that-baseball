import { describe, expect, it } from "vitest";

import {
  absChallengesRemainingAtReplayPoint,
  gameStateForAtBat,
  playsThroughAtBat,
} from "@/lib/games/replay";
import type { LiveGameState, PlayByPlayEntry } from "@/types/mlb-live";

function makePlay(
  overrides: Partial<PlayByPlayEntry> & Pick<PlayByPlayEntry, "atBatIndex" | "description">,
): PlayByPlayEntry {
  return {
    inning: 1,
    halfInning: "top",
    batterId: 1,
    batterName: "Batter",
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
    detail: {
      atBatIndex: overrides.atBatIndex,
      batterId: 1,
      batterName: "Batter",
      batterHits: 0,
      batterAtBats: 0,
      pitcherName: "Pitcher",
      pitcherId: 2,
      event: "Single",
      description: overrides.description,
      inning: overrides.inning ?? 1,
      halfInning: overrides.halfInning ?? "top",
      awayScore: 0,
      homeScore: 0,
      isScoringPlay: false,
      pitches: overrides.detail?.pitches ?? [],
      hit: null,
    },
    ...overrides,
  };
}

function makeBaseState(plays: PlayByPlayEntry[]): LiveGameState {
  return {
    gamePk: 1,
    venueId: null,
    venueName: null,
    gameStatus: "Final",
    awayTeam: "Toronto Blue Jays",
    awayAbbrev: "TOR",
    homeTeam: "Seattle Mariners",
    homeAbbrev: "SEA",
    awayRuns: 3,
    homeRuns: 2,
    batterId: null,
    batterName: "—",
    onDeckId: null,
    onDeckName: "—",
    inHoleId: null,
    inHoleName: "—",
    offenseTeamId: null,
    battingOrderSlot: null,
    pitcherId: null,
    pitcherName: "—",
    inning: 9,
    inningHalf: "bottom",
    inningState: "End",
    balls: 0,
    strikes: 0,
    outs: 0,
    onFirst: false,
    onSecond: false,
    onThird: false,
    awayAbsChallengesRemaining: 0,
    homeAbsChallengesRemaining: 0,
    atBatPitches: [],
    plays,
    observedAt: "2025-07-04T00:00:00.000Z",
  };
}

describe("playsThroughAtBat", () => {
  it("includes plays through the selected at-bat", () => {
    const plays = [
      makePlay({ atBatIndex: 0, description: "First out." }),
      makePlay({ atBatIndex: 1, description: "Second out." }),
      makePlay({ atBatIndex: 2, description: "Third out." }),
    ];

    expect(playsThroughAtBat(plays, 1)).toHaveLength(2);
    expect(playsThroughAtBat(plays, 1).at(-1)?.atBatIndex).toBe(1);
  });
});

describe("absChallengesRemainingAtReplayPoint", () => {
  it("decrements remaining challenges for the challenging team", () => {
    const plays = [
      makePlay({ atBatIndex: 0, description: "Ground out." }),
      makePlay({
        atBatIndex: 1,
        halfInning: "bottom",
        description:
          "Randy Arozarena challenged (pitch result), call on the field was confirmed: Randy Arozarena called out on strikes.",
        detail: {
          atBatIndex: 1,
          batterId: 1,
          batterName: "Randy Arozarena",
          batterHits: 0,
          batterAtBats: 1,
          pitcherName: "Kevin Gausman",
          pitcherId: 2,
          event: "Strikeout",
          description:
            "Randy Arozarena challenged (pitch result), call on the field was confirmed: Randy Arozarena called out on strikes.",
          inning: 1,
          halfInning: "bottom",
          awayScore: 0,
          homeScore: 0,
          isScoringPlay: false,
          hit: null,
          pitches: [
            {
              pitchNumber: 1,
              typeCode: "FF",
              typeDescription: "Four-Seam",
              callDescription: "Called Strike",
              callCode: "C",
              balls: 0,
              strikes: 1,
              startSpeed: 95,
              plateX: 0,
              plateZ: 2,
              isStrike: true,
              isBall: false,
              isInPlay: false,
              isOut: false,
              isPitch: true,
              strikeZoneTop: 3.5,
              strikeZoneBottom: 1.5,
            },
            {
              pitchNumber: 2,
              typeCode: "FF",
              typeDescription: "Four-Seam",
              callDescription: "Called Strike",
              callCode: "C",
              balls: 0,
              strikes: 2,
              startSpeed: 95,
              plateX: 0,
              plateZ: 2,
              isStrike: true,
              isBall: false,
              isInPlay: false,
              isOut: false,
              isPitch: true,
              strikeZoneTop: 3.5,
              strikeZoneBottom: 1.5,
              review: {
                isOverturned: false,
                reviewType: "MJ",
                challengeTeamId: 136,
              },
            },
          ],
        },
      }),
      makePlay({ atBatIndex: 2, description: "Fly out." }),
    ];

    const early = absChallengesRemainingAtReplayPoint(plays, plays[0]!, {
      awayTeamId: 141,
      homeTeamId: 136,
      awayTeamName: "Toronto Blue Jays",
      homeTeamName: "Seattle Mariners",
      awayAbbrev: "TOR",
      homeAbbrev: "SEA",
    });
    const afterChallenge = absChallengesRemainingAtReplayPoint(plays, plays[1]!, {
      awayTeamId: 141,
      homeTeamId: 136,
      awayTeamName: "Toronto Blue Jays",
      homeTeamName: "Seattle Mariners",
      awayAbbrev: "TOR",
      homeAbbrev: "SEA",
    });

    expect(early).toEqual({ away: 2, home: 2 });
    expect(afterChallenge).toEqual({ away: 2, home: 0 });
  });
});

describe("gameStateForAtBat", () => {
  it("uses replay ABS counts instead of the final game totals", () => {
    const plays = [
      makePlay({ atBatIndex: 0, description: "Pop out." }),
      makePlay({
        atBatIndex: 1,
        halfInning: "top",
        description: "Lineout.",
        detail: {
          atBatIndex: 1,
          batterId: 1,
          batterName: "Batter",
          batterHits: 0,
          batterAtBats: 1,
          pitcherName: "Pitcher",
          pitcherId: 2,
          event: "Lineout",
          description: "Lineout.",
          inning: 1,
          halfInning: "top",
          awayScore: 0,
          homeScore: 0,
          isScoringPlay: false,
          hit: null,
          pitches: [
            {
              pitchNumber: 1,
              typeCode: "FF",
              typeDescription: "Four-Seam",
              callDescription: "Called Strike",
              callCode: "C",
              balls: 0,
              strikes: 1,
              startSpeed: 95,
              plateX: 0,
              plateZ: 2,
              isStrike: true,
              isBall: false,
              isInPlay: false,
              isOut: false,
              isPitch: true,
              strikeZoneTop: 3.5,
              strikeZoneBottom: 1.5,
              review: { isOverturned: true, reviewType: "MJ" },
            },
          ],
        },
      }),
    ];

    const base = makeBaseState(plays);
    const replay = gameStateForAtBat(base, plays[0]!, {
      awayTeamId: 141,
      homeTeamId: 136,
    });

    expect(replay.awayAbsChallengesRemaining).toBe(2);
    expect(replay.homeAbsChallengesRemaining).toBe(2);
    expect(base.awayAbsChallengesRemaining).toBe(0);
  });

  it("prefers stamped ABS remaining on the selected play entry", () => {
    const plays = [
      makePlay({
        atBatIndex: 0,
        description: "Ground out.",
        awayAbsChallengesRemaining: 2,
        homeAbsChallengesRemaining: 2,
      }),
      makePlay({
        atBatIndex: 1,
        description: "Strikeout after failed challenge.",
        awayAbsChallengesRemaining: 2,
        homeAbsChallengesRemaining: 0,
      }),
    ];

    const base = makeBaseState(plays);
    const early = gameStateForAtBat(base, plays[0]!, {
      awayTeamId: 141,
      homeTeamId: 136,
    });
    const afterChallenge = gameStateForAtBat(base, plays[1]!, {
      awayTeamId: 141,
      homeTeamId: 136,
    });

    expect(early.awayAbsChallengesRemaining).toBe(2);
    expect(early.homeAbsChallengesRemaining).toBe(2);
    expect(afterChallenge.homeAbsChallengesRemaining).toBe(0);
  });
});
