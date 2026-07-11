"use client";

import { useEffect, useRef, useState } from "react";

import { isPlayByPlayAtBat } from "@/lib/mlb/liveFeed";
import type { PlayByPlayEntry } from "@/types/mlb-live";

export type OutcomeToastPhase = "hidden" | "enter" | "hold" | "exit";

export interface AtBatOutcomeToastState {
  play: PlayByPlayEntry | null;
  phase: OutcomeToastPhase;
  /** At-bat currently morphing into the feed (during exit). */
  settlingAtBatIndex: number | null;
  dismiss: () => void;
}

const HOLD_MS = 5_000;
const EXIT_MS = 420;

function latestAtBat(plays: PlayByPlayEntry[]): PlayByPlayEntry | null {
  for (let i = plays.length - 1; i >= 0; i -= 1) {
    if (isPlayByPlayAtBat(plays[i])) return plays[i];
  }
  return null;
}

/**
 * Surfaces the newest completed at-bat as a toast, then hands it off to the feed.
 * Skips the initial hydrate so reopening a live game doesn’t replay every result.
 */
export function useAtBatOutcomeToast(
  plays: PlayByPlayEntry[],
  enabled = true,
): AtBatOutcomeToastState {
  const [play, setPlay] = useState<PlayByPlayEntry | null>(null);
  const [phase, setPhase] = useState<OutcomeToastPhase>("hidden");
  const [settlingAtBatIndex, setSettlingAtBatIndex] = useState<number | null>(null);

  const lastSeenIndexRef = useRef<number | null>(null);
  const hydratedRef = useRef(false);
  const timersRef = useRef<number[]>([]);
  const playsRef = useRef(plays);
  playsRef.current = plays;

  const latestIndex = latestAtBat(plays)?.atBatIndex ?? null;

  const clearTimers = () => {
    for (const id of timersRef.current) window.clearTimeout(id);
    timersRef.current = [];
  };

  const dismiss = () => {
    clearTimers();
    setPlay(null);
    setPhase("hidden");
    setSettlingAtBatIndex(null);
  };

  useEffect(() => {
    if (!enabled) {
      clearTimers();
      setPlay(null);
      setPhase("hidden");
      setSettlingAtBatIndex(null);
      lastSeenIndexRef.current = null;
      hydratedRef.current = false;
      return;
    }

    if (latestIndex == null) return;

    if (!hydratedRef.current) {
      hydratedRef.current = true;
      lastSeenIndexRef.current = latestIndex;
      return;
    }

    if (lastSeenIndexRef.current === latestIndex) return;

    const nextPlay = latestAtBat(playsRef.current);
    if (!nextPlay || nextPlay.atBatIndex !== latestIndex) return;

    lastSeenIndexRef.current = latestIndex;
    clearTimers();
    setPlay(nextPlay);
    setPhase("enter");
    setSettlingAtBatIndex(null);

    const holdId = window.setTimeout(() => setPhase("hold"), 40);
    const exitId = window.setTimeout(() => {
      setPhase("exit");
      setSettlingAtBatIndex(latestIndex);
    }, HOLD_MS);
    const doneId = window.setTimeout(() => {
      setPlay(null);
      setPhase("hidden");
      setSettlingAtBatIndex(null);
    }, HOLD_MS + EXIT_MS);

    timersRef.current = [holdId, exitId, doneId];
  }, [enabled, latestIndex]);

  useEffect(() => () => clearTimers(), []);

  return { play, phase, settlingAtBatIndex, dismiss };
}
