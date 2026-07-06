"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";

import {
  selectPredictionForAtBat,
  type AtBatPredictionMatch,
} from "@/lib/predictions/matchAtBat";
import { createClient } from "@/utils/supabase/client";
import {
  normalizeOutcomeProbabilities,
  type OutcomeProbabilities,
  type Prediction,
  type StealProbabilities,
} from "@/types/database";

import { useChainedPoll } from "./useChainedPoll";

export type ConnectionStatus = "connecting" | "connected" | "disconnected" | "error";

export interface UseLivePredictionsResult {
  predictions: Prediction[];
  latestPrediction: Prediction | null;
  isLoading: boolean;
  error: string | null;
  connectionStatus: ConnectionStatus;
}

/** Independent of pitch polling — only refreshes Supabase reads. */
const PREDICTION_POLL_MS = 250;

const RECENT_PREDICTION_LIMIT = 80;

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

function sortPredictionsChronologically(rows: Prediction[]): Prediction[] {
  return [...rows].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
}

function upsertPrediction(rows: Prediction[], row: Prediction): Prediction[] {
  if (rows.some((existing) => existing.id === row.id)) {
    return rows;
  }
  return sortPredictionsChronologically([...rows, row]);
}

export function useLivePredictions(
  gamePk: number,
  match?: AtBatPredictionMatch | null,
): UseLivePredictionsResult {
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("connecting");
  const channelRef = useRef<RealtimeChannel | null>(null);

  const activePrediction = useMemo(
    () => selectPredictionForAtBat(predictions, match),
    [predictions, match],
  );

  const applyPrediction = useCallback((row: Record<string, unknown>) => {
    const normalized = normalizePrediction(row);
    setPredictions((prev) => upsertPrediction(prev, normalized));
    setIsLoading(false);
    setError(null);
  }, []);

  const fetchRecent = useCallback(async () => {
    if (!gamePk) return;

    const supabase = createClient();
    const { data, error: fetchError } = await supabase
      .from("predictions")
      .select("*")
      .eq("game_pk", gamePk)
      .order("timestamp", { ascending: false })
      .limit(RECENT_PREDICTION_LIMIT);

    if (fetchError) {
      setError(fetchError.message);
      setConnectionStatus("error");
      setIsLoading(false);
      return;
    }

    const rows = sortPredictionsChronologically(
      (data ?? []).map((row) => normalizePrediction(row as Record<string, unknown>)),
    );
    setPredictions(rows);
    setError(null);
    setIsLoading(false);
  }, [gamePk]);

  useEffect(() => {
    if (!gamePk) {
      setIsLoading(false);
      setError("Invalid game ID");
      return;
    }

    let cancelled = false;
    setPredictions([]);
    setIsLoading(true);
    setError(null);
    setConnectionStatus("connecting");

    const supabase = createClient();
    const channelName = `predictions:game_pk=${gamePk}`;

    void fetchRecent();

    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "predictions",
          filter: `game_pk=eq.${gamePk}`,
        },
        (payload) => {
          if (payload.new) {
            applyPrediction(payload.new as Record<string, unknown>);
            setConnectionStatus("connected");
          }
        },
      )
      .subscribe((status) => {
        if (cancelled) return;

        if (status === "SUBSCRIBED") {
          setConnectionStatus("connected");
          setIsLoading(false);
        } else if (status === "CHANNEL_ERROR") {
          setConnectionStatus("error");
          setError("Realtime channel error — check Supabase Realtime settings.");
          setIsLoading(false);
        } else if (status === "TIMED_OUT") {
          setConnectionStatus("disconnected");
          setError("Realtime connection timed out.");
          setIsLoading(false);
        } else if (status === "CLOSED") {
          setConnectionStatus("disconnected");
        }
      });

    channelRef.current = channel;

    return () => {
      cancelled = true;
      if (channelRef.current) {
        void supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [gamePk, applyPrediction, fetchRecent]);

  useChainedPoll(
    fetchRecent,
    PREDICTION_POLL_MS,
    PREDICTION_POLL_MS * 4,
    Boolean(gamePk),
    gamePk,
  );

  return {
    predictions,
    latestPrediction: activePrediction,
    isLoading,
    error,
    connectionStatus,
  };
}
