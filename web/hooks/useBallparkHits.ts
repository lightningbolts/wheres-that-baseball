"use client";

import { startTransition, useCallback, useEffect, useRef, useState } from "react";

import type { BallparkHitsAggregate, BallparkHitsDetail, VenueHit } from "@/lib/mlb/ballparkHits";
import {
  getCachedBallparkHitsDetail,
  getCachedBallparkHitsSummary,
  setCachedBallparkHitsDetail,
  setCachedBallparkHitsSummary,
} from "@/lib/mlb/ballparkHitsCache";

interface UseBallparkHitsSummaryResult {
  data: BallparkHitsAggregate | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

interface UseBallparkHitsDetailResult {
  data: BallparkHitsDetail | null;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  loadMore: () => Promise<void>;
  hasMore: boolean;
  fetchHitDetail: (hitKey: string) => Promise<VenueHit | null>;
}

const MOBILE_PAGE_SIZE = 40;
const DESKTOP_PAGE_SIZE = 80;

function getPageSize(): number {
  if (typeof window === "undefined") return DESKTOP_PAGE_SIZE;
  return window.matchMedia("(max-width: 767px)").matches ? MOBILE_PAGE_SIZE : DESKTOP_PAGE_SIZE;
}

export function useBallparkHitsSummary(season: number): UseBallparkHitsSummaryResult {
  const cachedSummary = getCachedBallparkHitsSummary(season);
  const [data, setData] = useState<BallparkHitsAggregate | null>(cachedSummary);
  const [isLoading, setIsLoading] = useState(!cachedSummary);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const refetch = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({ season: String(season) });
      const response = await fetch(`/api/ballparks/hits?${params.toString()}`, {
        cache: "no-store",
      });
      const body = (await response.json()) as BallparkHitsAggregate | { error?: string };

      if (!response.ok) {
        throw new Error("error" in body && body.error ? body.error : "Failed to load ballpark hits");
      }

      if (requestId !== requestIdRef.current) return;
      const summary = body as BallparkHitsAggregate;
      setCachedBallparkHitsSummary(season, summary);
      setData(summary);
    } catch (fetchError) {
      if (requestId !== requestIdRef.current) return;
      setError(fetchError instanceof Error ? fetchError.message : "Failed to load ballpark hits");
      setData(null);
    } finally {
      if (requestId === requestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [season]);

  useEffect(() => {
    const cached = getCachedBallparkHitsSummary(season);
    if (cached) {
      setData(cached);
      setIsLoading(false);
      setError(null);
      return;
    }
    setData(null);
    setIsLoading(true);
    void refetch();
  }, [refetch, season]);

  return { data, isLoading, error, refetch };
}

export function useBallparkHitsDetail(
  venueId: number,
  season: number,
): UseBallparkHitsDetailResult {
  const cachedDetail = getCachedBallparkHitsDetail(season, venueId);
  const [data, setData] = useState<BallparkHitsDetail | null>(cachedDetail);
  const [isLoading, setIsLoading] = useState(!cachedDetail);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const pageSizeRef = useRef(getPageSize());

  const refetch = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    setError(null);
    pageSizeRef.current = getPageSize();

    try {
      const params = new URLSearchParams({
        season: String(season),
        venueId: String(venueId),
        limit: String(pageSizeRef.current),
        offset: "0",
      });
      const response = await fetch(`/api/ballparks/hits?${params.toString()}`, {
        cache: "no-store",
      });
      const body = (await response.json()) as BallparkHitsDetail | { error?: string };

      if (!response.ok) {
        throw new Error("error" in body && body.error ? body.error : "Failed to load ballpark hits");
      }

      if (requestId !== requestIdRef.current) return;
      const detail = body as BallparkHitsDetail;
      setCachedBallparkHitsDetail(season, venueId, detail);
      setData(detail);
    } catch (fetchError) {
      if (requestId !== requestIdRef.current) return;
      setError(fetchError instanceof Error ? fetchError.message : "Failed to load ballpark hits");
      setData(null);
    } finally {
      if (requestId === requestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [season, venueId]);

  const loadMore = useCallback(async () => {
    if (!data?.hasMore || isLoadingMore) return;

    setIsLoadingMore(true);
    try {
      const params = new URLSearchParams({
        season: String(season),
        venueId: String(venueId),
        hitsOnly: "true",
        limit: String(pageSizeRef.current),
        offset: String(data.hits.length),
      });
      const response = await fetch(`/api/ballparks/hits?${params.toString()}`, {
        cache: "no-store",
      });
      const body = (await response.json()) as {
        hits: VenueHit[];
        hitsTotal: number;
        hasMore: boolean;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(body.error ?? "Failed to load more hits");
      }

      setData((current) => {
        if (!current) return current;
        const next = {
          ...current,
          hits: [...current.hits, ...body.hits],
          hitsTotal: body.hitsTotal,
          hasMore: body.hasMore,
        };
        setCachedBallparkHitsDetail(season, venueId, next);
        return next;
      });
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Failed to load more hits");
    } finally {
      setIsLoadingMore(false);
    }
  }, [data, isLoadingMore, season, venueId]);

  const fetchHitDetail = useCallback(
    async (hitKey: string): Promise<VenueHit | null> => {
      const cached = data?.hits.find((hit) => hit.hitKey === hitKey);
      if (cached?.detail) return cached as VenueHit;

      const params = new URLSearchParams({
        season: String(season),
        venueId: String(venueId),
        hitKey,
      });
      const response = await fetch(`/api/ballparks/hits?${params.toString()}`, {
        cache: "no-store",
      });
      const body = (await response.json()) as { hit?: VenueHit; error?: string };
      if (!response.ok || !body.hit) return null;

      // Cache in the background so opening the dialog isn't competing with a
      // full page re-render (spray/WebGL) — that was flashing the page.
      startTransition(() => {
        setData((current) => {
          if (!current) return current;
          const next = {
            ...current,
            hits: current.hits.map((hit) =>
              hit.hitKey === hitKey ? { ...hit, detail: body.hit!.detail } : hit,
            ),
          };
          setCachedBallparkHitsDetail(season, venueId, next);
          return next;
        });
      });

      return body.hit;
    },
    [data?.hits, season, venueId],
  );

  useEffect(() => {
    const cached = getCachedBallparkHitsDetail(season, venueId);
    if (cached) {
      setData(cached);
      setIsLoading(false);
      setError(null);
      return;
    }
    setData(null);
    setIsLoading(true);
    void refetch();
  }, [refetch, season, venueId]);

  return {
    data,
    isLoading,
    isLoadingMore,
    error,
    refetch,
    loadMore,
    hasMore: data?.hasMore ?? false,
    fetchHitDetail,
  };
}
