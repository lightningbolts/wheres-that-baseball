"use client";

import { useCallback, useEffect, useState } from "react";

import {
  peekLiveFeedState,
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

function emptyState(isLoading: boolean): LiveFeedCoordinatorState {
  return {
    gameState: null,
    boxScore: null,
    isLoading,
    error: null,
    consecutiveErrors: 0,
    realtimeConnected: false,
  };
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
  const [coordinatorState, setCoordinatorState] = useState<LiveFeedCoordinatorState>(() => {
    if (!gamePk || !enabled) return emptyState(false);
    return peekLiveFeedState(gamePk) ?? emptyState(true);
  });

  useEffect(() => {
    if (!gamePk || !enabled) {
      setCoordinatorState(emptyState(false));
      return;
    }

    // Prefer cached coordinator state immediately — don't blank the UI while
    // (re)subscribing to an already-warmed feed.
    const cached = peekLiveFeedState(gamePk);
    if (cached) {
      setCoordinatorState(cached);
    } else {
      setCoordinatorState((current) =>
        current.gameState ? { ...current, isLoading: true } : emptyState(true),
      );
    }

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
