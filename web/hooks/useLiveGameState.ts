"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  appendPlayByPlay,
  createPlayByPlayParseState,
  fetchDirectSnapshot,
  liveStateFingerprint,
  parseStateFromSnapshot,
  syncCurrentPlayTail,
  type LiveSnapshotWithPlays,
  type PlayByPlayParseState,
} from "@/lib/mlb/liveFeed";
import type { AllPlayRaw, LiveGameState, PlayPitch } from "@/types/mlb-live";

import { useChainedPoll } from "./useChainedPoll";

/** Minimum gap between live polls — chained so slow responses don't stack. */
const LIVE_FEED_MIN_GAP_MS = 100;

export interface UseLiveGameStateResult {
  gameState: LiveGameState | null;
  isLoading: boolean;
  error: string | null;
}

function pitchEqual(a: PlayPitch, b: PlayPitch): boolean {
  return (
    a.pitchNumber === b.pitchNumber &&
    a.callCode === b.callCode &&
    a.callDescription === b.callDescription &&
    a.balls === b.balls &&
    a.strikes === b.strikes &&
    a.startSpeed === b.startSpeed &&
    a.plateX === b.plateX &&
    a.plateZ === b.plateZ &&
    a.isInPlay === b.isInPlay &&
    a.isOut === b.isOut
  );
}

function mergeAtBatPitches(prev: PlayPitch[], next: PlayPitch[]): PlayPitch[] {
  if (prev.length === next.length) {
    let same = true;
    for (let i = 0; i < prev.length; i += 1) {
      if (!pitchEqual(prev[i], next[i])) {
        same = false;
        break;
      }
    }
    if (same) return prev;
  }

  if (next.length === prev.length + 1) {
    let prefixOk = true;
    for (let i = 0; i < prev.length; i += 1) {
      if (!pitchEqual(prev[i], next[i])) {
        prefixOk = false;
        break;
      }
    }
    if (prefixOk) return [...prev, next[next.length - 1]!];
  }

  return next;
}

function applyGameState(
  prev: LiveGameState | null,
  next: LiveGameState,
): LiveGameState {
  if (prev && isStaleRegression(prev, next)) {
    return prev;
  }

  if (prev && liveStateFingerprint(prev) === liveStateFingerprint(next)) {
    return prev;
  }

  if (prev && prev.plays === next.plays) {
    const atBatPitches = mergeAtBatPitches(prev.atBatPitches, next.atBatPitches);
    return { ...next, plays: prev.plays, atBatPitches };
  }

  return next;
}

function isStaleRegression(prev: LiveGameState, next: LiveGameState): boolean {
  if (next.plays.length < prev.plays.length) return true;
  if (
    prev.batterId === next.batterId &&
    next.atBatPitches.length < prev.atBatPitches.length
  ) {
    return true;
  }
  return false;
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

function applySnapshotToParseState(
  state: PlayByPlayParseState,
  result: LiveSnapshotWithPlays,
  allPlaysCount: number,
): PlayByPlayParseState {
  let next = state;
  const currentPlay = result.currentPlay as AllPlayRaw | undefined;

  if (result.plays?.plays.length && result.plays.from != null) {
    next = appendPlayByPlay(
      next,
      result.plays.plays as AllPlayRaw[],
      result.plays.from,
      result.plays.total,
    );
  }

  return syncCurrentPlayTail(next, currentPlay, allPlaysCount);
}

/**
 * Direct MLB CDN polls with a slim pitch field mask (~30× smaller than full feed).
 * Play-by-play rows download only when the log falls behind allPlays; the ongoing
 * at-bat tail is refreshed from currentPlay every poll so outcomes land immediately.
 */
export function useLiveGameState(gamePk: number): UseLiveGameStateResult {
  const [gameState, setGameState] = useState<LiveGameState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const generationRef = useRef(0);
  const parseStateRef = useRef<PlayByPlayParseState>(createPlayByPlayParseState());
  const wasBreakRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const pendingPlaysRef = useRef(false);
  const lastAllPlaysCountRef = useRef(0);
  const lastSnapshotBatterIdRef = useRef<number | null>(null);

  const fetchState = useCallback(async () => {
    const generation = generationRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;

    try {
      const needsPlays =
        pendingPlaysRef.current ||
        parseStateRef.current.entries.length === 0 ||
        parseStateRef.current.rawPlayCount < lastAllPlaysCountRef.current - 1;

      const playsFrom = needsPlays ? parseStateRef.current.rawPlayCount : null;
      const result = await fetchDirectSnapshot(gamePk, playsFrom, signal);

      if (generation !== generationRef.current) return;

      const allPlaysCount =
        result.plays?.total ??
        (result.allPlaysCount > 0 ? result.allPlaysCount : lastAllPlaysCountRef.current);

      const inningState = result.linescore.inningState ?? "";
      const isBreak = /^(middle|end)$/i.test(inningState);
      const enteringBreak = isBreak && !wasBreakRef.current;
      wasBreakRef.current = isBreak;

      const snapshotBatterId = result.currentPlay?.matchup?.batter?.id ?? null;
      const batterChanged =
        lastSnapshotBatterIdRef.current != null &&
        snapshotBatterId != null &&
        snapshotBatterId !== lastSnapshotBatterIdRef.current;
      lastSnapshotBatterIdRef.current = snapshotBatterId;

      const newPlayRow = allPlaysCount > lastAllPlaysCountRef.current;
      lastAllPlaysCountRef.current = allPlaysCount;

      const snapshot =
        result.allPlaysCount === allPlaysCount
          ? result
          : { ...result, allPlaysCount };

      parseStateRef.current = applySnapshotToParseState(
        parseStateRef.current,
        snapshot,
        allPlaysCount,
      );

      if (result.plays?.plays.length) {
        pendingPlaysRef.current = false;
      } else if (enteringBreak || batterChanged || newPlayRow) {
        pendingPlaysRef.current = true;
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
    pendingPlaysRef.current = false;
    lastAllPlaysCountRef.current = 0;
    lastSnapshotBatterIdRef.current = null;
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
