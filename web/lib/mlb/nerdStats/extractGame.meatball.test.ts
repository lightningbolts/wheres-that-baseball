import { describe, expect, it, vi } from "vitest";

import { extractNerdCountersFromGame } from "@/lib/mlb/nerdStats/extractGame";
import type { GameNerdSourceRow } from "@/lib/mlb/nerdStats/types";
import type { PlayByPlayEntry, PlayPitch } from "@/types/mlb-live";

vi.mock("@/lib/games/gameState", () => ({
  parseStoredGameState: vi.fn(),
}));

import { parseStoredGameState } from "@/lib/games/gameState";

const AWAY_ID = 119;
const HOME_ID = 134;

function makePitch(overrides: Partial<PlayPitch> = {}): PlayPitch {
  return {
    pitchNumber: 1,
    typeCode: "FF",
    typeDescription: "Four-Seam",
    callDescription: "In play, run(s)",
    callCode: "E",
    balls: 0,
    strikes: 0,
    startSpeed: 92,
    plateX: 0,
    plateZ: 2.5,
    isStrike: true,
    isBall: false,
    isInPlay: true,
    isOut: false,
    isPitch: true,
    hasPlateLocation: true,
    strikeZoneTop: 3.5,
    strikeZoneBottom: 1.5,
    ...overrides,
  };
}

function makePlay(overrides: Partial<PlayByPlayEntry>): PlayByPlayEntry {
  const baseDetail = {
    atBatIndex: 0,
    batterId: 1,
    batterName: "Judge",
    batterHits: 0,
    batterAtBats: 0,
    pitcherName: "Pitcher",
    pitcherId: 2,
    event: "Single",
    description: "Judge singles.",
    inning: 1,
    halfInning: "top",
    awayScore: 0,
    homeScore: 0,
    isScoringPlay: false,
    pitches: [makePitch()],
    hit: {
      launchSpeed: 105,
      launchAngle: 28,
      totalDistance: 380,
      trajectory: "line_drive",
      hardness: "hard",
      location: "8",
      coordX: 125,
      coordY: 100,
    },
  };

  return {
    atBatIndex: 0,
    inning: 1,
    halfInning: "top",
    batterId: 1,
    batterName: "Judge",
    batterHits: 0,
    batterAtBats: 0,
    event: "Single",
    description: "Judge singles.",
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
    detail: baseDetail,
    ...overrides,
  };
}

function extractFromPlays(plays: PlayByPlayEntry[]) {
  vi.mocked(parseStoredGameState).mockReturnValue({ plays } as never);

  const row: GameNerdSourceRow = {
    game_pk: 1,
    game_date: "2026-07-01",
    season: 2026,
    away_team_id: AWAY_ID,
    home_team_id: HOME_ID,
    away_team_abbrev: "LAD",
    home_team_abbrev: "PIT",
    away_score: 1,
    home_score: 0,
    game_state: {},
    box_score: null,
    feed_synced_at: "2026-07-01T00:00:00Z",
  };

  return extractNerdCountersFromGame(row);
}

describe("extractNerdCountersFromGame meatballs + how was that hit", () => {
  it("counts meatballs thrown/punished and contact grades", () => {
    const counters = extractFromPlays([makePlay({})]);
    const away = counters[String(AWAY_ID)]!;
    const home = counters[String(HOME_ID)]!;

    expect(away.meatballsSeen).toBe(1);
    expect(home.meatballsThrown).toBe(1);
    expect(away.meatballsInPlay).toBe(1);
    expect(away.meatballsPunished).toBe(1);
    expect(home.meatballsPunishedAllowed).toBe(1);
    expect(away.meatballBarrels).toBe(1);
    expect(away.hardHitBalls).toBe(1);
    expect(away.sweetSpotBalls).toBe(1);
    expect(away.launchSpeedAngleCount).toBe(1);
    expect(away.launchSpeedAngleSum).toBe(6);
  });

  it("counts meatball whiffs on swinging strikes", () => {
    const whiff = makePitch({
      isInPlay: false,
      isStrike: true,
      isBall: false,
      callCode: "S",
      callDescription: "Swinging Strike",
    });
    const play = makePlay({
      event: "Strikeout",
      description: "Judge strikes out swinging.",
      detail: {
        ...makePlay({}).detail,
        event: "Strikeout",
        description: "Judge strikes out swinging.",
        pitches: [whiff],
        hit: null,
      },
    });

    const counters = extractFromPlays([play]);
    expect(counters[String(AWAY_ID)]!.meatballWhiffs).toBe(1);
    expect(counters[String(HOME_ID)]!.meatballWhiffsInduced).toBe(1);
  });
});
