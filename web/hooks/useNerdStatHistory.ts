"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  selectHistorySeries,
  selectMultiHistorySeries,
  type NerdStatHistory,
  type NerdStatHistoryBasis,
  type NerdStatHistorySplit,
  NERD_STAT_HISTORY_BASES,
  NERD_STAT_HISTORY_SPLITS,
} from "@/lib/mlb/nerdStats/history";
import type { NerdStatGroupFilter } from "@/lib/mlb/teams";

export type NerdStatHistoryViewMode = "single" | "compare";

interface UseNerdStatHistoryOptions {
  enabled?: boolean;
}

interface UseNerdStatHistoryResult {
  data: NerdStatHistory | null;
  isLoading: boolean;
  error: string | null;
  available: boolean;
  refetch: () => Promise<void>;
}

export function useNerdStatHistory(
  statId: string,
  season: number,
  options: UseNerdStatHistoryOptions = {},
): UseNerdStatHistoryResult {
  const { enabled = true } = options;
  const [data, setData] = useState<NerdStatHistory | null>(null);
  const [isLoading, setIsLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [available, setAvailable] = useState(true);
  const requestIdRef = useRef(0);

  const refetch = useCallback(async () => {
    if (!enabled) return;
    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        season: String(season),
        statId,
      });
      const response = await fetch(`/api/nerd-stats/history?${params.toString()}`, {
        cache: "no-store",
      });
      const body = (await response.json()) as NerdStatHistory | { error?: string; available?: boolean };
      if (!response.ok) {
        if (response.status === 404) {
          if (requestId !== requestIdRef.current) return;
          setAvailable(false);
          setData(null);
          setError(null);
          return;
        }
        throw new Error("error" in body && body.error ? body.error : "Failed to load history");
      }
      if (requestId !== requestIdRef.current) return;
      setAvailable(true);
      setData(body as NerdStatHistory);
    } catch (fetchError) {
      if (requestId !== requestIdRef.current) return;
      setError(fetchError instanceof Error ? fetchError.message : "Failed to load history");
      setData(null);
    } finally {
      if (requestId === requestIdRef.current) setIsLoading(false);
    }
  }, [enabled, season, statId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { data, isLoading, error, available, refetch };
}

interface UseSelectedNerdStatHistoryOptions {
  basis: NerdStatHistoryBasis;
  split: NerdStatHistorySplit;
  group: NerdStatGroupFilter;
  teamId: number;
  sort: "asc" | "desc";
}

export function useSelectedNerdStatHistory(
  history: NerdStatHistory | null,
  options: UseSelectedNerdStatHistoryOptions,
) {
  return useMemo(() => {
    if (!history) return null;
    return selectHistorySeries(history, options);
  }, [history, options]);
}

interface UseMultiNerdStatHistoryOptions {
  basis: NerdStatHistoryBasis;
  split: NerdStatHistorySplit;
  group: NerdStatGroupFilter;
}

export function useMultiNerdStatHistory(
  history: NerdStatHistory | null,
  options: UseMultiNerdStatHistoryOptions,
) {
  return useMemo(() => {
    if (!history) return null;
    return selectMultiHistorySeries(history, options);
  }, [history, options]);
}

export { NERD_STAT_HISTORY_BASES, NERD_STAT_HISTORY_SPLITS };
