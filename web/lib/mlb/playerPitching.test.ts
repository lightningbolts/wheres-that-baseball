import { describe, expect, it } from "vitest";

import {
  buildPitchMixFromThrown,
  parseSavantExpectedPitcherCsv,
} from "@/lib/mlb/playerPitching";
import { createEmptyPitchTypesThrown } from "@/lib/mlb/nerdStats/pitchTypeStats";

describe("buildPitchMixFromThrown", () => {
  it("computes percentages and averages", () => {
    const thrown = createEmptyPitchTypesThrown();
    thrown.FF = {
      count: 60,
      velocitySum: 60 * 95,
      spinSum: 60 * 2200,
      hBreakSum: 60 * -5,
      vBreakSum: 60 * 15,
    };
    thrown.SL = {
      count: 40,
      velocitySum: 40 * 85,
      spinSum: 40 * 2400,
      hBreakSum: 40 * 3,
      vBreakSum: 40 * -2,
    };

    const mix = buildPitchMixFromThrown(thrown);
    expect(mix.totalPitches).toBe(100);
    expect(mix.pitches[0]!.code).toBe("FF");
    expect(mix.pitches[0]!.pct).toBeCloseTo(0.6);
    expect(mix.pitches[0]!.avgVelocity).toBeCloseTo(95);
    expect(mix.pitches[1]!.code).toBe("SL");
    expect(mix.pitches[1]!.pct).toBeCloseTo(0.4);
  });
});

describe("parseSavantExpectedPitcherCsv", () => {
  it("maps player_id to formatted xERA", () => {
    const csv = [
      '"last_name, first_name","player_id","year","era","xera"',
      '"Alcantara, Sandy","645261","2026","4.01","3.75"',
      '"Sánchez, Cristopher","650911","2026","2.71","3.31"',
    ].join("\n");

    const map = parseSavantExpectedPitcherCsv(csv);
    expect(map.get(645261)).toBe("3.75");
    expect(map.get(650911)).toBe("3.31");
  });
});
