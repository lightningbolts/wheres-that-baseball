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
    onSecond: true,
    onThird: false,
    situationBefore: {
      awayScore: 0,
      homeScore: 0,
      outs: 0,
      bases: {},
      onFirst: false,
      onSecond: true,
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

describe("RISP extraction", () => {
  it("uses at-bats (not plate appearances) for RISP batting average inputs", () => {
    const counters = extractFromPlays([
      makePlay({ atBatIndex: 0, event: "Single" }),
      makePlay({
        atBatIndex: 1,
        event: "Walk",
        situationBefore: {
          awayScore: 0,
          homeScore: 0,
          outs: 0,
          bases: {},
          onFirst: false,
          onSecond: true,
          onThird: false,
        },
      }),
      makePlay({
        atBatIndex: 2,
        event: "Sacrifice Fly",
        situationBefore: {
          awayScore: 0,
          homeScore: 0,
          outs: 1,
          bases: {},
          onFirst: false,
          onSecond: false,
          onThird: true,
        },
      }),
      makePlay({
        atBatIndex: 3,
        event: "Strikeout",
        situationBefore: {
          awayScore: 0,
          homeScore: 0,
          outs: 0,
          bases: {},
          onFirst: true,
          onSecond: true,
          onThird: false,
        },
      }),
      makePlay({
        atBatIndex: 4,
        event: "Groundout",
        situationBefore: {
          awayScore: 0,
          homeScore: 0,
          outs: 0,
          bases: {},
          onFirst: false,
          onSecond: false,
          onThird: false,
        },
      }),
    ]);

    expect(counters.rispHits).toBe(1);
    expect(counters.rispPlateAppearances).toBe(4);
    expect(counters.rispAtBats).toBe(2);
    expect(counters.rispHits / counters.rispAtBats).toBeCloseTo(0.5, 5);
  });
});
