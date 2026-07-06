import type { OutcomeProbabilities } from "@/types/database";

export interface ClientPredictorSituation {
  outs?: number;
  onFirst?: boolean;
  onSecond?: boolean;
  onThird?: boolean;
}

/** Deterministic pseudo-random in [0, 1) from an integer seed. */
function seededUnit(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function baseWeights(
  balls: number,
  strikes: number,
  situation: ClientPredictorSituation,
): Record<keyof OutcomeProbabilities, number> {
  const w: Record<keyof OutcomeProbabilities, number> = {
    strikeout: 0.21,
    walk: 0.08,
    hit_by_pitch: 0.01,
    single: 0.13,
    double: 0.04,
    triple: 0.005,
    home_run: 0.03,
    field_out: 0.32,
    gidp: 0.04,
    sac_fly: 0.025,
    sac_bunt: 0.015,
  };

  const outs = situation.outs ?? 0;
  const onFirst = situation.onFirst ?? false;
  const onSecond = situation.onSecond ?? false;
  const onThird = situation.onThird ?? false;

  if (onFirst && outs < 2) {
    w.gidp += 0.06;
    w.field_out -= 0.04;
  }
  if (onThird && outs < 2) {
    w.sac_fly += 0.08;
    w.field_out -= 0.06;
  }
  if (onSecond || onThird) {
    w.single += 0.02;
    w.double += 0.01;
  }

  switch (true) {
    case balls >= 3 && strikes === 0:
      w.walk = 0.45;
      w.single = 0.14;
      w.field_out = 0.10;
      w.strikeout = 0.05;
      break;
    case balls === 3 && strikes <= 1:
      w.walk = 0.38;
      w.strikeout = 0.08;
      break;
    case strikes >= 2 && balls === 0:
      w.strikeout = 0.52;
      w.walk = 0.03;
      w.field_out = 0.18;
      break;
    case strikes === 2:
      w.strikeout = 0.36;
      w.field_out = 0.22;
      break;
    case balls === 3 && strikes === 2:
      w.walk = 0.20;
      w.strikeout = 0.20;
      w.single = 0.16;
      w.home_run = 0.10;
      break;
  }

  return w;
}

function jitter(
  weights: Record<keyof OutcomeProbabilities, number>,
  seed: number,
): Record<keyof OutcomeProbabilities, number> {
  const out = { ...weights };
  const keys = Object.keys(out) as (keyof OutcomeProbabilities)[];
  keys.forEach((key, index) => {
    const delta = (seededUnit(seed + index * 17) - 0.5) * 0.06;
    out[key] = Math.max(0.001, out[key] + delta);
  });
  return out;
}

function normalize(weights: Record<keyof OutcomeProbabilities, number>): OutcomeProbabilities {
  const sum = Object.values(weights).reduce((acc, v) => acc + v, 0);
  const out = {} as OutcomeProbabilities;
  for (const key of Object.keys(weights) as (keyof OutcomeProbabilities)[]) {
    out[key] = weights[key] / sum;
  }
  return out;
}

/**
 * Mirrors the ingestor mock predictor — cheap, synchronous, and keyed by pitch
 * ordinal so odds still shift on fouls with an unchanged count.
 */
export function predictClientOutcomeOdds(
  balls: number,
  strikes: number,
  pitchCount: number,
  seed: number,
  situation: ClientPredictorSituation = {},
): OutcomeProbabilities {
  const weights = jitter(baseWeights(balls, strikes, situation), seed + pitchCount * 31);
  return normalize(weights);
}

export function predictClientStealOdds(
  situation: ClientPredictorSituation,
): { steal_attempt: number; steal_success: number } {
  if (!situation.onFirst && !situation.onSecond) {
    return { steal_attempt: 0, steal_success: 0 };
  }
  const attempt = 0.04 + (situation.onSecond ? 0.01 : 0);
  return { steal_attempt: attempt, steal_success: attempt * 0.72 };
}
