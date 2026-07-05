"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type {
  NerdStatDetail,
  NerdStatsSummary,
  TeamNerdCard,
} from "@/lib/mlb/nerdStats/types";
import type { NerdStatSplitFilter } from "@/lib/mlb/nerdStats/splits";
import type { NerdStatWindowId } from "@/lib/mlb/nerdStats/windows";

interface UseNerdStatsSummaryResult {
  data: NerdStatsSummary | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

interface UseNerdStatDetailResult {
  data: NerdStatDetail | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

interface UseTeamNerdCardResult {
  data: TeamNerdCard | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

async function fetchNerdStats<T extends object>(params: URLSearchParams): Promise<T> {
  const response = await fetch(`/api/nerd-stats?${params.toString()}`, { cache: "no-store" });
  const body = (await response.json()) as T | { error?: string };
  if (!response.ok) {
    throw new Error("error" in body && body.error ? body.error : "Failed to load nerd stats");
  }
  return body as T;
}

function nerdStatsParams(
  season: number,
  window: NerdStatWindowId,
  split: NerdStatSplitFilter,
): URLSearchParams {
  const params = new URLSearchParams({ season: String(season) });
  if (window !== "season") params.set("window", window);
  if (split !== "all" && window === "season") params.set("split", split);
  return params;
}

export function useNerdStatsSummary(
  season: number,
  window: NerdStatWindowId = "season",
  split: NerdStatSplitFilter = "all",
): UseNerdStatsSummaryResult {
  const [data, setData] = useState<NerdStatsSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const refetch = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    setError(null);
    try {
      const result = await fetchNerdStats<NerdStatsSummary>(
        nerdStatsParams(season, window, split),
      );
      if (requestId !== requestIdRef.current) return;
      setData(result);
    } catch (fetchError) {
      if (requestId !== requestIdRef.current) return;
      setError(fetchError instanceof Error ? fetchError.message : "Failed to load nerd stats");
      setData(null);
    } finally {
      if (requestId === requestIdRef.current) setIsLoading(false);
    }
  }, [season, split, window]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { data, isLoading, error, refetch };
}

export function useNerdStatDetail(
  statId: string,
  season: number,
  window: NerdStatWindowId = "season",
  split: NerdStatSplitFilter = "all",
): UseNerdStatDetailResult {
  const [data, setData] = useState<NerdStatDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const refetch = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    setError(null);
    try {
      const params = nerdStatsParams(season, window, split);
      params.set("statId", statId);
      const result = await fetchNerdStats<NerdStatDetail>(params);
      if (requestId !== requestIdRef.current) return;
      setData(result);
    } catch (fetchError) {
      if (requestId !== requestIdRef.current) return;
      setError(fetchError instanceof Error ? fetchError.message : "Failed to load stat");
      setData(null);
    } finally {
      if (requestId === requestIdRef.current) setIsLoading(false);
    }
  }, [season, split, statId, window]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { data, isLoading, error, refetch };
}

export function useTeamNerdCard(teamId: number, season: number): UseTeamNerdCardResult {
  const [data, setData] = useState<TeamNerdCard | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const refetch = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    setError(null);
    try {
      const result = await fetchNerdStats<TeamNerdCard>(
        new URLSearchParams({ season: String(season), teamId: String(teamId) }),
      );
      if (requestId !== requestIdRef.current) return;
      setData(result);
    } catch (fetchError) {
      if (requestId !== requestIdRef.current) return;
      setError(fetchError instanceof Error ? fetchError.message : "Failed to load team card");
      setData(null);
    } finally {
      if (requestId === requestIdRef.current) setIsLoading(false);
    }
  }, [season, teamId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { data, isLoading, error, refetch };
}
