"use client";

import { useEffect, useRef, useState } from "react";

import { isGameOver } from "@/lib/mlb/gameOver";
import { isHalfInningBreak } from "@/lib/mlb/lineup";
import type { LiveGameState } from "@/types/mlb-live";

export const BREAK_LINGER_MS = 2_000;

function breakKey(state: LiveGameState): string {
  return `${state.inning}-${state.inningState.toLowerCase()}`;
}

/** Reconstruct the just-finished at-bat when the feed jumps straight to a break. */
function buildLingerState(
  gameState: LiveGameState,
  lastActive: LiveGameState | null,
): LiveGameState {
  const lastPlay = gameState.plays.at(-1);
  if (lastPlay && lastPlay.detail.pitches.length > 0) {
    const lastPitch = lastPlay.detail.pitches.at(-1);
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
      atBatPitches: lastPlay.detail.pitches,
    };
  }

  if (lastActive && lastActive.atBatPitches.length > 0) {
    return { ...lastActive, inningState: lastActive.inningHalf };
  }

  return lastActive ?? gameState;
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
  const [lingerTick, setLingerTick] = useState(0);

  const isBreak = gameState != null && isHalfInningBreak(gameState.inningState);
  const currentBreakKey = isBreak && gameState ? breakKey(gameState) : null;

  if (gameState && !isBreak) {
    lastActiveRef.current = gameState;
    activeBreakKeyRef.current = null;
    lingerSnapshotRef.current = null;
    lingerStartedAtRef.current = 0;
  } else if (gameState && currentBreakKey && activeBreakKeyRef.current !== currentBreakKey) {
    activeBreakKeyRef.current = currentBreakKey;
    lingerSnapshotRef.current = buildLingerState(gameState, lastActiveRef.current);
    lingerStartedAtRef.current = Date.now();
  }

  const isLingering =
    currentBreakKey != null &&
    lingerSnapshotRef.current != null &&
    Date.now() - lingerStartedAtRef.current < BREAK_LINGER_MS;

  useEffect(() => {
    if (!isLingering) return;

    const remaining = BREAK_LINGER_MS - (Date.now() - lingerStartedAtRef.current);
    const id = window.setTimeout(() => setLingerTick((tick) => tick + 1), Math.max(0, remaining));
    return () => window.clearTimeout(id);
  }, [isLingering, currentBreakKey, lingerTick]);

  useEffect(() => {
    lastActiveRef.current = null;
    activeBreakKeyRef.current = null;
    lingerSnapshotRef.current = null;
    lingerStartedAtRef.current = 0;
  }, [gameState?.gamePk]);

  const showBreakUI =
    isBreak && !isLingering && !(gameState != null && isGameOver(gameState));
  const atBatViewState =
    isLingering && lingerSnapshotRef.current ? lingerSnapshotRef.current : gameState;

  return { atBatViewState, isLingering, showBreakUI };
}
