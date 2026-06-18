"use client";

import { useMemo } from "react";

import { predictClientOutcomeOdds } from "@/lib/predictions/clientPredictor";
import { selectPredictionForAtBat } from "@/lib/predictions/matchAtBat";
import {
  DEFAULT_OUTCOME_PROBABILITIES,
  type OutcomeProbabilities,
  type Prediction,
} from "@/types/database";
import type { LiveGameState } from "@/types/mlb-live";

export interface UseOutcomeOddsResult {
  probabilities: OutcomeProbabilities;
  matchedPrediction: Prediction | null;
  /** Stable key for chart re-mount / animation when the pitch state changes. */
  oddsKey: string;
  source: "ingestor" | "client" | "none";
}

/**
 * Instant per-pitch outcome odds derived from the live feed count, with
 * ingestor rows preferred when they match. No network — runs in the same
 * render as pitch updates.
 */
export function useOutcomeOdds(
  atBatViewState: LiveGameState | null,
  predictions: Prediction[],
): UseOutcomeOddsResult {
  return useMemo(() => {
    if (!atBatViewState) {
      return {
        probabilities: DEFAULT_OUTCOME_PROBABILITIES,
        matchedPrediction: null,
        oddsKey: "none",
        source: "none" as const,
      };
    }

    const balls = atBatViewState.balls;
    const strikes = atBatViewState.strikes;
    const pitchCount = atBatViewState.atBatPitches.length;
    const seed =
      atBatViewState.gamePk * 97 +
      (atBatViewState.batterId ?? 0) * 13 +
      atBatViewState.inning * 3;

    const match = {
      batterName: atBatViewState.batterName,
      inning: atBatViewState.inning,
      balls,
      strikes,
      pitchCount,
    };

    const ingestorMatch = selectPredictionForAtBat(predictions, match);

    const oddsKey = `${atBatViewState.batterId ?? 0}-${balls}-${strikes}-${pitchCount}`;

    if (ingestorMatch) {
      return {
        probabilities: ingestorMatch.outcome_probabilities,
        matchedPrediction: ingestorMatch,
        oddsKey: `${ingestorMatch.id}-${oddsKey}`,
        source: "ingestor" as const,
      };
    }

    if (pitchCount === 0 && balls === 0 && strikes === 0) {
      return {
        probabilities: DEFAULT_OUTCOME_PROBABILITIES,
        matchedPrediction: null,
        oddsKey,
        source: "none" as const,
      };
    }

    return {
      probabilities: predictClientOutcomeOdds(balls, strikes, pitchCount, seed),
      matchedPrediction: null,
      oddsKey,
      source: "client" as const,
    };
  }, [atBatViewState, predictions]);
}
