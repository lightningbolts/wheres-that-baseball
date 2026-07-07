import { describe, expect, it } from "vitest";

import { buildLiveInsightContext } from "@/lib/mlb/nerdInsights/context";
import type { LiveGameState, PlayByPlayEntry } from "@/types/mlb-live";

function play(overrides: Partial<PlayByPlayEntry> & Pick<PlayByPlayEntry, "atBatIndex" | "event">): PlayByPlayEntry {
  return {
    inning: 3,
    halfInning: "top",
    batterId: 1,
    batterName: "Test Batter",
    batterHits: 1,
    batterAtBats: 2,
    description: "Test",
    awayScore: 1,
    homeScore: 0,
    outs: 1,
    bases: {},
    onFirst: false,
    onSecond: false,
    onThird: false,
    situationBefore: {
      awayScore: 0,
      homeScore: 0,
      outs: 1,
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
      batterName: "Test Batter",
      batterHits: 1,
      batterAtBats: 2,
      pitcherName: "Pitcher",
      pitcherId: 2,
      event: overrides.event,
      description: "Test",
      inning: 3,
      halfInning: "top",
      awayScore: 1,
      homeScore: 0,
      isScoringPlay: false,
      pitches: [],
      hit: null,
    },
    ...overrides,
  };
}

function gameState(plays: PlayByPlayEntry[]): LiveGameState {
  return {
    gamePk: 99,
    venueId: null,
    venueName: null,
    gameStatus: "Live",
    awayTeam: "Away",
    awayAbbrev: "NYY",
    homeTeam: "Home",
    homeAbbrev: "BOS",
    awayRuns: 1,
    homeRuns: 0,
    batterId: 2,
    batterName: "Next Batter",
    pitcherName: "Pitcher",
    inning: 3,
    inningHalf: "Top",
    inningState: "Top",
    outs: 1,
    balls: 0,
    strikes: 0,
    onFirst: false,
    onSecond: false,
    onThird: false,
    offenseTeamId: null,
    atBatPitches: [],
    plays,
  } as LiveGameState;
}

describe("buildLiveInsightContext contact", () => {
  it("attaches Statcast fields from the completed at-bat", () => {
    const completed = play({
      atBatIndex: 4,
      event: "Single",
      detail: {
        atBatIndex: 4,
        batterId: 1,
        batterName: "Test Batter",
        batterHits: 1,
        batterAtBats: 2,
        pitcherName: "Pitcher",
        pitcherId: 2,
        event: "Single",
        description: "Test",
        inning: 3,
        halfInning: "top",
        awayScore: 1,
        homeScore: 0,
        isScoringPlay: false,
        pitches: [],
        hit: {
          launchSpeed: 102.4,
          launchAngle: 18,
          totalDistance: 310,
          trajectory: "fly_ball",
          hardness: "hard",
          location: "7",
          coordX: 100,
          coordY: 100,
          batSpeed: 74.2,
        },
      },
    });

    const ctx = buildLiveInsightContext(gameState([completed]), {
      type: "at-bat-end",
      atBatIndex: 4,
      event: "Single",
    });

    expect(ctx?.contact).toMatchObject({
      exitVelo: 102.4,
      launchAngle: 18,
      distance: 310,
      batSpeed: 74.2,
      isBarrel: true,
      isChop: false,
      isPopup: false,
    });
  });

  it("detects called strikeouts from play description", () => {
    const completed = play({
      atBatIndex: 4,
      event: "Strikeout",
      description: "J.P. Crawford called out on strikes.",
      detail: {
        atBatIndex: 4,
        batterId: 1,
        batterName: "J.P. Crawford",
        batterHits: 0,
        batterAtBats: 1,
        pitcherName: "Pitcher",
        pitcherId: 2,
        event: "Strikeout",
        description: "J.P. Crawford called out on strikes.",
        inning: 3,
        halfInning: "top",
        awayScore: 1,
        homeScore: 0,
        isScoringPlay: false,
        pitches: [
          {
            pitchNumber: 1,
            typeCode: "FF",
            typeDescription: "Four-Seam Fastball",
            callDescription: "Called Strike",
            callCode: "C",
            balls: 0,
            strikes: 1,
            startSpeed: 94,
            plateX: 0,
            plateZ: 2.5,
            isStrike: true,
            isBall: false,
            isInPlay: false,
            isOut: false,
            isPitch: true,
            strikeZoneTop: 3.5,
            strikeZoneBottom: 1.5,
          },
        ],
      },
    });

    const ctx = buildLiveInsightContext(gameState([completed]), {
      type: "at-bat-end",
      atBatIndex: 4,
      event: "Strikeout",
    });

    expect(ctx?.strikeoutKind).toBe("called");
  });
});
