"use client";

import { useMemo } from "react";

import {
  predictClientOutcomeOdds,
  predictClientStealOdds,
} from "@/lib/predictions/clientPredictor";
import { oddsStateKey } from "@/lib/predictions/buildPredictRequest";
import { selectPredictionForAtBat } from "@/lib/predictions/matchAtBat";
import {
  DEFAULT_OUTCOME_PROBABILITIES,
  normalizeOutcomeProbabilities,
  type OutcomeProbabilities,
  type Prediction,
  type StealProbabilities,
} from "@/types/database";
import type { MlPredictionSnapshot } from "@/hooks/useMlPredictions";
import type { LiveGameState } from "@/types/mlb-live";

export interface UseOutcomeOddsResult {
  probabilities: OutcomeProbabilities;
  stealProbabilities: StealProbabilities | null;
  matchedPrediction: Prediction | null;
  /** Stable key for chart re-mount / animation when the pitch state changes. */
  oddsKey: string;
  source: "ml" | "ingestor" | "client" | "none";
}

function hasNonZeroProbabilities(probs: OutcomeProbabilities): boolean {
  return Object.values(probs).some((v) => v > 0);
}

/**
 * Instant per-pitch outcome odds derived from the live feed count, with
 * on-demand ML (Render) and ingestor rows preferred when available.
 * Falls back to the client-side heuristic model for all counts including 0-0
 * so that baseline odds are always visible while ML cold-starts.
 */
export function useOutcomeOdds(
  atBatViewState: LiveGameState | null,
  predictions: Prediction[],
  ml?: MlPredictionSnapshot | null,
): UseOutcomeOddsResult {
  return useMemo(() => {
    if (!atBatViewState) {
      return {
        probabilities: DEFAULT_OUTCOME_PROBABILITIES,
        stealProbabilities: null,
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

    const situation = {
      outs: atBatViewState.outs,
      onFirst: atBatViewState.onFirst,
      onSecond: atBatViewState.onSecond,
      onThird: atBatViewState.onThird,
    };

    const match = {
      batterName: atBatViewState.batterName,
      inning: atBatViewState.inning,
      balls,
      strikes,
      pitchCount,
    };

    const ingestorMatch = selectPredictionForAtBat(predictions, match);

    const oddsKey = oddsStateKey(atBatViewState);

    if (
      ml?.probabilities &&
      ml.oddsKey === oddsKey &&
      hasNonZeroProbabilities(ml.probabilities)
    ) {
      return {
        probabilities: ml.probabilities,
        stealProbabilities:
          ml.stealProbabilities ?? predictClientStealOdds(situation),
        matchedPrediction: ingestorMatch,
        oddsKey: `ml-${oddsKey}`,
        source: "ml" as const,
      };
    }

    if (ingestorMatch && hasNonZeroProbabilities(normalizeOutcomeProbabilities(ingestorMatch.outcome_probabilities))) {
      return {
        probabilities: normalizeOutcomeProbabilities(ingestorMatch.outcome_probabilities),
        stealProbabilities: ingestorMatch.steal_probabilities ?? predictClientStealOdds(situation),
        matchedPrediction: ingestorMatch,
        oddsKey: `${ingestorMatch.id}-${oddsKey}`,
        source: "ingestor" as const,
      };
    }

    return {
      probabilities: predictClientOutcomeOdds(balls, strikes, pitchCount, seed, situation),
      stealProbabilities: predictClientStealOdds(situation),
      matchedPrediction: ingestorMatch,
      oddsKey,
      source: ingestorMatch ? "ingestor" as const : "client" as const,
    };
  }, [atBatViewState, predictions, ml]);
}
