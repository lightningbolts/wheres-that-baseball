"use client";

import { useEffect, useRef, useState } from "react";

import { isGameOver } from "@/lib/mlb/gameOver";
import { isHalfInningBreak } from "@/lib/mlb/lineup";
import { isPlayByPlayAtBat } from "@/lib/mlb/liveFeed";
import type { LiveGameState, PlayByPlayEntry, PlayPitch } from "@/types/mlb-live";

export const BREAK_LINGER_MS = 2_000;
export const AT_BAT_LINGER_MS = 0;
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

function findLastAtBatForBatter(
  plays: PlayByPlayEntry[],
  batterId: number | null | undefined,
): PlayByPlayEntry | undefined {
  if (batterId == null) return undefined;

  for (let i = plays.length - 1; i >= 0; i -= 1) {
    const play = plays[i];
    if (isPlayByPlayAtBat(play) && play.batterId === batterId) {
      return play;
    }
  }

  return undefined;
}

function applyCompletedPlayMeta(
  base: LiveGameState,
  completedPlay: PlayByPlayEntry,
  pitches: PlayPitch[],
): LiveGameState {
  const lastPitch = pitches.at(-1);
  return {
    ...base,
    batterId: completedPlay.batterId,
    batterName: completedPlay.batterName,
    pitcherId: completedPlay.detail.pitcherId,
    pitcherName: completedPlay.detail.pitcherName,
    inning: completedPlay.inning,
    inningHalf: completedPlay.halfInning,
    balls: lastPitch?.balls ?? base.balls,
    strikes: lastPitch?.strikes ?? base.strikes,
    outs: completedPlay.outs,
    onFirst: completedPlay.onFirst,
    onSecond: completedPlay.onSecond,
    onThird: completedPlay.onThird,
    runnerFirst:
      completedPlay.onFirst && completedPlay.bases.first
        ? { id: 0, name: completedPlay.bases.first }
        : null,
    runnerSecond:
      completedPlay.onSecond && completedPlay.bases.second
        ? { id: 0, name: completedPlay.bases.second }
        : null,
    runnerThird:
      completedPlay.onThird && completedPlay.bases.third
        ? { id: 0, name: completedPlay.bases.third }
        : null,
    awayRuns: completedPlay.awayScore,
    homeRuns: completedPlay.homeScore,
    atBatPitches: pitches,
  };
}

/** Hold the finished AB through batter changes — merge terminal pitch from PBP when live tail jumped. */
function buildAtBatLingerSnapshot(
  lastActive: LiveGameState,
  gameState: LiveGameState,
): LiveGameState {
  const completedPlay = findLastAtBatForBatter(gameState.plays, lastActive.batterId);
  const pitches = mergeLingerPitches(lastActive, completedPlay);
  if (pitches.length === 0) return lastActive;

  const lastPitch = pitches.at(-1);
  const usePlayMeta =
    completedPlay != null &&
    completedPlay.detail.pitches.length >= lastActive.atBatPitches.length;

  if (usePlayMeta && completedPlay) {
    return applyCompletedPlayMeta(lastActive, completedPlay, pitches);
  }

  return {
    ...lastActive,
    balls: lastPitch?.balls ?? lastActive.balls,
    strikes: lastPitch?.strikes ?? lastActive.strikes,
    atBatPitches: pitches,
  };
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
      ...applyCompletedPlayMeta(base, lastPlay, pitches),
      inningState: lastPlay.halfInning,
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

function refreshAtBatLinger(
  linger: { snapshot: LiveGameState; until: number },
  gameState: LiveGameState,
): { snapshot: LiveGameState; until: number; pitchCount: number } {
  const prevCount = linger.snapshot.atBatPitches.length;
  const completedPlay = findLastAtBatForBatter(gameState.plays, linger.snapshot.batterId);
  const pitches = mergeLingerPitches(linger.snapshot, completedPlay);
  const pitchCount = pitches.length;

  if (pitchCount === prevCount) {
    return { ...linger, pitchCount };
  }

  const lastPitch = pitches.at(-1);
  const usePlayMeta =
    completedPlay != null &&
    completedPlay.detail.pitches.length >= prevCount;

  const snapshot =
    usePlayMeta && completedPlay
      ? applyCompletedPlayMeta(linger.snapshot, completedPlay, pitches)
      : {
          ...linger.snapshot,
          balls: lastPitch?.balls ?? linger.snapshot.balls,
          strikes: lastPitch?.strikes ?? linger.snapshot.strikes,
          atBatPitches: pitches,
        };

  return {
    snapshot,
    pitchCount,
    until: Date.now() + AT_BAT_LINGER_MS,
  };
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
    const completedPlay =
      prev != null ? findLastAtBatForBatter(gameState.plays, prev.batterId) : undefined;
    const batterChanged =
      prev != null &&
      prev.batterId != null &&
      gameState.batterId != null &&
      gameState.batterId !== prev.batterId &&
      (prev.atBatPitches.length > 0 || (completedPlay?.detail.pitches.length ?? 0) > 0);

    if (batterChanged) {
      atBatLingerRef.current = {
        snapshot: buildAtBatLingerSnapshot(prev, gameState),
        until: Date.now() + AT_BAT_LINGER_MS,
      };
    } else if (atBatLingerRef.current && Date.now() < atBatLingerRef.current.until) {
      atBatLingerRef.current = refreshAtBatLinger(atBatLingerRef.current, gameState);
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
