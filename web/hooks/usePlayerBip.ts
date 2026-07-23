"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { PlayerBipDetail, PlayerBipIndexEntry } from "@/lib/mlb/playerBip";
import type { VenueHit } from "@/lib/mlb/ballparkHits";

const CURRENT_SEASON = new Date().getFullYear();

export function usePlayerSearch(season = CURRENT_SEASON) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<PlayerBipIndexEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    const q = query.trim();
    const handle = window.setTimeout(async () => {
      setIsLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          season: String(season),
          q,
          limit: "12",
        });
        const response = await fetch(`/api/players/search?${params.toString()}`, {
          cache: "no-store",
        });
        const body = (await response.json()) as {
          players?: PlayerBipIndexEntry[];
          error?: string;
        };
        if (!response.ok) {
          throw new Error(body.error ?? "Search failed");
        }
        if (requestId !== requestIdRef.current) return;
        setSuggestions(body.players ?? []);
      } catch (err) {
        if (requestId !== requestIdRef.current) return;
        setError(err instanceof Error ? err.message : "Search failed");
        setSuggestions([]);
      } finally {
        if (requestId === requestIdRef.current) setIsLoading(false);
      }
    }, q ? 180 : 0);

    return () => window.clearTimeout(handle);
  }, [query, season]);

  return { query, setQuery, suggestions, isLoading, error };
}

export function usePlayerBip(playerId: number | null, season = CURRENT_SEASON) {
  const [data, setData] = useState<PlayerBipDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const refetch = useCallback(async () => {
    if (playerId == null) {
      setData(null);
      return;
    }
    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ season: String(season) });
      const response = await fetch(`/api/players/${playerId}/bip?${params.toString()}`, {
        cache: "no-store",
      });
      const body = (await response.json()) as PlayerBipDetail | { error?: string };
      if (!response.ok) {
        throw new Error("error" in body && body.error ? body.error : "Failed to load player BIP");
      }
      if (requestId !== requestIdRef.current) return;
      setData(body as PlayerBipDetail);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to load player BIP");
      setData(null);
    } finally {
      if (requestId === requestIdRef.current) setIsLoading(false);
    }
  }, [playerId, season]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const fetchHitDetail = useCallback(
    async (hitKey: string): Promise<VenueHit | null> => {
      if (playerId == null) return null;
      const params = new URLSearchParams({
        season: String(season),
        hitKey,
      });
      const response = await fetch(`/api/players/${playerId}/bip?${params.toString()}`, {
        cache: "no-store",
      });
      if (!response.ok) return null;
      const body = (await response.json()) as { hit?: VenueHit };
      return body.hit ?? null;
    },
    [playerId, season],
  );

  return { data, isLoading, error, refetch, fetchHitDetail };
}
