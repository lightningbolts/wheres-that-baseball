"use client";

import { useEffect, useLayoutEffect, useState } from "react";

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

/** A held at-bat: `startedAt` null means "starting now" (stamped right after commit). */
interface AtBatLinger {
  snapshot: LiveGameState;
  startedAt: number | null;
}

function refreshAtBatLinger(linger: AtBatLinger, gameState: LiveGameState): AtBatLinger {
  const prevCount = linger.snapshot.atBatPitches.length;
  const completedPlay = findLastAtBatForBatter(gameState.plays, linger.snapshot.batterId);
  const pitches = mergeLingerPitches(linger.snapshot, completedPlay);

  if (pitches.length === prevCount) return linger;

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

  return { snapshot, startedAt: null };
}

/** Everything the hook remembers between feed updates. Timestamps of null mean "now". */
interface LingerMachine {
  /** The feed state this machine last processed. */
  source: LiveGameState | null;
  gamePk: number | null;
  lastActive: LiveGameState | null;
  breakKey: string | null;
  snapshot: LiveGameState | null;
  startedAt: number | null;
  atBat: AtBatLinger | null;
}

const EMPTY: LingerMachine = {
  source: null,
  gamePk: null,
  lastActive: null,
  breakKey: null,
  snapshot: null,
  startedAt: 0,
  atBat: null,
};

const elapsed = (startedAt: number | null, now: number) => (startedAt == null ? 0 : now - startedAt);

/** Fold one feed update into the machine (pure; `now` is the last known clock reading). */
function step(prevMachine: LingerMachine, gameState: LiveGameState | null, now: number): LingerMachine {
  const gamePk = gameState?.gamePk ?? null;
  const m: LingerMachine =
    prevMachine.gamePk === gamePk ? { ...prevMachine, source: gameState } : { ...EMPTY, source: gameState, gamePk };
  if (!gameState) return m;

  const isBreak = isHalfInningBreak(gameState.inningState);
  if (!isBreak) {
    const prev = m.lastActive;
    const completedPlay =
      prev != null ? findLastAtBatForBatter(gameState.plays, prev.batterId) : undefined;
    const batterChanged =
      prev != null &&
      prev.batterId != null &&
      gameState.batterId != null &&
      gameState.batterId !== prev.batterId &&
      (prev.atBatPitches.length > 0 || (completedPlay?.detail.pitches.length ?? 0) > 0);

    let atBat = m.atBat;
    if (batterChanged) {
      atBat = { snapshot: buildAtBatLingerSnapshot(prev, gameState), startedAt: null };
    } else if (atBat && elapsed(atBat.startedAt, now) < AT_BAT_LINGER_MS) {
      atBat = refreshAtBatLinger(atBat, gameState);
    }
    return { ...m, atBat, lastActive: gameState, breakKey: null, snapshot: null, startedAt: 0 };
  }

  const key = breakKey(gameState);
  const nextSnapshot = buildLingerState(gameState, m.lastActive);
  const prevPitchCount = m.snapshot?.atBatPitches.length ?? 0;
  const nextPitchCount = nextSnapshot?.atBatPitches.length ?? 0;
  const next = { ...m, atBat: null };
  if (m.breakKey !== key) {
    return { ...next, breakKey: key, snapshot: nextSnapshot, startedAt: null };
  }
  if ((nextSnapshot && nextPitchCount > prevPitchCount) || (!m.snapshot && nextSnapshot)) {
    return { ...next, snapshot: nextSnapshot, startedAt: null };
  }
  return next;
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
  const [machine, setMachine] = useState<LingerMachine>(EMPTY);
  /** Last clock reading, taken after commits and when a linger expires (never during render). */
  const [now, setNow] = useState(0);

  // Fold each new feed state in during render ("adjust state when props change").
  let m = machine;
  if (machine.source !== gameState) {
    m = step(machine, gameState, now);
    setMachine(m);
  }

  // Stamp "now" timestamps with the real clock right after commit, before paint.
  const pending = m.startedAt == null || (m.atBat != null && m.atBat.startedAt == null);
  useLayoutEffect(() => {
    if (!pending) return;
    const t = Date.now();
    setNow(t);
    setMachine((cur) => ({
      ...cur,
      startedAt: cur.startedAt ?? t,
      atBat: cur.atBat && cur.atBat.startedAt == null ? { ...cur.atBat, startedAt: t } : cur.atBat,
    }));
  }, [pending]);

  const isBreak = gameState != null && isHalfInningBreak(gameState.inningState);
  const currentBreakKey = isBreak && gameState ? breakKey(gameState) : null;

  const atBatLingering =
    !isBreak && m.atBat != null && elapsed(m.atBat.startedAt, now) < AT_BAT_LINGER_MS;

  const lingerAge = elapsed(m.startedAt, now);
  const lingerPitchCount = m.snapshot?.atBatPitches.length ?? 0;
  const isBreakLingering =
    currentBreakKey != null &&
    ((lingerPitchCount > 0 && lingerAge < BREAK_LINGER_MS) ||
      (lingerPitchCount === 0 && lingerAge < MAX_BREAK_WAIT_MS));

  const isLingering = isBreakLingering || atBatLingering;
  const breakStartedAt = m.startedAt;
  const atBatStartedAt = m.atBat?.startedAt ?? null;

  // Wake up when the linger runs out.
  useEffect(() => {
    if (!isLingering) return;
    let endsAt: number;
    if (isBreakLingering) {
      if (breakStartedAt == null) return;
      endsAt = breakStartedAt + (lingerPitchCount > 0 ? BREAK_LINGER_MS : MAX_BREAK_WAIT_MS);
    } else {
      if (atBatStartedAt == null) return;
      endsAt = atBatStartedAt + AT_BAT_LINGER_MS;
    }
    const id = window.setTimeout(() => setNow(Date.now()), Math.max(0, endsAt - Date.now()));
    return () => window.clearTimeout(id);
  }, [isLingering, isBreakLingering, currentBreakKey, lingerPitchCount, breakStartedAt, atBatStartedAt]);

  const showBreakUI =
    isBreak && !isBreakLingering && !(gameState != null && isGameOver(gameState));

  let atBatViewState: LiveGameState | null = gameState;
  if (isBreakLingering) {
    atBatViewState = m.snapshot ?? m.lastActive ?? gameState;
  } else if (atBatLingering && m.atBat) {
    atBatViewState = m.atBat.snapshot;
  }

  return { atBatViewState, isLingering, showBreakUI };
}
