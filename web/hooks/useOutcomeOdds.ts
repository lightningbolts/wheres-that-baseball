"use client";

import { useMemo } from "react";

import {
  predictClientOutcomeOdds,
  predictClientStealOdds,
} from "@/lib/predictions/clientPredictor";
import { oddsStateKey } from "@/lib/predictions/buildPredictRequest";
import {
  applySituationConstraints,
  clampStealProbabilities,
} from "@/lib/predictions/situationConstraints";
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

function finalizeOdds(
  probabilities: OutcomeProbabilities,
  stealProbabilities: StealProbabilities | null,
  situation: {
    outs: number;
    onFirst: boolean;
    onSecond: boolean;
    onThird: boolean;
  },
): { probabilities: OutcomeProbabilities; stealProbabilities: StealProbabilities | null } {
  return {
    probabilities: applySituationConstraints(probabilities, situation),
    stealProbabilities: clampStealProbabilities(stealProbabilities, situation),
  };
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
      const finalized = finalizeOdds(
        ml.probabilities,
        ml.stealProbabilities ?? predictClientStealOdds(situation),
        situation,
      );
      return {
        ...finalized,
        matchedPrediction: ingestorMatch,
        oddsKey: `ml-${oddsKey}`,
        source: "ml" as const,
      };
    }

    if (ingestorMatch && hasNonZeroProbabilities(normalizeOutcomeProbabilities(ingestorMatch.outcome_probabilities))) {
      const finalized = finalizeOdds(
        normalizeOutcomeProbabilities(ingestorMatch.outcome_probabilities),
        ingestorMatch.steal_probabilities ?? predictClientStealOdds(situation),
        situation,
      );
      return {
        ...finalized,
        matchedPrediction: ingestorMatch,
        oddsKey: `${ingestorMatch.id}-${oddsKey}`,
        source: "ingestor" as const,
      };
    }

    const finalized = finalizeOdds(
      predictClientOutcomeOdds(balls, strikes, pitchCount, seed, situation),
      predictClientStealOdds(situation),
      situation,
    );
    return {
      ...finalized,
      matchedPrediction: ingestorMatch,
      oddsKey,
      source: ingestorMatch ? "ingestor" as const : "client" as const,
    };
  }, [atBatViewState, predictions, ml]);
}
