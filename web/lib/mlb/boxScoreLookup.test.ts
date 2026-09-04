import { describe, expect, it } from "vitest";

import { resolveBatSide } from "@/lib/mlb/boxScoreLookup";
import type { GameBoxScore } from "@/types/mlb-boxscore";

function makeBoxScore(batSide: string, playerId = 10, teamId = 100): GameBoxScore {
  return {
    gamePk: 1,
    awayAbbrev: "AWY",
    homeAbbrev: "HME",
    lineScore: {
      scheduledInnings: 9,
      away: { runs: 0, hits: 0, errors: 0 },
      home: { runs: 0, hits: 0, errors: 0 },
      innings: [],
    },
    away: {
      teamId: 200,
      abbrev: "AWY",
      name: "Away",
      batters: [],
      pitchers: [],
      pitchingTotals: null,
      bench: [],
      bullpen: [],
    },
    home: {
      teamId,
      abbrev: "HME",
      name: "Home",
      batters: [
        {
          playerId,
          name: "Batter",
          note: "",
          positions: "CF",
          batSide,
          atBats: 1,
          runs: 0,
          hits: 0,
          rbi: 0,
          walks: 0,
          strikeOuts: 0,
          seasonAvg: ".250",
          seasonOps: ".700",
        },
      ],
      pitchers: [],
      pitchingTotals: null,
      bench: [],
      bullpen: [],
    },
    decisions: { winner: null, loser: null, save: null },
    info: [],
    observedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("resolveBatSide", () => {
  it("prefers live matchup stand over box score", () => {
    expect(resolveBatSide("L", makeBoxScore("R"), 10, 100)).toBe("L");
    expect(resolveBatSide("r", makeBoxScore("L"), 10, 100)).toBe("R");
  });

  it("falls back to box-score batSide", () => {
    expect(resolveBatSide(null, makeBoxScore("L"), 10, 100)).toBe("L");
    expect(resolveBatSide(undefined, makeBoxScore("R"), 10, 100)).toBe("R");
  });

  it("maps switch hitters without a live stand to R", () => {
    expect(resolveBatSide(null, makeBoxScore("S"), 10, 100)).toBe("R");
  });

  it("returns null when unknown", () => {
    expect(resolveBatSide(null, null, 10, 100)).toBeNull();
    expect(resolveBatSide("S", null, 10, 100)).toBeNull();
  });
});
