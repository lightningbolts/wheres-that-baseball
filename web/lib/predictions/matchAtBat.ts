import type { Prediction } from "@/types/database";

export interface AtBatPredictionMatch {
  batterName?: string;
  inning?: number;
  balls?: number;
  strikes?: number;
  /** Pitches thrown this at-bat — disambiguates fouls with an unchanged count. */
  pitchCount?: number;
}

function normalizeBatterName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function batterNamesMatch(a: string, b: string): boolean {
  return normalizeBatterName(a) === normalizeBatterName(b);
}

/** Pick the prediction row that matches the current plate appearance count. */
export function selectPredictionForAtBat(
  predictions: Prediction[],
  match: AtBatPredictionMatch | null | undefined,
): Prediction | null {
  if (predictions.length === 0) return null;
  if (!match?.batterName) return predictions.at(-1) ?? null;

  const sameAtBat = predictions.filter(
    (prediction) =>
      batterNamesMatch(prediction.batter_name, match.batterName!) &&
      prediction.inning === match.inning,
  );
  if (sameAtBat.length === 0) return null;

  const balls = match.balls ?? 0;
  const strikes = match.strikes ?? 0;

  const exactCount = sameAtBat.filter(
    (prediction) => prediction.balls === balls && prediction.strikes === strikes,
  );
  if (exactCount.length > 0) {
    // Prefer the newest row — multiple pitches can share a count (e.g. foul on 2 strikes).
    return exactCount.at(-1) ?? null;
  }

  const pitchOrdinal = match.pitchCount ?? balls + strikes;

  let best: Prediction | null = null;
  let bestOrdinal = -1;

  for (const prediction of sameAtBat) {
    const ordinal = prediction.balls + prediction.strikes;
    if (ordinal > pitchOrdinal) continue;
    if (ordinal > bestOrdinal) {
      best = prediction;
      bestOrdinal = ordinal;
    }
  }

  return best;
}
