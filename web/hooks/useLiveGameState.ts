"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  createPlayByPlayParseState,
  fetchMLBLiveFeed,
  liveStateFingerprint,
  parseLiveFeedSnapshot,
  syncPlayByPlayFromFeed,
  type PlayByPlayParseState,
} from "@/lib/mlb/liveFeed";
import type { AllPlayRaw, LiveGameState, PlayPitch } from "@/types/mlb-live";

import { useRapidPoll } from "./useRapidPoll";

/** Overlapping polls — next request starts while prior fetch is in flight. */
const LIVE_FEED_POLL_MS = 100;
const MAX_IN_FLIGHT = 2;

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
  if (prev && liveStateFingerprint(prev) === liveStateFingerprint(next)) {
    return prev;
  }

  // Pitch-only: keep play-by-play reference stable for the feed.
  if (prev && prev.plays === next.plays) {
    const atBatPitches = mergeAtBatPitches(prev.atBatPitches, next.atBatPitches);
    return { ...next, plays: prev.plays, atBatPitches };
  }

  return next;
}

/**
 * Direct MLB CDN polls with overlapping requests. Re-syncs the allPlays tail
 * every poll (using fresher currentPlay) so pitches, game events, and at-bat
 * outcomes land in play-by-play as they happen.
 */
export function useLiveGameState(gamePk: number): UseLiveGameStateResult {
  const [gameState, setGameState] = useState<LiveGameState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const generationRef = useRef(0);
  const parseStateRef = useRef<PlayByPlayParseState>(createPlayByPlayParseState());

  const fetchState = useCallback(async () => {
    const generation = generationRef.current;

    try {
      const feed = await fetchMLBLiveFeed(gamePk);
      if (generation !== generationRef.current) return;

      const allPlays = feed.liveData.plays.allPlays ?? [];
      const currentPlay = feed.liveData.plays.currentPlay as AllPlayRaw | undefined;

      parseStateRef.current = syncPlayByPlayFromFeed(
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
    parseStateRef.current = createPlayByPlayParseState();
    setGameState(null);
    setIsLoading(true);
    setError(null);
  }, [gamePk]);

  useRapidPoll(fetchState, LIVE_FEED_POLL_MS, MAX_IN_FLIGHT, Boolean(gamePk), gamePk);

  return { gameState, isLoading, error };
}
