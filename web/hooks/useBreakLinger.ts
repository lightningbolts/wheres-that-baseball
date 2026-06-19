"use client";

import { useEffect, useRef, useState } from "react";

import { isGameOver } from "@/lib/mlb/gameOver";
import { isHalfInningBreak } from "@/lib/mlb/lineup";
import type { LiveGameState, PlayByPlayEntry, PlayPitch } from "@/types/mlb-live";

export const BREAK_LINGER_MS = 3_000;
export const AT_BAT_LINGER_MS = 3_000;
/** Cap how long we wait for play-by-play to catch up before showing due-up UI. */
const MAX_BREAK_WAIT_MS = 5_000;

function breakKey(state: LiveGameState): string {
  return `${state.inning}-${state.inningState.toLowerCase()}`;
}

function mergeLingerPitches(
  lastActive: LiveGameState | null,
  lastPlay: PlayByPlayEntry | undefined,
): PlayPitch[] {
  const active = lastActive?.atBatPitches ?? [];
  const play = lastPlay?.detail.pitches ?? [];
  return play.length >= active.length ? play : active;
}

/** Reconstruct the just-finished at-bat when the feed jumps straight to a break. */
function buildLingerState(
  gameState: LiveGameState,
  lastActive: LiveGameState | null,
): LiveGameState | null {
  const lastPlay = gameState.plays.at(-1);
  const pitches = mergeLingerPitches(lastActive, lastPlay);
  if (pitches.length === 0) return null;

  const lastPitch = pitches.at(-1);
  const usePlayMeta = lastPlay != null && lastPlay.detail.pitches.length >= (lastActive?.atBatPitches.length ?? 0);

  if (usePlayMeta && lastPlay) {
    const base = lastActive ?? gameState;
    return {
      ...base,
      batterId: lastPlay.batterId,
      batterName: lastPlay.batterName,
      pitcherId: lastPlay.detail.pitcherId,
      pitcherName: lastPlay.detail.pitcherName,
      inning: lastPlay.inning,
      inningHalf: lastPlay.halfInning,
      inningState: lastPlay.halfInning,
      balls: lastPitch?.balls ?? 0,
      strikes: lastPitch?.strikes ?? 0,
      outs: lastPlay.outs,
      onFirst: lastPlay.onFirst,
      onSecond: lastPlay.onSecond,
      onThird: lastPlay.onThird,
      awayRuns: lastPlay.awayScore,
      homeRuns: lastPlay.homeScore,
      atBatPitches: pitches,
    };
  }

  if (lastActive) {
    return {
      ...lastActive,
      inningState: lastActive.inningHalf,
      balls: lastPitch?.balls ?? lastActive.balls,
      strikes: lastPitch?.strikes ?? lastActive.strikes,
      atBatPitches: pitches,
    };
  }

  return null;
}

export interface BreakLingerResult {
  /** State to render for the at-bat pitch panel (may hold the finished AB briefly). */
  atBatViewState: LiveGameState | null;
  /** True while the final at-bat is still on screen before due-up UI. */
  isLingering: boolean;
  /** True when due-up / break UI should replace the at-bat panel. */
  showBreakUI: boolean;
}

export function useBreakLinger(gameState: LiveGameState | null): BreakLingerResult {
  const lastActiveRef = useRef<LiveGameState | null>(null);
  const activeBreakKeyRef = useRef<string | null>(null);
  const lingerSnapshotRef = useRef<LiveGameState | null>(null);
  const lingerStartedAtRef = useRef(0);
  const atBatLingerRef = useRef<{ snapshot: LiveGameState; until: number } | null>(null);
  const [lingerTick, setLingerTick] = useState(0);

  const isBreak = gameState != null && isHalfInningBreak(gameState.inningState);
  const currentBreakKey = isBreak && gameState ? breakKey(gameState) : null;

  if (gameState && !isBreak) {
    const prev = lastActiveRef.current;
    const batterChanged =
      prev != null &&
      prev.batterId != null &&
      gameState.batterId != null &&
      gameState.batterId !== prev.batterId &&
      prev.atBatPitches.length > 0;

    if (batterChanged) {
      atBatLingerRef.current = {
        snapshot: prev,
        until: Date.now() + AT_BAT_LINGER_MS,
      };
    }

    lastActiveRef.current = gameState;
    activeBreakKeyRef.current = null;
    lingerSnapshotRef.current = null;
    lingerStartedAtRef.current = 0;
  } else if (gameState && currentBreakKey) {
    atBatLingerRef.current = null;
    const nextSnapshot = buildLingerState(gameState, lastActiveRef.current);
    const prevPitchCount = lingerSnapshotRef.current?.atBatPitches.length ?? 0;
    const nextPitchCount = nextSnapshot?.atBatPitches.length ?? 0;
    const isNewBreak = activeBreakKeyRef.current !== currentBreakKey;

    if (isNewBreak) {
      activeBreakKeyRef.current = currentBreakKey;
      lingerSnapshotRef.current = nextSnapshot;
      lingerStartedAtRef.current = Date.now();
    } else if (nextSnapshot && nextPitchCount > prevPitchCount) {
      lingerSnapshotRef.current = nextSnapshot;
      lingerStartedAtRef.current = Date.now();
    } else if (!lingerSnapshotRef.current && nextSnapshot) {
      lingerSnapshotRef.current = nextSnapshot;
      lingerStartedAtRef.current = Date.now();
    }
  }

  const now = Date.now();
  const atBatLingering =
    !isBreak &&
    atBatLingerRef.current != null &&
    now < atBatLingerRef.current.until;

  const lingerAge = now - lingerStartedAtRef.current;
  const lingerPitchCount = lingerSnapshotRef.current?.atBatPitches.length ?? 0;
  const isBreakLingering =
    currentBreakKey != null &&
    ((lingerPitchCount > 0 && lingerAge < BREAK_LINGER_MS) ||
      (lingerPitchCount === 0 && lingerAge < MAX_BREAK_WAIT_MS));

  const isLingering = isBreakLingering || atBatLingering;

  useEffect(() => {
    if (!isLingering) return;

    let remaining: number;
    if (isBreakLingering) {
      const limit = lingerPitchCount > 0 ? BREAK_LINGER_MS : MAX_BREAK_WAIT_MS;
      remaining = limit - (Date.now() - lingerStartedAtRef.current);
    } else if (atBatLingerRef.current) {
      remaining = atBatLingerRef.current.until - Date.now();
    } else {
      return;
    }

    const id = window.setTimeout(() => setLingerTick((tick) => tick + 1), Math.max(0, remaining));
    return () => window.clearTimeout(id);
  }, [isLingering, isBreakLingering, currentBreakKey, lingerTick, lingerPitchCount]);

  useEffect(() => {
    lastActiveRef.current = null;
    activeBreakKeyRef.current = null;
    lingerSnapshotRef.current = null;
    lingerStartedAtRef.current = 0;
    atBatLingerRef.current = null;
  }, [gameState?.gamePk]);

  const showBreakUI =
    isBreak && !isBreakLingering && !(gameState != null && isGameOver(gameState));

  let atBatViewState: LiveGameState | null = gameState;
  if (isBreakLingering) {
    atBatViewState = lingerSnapshotRef.current ?? lastActiveRef.current ?? gameState;
  } else if (atBatLingering && atBatLingerRef.current) {
    atBatViewState = atBatLingerRef.current.snapshot;
  }

  return { atBatViewState, isLingering, showBreakUI };
}
