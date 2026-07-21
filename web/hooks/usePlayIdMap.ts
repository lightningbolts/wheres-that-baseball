"use client";

import { useEffect, useMemo, useState } from "react";

import {
  fetchPlayIdMap,
  mergePlayIdsOntoPlays,
  playsNeedPlayIdEnrichment,
} from "@/lib/mlb/playVideo";
import type { PlayByPlayEntry } from "@/types/mlb-live";

/**
 * For historical/legacy archives missing playId, fetch a one-shot
 * atBatIndex → playId map from MLB feed/live and merge onto plays.
 */
export function usePlayIdMap(
  gamePk: number | null | undefined,
  plays: PlayByPlayEntry[],
  enabled = true,
): PlayByPlayEntry[] {
  const needsEnrichment = enabled && playsNeedPlayIdEnrichment(plays);
  const [playIds, setPlayIds] = useState<Record<string, string> | null>(null);

  useEffect(() => {
    if (!enabled || gamePk == null || gamePk <= 0 || !needsEnrichment) return;

    let cancelled = false;
    const controller = new AbortController();

    void (async () => {
      try {
        const map = await fetchPlayIdMap(gamePk, controller.signal);
        if (!cancelled) setPlayIds(map);
      } catch {
        // Enrichment is best-effort; UI still works without icons.
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [enabled, gamePk, needsEnrichment]);

  return useMemo(
    () => (playIds ? mergePlayIdsOntoPlays(plays, playIds) : plays),
    [plays, playIds],
  );
}
