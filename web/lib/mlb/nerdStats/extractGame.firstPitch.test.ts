import { describe, expect, it, vi } from "vitest";

import { extractNerdCountersFromGame } from "@/lib/mlb/nerdStats/extractGame";
import { firstPitchOfAtBat } from "@/lib/mlb/nerdStats/extractHelpers";
import { getNerdStatDefinition } from "@/lib/mlb/nerdStats/definitions";
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
    callDescription: "Called Strike",
    callCode: "C",
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
    strikeZoneTop: 3.5,
    strikeZoneBottom: 1.5,
    ...overrides,
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

  return extractNerdCountersFromGame(row);
}

describe("firstPitchOfAtBat", () => {
  it("skips non-pitch feed events", () => {
    const pitches = [
      makePitch({ isPitch: false, callDescription: "Pickoff Attempt 1B" }),
      makePitch({
        pitchNumber: 1,
        callDescription: "Ball",
        callCode: "B",
        isBall: true,
        isStrike: false,
        balls: 1,
        strikes: 0,
      }),
    ];
    expect(firstPitchOfAtBat(pitches)?.callDescription).toBe("Ball");
  });
});

describe("first-pitch outcome extraction", () => {
  it("classifies first-pitch take, swing, and in-play results for both sides", () => {
    const season = extractFromPlays([
      makePlay({
        atBatIndex: 0,
        event: "Strikeout",
        detail: {
          ...makePlay({}).detail,
          event: "Strikeout",
          pitches: [
            makePitch({
              callDescription: "Called Strike",
              callCode: "C",
              isStrike: true,
              strikes: 1,
            }),
            makePitch({
              pitchNumber: 2,
              callDescription: "Swinging Strike",
              callCode: "S",
              isStrike: true,
              strikes: 2,
            }),
            makePitch({
              pitchNumber: 3,
              callDescription: "Swinging Strike",
              callCode: "S",
              isStrike: true,
              strikes: 3,
            }),
          ],
        },
      }),
      makePlay({
        atBatIndex: 1,
        event: "Walk",
        detail: {
          ...makePlay({}).detail,
          event: "Walk",
          pitches: [
            makePitch({
              callDescription: "Ball",
              callCode: "B",
              isBall: true,
              isStrike: false,
              balls: 1,
              strikes: 0,
            }),
            makePitch({
              pitchNumber: 2,
              callDescription: "Ball",
              callCode: "B",
              isBall: true,
              isStrike: false,
              balls: 2,
              strikes: 0,
            }),
          ],
        },
      }),
      makePlay({
        atBatIndex: 2,
        event: "Foul",
        detail: {
          ...makePlay({}).detail,
          event: "Field Out",
          pitches: [
            makePitch({
              callDescription: "Foul",
              callCode: "F",
              isStrike: true,
              isBall: false,
              isInPlay: false,
              strikes: 1,
            }),
            makePitch({
              pitchNumber: 2,
              callDescription: "In play, out(s)",
              callCode: "X",
              isInPlay: true,
              isStrike: true,
            }),
          ],
        },
      }),
      makePlay({
        atBatIndex: 3,
        event: "Home Run",
        detail: {
          ...makePlay({}).detail,
          event: "Home Run",
          pitches: [
            makePitch({
              callDescription: "In play, run(s)",
              callCode: "E",
              isInPlay: true,
              isStrike: true,
              isBall: false,
            }),
          ],
        },
      }),
      makePlay({
        atBatIndex: 4,
        event: "Swinging Strike",
        detail: {
          ...makePlay({}).detail,
          event: "Field Out",
          pitches: [
            makePitch({
              callDescription: "Swinging Strike",
              callCode: "S",
              isStrike: true,
              strikes: 1,
            }),
            makePitch({
              pitchNumber: 2,
              callDescription: "In play, out(s)",
              callCode: "X",
              isInPlay: true,
            }),
          ],
        },
      }),
    ]);

    const offense = season[String(AWAY_ID)]!;
    const defense = season[String(HOME_ID)]!;

    expect(offense.firstPitchesSeen).toBe(5);
    expect(defense.firstPitchesThrown).toBe(5);

    expect(offense.firstPitchCalledStrikes).toBe(1);
    expect(offense.firstPitchBalls).toBe(1);
    expect(offense.firstPitchFouls).toBe(1);
    expect(offense.firstPitchSwingingStrikes).toBe(1);
    expect(offense.firstPitchInPlay).toBe(1);
    expect(offense.firstPitchHits).toBe(1);
    expect(offense.firstPitchHomeRuns).toBe(1);
    expect(offense.firstPitchTotalBases).toBe(4);
    expect(offense.firstPitchStrikes).toBe(4); // called + foul + HR BIP + swinging
    expect(offense.firstPitchSwings).toBe(3); // foul + HR BIP + swinging

    expect(defense.firstPitchCalledStrikesInduced).toBe(1);
    expect(defense.firstPitchBallsThrown).toBe(1);
    expect(defense.firstPitchFoulsInduced).toBe(1);
    expect(defense.firstPitchSwingingStrikesInduced).toBe(1);
    expect(defense.firstPitchInPlayAllowed).toBe(1);
    expect(defense.firstPitchHitsAllowed).toBe(1);
    expect(defense.firstPitchHomeRunsAllowed).toBe(1);
    expect(defense.firstPitchTotalBasesAllowed).toBe(4);
    expect(defense.firstPitchStrikesThrown).toBe(4);

    expect(getNerdStatDefinition("first-pitch-strike-rate")?.compute(offense)).toBeCloseTo(
      (4 / 5) * 100,
      5,
    );
    expect(getNerdStatDefinition("first-pitch-avg")?.compute(offense)).toBeCloseTo(1, 5);
    expect(getNerdStatDefinition("first-pitch-slg")?.compute(offense)).toBeCloseTo(4, 5);
    expect(
      getNerdStatDefinition("first-pitch-strike-rate-pitching")?.compute(defense),
    ).toBeCloseTo((4 / 5) * 100, 5);
    expect(getNerdStatDefinition("first-pitch-avg-against")?.compute(defense)).toBeCloseTo(
      1,
      5,
    );
  });

  it("only counts the first pitch of each plate appearance", () => {
    const season = extractFromPlays([
      makePlay({
        atBatIndex: 0,
        event: "Single",
        detail: {
          ...makePlay({}).detail,
          event: "Single",
          pitches: [
            makePitch({
              callDescription: "Ball",
              callCode: "B",
              isBall: true,
              isStrike: false,
              balls: 1,
              strikes: 0,
            }),
            makePitch({
              pitchNumber: 2,
              callDescription: "In play, no out",
              callCode: "D",
              isInPlay: true,
              isStrike: true,
              isBall: false,
            }),
          ],
        },
      }),
    ]);

    const offense = season[String(AWAY_ID)]!;
    expect(offense.firstPitchesSeen).toBe(1);
    expect(offense.firstPitchBalls).toBe(1);
    expect(offense.firstPitchInPlay).toBe(0);
    expect(offense.firstPitchHits).toBe(0);
  });
});
