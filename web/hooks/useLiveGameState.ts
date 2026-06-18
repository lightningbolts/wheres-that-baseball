"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  appendPlayByPlay,
  createPlayByPlayParseState,
  fetchLivePlayChunk,
  fetchLiveSnapshot,
  liveStateFingerprint,
  parseStateFromSnapshot,
  type PlayByPlayParseState,
} from "@/lib/mlb/liveFeed";
import type { LiveGameState } from "@/types/mlb-live";

import { useChainedPoll } from "./useChainedPoll";

/** Minimum gap between live polls — chained so slow responses don't stack. */
const LIVE_FEED_MIN_GAP_MS = 100;

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
 * Avoids re-downloading and re-parsing the full MLB feed on every poll as the game grows.
 */
export function useLiveGameState(gamePk: number): UseLiveGameStateResult {
  const [gameState, setGameState] = useState<LiveGameState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const generationRef = useRef(0);
  const parseStateRef = useRef<PlayByPlayParseState>(createPlayByPlayParseState());
  const wasBreakRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const fetchState = useCallback(async () => {
    const generation = generationRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;

    try {
      const snapshot = await fetchLiveSnapshot(gamePk, signal);
      if (generation !== generationRef.current) return;

      const allPlaysCount = snapshot.allPlaysCount;
      const inningState = snapshot.linescore.inningState ?? "";
      const isBreak = /^(middle|end)$/i.test(inningState);
      const enteringBreak = isBreak && !wasBreakRef.current;
      wasBreakRef.current = isBreak;

      const needsPlayChunk =
        allPlaysCount > parseStateRef.current.rawPlayCount ||
        (parseStateRef.current.entries.length === 0 && allPlaysCount > 0) ||
        enteringBreak;

      if (needsPlayChunk) {
        const chunk = await fetchLivePlayChunk(
          gamePk,
          parseStateRef.current.rawPlayCount,
          signal,
        );
        if (generation !== generationRef.current) return;

        if (chunk.plays.length > 0) {
          parseStateRef.current = appendPlayByPlay(parseStateRef.current, chunk.plays);
        }
      }

      if (generation !== generationRef.current) return;

      const next = parseStateFromSnapshot(snapshot, parseStateRef.current.entries);
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
