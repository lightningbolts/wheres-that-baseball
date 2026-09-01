"use client";

import { useCallback, useEffect, useState } from "react";

import { fetchLiveSnapshotPreferringMlb } from "@/lib/mlb/liveFeed";
import type { LiveSnapshotWithPlays } from "@/lib/mlb/liveFeed";
import type { CardPitcher } from "@/types/mlb";
import type { GameBoxScore } from "@/types/mlb-boxscore";

export const CARD_POLL_MS = 5_000;

export interface GameCardSnapshot {
  balls: number;
  strikes: number;
  outs: number;
  onFirst: boolean;
  onSecond: boolean;
  onThird: boolean;
  inning: number;
  inningHalf: string;
  awayRuns: number;
  homeRuns: number;
  awayPitcher: CardPitcher | null;
  homePitcher: CardPitcher | null;
  boxScore: GameBoxScore | null;
}

function snapshotToCardState(snapshot: LiveSnapshotWithPlays): GameCardSnapshot {
  const play = snapshot.currentPlay;
  const linescore = snapshot.linescore;
  const offense = linescore.offense ?? {};
  const inningState = linescore.inningState ?? "";
  const isBreak = /^(middle|end)$/i.test(inningState);

  return {
    balls: isBreak ? 0 : (play?.count?.balls ?? 0),
    strikes: isBreak ? 0 : (play?.count?.strikes ?? 0),
    outs: isBreak ? 0 : (play?.count?.outs ?? 0),
    onFirst: isBreak ? false : offense.first != null,
    onSecond: isBreak ? false : offense.second != null,
    onThird: isBreak ? false : offense.third != null,
    inning: play?.about?.inning ?? linescore.currentInning ?? 1,
    inningHalf: isBreak
      ? inningState.toLowerCase()
      : (play?.about?.halfInning ?? linescore.inningState ?? ""),
    awayRuns: linescore.teams?.away?.runs ?? 0,
    homeRuns: linescore.teams?.home?.runs ?? 0,
    awayPitcher: snapshot.awayPitcher,
    homePitcher: snapshot.homePitcher,
    boxScore: snapshot.boxScore ?? null,
  };
}

/** Lightweight live snapshot for slate cards — MLB-direct, only polls when enabled. */
export function useGameCardSnapshot(gamePk: number, enabled: boolean) {
  const [state, setState] = useState<GameCardSnapshot | null>(null);

  const poll = useCallback(async () => {
    try {
      const snapshot = await fetchLiveSnapshotPreferringMlb(gamePk, null);
      setState(snapshotToCardState(snapshot));
    } catch {
      // keep stale card state
    }
  }, [gamePk]);

  useEffect(() => {
    if (!enabled) {
      setState(null);
      return;
    }

    void poll();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void poll();
    }, CARD_POLL_MS);

    const onVisibility = () => {
      if (document.visibilityState === "visible") void poll();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, poll]);

  return state;
}
