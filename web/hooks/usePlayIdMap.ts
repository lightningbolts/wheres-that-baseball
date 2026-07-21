"use client";

import { useEffect, useMemo, useState } from "react";

import {
  mergePlayIdsOntoPlays,
  playsNeedPlayIdEnrichment,
} from "@/lib/mlb/playVideo";
import type { PlayByPlayEntry } from "@/types/mlb-live";

interface PlayIdsResponse {
  gamePk: number;
  playIds: Record<string, string>;
}

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
        const response = await fetch(`/api/game/${gamePk}/play-ids`, {
          signal: controller.signal,
        });
        if (!response.ok) return;
        const data = (await response.json()) as PlayIdsResponse;
        if (!cancelled && data.playIds) {
          setPlayIds(data.playIds);
        }
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
