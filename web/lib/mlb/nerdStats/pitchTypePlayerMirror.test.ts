import { describe, expect, it, vi } from "vitest";

import { extractNerdCountersFromGame } from "@/lib/mlb/nerdStats/extractGame";
import type { GameNerdSourceRow, SeasonPlayerNerdCounters } from "@/lib/mlb/nerdStats/types";
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
    callDescription: "Swinging Strike",
    callCode: "S",
    balls: 0,
    strikes: 1,
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
    spinRate: 2200,
    breakHorizontal: -4,
    breakVerticalInduced: 14,
    ...overrides,
  };
}

function makePlay(overrides: Partial<PlayByPlayEntry> = {}): PlayByPlayEntry {
  return {
    atBatIndex: 0,
    inning: 1,
    halfInning: "top",
    batterId: 1,
    batterName: "Judge",
    batterHits: 0,
    batterAtBats: 1,
    event: "Strikeout",
    description: "Judge strikes out swinging.",
    awayScore: 0,
    homeScore: 0,
    outs: 1,
    bases: {},
    onFirst: false,
    onSecond: false,
    onThird: false,
    situationBefore: {
      outs: 0,
      bases: {},
      onFirst: false,
      onSecond: false,
      onThird: false,
      awayScore: 0,
      homeScore: 0,
    },
    isScoringPlay: false,
    isAtBat: true,
    detail: {
      atBatIndex: 0,
      batterId: 1,
      batterName: "Judge",
      batterHits: 0,
      batterAtBats: 1,
      pitcherName: "Ace",
      pitcherId: 20,
      event: "Strikeout",
      description: "Judge strikes out swinging.",
      inning: 1,
      halfInning: "top",
      awayScore: 0,
      homeScore: 0,
      isScoringPlay: false,
      pitches: [
        makePitch({ pitchNumber: 1, typeCode: "FF", startSpeed: 95 }),
        makePitch({ pitchNumber: 2, typeCode: "SL", startSpeed: 86 }),
        makePitch({ pitchNumber: 3, typeCode: "FF", startSpeed: 96 }),
      ],
      hit: null,
    },
    ...overrides,
  };
}

describe("pitchTypesThrown player mirror", () => {
  it("records pitch mix onto the mirrored pitcher counters", () => {
    vi.mocked(parseStoredGameState).mockReturnValue({
      plays: [makePlay()],
      venueId: 3,
    } as ReturnType<typeof parseStoredGameState>);

    const row: GameNerdSourceRow = {
      game_pk: 1,
      game_date: "2026-07-01",
      season: 2026,
      away_team_id: AWAY_ID,
      home_team_id: HOME_ID,
      away_team_abbrev: "LAD",
      home_team_abbrev: "OAK",
      away_score: 0,
      home_score: 1,
      game_state: {},
      box_score: null,
      feed_synced_at: "2026-07-01T20:00:00Z",
    };

    const playerOut: SeasonPlayerNerdCounters = {};
    extractNerdCountersFromGame(row, "all", playerOut);

    const pitcher = playerOut["20"];
    expect(pitcher).toBeDefined();
    expect(pitcher!.pitchTypesThrown.FF?.count).toBe(2);
    expect(pitcher!.pitchTypesThrown.SL?.count).toBe(1);
    expect(pitcher!.pitchesThrown).toBeGreaterThan(0);
  });
});
