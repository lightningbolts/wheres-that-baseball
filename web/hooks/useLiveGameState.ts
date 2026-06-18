"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  fetchMLBLiveFeed,
  liveStateFingerprint,
  parseLiveFeed,
  parseLiveFeedSnapshot,
} from "@/lib/mlb/liveFeed";
import type { PlayByPlayEntry } from "@/types/mlb-live";
import type { LiveGameState } from "@/types/mlb-live";

import { useChainedPoll } from "./useChainedPoll";

/** Minimum gap between live feed polls — chained so slow responses don't stack. */
const LIVE_FEED_MIN_GAP_MS = 100;
/** Refresh the full play-by-play log on this cadence; at-bat data polls faster. */
const FULL_PLAY_BY_PLAY_MS = 3_000;

export interface UseLiveGameStateResult {
  gameState: LiveGameState | null;
  isLoading: boolean;
  error: string | null;
}

function applyGameState(
  prev: LiveGameState | null,
  next: LiveGameState,
): LiveGameState {
  if (prev && liveStateFingerprint(prev) === liveStateFingerprint(next)) {
    return prev;
  }
  return next;
}

/**
 * Polls the MLB live feed directly from the browser for low-latency pitch updates.
 * Fast polls reuse the cached play-by-play list; full parses run every few seconds.
 */
export function useLiveGameState(gamePk: number): UseLiveGameStateResult {
  const [gameState, setGameState] = useState<LiveGameState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const generationRef = useRef(0);
  const playsRef = useRef<PlayByPlayEntry[]>([]);
  const lastFullParseAtRef = useRef(0);
  const lastAllPlaysCountRef = useRef(0);

  const fetchState = useCallback(async () => {
    const generation = generationRef.current;

    try {
      const feed = await fetchMLBLiveFeed(gamePk);
      if (generation !== generationRef.current) return;

      const now = Date.now();
      const allPlaysCount = feed.liveData.plays.allPlays?.length ?? 0;
      const newAtBatCompleted = allPlaysCount > lastAllPlaysCountRef.current;
      const needsFullParse =
        playsRef.current.length === 0 ||
        newAtBatCompleted ||
        now - lastFullParseAtRef.current >= FULL_PLAY_BY_PLAY_MS;

      const next = needsFullParse
        ? parseLiveFeed(gamePk, feed)
        : parseLiveFeedSnapshot(gamePk, feed, playsRef.current);

      if (needsFullParse) {
        playsRef.current = next.plays;
        lastFullParseAtRef.current = now;
        lastAllPlaysCountRef.current = allPlaysCount;
      }

      if (generation !== generationRef.current) return;

      setGameState((prev) => applyGameState(prev, next));
      setError(null);
    } catch (err) {
      if (generation !== generationRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to fetch live game state");
    } finally {
      if (generation === generationRef.current) {
        setIsLoading(false);
      }
    }
  }, [gamePk]);

  useEffect(() => {
    if (!gamePk) {
      setIsLoading(false);
      return;
    }

    generationRef.current += 1;
    playsRef.current = [];
    lastFullParseAtRef.current = 0;
    lastAllPlaysCountRef.current = 0;
    setGameState(null);
    setIsLoading(true);
    setError(null);
  }, [gamePk]);

  useChainedPoll(fetchState, LIVE_FEED_MIN_GAP_MS, Boolean(gamePk), gamePk);

  return { gameState, isLoading, error };
}
