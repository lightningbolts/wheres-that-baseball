import { describe, expect, it } from "vitest";

import { deriveDefense } from "@/lib/mlb/fieldDefense";
import type { GameBoxScore } from "@/types/mlb-boxscore";

function makeBoxScore(): GameBoxScore {
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
      teamId: 10,
      abbrev: "AWY",
      name: "Away",
      batters: [
        {
          playerId: 1,
          name: "Left Fielder",
          note: "",
          positions: "LF",
          batSide: "R",
          atBats: 0,
          runs: 0,
          hits: 0,
          rbi: 0,
          walks: 0,
          strikeOuts: 0,
          seasonAvg: ".000",
          seasonOps: ".000",
        },
        {
          playerId: 2,
          name: "Shortstop",
          note: "",
          positions: "SS",
          batSide: "R",
          atBats: 0,
          runs: 0,
          hits: 0,
          rbi: 0,
          walks: 0,
          strikeOuts: 0,
          seasonAvg: ".000",
          seasonOps: ".000",
        },
        {
          playerId: 3,
          name: "Designated",
          note: "",
          positions: "DH",
          batSide: "L",
          atBats: 0,
          runs: 0,
          hits: 0,
          rbi: 0,
          walks: 0,
          strikeOuts: 0,
          seasonAvg: ".000",
          seasonOps: ".000",
        },
      ],
      pitchers: [
        {
          playerId: 99,
          name: "Starter",
          note: "",
          inningsPitched: "1.0",
          hits: 0,
          runs: 0,
          earnedRuns: 0,
          walks: 0,
          strikeOuts: 0,
          homeRuns: 0,
          seasonEra: "0.00",
        },
      ],
      pitchingTotals: null,
      bench: [],
      bullpen: [],
    },
    home: {
      teamId: 20,
      abbrev: "HME",
      name: "Home",
      batters: [],
      pitchers: [],
      pitchingTotals: null,
      bench: [],
      bullpen: [],
    },
    decisions: { winner: null, loser: null, save: null },
    info: [],
    observedAt: "2025-01-01T00:00:00.000Z",
  };
}

describe("deriveDefense", () => {
  it("maps fielding team positions and active pitcher", () => {
    const defense = deriveDefense(makeBoxScore(), 20, 55, "Reliever");
    expect(defense.map((d) => d.position)).toEqual(["LF", "SS", "P"]);
    expect(defense.find((d) => d.position === "P")?.name).toBe("Reliever");
    expect(defense.find((d) => d.position === "P")?.playerId).toBe(55);
    expect(defense.some((d) => d.name === "Designated")).toBe(false);
  });

  it("falls back to box-score pitcher when live pitcher missing", () => {
    const defense = deriveDefense(makeBoxScore(), 20, null, "—");
    expect(defense.find((d) => d.position === "P")?.name).toBe("Starter");
  });

  it("returns empty when box score or offense team missing", () => {
    expect(deriveDefense(null, 20, 1, "P")).toEqual([]);
    expect(deriveDefense(makeBoxScore(), null, 1, "P")).toEqual([]);
  });
});
