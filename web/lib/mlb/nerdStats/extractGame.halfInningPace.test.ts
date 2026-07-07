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

function makePitch() {
  return {
    pitchNumber: 1,
    typeCode: "FF",
    typeDescription: "Four-Seam",
    callDescription: "Ball",
    callCode: "B",
    balls: 0,
    strikes: 0,
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
    event: "Strikeout",
    description: "",
    awayScore: 0,
    homeScore: 0,
    outs: 1,
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
      event: "Strikeout",
      description: "",
      inning: 1,
      halfInning: "top",
      awayScore: 0,
      homeScore: 0,
      isScoringPlay: false,
      pitches: [makePitch()],
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
    away_score: 1,
    home_score: 0,
    game_state: {},
    box_score: null,
    feed_synced_at: "2026-06-01T12:00:00.000Z",
  };

  return {
    away: extractNerdCountersFromGame(row)[String(AWAY_ID)]!,
    home: extractNerdCountersFromGame(row)[String(HOME_ID)]!,
  };
}

function pitches(count: number) {
  return Array.from({ length: count }, () => makePitch());
}

describe("half-inning pace extraction", () => {
  it("tracks quick and marathon halves, min/max pitch counts, and ratio inputs", () => {
    const quickTop = makePlay({
      atBatIndex: 0,
      inning: 1,
      halfInning: "top",
      outs: 3,
      detail: {
        ...makePlay({}).detail,
        pitches: pitches(5),
      },
    });

    const marathonTop = makePlay({
      atBatIndex: 1,
      inning: 2,
      halfInning: "top",
      outs: 3,
      event: "Single",
      isScoringPlay: true,
      awayScore: 1,
      homeScore: 0,
      detail: {
        ...makePlay({}).detail,
        event: "Single",
        pitches: pitches(32),
      },
    });

    const quickBottom = makePlay({
      atBatIndex: 2,
      inning: 1,
      halfInning: "bottom",
      outs: 3,
      detail: {
        ...makePlay({}).detail,
        halfInning: "bottom",
        pitches: pitches(4),
      },
    });

    const { away, home } = extractFromPlays([quickTop, quickBottom, marathonTop]);

    expect(away.quickHalfInningsSeen).toBe(1);
    expect(away.longHalfInningsSeen).toBe(1);
    expect(away.shortestHalfInningPitchesSeen).toBe(5);
    expect(away.longestHalfInningPitchesSeen).toBe(32);
    expect(away.hits).toBe(1);
    expect(away.runsScored).toBe(1);
    expect(away.pitchesSeen).toBe(37);

    expect(home.quickHalfInningsThrown).toBe(1);
    expect(home.longHalfInningsThrown).toBe(1);
    expect(home.shortestHalfInningPitchesThrown).toBe(5);
    expect(home.longestHalfInningPitchesThrown).toBe(32);
    expect(home.hitsAllowed).toBe(1);
    expect(home.pitchesThrown).toBe(37);
  });
});
