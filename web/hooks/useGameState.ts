"use client";

import { useCallback, useEffect, useState } from "react";

import type { LiveGameState } from "@/types/mlb-live";

export interface UseGameStateResult {
  gameState: LiveGameState | null;
  isLoading: boolean;
  error: string | null;
  source: "supabase" | "mlb" | null;
  feedSyncedAt: string | null;
  refetch: () => Promise<void>;
}

export function useGameState(gamePk: number, options?: { poll?: boolean }): UseGameStateResult {
  const [gameState, setGameState] = useState<LiveGameState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<"supabase" | "mlb" | null>(null);
  const [feedSyncedAt, setFeedSyncedAt] = useState<string | null>(null);

  const shouldPoll = options?.poll ?? false;

  const fetchState = useCallback(async () => {
    try {
      const response = await fetch(`/api/games/${gamePk}/state`, { cache: "no-store" });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? `Game state error ${response.status}`);
      }

      const data = (await response.json()) as {
        state: LiveGameState;
        source: "supabase" | "mlb";
        feedSyncedAt: string | null;
      };

      setGameState(data.state);
      setSource(data.source);
      setFeedSyncedAt(data.feedSyncedAt);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch game state");
    } finally {
      setIsLoading(false);
    }
  }, [gamePk]);

  useEffect(() => {
    if (!gamePk) {
      setIsLoading(false);
      return;
    }

    setGameState(null);
    setIsLoading(true);
    setError(null);
    setSource(null);
    setFeedSyncedAt(null);

    void fetchState();

    if (!shouldPoll) return;

    const pollId = window.setInterval(() => {
      void fetchState();
    }, 3_000);

    return () => window.clearInterval(pollId);
  }, [gamePk, fetchState, shouldPoll]);

  return {
    gameState,
    isLoading,
    error,
    source,
    feedSyncedAt,
    refetch: fetchState,
  };
}
