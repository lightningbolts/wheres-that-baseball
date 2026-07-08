"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { buildLiveInsightContext } from "@/lib/mlb/nerdInsights/context";
import { buildMiniInsight, generateNerdInsight } from "@/lib/mlb/nerdInsights/generate";
import { collectInsightTriggers } from "@/lib/mlb/nerdInsights/insightTriggers";
import { profileFromTeamCard } from "@/lib/mlb/nerdInsights/profile";
import type { InsightTrigger, NerdInsight } from "@/lib/mlb/nerdInsights/types";
import { statThemeKey } from "@/lib/mlb/nerdInsights/types";
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

export interface UseNerdInsightsOptions {
  season?: number;
  enabled?: boolean;
  gameOver?: boolean;
}

function createInsight(
  base: NerdInsight,
  ctx: ReturnType<typeof buildLiveInsightContext>,
  away: ReturnType<typeof profileFromTeamCard>,
  home: ReturnType<typeof profileFromTeamCard>,
  shownStatIds: Set<string>,
  statOccurrence: Map<string, number>,
): { insight: NerdInsight; showOverlay: boolean } {
  let insight: NerdInsight = base;
  let showOverlay = base.variant === "full";

  if (base.statId != null && base.teamId != null) {
    const themeKey = statThemeKey(base.statId, base.teamId);
    const priorCount = statOccurrence.get(themeKey) ?? 0;

    if (shownStatIds.has(themeKey)) {
      const occurrenceCount = priorCount + 1;
      statOccurrence.set(themeKey, occurrenceCount);
      insight = buildMiniInsight(base, ctx!, away, home, occurrenceCount);
      showOverlay = false;
    } else {
      shownStatIds.add(themeKey);
      statOccurrence.set(themeKey, 1);
    }
  }

  return { insight, showOverlay };
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
    if (!prev || prev.gamePk !== gameState.gamePk) {
      prevStateRef.current = gameState;
      return;
    }

    const triggers = collectInsightTriggers(prev, gameState);
    if (triggers.length === 0) {
      prevStateRef.current = gameState;
      return;
    }

    const { away, home } = profiles;
    if (!away && !home) return;

    const newFeedInsights: NerdInsight[] = [];
    const newToasts: NerdInsight[] = [];
    let nextLiveInsight: NerdInsight | null | undefined;

    for (const trigger of triggers) {
      const ctx = buildLiveInsightContext(gameState, trigger);
      if (!ctx) continue;

      const base = generateNerdInsight(ctx, away, home);
      if (!base || shownIdsRef.current.has(base.id)) continue;

      const { insight, showOverlay } = createInsight(
        base,
        ctx,
        away,
        home,
        shownStatIdsRef.current,
        statOccurrenceRef.current,
      );

      shownIdsRef.current.add(insight.id);
      newFeedInsights.push(insight);

      if (trigger.type === "at-bat-end") {
        nextLiveInsight = null;
      } else if (
        trigger.type === "at-bat-start" ||
        trigger.type === "pitch-thrown"
      ) {
        nextLiveInsight = insight;
      }

      if (showOverlay && !toastedIdsRef.current.has(insight.id)) {
        toastedIdsRef.current.add(insight.id);
        newToasts.push({
          ...insight,
          durationMs: insight.durationMs ?? TOAST_DURATION_MS,
        });
      }
    }

    prevStateRef.current = gameState;

    if (newFeedInsights.length > 0) {
      setFeedInsights((current) => [...current, ...newFeedInsights]);
    }
    if (newToasts.length > 0) {
      setOverlayToasts((current) => [...current, ...newToasts]);
    }
    if (nextLiveInsight !== undefined) {
      setLiveInsight(nextLiveInsight);
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
