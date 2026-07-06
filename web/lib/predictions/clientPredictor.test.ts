import { describe, expect, it } from "vitest";

import { predictClientOutcomeOdds, predictClientStealOdds } from "./clientPredictor";
import { applySituationConstraints } from "./situationConstraints";

const emptyBases = { outs: 0, onFirst: false, onSecond: false, onThird: false };
const runnerOnFirst = { outs: 0, onFirst: true, onSecond: false, onThird: false };
const runnerOnThird = { outs: 0, onFirst: false, onSecond: false, onThird: true };

describe("predictClientOutcomeOdds", () => {
  it("zeros GIDP and sac fly with empty bases", () => {
    const probs = predictClientOutcomeOdds(0, 0, 0, 42, emptyBases);
    expect(probs.gidp).toBe(0);
    expect(probs.sac_fly).toBe(0);
    expect(probs.sac_bunt).toBe(0);
  });

  it("allows GIDP only with a runner on first", () => {
    const empty = predictClientOutcomeOdds(1, 1, 2, 99, emptyBases);
    const first = predictClientOutcomeOdds(1, 1, 2, 99, runnerOnFirst);
    expect(empty.gidp).toBe(0);
    expect(first.gidp).toBeGreaterThan(0);
  });

  it("allows sac fly only with a runner on third and fewer than two outs", () => {
    const empty = predictClientOutcomeOdds(1, 1, 2, 7, emptyBases);
    const third = predictClientOutcomeOdds(1, 1, 2, 7, runnerOnThird);
    const twoOuts = predictClientOutcomeOdds(1, 1, 2, 7, { ...runnerOnThird, outs: 2 });
    expect(empty.sac_fly).toBe(0);
    expect(third.sac_fly).toBeGreaterThan(0);
    expect(twoOuts.sac_fly).toBe(0);
  });
});

describe("predictClientStealOdds", () => {
  it("returns zero steal odds with empty bases", () => {
    expect(predictClientStealOdds(emptyBases)).toEqual({
      steal_attempt: 0,
      steal_success: 0,
    });
  });
});

describe("applySituationConstraints", () => {
  it("strips impossible ML tails and renormalizes", () => {
    const adjusted = applySituationConstraints(
      {
        strikeout: 0.2,
        walk: 0.1,
        hit_by_pitch: 0.01,
        single: 0.2,
        double: 0.05,
        triple: 0.01,
        home_run: 0.04,
        field_out: 0.2,
        gidp: 0.06,
        sac_fly: 0.01,
        sac_bunt: 0.02,
      },
      emptyBases,
    );
    expect(adjusted.gidp).toBe(0);
    expect(adjusted.sac_fly).toBe(0);
    expect(adjusted.sac_bunt).toBe(0);
    const sum = Object.values(adjusted).reduce((acc, value) => acc + value, 0);
    expect(sum).toBeCloseTo(1, 5);
  });
});
