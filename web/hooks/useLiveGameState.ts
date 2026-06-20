"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  appendPlayByPlay,
  createPlayByPlayParseState,
  liveStateFingerprint,
  parseStateFromSnapshot,
  type PlayByPlayParseState,
} from "@/lib/mlb/liveFeed";
import { pollLiveFeed, workerPayloadToSnapshot } from "@/lib/mlb/liveFeedClient";
import type { AllPlayRaw, LiveGameState, PlayPitch } from "@/types/mlb-live";

import { useIntervalPoll } from "./useIntervalPoll";

/** Gameday-class cadence — overlapping polls, not chained on round-trip. */
const LIVE_FEED_POLL_MS = 200;

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

/** Ignore out-of-order poll responses that would roll back pitch or PBP state. */
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

function syncPlayByPlay(
  parseState: PlayByPlayParseState,
  newPlays: unknown[],
  from: number,
  total: number,
): PlayByPlayParseState {
  return appendPlayByPlay(parseState, newPlays as AllPlayRaw[], from, total);
}

/**
 * Overlapping polls against MLB CDN with off-thread JSON parse (worker).
 * Pitch polls skip allPlays; play-by-play extends only when allPlays grows.
 */
export function useLiveGameState(gamePk: number): UseLiveGameStateResult {
  const [gameState, setGameState] = useState<LiveGameState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const generationRef = useRef(0);
  const parseStateRef = useRef<PlayByPlayParseState>(createPlayByPlayParseState());

  const fetchState = useCallback(() => {
    const generation = generationRef.current;

    void (async () => {
      try {
        const playsFrom =
          parseStateRef.current.entries.length === 0
            ? 0
            : null;

        const result = await pollLiveFeed(gamePk, playsFrom);

        if (generation !== generationRef.current) {
          return;
        }

        const snapshot = workerPayloadToSnapshot(result);
        let entries = parseStateRef.current.entries;

        if (result.newPlays?.length && result.playsFrom != null) {
          parseStateRef.current = syncPlayByPlay(
            parseStateRef.current,
            result.newPlays,
            result.playsFrom,
            result.allPlaysCount,
          );
          entries = parseStateRef.current.entries;
        } else if (
          result.allPlaysCount > parseStateRef.current.rawPlayCount &&
          parseStateRef.current.entries.length > 0
        ) {
          const syncFrom = parseStateRef.current.rawPlayCount;
          void pollLiveFeed(gamePk, syncFrom).then((sync) => {
            if (generation !== generationRef.current) return;
            if (!sync.newPlays?.length || sync.playsFrom == null) return;

            parseStateRef.current = syncPlayByPlay(
              parseStateRef.current,
              sync.newPlays,
              sync.playsFrom,
              sync.allPlaysCount,
            );

            const synced = parseStateFromSnapshot(
              workerPayloadToSnapshot(sync),
              parseStateRef.current.entries,
            );
            setGameState((prev) => applyGameState(prev, synced));
          });
        }

        const next = parseStateFromSnapshot(snapshot, entries);
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
    })();
  }, [gamePk]);

  useEffect(() => {
    if (!gamePk) {
      setIsLoading(false);
      return;
    }

    generationRef.current += 1;
    parseStateRef.current = createPlayByPlayParseState();
    setGameState(null);
    setIsLoading(true);
    setError(null);
  }, [gamePk]);

  useIntervalPoll(fetchState, LIVE_FEED_POLL_MS, Boolean(gamePk), gamePk);

  return { gameState, isLoading, error };
}
