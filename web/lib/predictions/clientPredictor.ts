import type { OutcomeProbabilities } from "@/types/database";

import {
  applySituationConstraints,
  impossibleOutcomeKeys,
} from "./situationConstraints";

export interface ClientPredictorSituation {
  outs?: number;
  onFirst?: boolean;
  onSecond?: boolean;
  onThird?: boolean;
}

type OutcomeWeights = Record<keyof OutcomeProbabilities, number>;

/** Deterministic pseudo-random in [0, 1) from an integer seed. */
function seededUnit(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Empirical-ish eventual PA outcome rates by count (league-average priors).
 * Tuned toward Baseball Savant / FanGraphs count-split tendencies rather than
 * a few hard-coded switch cases.
 */
const COUNT_PRIORS: Record<string, OutcomeWeights> = {
  "0-0": {
    strikeout: 0.187,
    walk: 0.083,
    hit_by_pitch: 0.009,
    single: 0.143,
    double: 0.045,
    triple: 0.004,
    home_run: 0.031,
    field_out: 0.498,
    gidp: 0,
    sac_fly: 0,
    sac_bunt: 0,
  },
  "0-1": {
    strikeout: 0.252,
    walk: 0.055,
    hit_by_pitch: 0.007,
    single: 0.132,
    double: 0.041,
    triple: 0.004,
    home_run: 0.027,
    field_out: 0.482,
    gidp: 0,
    sac_fly: 0,
    sac_bunt: 0,
  },
  "0-2": {
    strikeout: 0.396,
    walk: 0.035,
    hit_by_pitch: 0.005,
    single: 0.105,
    double: 0.032,
    triple: 0.003,
    home_run: 0.02,
    field_out: 0.404,
    gidp: 0,
    sac_fly: 0,
    sac_bunt: 0,
  },
  "1-0": {
    strikeout: 0.152,
    walk: 0.125,
    hit_by_pitch: 0.011,
    single: 0.15,
    double: 0.047,
    triple: 0.004,
    home_run: 0.035,
    field_out: 0.476,
    gidp: 0,
    sac_fly: 0,
    sac_bunt: 0,
  },
  "1-1": {
    strikeout: 0.213,
    walk: 0.078,
    hit_by_pitch: 0.008,
    single: 0.14,
    double: 0.044,
    triple: 0.004,
    home_run: 0.03,
    field_out: 0.483,
    gidp: 0,
    sac_fly: 0,
    sac_bunt: 0,
  },
  "1-2": {
    strikeout: 0.348,
    walk: 0.049,
    hit_by_pitch: 0.006,
    single: 0.112,
    double: 0.035,
    triple: 0.003,
    home_run: 0.022,
    field_out: 0.425,
    gidp: 0,
    sac_fly: 0,
    sac_bunt: 0,
  },
  "2-0": {
    strikeout: 0.116,
    walk: 0.204,
    hit_by_pitch: 0.013,
    single: 0.148,
    double: 0.047,
    triple: 0.004,
    home_run: 0.038,
    field_out: 0.43,
    gidp: 0,
    sac_fly: 0,
    sac_bunt: 0,
  },
  "2-1": {
    strikeout: 0.168,
    walk: 0.125,
    hit_by_pitch: 0.01,
    single: 0.145,
    double: 0.046,
    triple: 0.004,
    home_run: 0.034,
    field_out: 0.468,
    gidp: 0,
    sac_fly: 0,
    sac_bunt: 0,
  },
  "2-2": {
    strikeout: 0.286,
    walk: 0.081,
    hit_by_pitch: 0.007,
    single: 0.122,
    double: 0.038,
    triple: 0.003,
    home_run: 0.026,
    field_out: 0.437,
    gidp: 0,
    sac_fly: 0,
    sac_bunt: 0,
  },
  "3-0": {
    strikeout: 0.057,
    walk: 0.533,
    hit_by_pitch: 0.014,
    single: 0.1,
    double: 0.032,
    triple: 0.003,
    home_run: 0.028,
    field_out: 0.233,
    gidp: 0,
    sac_fly: 0,
    sac_bunt: 0,
  },
  "3-1": {
    strikeout: 0.094,
    walk: 0.316,
    hit_by_pitch: 0.012,
    single: 0.13,
    double: 0.041,
    triple: 0.004,
    home_run: 0.035,
    field_out: 0.368,
    gidp: 0,
    sac_fly: 0,
    sac_bunt: 0,
  },
  "3-2": {
    strikeout: 0.205,
    walk: 0.164,
    hit_by_pitch: 0.009,
    single: 0.14,
    double: 0.044,
    triple: 0.004,
    home_run: 0.033,
    field_out: 0.401,
    gidp: 0,
    sac_fly: 0,
    sac_bunt: 0,
  },
};

function countKey(balls: number, strikes: number): string {
  const b = Math.max(0, Math.min(3, balls));
  const s = Math.max(0, Math.min(2, strikes));
  return `${b}-${s}`;
}

function applySituationModifiers(
  weights: OutcomeWeights,
  situation: ClientPredictorSituation,
): OutcomeWeights {
  const w = { ...weights };
  const outs = situation.outs ?? 0;
  const onFirst = situation.onFirst ?? false;
  const onSecond = situation.onSecond ?? false;
  const onThird = situation.onThird ?? false;

  if (onFirst) {
    const gidp = outs < 2 ? 0.095 : 0.035;
    w.gidp = gidp;
    w.field_out = Math.max(0.05, w.field_out - gidp * 0.85);
  }
  if (onThird && outs < 2) {
    w.sac_fly = 0.055;
    w.field_out = Math.max(0.05, w.field_out - 0.045);
  }
  if ((onFirst || onSecond) && outs < 2) {
    // Sac bunts are rare league-wide; keep a small prior only with traffic.
    w.sac_bunt = onFirst && !onSecond && !onThird ? 0.012 : 0.006;
    w.field_out = Math.max(0.05, w.field_out - w.sac_bunt);
  }
  if (onSecond || onThird) {
    w.single += 0.015;
    w.double += 0.008;
    w.field_out = Math.max(0.05, w.field_out - 0.02);
  }
  // Two-out BIP skews slightly more toward hits (no force / SF pressure).
  if (outs >= 2) {
    w.single += 0.01;
    w.home_run += 0.005;
    w.field_out = Math.max(0.05, w.field_out - 0.015);
  }

  return w;
}

/**
 * Tiny deterministic drift from long at-bats (fouls) without drowning the
 * count prior the way ±3pp random jitter used to.
 */
function pitchCountDrift(
  weights: OutcomeWeights,
  pitchCount: number,
  seed: number,
  frozen: Set<keyof OutcomeProbabilities>,
): OutcomeWeights {
  const out = { ...weights };
  const foulExtra = Math.max(0, pitchCount - (weights.walk > 0.3 ? 3 : 4));
  if (foulExtra <= 0) return out;

  const fatigue = Math.min(0.04, foulExtra * 0.008);
  out.strikeout += fatigue * 0.55;
  out.field_out += fatigue * 0.25;
  out.walk = Math.max(0.01, out.walk - fatigue * 0.35);
  out.single = Math.max(0.02, out.single - fatigue * 0.2);

  const keys = Object.keys(out) as (keyof OutcomeProbabilities)[];
  keys.forEach((key, index) => {
    if (frozen.has(key) || out[key] <= 0) return;
    const delta = (seededUnit(seed + index * 17) - 0.5) * 0.012;
    out[key] = Math.max(0.001, out[key] + delta);
  });
  return out;
}

function normalize(weights: OutcomeWeights): OutcomeProbabilities {
  const sum = Object.values(weights).reduce((acc, v) => acc + v, 0);
  const out = {} as OutcomeProbabilities;
  for (const key of Object.keys(weights) as (keyof OutcomeProbabilities)[]) {
    out[key] = sum > 0 ? weights[key] / sum : 0;
  }
  return out;
}

/**
 * Count-aware client fallback when ML / ingestor odds are unavailable.
 * Uses league-average count priors with light situation + foul-count drift.
 */
export function predictClientOutcomeOdds(
  balls: number,
  strikes: number,
  pitchCount: number,
  seed: number,
  situation: ClientPredictorSituation = {},
): OutcomeProbabilities {
  const frozen = impossibleOutcomeKeys(situation);
  const prior = COUNT_PRIORS[countKey(balls, strikes)] ?? COUNT_PRIORS["0-0"]!;
  let weights = applySituationModifiers(prior, situation);

  for (const key of frozen) {
    weights[key] = 0;
  }

  weights = pitchCountDrift(weights, pitchCount, seed + pitchCount * 31, frozen);
  for (const key of frozen) {
    weights[key] = 0;
  }

  return applySituationConstraints(normalize(weights), situation);
}

export function predictClientStealOdds(
  situation: ClientPredictorSituation,
): { steal_attempt: number; steal_success: number } {
  if (!situation.onFirst && !situation.onSecond) {
    return { steal_attempt: 0, steal_success: 0 };
  }
  let attempt = 0.045;
  if (situation.onFirst && !situation.onSecond) attempt = 0.055;
  if (situation.onSecond && !situation.onFirst) attempt = 0.03;
  if ((situation.outs ?? 0) >= 2) attempt += 0.015;
  return { steal_attempt: attempt, steal_success: attempt * 0.74 };
}
