"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  appendPlayByPlay,
  createPlayByPlayParseState,
  fetchDirectSnapshot,
  fetchLiveSnapshotWithPlays,
  liveStateFingerprint,
  parseStateFromSnapshot,
  type LiveSnapshotWithPlays,
  type PlayByPlayParseState,
} from "@/lib/mlb/liveFeed";
import type { LiveGameState } from "@/types/mlb-live";

import { useChainedPoll } from "./useChainedPoll";

/** Minimum gap between live polls — chained so slow responses don't stack. */
const LIVE_FEED_MIN_GAP_MS = 100;

/** If the proxy responds slower than this, switch to direct MLB CDN fetch. */
const SLOW_RESPONSE_THRESHOLD_MS = 1_500;

/** Number of consecutive slow responses before switching to direct. */
const SLOW_RESPONSE_COUNT_THRESHOLD = 2;

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

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

/**
 * Polls a compact live snapshot for pitch updates and incrementally extends play-by-play.
 * Uses a single combined request (snapshot + plays) to minimize latency.
 * Falls back to direct MLB CDN fetch if the proxy is consistently slow.
 */
export function useLiveGameState(gamePk: number): UseLiveGameStateResult {
  const [gameState, setGameState] = useState<LiveGameState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const generationRef = useRef(0);
  const parseStateRef = useRef<PlayByPlayParseState>(createPlayByPlayParseState());
  const wasBreakRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const slowCountRef = useRef(0);
  const useDirectRef = useRef(false);
  const pendingPlaysRef = useRef(false);

  const fetchState = useCallback(async () => {
    const generation = generationRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;

    try {
      const needsPlays =
        pendingPlaysRef.current ||
        parseStateRef.current.entries.length === 0;

      const playsFrom = needsPlays ? parseStateRef.current.rawPlayCount : null;

      const started = performance.now();
      let result: LiveSnapshotWithPlays;

      if (useDirectRef.current) {
        result = await fetchDirectSnapshot(gamePk, playsFrom, signal);
      } else {
        result = await fetchLiveSnapshotWithPlays(gamePk, playsFrom, signal);
      }

      const elapsed = performance.now() - started;

      if (!useDirectRef.current) {
        if (elapsed > SLOW_RESPONSE_THRESHOLD_MS) {
          slowCountRef.current += 1;
          if (slowCountRef.current >= SLOW_RESPONSE_COUNT_THRESHOLD) {
            useDirectRef.current = true;
          }
        } else {
          slowCountRef.current = Math.max(0, slowCountRef.current - 1);
        }
      }

      if (generation !== generationRef.current) return;

      const allPlaysCount = result.allPlaysCount;
      const inningState = result.linescore.inningState ?? "";
      const isBreak = /^(middle|end)$/i.test(inningState);
      const enteringBreak = isBreak && !wasBreakRef.current;
      wasBreakRef.current = isBreak;

      const hasNewPlays = allPlaysCount > parseStateRef.current.rawPlayCount;
      const playChunkNeeded =
        hasNewPlays ||
        (parseStateRef.current.entries.length === 0 && allPlaysCount > 0) ||
        enteringBreak;

      if (result.plays && result.plays.plays.length > 0) {
        const prevCount = parseStateRef.current.rawPlayCount;
        parseStateRef.current = appendPlayByPlay(
          parseStateRef.current,
          result.plays.plays,
          result.plays.from,
          result.plays.total,
        );
        const processedAll = parseStateRef.current.rawPlayCount >= result.plays.total;
        pendingPlaysRef.current = !processedAll;
      } else if (playChunkNeeded && !result.plays) {
        pendingPlaysRef.current = true;
      } else {
        pendingPlaysRef.current = allPlaysCount > parseStateRef.current.rawPlayCount;
      }

      if (generation !== generationRef.current) return;

      const next = parseStateFromSnapshot(result, parseStateRef.current.entries);
      setGameState((prev) => applyGameState(prev, next));
      setError(null);
    } catch (err) {
      if (isAbortError(err) || generation !== generationRef.current) return;
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
    abortRef.current?.abort();
    parseStateRef.current = createPlayByPlayParseState();
    wasBreakRef.current = false;
    slowCountRef.current = 0;
    useDirectRef.current = false;
    pendingPlaysRef.current = false;
    setGameState(null);
    setIsLoading(true);
    setError(null);

    return () => {
      abortRef.current?.abort();
    };
  }, [gamePk]);

  useChainedPoll(fetchState, LIVE_FEED_MIN_GAP_MS, Boolean(gamePk), gamePk);

  return { gameState, isLoading, error };
}
