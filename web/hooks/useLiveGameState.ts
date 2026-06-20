"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  appendPlayByPlay,
  createPlayByPlayParseState,
  dedupePlayByPlayEntries,
  fetchMLBLiveFeed,
  liveStateFingerprint,
  mergeCurrentPlayTail,
  parseLiveFeedSnapshot,
  syncPlayByPlayFromFeed,
  type PlayByPlayParseState,
} from "@/lib/mlb/liveFeed";
import type { AllPlayRaw, LiveGameState, PlayPitch } from "@/types/mlb-live";

import { useChainedPoll } from "./useChainedPoll";

/** Chained polls — one in-flight fetch, next starts ~100ms after the prior finishes. */
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
  force = false,
): LiveGameState {
  if (!force && prev && isStaleRegression(prev, next)) {
    return prev;
  }

  if (!force && prev && liveStateFingerprint(prev) === liveStateFingerprint(next)) {
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

/** Rebuild play-by-play when the tab was backgrounded and we fell behind allPlays. */
function resyncPlayByPlayState(
  state: PlayByPlayParseState,
  allPlays: AllPlayRaw[],
  currentPlay: AllPlayRaw | undefined,
): PlayByPlayParseState {
  if (allPlays.length === 0) return state;

  const behind = state.rawPlayCount < allPlays.length - 1;
  if (!behind) {
    return syncPlayByPlayFromFeed(state, allPlays, currentPlay);
  }

  const merged = mergeCurrentPlayTail(allPlays, currentPlay, 0);
  const rebuilt = appendPlayByPlay(
    createPlayByPlayParseState(),
    merged,
    0,
    allPlays.length,
  );

  return {
    ...rebuilt,
    entries: dedupePlayByPlayEntries(rebuilt.entries),
  };
}

/**
 * Direct MLB CDN polls. Re-syncs the allPlays tail each poll (merging fresher
 * currentPlay) so pitches, game events, and at-bat outcomes land as they happen.
 */
export function useLiveGameState(gamePk: number): UseLiveGameStateResult {
  const [gameState, setGameState] = useState<LiveGameState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const generationRef = useRef(0);
  const parseStateRef = useRef<PlayByPlayParseState>(createPlayByPlayParseState());
  const tabWasHiddenRef = useRef(false);

  const fetchState = useCallback(async () => {
    const generation = generationRef.current;
    const forceUpdate = tabWasHiddenRef.current && document.visibilityState === "visible";
    if (forceUpdate) tabWasHiddenRef.current = false;

    try {
      const feed = await fetchMLBLiveFeed(gamePk);
      if (generation !== generationRef.current) return;

      const allPlays = feed.liveData.plays.allPlays ?? [];
      const currentPlay = feed.liveData.plays.currentPlay as AllPlayRaw | undefined;

      parseStateRef.current = resyncPlayByPlayState(
        parseStateRef.current,
        allPlays,
        currentPlay,
      );

      if (generation !== generationRef.current) return;

      const next = parseLiveFeedSnapshot(
        gamePk,
        feed,
        parseStateRef.current.entries,
      );
      setGameState((prev) => applyGameState(prev, next, forceUpdate));
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
    parseStateRef.current = createPlayByPlayParseState();
    tabWasHiddenRef.current = false;
    setGameState(null);
    setIsLoading(true);
    setError(null);
  }, [gamePk]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        tabWasHiddenRef.current = true;
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useChainedPoll(fetchState, LIVE_FEED_MIN_GAP_MS, Boolean(gamePk), gamePk);

  return { gameState, isLoading, error };
}
