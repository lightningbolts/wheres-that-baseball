"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { VenueHit } from "@/lib/mlb/ballparkHits";
import type { PlayerBipDetail, PlayerBipIndexEntry } from "@/lib/mlb/playerBip";
import type { PlayerNerdCard } from "@/lib/mlb/nerdStats/types";
import {
  getCachedPlayerBip,
  getCachedPlayerNerd,
  getCachedPlayerPitchBip,
  getCachedPlayerPitching,
  getCachedPlayerSearch,
  setCachedPlayerBip,
  setCachedPlayerNerd,
  setCachedPlayerPitchBip,
  setCachedPlayerPitching,
  setCachedPlayerSearch,
  type PlayerPitchingResponse,
} from "@/lib/mlb/playerCache";

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

    const cached = getCachedPlayerSearch(season, q);
    if (cached) {
      setSuggestions(cached);
      setIsLoading(false);
      setError(null);
    }

    const handle = window.setTimeout(async () => {
      if (!cached) setIsLoading(true);
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
        const players = body.players ?? [];
        setCachedPlayerSearch(season, q, players);
        setSuggestions(players);
      } catch (err) {
        if (requestId !== requestIdRef.current) return;
        setError(err instanceof Error ? err.message : "Search failed");
        if (!cached) setSuggestions([]);
      } finally {
        if (requestId === requestIdRef.current) setIsLoading(false);
      }
    }, q ? 180 : 0);

    return () => window.clearTimeout(handle);
  }, [query, season]);

  return { query, setQuery, suggestions, isLoading, error };
}

function usePlayerBipEndpoint(
  endpoint: "bip" | "pitch-bip",
  playerId: number | null,
  season: number,
  getCached: (season: number, playerId: number) => PlayerBipDetail | null,
  setCached: (season: number, playerId: number, data: PlayerBipDetail) => void,
) {
  const cached = playerId != null ? getCached(season, playerId) : null;
  const [data, setData] = useState<PlayerBipDetail | null>(cached);
  const [isLoading, setIsLoading] = useState(!cached && playerId != null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const requestIdRef = useRef(0);

  const refetch = useCallback(async () => {
    if (playerId == null) {
      setData(null);
      setIsLoading(false);
      setNotFound(false);
      return;
    }
    const requestId = ++requestIdRef.current;
    const fromCache = getCached(season, playerId);
    if (fromCache) {
      setData(fromCache);
      setIsLoading(false);
      setNotFound(false);
    } else {
      setIsLoading(true);
    }
    setError(null);
    try {
      const params = new URLSearchParams({ season: String(season) });
      const response = await fetch(`/api/players/${playerId}/${endpoint}?${params.toString()}`, {
        cache: "no-store",
      });
      if (response.status === 404) {
        if (requestId !== requestIdRef.current) return;
        setNotFound(true);
        if (!fromCache) setData(null);
        return;
      }
      const body = (await response.json()) as PlayerBipDetail | { error?: string };
      if (!response.ok) {
        throw new Error(
          "error" in body && body.error ? body.error : `Failed to load player ${endpoint}`,
        );
      }
      if (requestId !== requestIdRef.current) return;
      const detail = body as PlayerBipDetail;
      setCached(season, playerId, detail);
      setData(detail);
      setNotFound(false);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(err instanceof Error ? err.message : `Failed to load player ${endpoint}`);
      if (!fromCache) setData(null);
    } finally {
      if (requestId === requestIdRef.current) setIsLoading(false);
    }
  }, [endpoint, getCached, playerId, season, setCached]);

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
      const response = await fetch(`/api/players/${playerId}/${endpoint}?${params.toString()}`, {
        cache: "no-store",
      });
      if (!response.ok) return null;
      const body = (await response.json()) as { hit?: VenueHit };
      return body.hit ?? null;
    },
    [endpoint, playerId, season],
  );

  return { data, isLoading, error, notFound, refetch, fetchHitDetail };
}

export function usePlayerBip(playerId: number | null, season = CURRENT_SEASON) {
  return usePlayerBipEndpoint("bip", playerId, season, getCachedPlayerBip, setCachedPlayerBip);
}

export function usePlayerPitchBip(playerId: number | null, season = CURRENT_SEASON) {
  return usePlayerBipEndpoint(
    "pitch-bip",
    playerId,
    season,
    getCachedPlayerPitchBip,
    setCachedPlayerPitchBip,
  );
}

export function usePlayerPitchingLine(playerId: number | null, season = CURRENT_SEASON) {
  const cached = playerId != null ? getCachedPlayerPitching(season, playerId) : null;
  const [data, setData] = useState<PlayerPitchingResponse | null>(cached);
  const [isLoading, setIsLoading] = useState(!cached && playerId != null);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (playerId == null) {
      setData(null);
      setIsLoading(false);
      return;
    }

    const requestId = ++requestIdRef.current;
    const fromCache = getCachedPlayerPitching(season, playerId);
    if (fromCache) {
      setData(fromCache);
      setIsLoading(false);
    } else {
      setIsLoading(true);
    }
    setError(null);

    void (async () => {
      try {
        const params = new URLSearchParams({ season: String(season) });
        const response = await fetch(`/api/players/${playerId}/pitching?${params.toString()}`, {
          cache: "no-store",
        });
        const body = (await response.json()) as PlayerPitchingResponse | { error?: string };
        if (!response.ok) {
          throw new Error(
            "error" in body && body.error ? body.error : "Failed to load pitching line",
          );
        }
        if (requestId !== requestIdRef.current) return;
        const line = body as PlayerPitchingResponse;
        setCachedPlayerPitching(season, playerId, line);
        setData(line);
      } catch (err) {
        if (requestId !== requestIdRef.current) return;
        setError(err instanceof Error ? err.message : "Failed to load pitching line");
        if (!fromCache) setData(null);
      } finally {
        if (requestId === requestIdRef.current) setIsLoading(false);
      }
    })();
  }, [playerId, season]);

  return { data, isLoading, error };
}

export function usePlayerNerd(playerId: number | null, season = CURRENT_SEASON) {
  const cached = playerId != null ? getCachedPlayerNerd(season, playerId) : null;
  const [data, setData] = useState<PlayerNerdCard | null>(cached);
  const [isLoading, setIsLoading] = useState(!cached && playerId != null);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (playerId == null) {
      setData(null);
      setIsLoading(false);
      return;
    }

    const requestId = ++requestIdRef.current;
    const fromCache = getCachedPlayerNerd(season, playerId);
    if (fromCache) {
      setData(fromCache);
      setIsLoading(false);
    } else {
      setIsLoading(true);
    }
    setError(null);

    void (async () => {
      try {
        const params = new URLSearchParams({ season: String(season) });
        const response = await fetch(`/api/players/${playerId}/nerd?${params.toString()}`, {
          cache: "no-store",
        });
        const body = (await response.json()) as PlayerNerdCard | { error?: string };
        if (!response.ok) {
          throw new Error("error" in body && body.error ? body.error : "Failed to load nerd card");
        }
        if (requestId !== requestIdRef.current) return;
        const card = body as PlayerNerdCard;
        setCachedPlayerNerd(season, playerId, card);
        setData(card);
      } catch (err) {
        if (requestId !== requestIdRef.current) return;
        setError(err instanceof Error ? err.message : "Failed to load nerd card");
        if (!fromCache) setData(null);
      } finally {
        if (requestId === requestIdRef.current) setIsLoading(false);
      }
    })();
  }, [playerId, season]);

  return { data, isLoading, error };
}
