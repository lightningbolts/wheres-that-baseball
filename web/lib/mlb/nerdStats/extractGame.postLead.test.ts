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

function extractBoth(plays: PlayByPlayEntry[], awayScore = 3, homeScore = 2) {
  vi.mocked(parseStoredGameState).mockReturnValue({ plays } as never);

  const row: GameNerdSourceRow = {
    game_pk: 1,
    game_date: "2026-06-01",
    season: 2026,
    away_team_id: AWAY_ID,
    home_team_id: HOME_ID,
    away_team_abbrev: "LAD",
    home_team_abbrev: "PIT",
    away_score: awayScore,
    home_score: homeScore,
    game_state: {},
    box_score: null,
    feed_synced_at: "2026-06-01T12:00:00.000Z",
  };

  const season = extractNerdCountersFromGame(row);
  return {
    away: season[String(AWAY_ID)]!,
    home: season[String(HOME_ID)]!,
  };
}

describe("post-lead next-inning runs allowed", () => {
  it("counts runs allowed in the half right after taking a lead", () => {
    const { away, home } = extractBoth([
      // Top 1: away takes a 1-0 lead
      makePlay({
        atBatIndex: 0,
        inning: 1,
        halfInning: "top",
        event: "Home Run",
        isScoringPlay: true,
        awayScore: 1,
        homeScore: 0,
        outs: 0,
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
      makePlay({
        atBatIndex: 1,
        inning: 1,
        halfInning: "top",
        event: "Strikeout",
        awayScore: 1,
        homeScore: 0,
        outs: 3,
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
      // Bottom 1: home scores 2 against the team that just took the lead
      makePlay({
        atBatIndex: 2,
        inning: 1,
        halfInning: "bottom",
        event: "Home Run",
        isScoringPlay: true,
        awayScore: 1,
        homeScore: 2,
        outs: 0,
        situationBefore: {
          awayScore: 1,
          homeScore: 0,
          outs: 0,
          bases: {},
          onFirst: false,
          onSecond: false,
          onThird: false,
        },
      }),
      makePlay({
        atBatIndex: 3,
        inning: 1,
        halfInning: "bottom",
        event: "Strikeout",
        awayScore: 1,
        homeScore: 2,
        outs: 3,
        situationBefore: {
          awayScore: 1,
          homeScore: 2,
          outs: 2,
          bases: {},
          onFirst: false,
          onSecond: false,
          onThird: false,
        },
      }),
    ]);

    expect(away.leadTakeNextInningOpportunities).toBe(1);
    expect(away.leadTakeNextInningRunsAllowed).toBe(2);
    expect(home.leadTakeNextInningOpportunities).toBe(0);
    expect(home.leadTakeNextInningRunsAllowed).toBe(0);
    expect(
      away.notableEvents.some(
        (event) => event.statId === "post-lead-runs-allowed" && event.value === 2,
      ),
    ).toBe(true);
  });

  it("does not count extending an existing lead as a lead take", () => {
    const { away } = extractBoth([
      makePlay({
        atBatIndex: 0,
        inning: 2,
        halfInning: "top",
        event: "Home Run",
        isScoringPlay: true,
        awayScore: 2,
        homeScore: 0,
        outs: 0,
        situationBefore: {
          awayScore: 1,
          homeScore: 0,
          outs: 0,
          bases: {},
          onFirst: false,
          onSecond: false,
          onThird: false,
        },
      }),
      makePlay({
        atBatIndex: 1,
        inning: 2,
        halfInning: "top",
        event: "Strikeout",
        awayScore: 2,
        homeScore: 0,
        outs: 3,
        situationBefore: {
          awayScore: 2,
          homeScore: 0,
          outs: 2,
          bases: {},
          onFirst: false,
          onSecond: false,
          onThird: false,
        },
      }),
      makePlay({
        atBatIndex: 2,
        inning: 2,
        halfInning: "bottom",
        event: "Home Run",
        isScoringPlay: true,
        awayScore: 2,
        homeScore: 1,
        outs: 0,
        situationBefore: {
          awayScore: 2,
          homeScore: 0,
          outs: 0,
          bases: {},
          onFirst: false,
          onSecond: false,
          onThird: false,
        },
      }),
    ]);

    expect(away.leadTakeNextInningOpportunities).toBe(0);
    expect(away.leadTakeNextInningRunsAllowed).toBe(0);
  });

  it("skips walk-off lead takes with no next half to defend", () => {
    const { home } = extractBoth(
      [
        makePlay({
          atBatIndex: 0,
          inning: 9,
          halfInning: "bottom",
          event: "Home Run",
          isScoringPlay: true,
          awayScore: 3,
          homeScore: 4,
          outs: 0,
          situationBefore: {
            awayScore: 3,
            homeScore: 3,
            outs: 0,
            bases: {},
            onFirst: false,
            onSecond: false,
            onThird: false,
          },
        }),
      ],
      3,
      4,
    );

    expect(home.leadTakeNextInningOpportunities).toBe(0);
    expect(home.leadTakeNextInningRunsAllowed).toBe(0);
  });
});
