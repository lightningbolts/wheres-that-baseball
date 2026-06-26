"use client";

import { useCallback, useEffect, useState } from "react";

import {
  refreshLiveFeedNow,
  subscribeLiveFeed,
  type LiveFeedCoordinatorState,
} from "@/lib/mlb/liveFeedCoordinator";
import type { GameBoxScore } from "@/types/mlb-boxscore";

export interface UseGameBoxScoreOptions {
  poll?: boolean;
  /** Change to trigger an immediate box score fetch (e.g. dashboard tab switch). */
  pollBurstKey?: unknown;
}

export interface UseGameBoxScoreResult {
  boxScore: GameBoxScore | null;
  isLoading: boolean;
  error: string | null;
  source: "supabase" | "mlb" | null;
  feedSyncedAt: string | null;
  refetch: () => Promise<void>;
}

export function useGameBoxScore(
  gamePk: number,
  options?: UseGameBoxScoreOptions,
): UseGameBoxScoreResult {
  const shouldPoll = options?.poll ?? false;
  const pollBurstKey = options?.pollBurstKey;

  const [boxScore, setBoxScore] = useState<GameBoxScore | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<"supabase" | "mlb" | null>(null);
  const [feedSyncedAt, setFeedSyncedAt] = useState<string | null>(null);

  const fetchBoxScore = useCallback(async () => {
    try {
      const query = shouldPoll ? "?live=1" : "";
      const response = await fetch(`/api/games/${gamePk}/boxscore${query}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? `Box score error ${response.status}`);
      }

      const data = (await response.json()) as {
        boxScore: GameBoxScore;
        source: "supabase" | "mlb";
        feedSyncedAt: string | null;
      };

      setBoxScore(data.boxScore);
      setSource(data.source);
      setFeedSyncedAt(data.feedSyncedAt);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch box score");
    } finally {
      setIsLoading(false);
    }
  }, [gamePk, shouldPoll]);

  useEffect(() => {
    if (!gamePk) {
      setIsLoading(false);
      return;
    }

    if (shouldPoll) {
      setBoxScore(null);
      setIsLoading(true);
      setError(null);
      setSource("mlb");
      setFeedSyncedAt(null);

      const onCoordinator = (state: LiveFeedCoordinatorState) => {
        setBoxScore(state.boxScore);
        setIsLoading(state.isLoading);
        setError(state.error);
        setSource("mlb");
      };

      return subscribeLiveFeed(gamePk, onCoordinator);
    }

    setBoxScore(null);
    setIsLoading(true);
    setError(null);
    setSource(null);
    setFeedSyncedAt(null);
    void fetchBoxScore();
  }, [gamePk, shouldPoll, fetchBoxScore]);

  useEffect(() => {
    if (!shouldPoll || pollBurstKey === undefined) return;
    void refreshLiveFeedNow(gamePk);
  }, [shouldPoll, pollBurstKey, gamePk]);

  const refetch = useCallback(async () => {
    if (shouldPoll) {
      await refreshLiveFeedNow(gamePk);
      return;
    }
    await fetchBoxScore();
  }, [shouldPoll, gamePk, fetchBoxScore]);

  return {
    boxScore,
    isLoading,
    error,
    source,
    feedSyncedAt,
    refetch,
  };
}
