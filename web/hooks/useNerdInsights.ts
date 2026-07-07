"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { buildLiveInsightContext } from "@/lib/mlb/nerdInsights/context";
import { buildMiniInsight, generateNerdInsight } from "@/lib/mlb/nerdInsights/generate";
import { profileFromTeamCard } from "@/lib/mlb/nerdInsights/profile";
import type { InsightTrigger, NerdInsight } from "@/lib/mlb/nerdInsights/types";
import { statThemeKey } from "@/lib/mlb/nerdInsights/types";
import { isHalfInningBreak } from "@/lib/mlb/lineup";
import { normalizeHalfInning } from "@/lib/mlb/nerdInsights/situational";
import { isPlayByPlayAtBat } from "@/lib/mlb/liveFeed";
import { getTeamByAbbrev } from "@/lib/mlb/teams";
import type { TeamNerdCard } from "@/lib/mlb/nerdStats/types";
import type { LiveGameState } from "@/types/mlb-live";

const TOAST_DURATION_MS = 7_000;

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
      halfKey: `${prev.inning}-${normalizeHalfInning(prev.inningHalf)}`,
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
  const [feedInsights, setFeedInsights] = useState<NerdInsight[]>([]);
  const [overlayToasts, setOverlayToasts] = useState<NerdInsight[]>([]);
  const [liveInsight, setLiveInsight] = useState<NerdInsight | null>(null);
  const [profiles, setProfiles] = useState<{
    away: ReturnType<typeof profileFromTeamCard> | null;
    home: ReturnType<typeof profileFromTeamCard> | null;
  }>({ away: null, home: null });
  const prevStateRef = useRef<LiveGameState | null>(null);
  const shownIdsRef = useRef<Set<string>>(new Set());
  const shownStatIdsRef = useRef<Set<string>>(new Set());
  const toastedIdsRef = useRef<Set<string>>(new Set());
  const statOccurrenceRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    shownIdsRef.current = new Set();
    shownStatIdsRef.current = new Set();
    toastedIdsRef.current = new Set();
    statOccurrenceRef.current = new Map();
    prevStateRef.current = null;
    setProfiles({ away: null, home: null });
    setFeedInsights([]);
    setOverlayToasts([]);
    setLiveInsight(null);
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

    for (const trigger of triggers) {
      const ctx = buildLiveInsightContext(gameState, trigger);
      if (!ctx) continue;

      const base = generateNerdInsight(ctx, away, home);
      if (!base || shownIdsRef.current.has(base.id)) continue;

      let insight: NerdInsight = base;
      let showOverlay = base.variant === "full";

      if (base.statId != null && base.teamId != null) {
        const themeKey = statThemeKey(base.statId, base.teamId);
        const priorCount = statOccurrenceRef.current.get(themeKey) ?? 0;

        if (shownStatIdsRef.current.has(themeKey)) {
          const occurrenceCount = priorCount + 1;
          statOccurrenceRef.current.set(themeKey, occurrenceCount);
          insight = buildMiniInsight(base, ctx, away, home, occurrenceCount);
          showOverlay = false;
        } else {
          shownStatIdsRef.current.add(themeKey);
          statOccurrenceRef.current.set(themeKey, 1);
        }
      }

      shownIdsRef.current.add(insight.id);

      setFeedInsights((current) => [...current, insight]);

      if (insight.anchor.type === "live") {
        setLiveInsight(insight);
      } else if (trigger.type === "at-bat-end") {
        setLiveInsight(null);
      }

      if (showOverlay && !toastedIdsRef.current.has(insight.id)) {
        toastedIdsRef.current.add(insight.id);
        const toast: NerdInsight = {
          ...insight,
          durationMs: insight.durationMs ?? TOAST_DURATION_MS,
        };
        setOverlayToasts((current) => [...current, toast]);
      }

      break;
    }
  }, [enabled, gameOver, gameState, profiles]);

  const dismissToast = useCallback((id: string) => {
    setOverlayToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  return { feedInsights, overlayToasts, liveInsight, dismissToast };
}

export function buildInsightMaps(feedInsights: NerdInsight[]) {
  const insightsByAtBat = new Map<number, NerdInsight[]>();
  const halfInsights = new Map<string, NerdInsight[]>();
  const inningInsights = new Map<number, NerdInsight[]>();

  for (const insight of feedInsights) {
    const { anchor } = insight;
    if (anchor.type === "at-bat") {
      const list = insightsByAtBat.get(anchor.atBatIndex) ?? [];
      list.push(insight);
      insightsByAtBat.set(anchor.atBatIndex, list);
    } else if (anchor.type === "half") {
      const list = halfInsights.get(anchor.halfKey) ?? [];
      list.push(insight);
      halfInsights.set(anchor.halfKey, list);
    } else if (anchor.type === "inning") {
      const list = inningInsights.get(anchor.inning) ?? [];
      list.push(insight);
      inningInsights.set(anchor.inning, list);
    }
  }

  return { insightsByAtBat, halfInsights, inningInsights };
}
