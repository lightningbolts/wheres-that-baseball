"use client";

import { useCallback, useEffect, useState } from "react";

import { createClient } from "@/utils/supabase/client";
import {
  normalizeOutcomeProbabilities,
  type Prediction,
  type StealProbabilities,
} from "@/types/database";

function normalizeStealProbabilities(raw: unknown): StealProbabilities | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const p = raw as Record<string, unknown>;
  const attempt = typeof p.steal_attempt === "number" ? p.steal_attempt : 0;
  const success = typeof p.steal_success === "number" ? p.steal_success : 0;
  if (attempt <= 0 && success <= 0) return null;
  return { steal_attempt: attempt, steal_success: success };
}

function normalizePrediction(row: Record<string, unknown>): Prediction {
  const probabilities = normalizeOutcomeProbabilities(
    row.outcome_probabilities as Record<string, number> | null | undefined,
  );

  return {
    id: typeof row.id === "string" ? row.id : "",
    game_pk: typeof row.game_pk === "number" ? row.game_pk : 0,
    timestamp: typeof row.timestamp === "string" ? row.timestamp : new Date().toISOString(),
    batter_name: typeof row.batter_name === "string" ? row.batter_name : "Unknown Batter",
    pitcher_name: typeof row.pitcher_name === "string" ? row.pitcher_name : "Unknown Pitcher",
    inning: typeof row.inning === "number" ? row.inning : 1,
    balls: typeof row.balls === "number" ? row.balls : 0,
    strikes: typeof row.strikes === "number" ? row.strikes : 0,
    outs: typeof row.outs === "number" ? Math.min(3, Math.max(0, row.outs)) : 0,
    on_first: Boolean(row.on_first),
    on_second: Boolean(row.on_second),
    on_third: Boolean(row.on_third),
    outcome_probabilities: probabilities,
    steal_probabilities: normalizeStealProbabilities(row.steal_probabilities),
  };
}

export interface UseGamePredictionsResult {
  predictions: Prediction[];
  predictionForAtBat: Prediction | null;
  isLoading: boolean;
  error: string | null;
}

export function useGamePredictions(
  gamePk: number,
  match?: {
    batterName?: string;
    inning?: number;
    balls?: number;
    strikes?: number;
  } | null,
  options?: { enabled?: boolean },
): UseGamePredictionsResult {
  const enabled = options?.enabled ?? true;
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPredictions = useCallback(async () => {
    if (!enabled || !gamePk) {
      setPredictions([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const supabase = createClient();
      const { data, error: fetchError } = await supabase
        .from("predictions")
        .select("*")
        .eq("game_pk", gamePk)
        .order("timestamp", { ascending: true });

      if (fetchError) {
        setError(fetchError.message);
        setPredictions([]);
        return;
      }

      setPredictions((data ?? []).map((row) => normalizePrediction(row as Record<string, unknown>)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load predictions");
      setPredictions([]);
    } finally {
      setIsLoading(false);
    }
  }, [enabled, gamePk]);

  useEffect(() => {
    void fetchPredictions();
  }, [fetchPredictions]);

  const predictionForAtBat = (() => {
    if (!match?.batterName || predictions.length === 0) return null;

    const exact = predictions.find(
      (prediction) =>
        prediction.batter_name === match.batterName &&
        prediction.inning === match.inning &&
        prediction.balls === match.balls &&
        prediction.strikes === match.strikes,
    );
    if (exact) return exact;

    const byBatterInning = predictions.filter(
      (prediction) =>
        prediction.batter_name === match.batterName && prediction.inning === match.inning,
    );
    return byBatterInning.at(-1) ?? null;
  })();

  return {
    predictions,
    predictionForAtBat,
    isLoading,
    error,
  };
}
