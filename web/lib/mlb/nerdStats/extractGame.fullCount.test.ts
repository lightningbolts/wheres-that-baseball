import { describe, expect, it, vi } from "vitest";

import { extractNerdCountersFromGame } from "@/lib/mlb/nerdStats/extractGame";
import type { GameNerdSourceRow } from "@/lib/mlb/nerdStats/types";
import type { PlayByPlayEntry } from "@/types/mlb-live";

vi.mock("@/lib/games/gameState", () => ({
  parseStoredGameState: vi.fn(),
}));

import { parseStoredGameState } from "@/lib/games/gameState";

const AWAY_ID = 119;
const HOME_ID = 134;

function makePitch(balls: number, strikes: number) {
  return {
    pitchNumber: 1,
    typeCode: "FF",
    typeDescription: "Four-Seam",
    callDescription: "Ball",
    callCode: "B",
    balls,
    strikes,
    startSpeed: 95,
    plateX: 0,
    plateZ: 0,
    isStrike: false,
    isBall: true,
    isInPlay: false,
    isOut: false,
    isPitch: true,
    strikeZoneTop: 3.5,
    strikeZoneBottom: 1.5,
  };
}

function makePlay(overrides: Partial<PlayByPlayEntry>): PlayByPlayEntry {
  return {
    atBatIndex: 0,
    inning: 1,
    halfInning: "top",
    batterId: 1,
    batterName: "Batter",
    batterHits: 0,
    batterAtBats: 0,
    event: "Single",
    description: "",
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
      atBatIndex: 0,
      batterId: 1,
      batterName: "Batter",
      batterHits: 0,
      batterAtBats: 0,
      pitcherName: "Pitcher",
      pitcherId: 2,
      event: "Single",
      description: "",
      inning: 1,
      halfInning: "top",
      awayScore: 0,
      homeScore: 0,
      isScoringPlay: false,
      pitches: [],
      hit: null,
    },
    ...overrides,
  };
}

function extractFromPlays(plays: PlayByPlayEntry[]) {
  vi.mocked(parseStoredGameState).mockReturnValue({ plays } as never);

  const row: GameNerdSourceRow = {
    game_pk: 1,
    game_date: "2026-06-01",
    season: 2026,
    away_team_id: AWAY_ID,
    home_team_id: HOME_ID,
    away_team_abbrev: "LAD",
    home_team_abbrev: "PIT",
    away_score: 5,
    home_score: 3,
    game_state: {},
    box_score: null,
    feed_synced_at: "2026-06-01T12:00:00.000Z",
  };

  return extractNerdCountersFromGame(row)[String(AWAY_ID)]!;
}

function fangraphsObp(counters: {
  fullCountHits: number;
  fullCountAtBats: number;
  fullCountWalks: number;
  fullCountHbp: number;
  fullCountSacFlies: number;
}): number {
  const numerator =
    counters.fullCountHits + counters.fullCountWalks + counters.fullCountHbp;
  const denominator =
    counters.fullCountAtBats +
    counters.fullCountWalks +
    counters.fullCountHbp +
    counters.fullCountSacFlies;
  return numerator / denominator;
}

describe("full-count extraction", () => {
  it("uses Fangraphs OBP and SLG inputs for plate appearances that reached 3-2", () => {
    const counters = extractFromPlays([
      makePlay({
        atBatIndex: 0,
        event: "Single",
        detail: {
          ...makePlay({}).detail,
          event: "Single",
          pitches: [makePitch(1, 0), makePitch(2, 0), makePitch(2, 1)],
        },
      }),
      makePlay({
        atBatIndex: 1,
        event: "Double",
        detail: {
          ...makePlay({}).detail,
          event: "Double",
          pitches: [
            makePitch(1, 0),
            makePitch(1, 1),
            makePitch(2, 1),
            makePitch(2, 2),
            makePitch(3, 2),
            makePitch(3, 2),
          ],
        },
      }),
      makePlay({
        atBatIndex: 2,
        event: "Walk",
        detail: {
          ...makePlay({}).detail,
          event: "Walk",
          pitches: [makePitch(3, 2)],
        },
      }),
      makePlay({
        atBatIndex: 3,
        event: "Sacrifice Fly",
        detail: {
          ...makePlay({}).detail,
          event: "Sacrifice Fly",
          pitches: [makePitch(3, 2)],
        },
      }),
    ]);

    expect(counters.fullCountHits).toBe(1);
    expect(counters.fullCountAtBats).toBe(1);
    expect(counters.fullCountWalks).toBe(1);
    expect(counters.fullCountSacFlies).toBe(1);
    expect(counters.fullCountTotalBases).toBe(2);

    const obp = fangraphsObp(counters);
    const slg = counters.fullCountTotalBases / counters.fullCountAtBats;

    expect(obp).toBeCloseTo(2 / 3, 5);
    expect(slg).toBeCloseTo(2, 5);
    expect(obp + slg).toBeCloseTo(8 / 3, 5);
  });
});
