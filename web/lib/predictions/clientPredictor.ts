import type { OutcomeProbabilities } from "@/types/database";

/** Deterministic pseudo-random in [0, 1) from an integer seed. */
function seededUnit(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function baseWeights(balls: number, strikes: number): Record<keyof OutcomeProbabilities, number> {
  const w: Record<keyof OutcomeProbabilities, number> = {
    strikeout: 0.18,
    walk: 0.08,
    single: 0.22,
    double: 0.07,
    triple: 0.01,
    home_run: 0.09,
    field_out: 0.35,
  };

  switch (true) {
    case balls >= 3 && strikes === 0:
      w.walk = 0.48;
      w.single = 0.15;
      w.field_out = 0.12;
      w.strikeout = 0.05;
      break;
    case balls === 3 && strikes <= 1:
      w.walk = 0.42;
      w.strikeout = 0.08;
      break;
    case strikes >= 2 && balls === 0:
      w.strikeout = 0.55;
      w.walk = 0.03;
      w.field_out = 0.22;
      break;
    case strikes === 2:
      w.strikeout = 0.38;
      w.field_out = 0.28;
      break;
    case balls === 3 && strikes === 2:
      w.walk = 0.22;
      w.strikeout = 0.22;
      w.single = 0.18;
      w.home_run = 0.12;
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
): OutcomeProbabilities {
  const weights = jitter(baseWeights(balls, strikes), seed + pitchCount * 31);
  return normalize(weights);
}
