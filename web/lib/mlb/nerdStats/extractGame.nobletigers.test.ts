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
    away_score: 0,
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

const loadedNoOuts = {
  awayScore: 0,
  homeScore: 0,
  outs: 0,
  bases: {},
  onFirst: true,
  onSecond: true,
  onThird: true,
};

const loadedOneOut = {
  ...loadedNoOuts,
  outs: 1,
};

describe("nobletigers extraction", () => {
  it("credits offense and defense when bases are loaded with nobody out and zero runs score", () => {
    const { away, home } = extractFromPlays([
      makePlay({
        atBatIndex: 0,
        event: "Strikeout",
        outs: 1,
        situationBefore: loadedNoOuts,
      }),
      makePlay({
        atBatIndex: 1,
        event: "Groundout",
        outs: 2,
        situationBefore: {
          ...loadedNoOuts,
          outs: 1,
        },
      }),
      makePlay({
        atBatIndex: 2,
        event: "Flyout",
        outs: 3,
        situationBefore: {
          ...loadedNoOuts,
          outs: 2,
        },
      }),
    ]);

    expect(away.nobletigers).toBe(1);
    expect(home.nobletigersInduced).toBe(1);
    expect(away.basesLoadedNoRuns).toBe(1);
    expect(away.notableEvents.some((e) => e.statId === "nobletigers")).toBe(true);
    expect(home.notableEvents.some((e) => e.statId === "nobletigers-induced")).toBe(true);
  });

  it("does not count bases loaded with an out already recorded as a nobletiger", () => {
    const { away, home } = extractFromPlays([
      makePlay({
        atBatIndex: 0,
        event: "Strikeout",
        outs: 2,
        situationBefore: loadedOneOut,
      }),
      makePlay({
        atBatIndex: 1,
        event: "Groundout",
        outs: 3,
        situationBefore: {
          ...loadedOneOut,
          outs: 2,
        },
      }),
    ]);

    expect(away.nobletigers).toBe(0);
    expect(home.nobletigersInduced).toBe(0);
    expect(away.basesLoadedNoRuns).toBe(1);
  });

  it("does not count a nobletiger when any run scores in the half", () => {
    const { away, home } = extractFromPlays([
      makePlay({
        atBatIndex: 0,
        event: "Single",
        isScoringPlay: true,
        awayScore: 1,
        homeScore: 0,
        outs: 0,
        situationBefore: loadedNoOuts,
        detail: {
          ...makePlay({}).detail,
          event: "Single",
          isScoringPlay: true,
          awayScore: 1,
          homeScore: 0,
        },
      }),
      makePlay({
        atBatIndex: 1,
        event: "Strikeout",
        outs: 3,
        awayScore: 1,
        situationBefore: {
          awayScore: 1,
          homeScore: 0,
          outs: 2,
          bases: {},
          onFirst: false,
          onSecond: false,
          onThird: false,
        },
      }),
    ]);

    expect(away.nobletigers).toBe(0);
    expect(home.nobletigersInduced).toBe(0);
    expect(away.basesLoadedNoRuns).toBe(0);
  });
});
