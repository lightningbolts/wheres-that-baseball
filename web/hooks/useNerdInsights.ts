"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { buildLiveInsightContext } from "@/lib/mlb/nerdInsights/context";
import { generateNerdInsight } from "@/lib/mlb/nerdInsights/generate";
import { profileFromTeamCard } from "@/lib/mlb/nerdInsights/profile";
import type { InsightTrigger, NerdInsightToast } from "@/lib/mlb/nerdInsights/types";
import { isHalfInningBreak } from "@/lib/mlb/lineup";
import { isPlayByPlayAtBat } from "@/lib/mlb/liveFeed";
import { getTeamByAbbrev } from "@/lib/mlb/teams";
import type { TeamNerdCard } from "@/lib/mlb/nerdStats/types";
import type { LiveGameState } from "@/types/mlb-live";

const TOAST_DURATION_MS = 7_000;
const MIN_TOAST_GAP_MS = 40_000;
const MAX_TOASTS_PER_GAME = 10;

async function fetchTeamNerdCard(teamId: number, season: number): Promise<TeamNerdCard | null> {
  try {
    const response = await fetch(
      `/api/nerd-stats?${new URLSearchParams({ season: String(season), teamId: String(teamId) })}`,
      { cache: "no-store" },
    );
    if (!response.ok) return null;
    return (await response.json()) as TeamNerdCard;
  } catch {
    return null;
  }
}

function detectTriggers(
  prev: LiveGameState,
  next: LiveGameState,
): InsightTrigger[] {
  const triggers: InsightTrigger[] = [];

  if (isHalfInningBreak(next.inningState) && !isHalfInningBreak(prev.inningState)) {
    triggers.push({
      type: "half-break",
      halfKey: `${next.inning}-${next.inningHalf}`,
    });
  }

  if (next.inning !== prev.inning) {
    triggers.push({ type: "inning-change", inning: next.inning });
  }

  if (next.batterId != null && next.batterId !== prev.batterId) {
    const atBats = next.plays.filter(isPlayByPlayAtBat);
    triggers.push({ type: "at-bat-start", atBatIndex: atBats.length });

    if (prev.batterId != null && prev.atBatPitches.length > 0) {
      const completed = atBats.at(-1);
      triggers.push({
        type: "at-bat-end",
        atBatIndex: completed?.atBatIndex ?? atBats.length,
        event: completed?.event ?? "",
      });
    }
  }

  if (next.atBatPitches.length > prev.atBatPitches.length) {
    const atBats = next.plays.filter(isPlayByPlayAtBat);
    triggers.push({
      type: "pitch-thrown",
      atBatIndex: atBats.length,
      pitchNumber: next.atBatPitches.length,
    });
  }

  return triggers;
}

export interface UseNerdInsightsOptions {
  season?: number;
  enabled?: boolean;
  gameOver?: boolean;
}

export function useNerdInsights(
  gameState: LiveGameState | null,
  { season = new Date().getFullYear(), enabled = true, gameOver = false }: UseNerdInsightsOptions = {},
) {
  const [toasts, setToasts] = useState<NerdInsightToast[]>([]);
  const [profiles, setProfiles] = useState<{
    away: ReturnType<typeof profileFromTeamCard> | null;
    home: ReturnType<typeof profileFromTeamCard> | null;
  }>({ away: null, home: null });
  const prevStateRef = useRef<LiveGameState | null>(null);
  const shownIdsRef = useRef<Set<string>>(new Set());
  const lastShownAtRef = useRef(0);
  const toastCountRef = useRef(0);

  useEffect(() => {
    shownIdsRef.current = new Set();
    lastShownAtRef.current = 0;
    toastCountRef.current = 0;
    prevStateRef.current = null;
    setProfiles({ away: null, home: null });
    setToasts([]);
  }, [gameState?.gamePk]);

  useEffect(() => {
    if (!enabled || !gameState || gameOver) return;

    const away = getTeamByAbbrev(gameState.awayAbbrev);
    const home = getTeamByAbbrev(gameState.homeAbbrev);
    if (!away || !home) return;

    let cancelled = false;

    void (async () => {
      const [awayCard, homeCard] = await Promise.all([
        fetchTeamNerdCard(away.id, season),
        fetchTeamNerdCard(home.id, season),
      ]);
      if (cancelled) return;
      setProfiles({
        away: awayCard ? profileFromTeamCard(awayCard) : null,
        home: homeCard ? profileFromTeamCard(homeCard) : null,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, gameOver, gameState, season]);

  useEffect(() => {
    if (!enabled || !gameState || gameOver) return;
    if (gameState.gameStatus !== "Live" && gameState.gameStatus !== "In Progress") return;

    const prev = prevStateRef.current;
    prevStateRef.current = gameState;
    if (!prev || prev.gamePk !== gameState.gamePk) return;

    const triggers = detectTriggers(prev, gameState);
    if (triggers.length === 0) return;

    const { away, home } = profiles;
    if (!away && !home) return;

    const now = Date.now();
    if (now - lastShownAtRef.current < MIN_TOAST_GAP_MS) return;
    if (toastCountRef.current >= MAX_TOASTS_PER_GAME) return;

    for (const trigger of triggers) {
      const ctx = buildLiveInsightContext(gameState, trigger);
      if (!ctx) continue;

      const insight = generateNerdInsight(ctx, away, home);
      if (!insight || shownIdsRef.current.has(insight.id)) continue;

      shownIdsRef.current.add(insight.id);
      lastShownAtRef.current = now;
      toastCountRef.current += 1;

      const toast: NerdInsightToast = {
        ...insight,
        durationMs: insight.durationMs ?? TOAST_DURATION_MS,
      };

      setToasts((current) => [...current, toast]);
      break;
    }
  }, [enabled, gameOver, gameState, profiles]);

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  return { toasts, dismissToast };
}
