"use client";

import { useCallback, useEffect, useState } from "react";

import {
  refreshLiveFeedNow,
  subscribeLiveFeed,
  type LiveFeedCoordinatorState,
} from "@/lib/mlb/liveFeedCoordinator";
import type { LiveGameState } from "@/types/mlb-live";

export interface UseLiveGameStateOptions {
  /** When false, skips polling (e.g. archived replay view). */
  enabled?: boolean;
  /** Change to trigger an immediate MLB feed fetch (e.g. dashboard tab switch). */
  pollBurstKey?: unknown;
}

export interface UseLiveGameStateResult {
  gameState: LiveGameState | null;
  isLoading: boolean;
  error: string | null;
  consecutiveErrors: number;
  refreshNow: () => Promise<void>;
}

/**
 * Shared coordinator polls the coalesced snapshot API once per game.
 * Box score and game state derive from the same server-side MLB fetch.
 */
export function useLiveGameState(
  gamePk: number,
  options?: UseLiveGameStateOptions,
): UseLiveGameStateResult {
  const enabled = options?.enabled ?? true;
  const pollBurstKey = options?.pollBurstKey;
  const [coordinatorState, setCoordinatorState] = useState<LiveFeedCoordinatorState>({
    gameState: null,
    boxScore: null,
    isLoading: true,
    error: null,
    consecutiveErrors: 0,
  });

  useEffect(() => {
    if (!gamePk || !enabled) {
      setCoordinatorState({
        gameState: null,
        boxScore: null,
        isLoading: false,
        error: null,
        consecutiveErrors: 0,
      });
      return;
    }

    setCoordinatorState({
      gameState: null,
      boxScore: null,
      isLoading: true,
      error: null,
      consecutiveErrors: 0,
    });

    return subscribeLiveFeed(gamePk, setCoordinatorState);
  }, [gamePk, enabled]);

  useEffect(() => {
    if (!enabled || pollBurstKey === undefined || !gamePk) return;
    void refreshLiveFeedNow(gamePk);
  }, [enabled, pollBurstKey, gamePk]);

  const refreshNow = useCallback(async () => {
    if (!gamePk || !enabled) return;
    await refreshLiveFeedNow(gamePk);
  }, [gamePk, enabled]);

  return {
    gameState: coordinatorState.gameState,
    isLoading: coordinatorState.isLoading,
    error: coordinatorState.error,
    consecutiveErrors: coordinatorState.consecutiveErrors,
    refreshNow,
  };
}
