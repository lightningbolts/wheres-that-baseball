"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { buildLiveInsightContext } from "@/lib/mlb/nerdInsights/context";
import {
  loadNerdInsightsFeed,
  saveNerdInsightsFeed,
} from "@/lib/mlb/nerdInsights/feedStorage";
import { buildMiniInsight, generateNerdInsight } from "@/lib/mlb/nerdInsights/generate";
import {
  collectBootstrapFeedTriggers,
  collectInsightTriggers,
  shouldPersistInsightInFeed,
} from "@/lib/mlb/nerdInsights/insightTriggers";
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
  ctx: NonNullable<ReturnType<typeof buildLiveInsightContext>>,
  away: NonNullable<ReturnType<typeof profileFromTeamCard>>,
  home: NonNullable<ReturnType<typeof profileFromTeamCard>>,
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
      insight = buildMiniInsight(base, ctx, away, home, occurrenceCount);
      showOverlay = false;
    } else {
      shownStatIds.add(themeKey);
      statOccurrence.set(themeKey, 1);
    }
  }

  return { insight, showOverlay };
}

function restoreDedupState(insights: NerdInsight[]) {
  const shownIds = new Set<string>();
  const shownStatIds = new Set<string>();
  const toastedIds = new Set<string>();
  const statOccurrence = new Map<string, number>();

  for (const insight of insights) {
    shownIds.add(insight.id);
    toastedIds.add(insight.id);
    if (insight.statId != null && insight.teamId != null) {
      const themeKey = statThemeKey(insight.statId, insight.teamId);
      shownStatIds.add(themeKey);
      statOccurrence.set(themeKey, (statOccurrence.get(themeKey) ?? 0) + 1);
    }
  }

  return { shownIds, shownStatIds, toastedIds, statOccurrence };
}

function insightsFromTriggers(
  gameState: LiveGameState,
  triggers: InsightTrigger[],
  away: NonNullable<ReturnType<typeof profileFromTeamCard>>,
  home: NonNullable<ReturnType<typeof profileFromTeamCard>>,
  shownIds: Set<string>,
  shownStatIds: Set<string>,
  statOccurrence: Map<string, number>,
  options: { persistOnly: boolean; toastedIds?: Set<string> },
): { feedInsights: NerdInsight[]; toasts: NerdInsight[]; liveInsight?: NerdInsight | null } {
  const feedInsights: NerdInsight[] = [];
  const toasts: NerdInsight[] = [];
  let liveInsight: NerdInsight | null | undefined;

  for (const trigger of triggers) {
    const ctx = buildLiveInsightContext(gameState, trigger);
    if (!ctx) continue;

    const base = generateNerdInsight(ctx, away, home);
    if (!base || shownIds.has(base.id)) continue;

    const { insight, showOverlay } = createInsight(
      base,
      ctx,
      away,
      home,
      shownStatIds,
      statOccurrence,
    );

    shownIds.add(insight.id);

    if (shouldPersistInsightInFeed(trigger)) {
      feedInsights.push(insight);
    }

    if (!options.persistOnly) {
      if (trigger.type === "at-bat-end") {
        liveInsight = null;
      } else if (trigger.type === "at-bat-start" || trigger.type === "pitch-thrown") {
        liveInsight = insight;
      }

      if (showOverlay && options.toastedIds && !options.toastedIds.has(insight.id)) {
        options.toastedIds.add(insight.id);
        toasts.push({
          ...insight,
          durationMs: insight.durationMs ?? TOAST_DURATION_MS,
        });
      }
    }
  }

  return { feedInsights, toasts, liveInsight };
}

export function useNerdInsights(
  gameState: LiveGameState | null,
  { season = new Date().getFullYear(), enabled = true, gameOver = false }: UseNerdInsightsOptions = {},
) {
  const gamePk = gameState?.gamePk ?? null;
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
  const bootstrappedRef = useRef(false);
  const persistReadyRef = useRef(false);

  useEffect(() => {
    const stored = gamePk != null ? loadNerdInsightsFeed(gamePk) : [];
    const restored = restoreDedupState(stored);

    shownIdsRef.current = restored.shownIds;
    shownStatIdsRef.current = restored.shownStatIds;
    toastedIdsRef.current = restored.toastedIds;
    statOccurrenceRef.current = restored.statOccurrence;
    prevStateRef.current = null;
    bootstrappedRef.current = stored.length > 0;
    persistReadyRef.current = false;

    setProfiles({ away: null, home: null });
    setFeedInsights(stored);
    setOverlayToasts([]);
    setLiveInsight(null);

    // Allow writes after hydration so we don't clobber storage with [].
    persistReadyRef.current = true;
  }, [gamePk]);

  useEffect(() => {
    if (!persistReadyRef.current || gamePk == null) return;
    saveNerdInsightsFeed(gamePk, feedInsights);
  }, [feedInsights, gamePk]);

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
    if (!enabled || !gameState) return;

    const { away, home } = profiles;
    if (!away || !home) return;

    // First pass after profiles load: rebuild feed from plays if storage was empty.
    if (!bootstrappedRef.current) {
      const triggers = collectBootstrapFeedTriggers(gameState);
      const { feedInsights: bootstrapped } = insightsFromTriggers(
        gameState,
        triggers,
        away,
        home,
        shownIdsRef.current,
        shownStatIdsRef.current,
        statOccurrenceRef.current,
        { persistOnly: true },
      );
      bootstrappedRef.current = true;
      prevStateRef.current = gameState;
      if (bootstrapped.length > 0) {
        setFeedInsights((current) => (current.length > 0 ? current : bootstrapped));
      }
      return;
    }

    if (gameOver) return;
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

    const { feedInsights: newFeedInsights, toasts: newToasts, liveInsight: nextLiveInsight } =
      insightsFromTriggers(
        gameState,
        triggers,
        away,
        home,
        shownIdsRef.current,
        shownStatIdsRef.current,
        statOccurrenceRef.current,
        { persistOnly: false, toastedIds: toastedIdsRef.current },
      );

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
