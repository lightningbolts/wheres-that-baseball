"use client";

import { useEffect, useState } from "react";

import type { GameHighlightClip } from "@/lib/mlb/gameHighlights";

interface UseGameHighlightsResult {
  clips: GameHighlightClip[];
  isLoading: boolean;
  error: string | null;
}

const cache = new Map<number, GameHighlightClip[]>();
const inflight = new Map<number, Promise<GameHighlightClip[]>>();

async function fetchClips(
  gamePk: number,
  isLive: boolean,
  signal?: AbortSignal,
): Promise<GameHighlightClip[]> {
  if (!isLive) {
    const cached = cache.get(gamePk);
    if (cached) return cached;
  }

  const pending = inflight.get(gamePk);
  if (pending) return pending;

  const promise = (async () => {
    const qs = isLive ? "?live=1" : "";
    const response = await fetch(`/api/game/${gamePk}/highlights${qs}`, {
      signal,
      cache: isLive ? "no-store" : "default",
    });
    if (!response.ok) {
      throw new Error(`Highlights fetch failed: ${response.status}`);
    }
    const data = (await response.json()) as { clips?: GameHighlightClip[] };
    const clips = data.clips ?? [];
    cache.set(gamePk, clips);
    return clips;
  })().finally(() => {
    inflight.delete(gamePk);
  });

  inflight.set(gamePk, promise);
  return promise;
}

/**
 * MLB Content highlights for a game (direct MP4s — works during live games
 * before Savant sporty-videos are published).
 */
export function useGameHighlights(
  gamePk: number | null | undefined,
  options: { enabled?: boolean; isLive?: boolean; refreshKey?: string | number } = {},
): UseGameHighlightsResult {
  const enabled = options.enabled !== false && gamePk != null && gamePk > 0;
  const isLive = Boolean(options.isLive);
  const refreshKey = options.refreshKey;
  const [clips, setClips] = useState<GameHighlightClip[]>(() =>
    gamePk != null && cache.has(gamePk) ? (cache.get(gamePk) ?? []) : [],
  );
  const [isLoading, setIsLoading] = useState(enabled && clips.length === 0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || gamePk == null) {
      setClips([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    if (!isLive && cache.has(gamePk)) {
      setClips(cache.get(gamePk) ?? []);
      setIsLoading(false);
      setError(null);
      return;
    }

    const hasCachedClips = (cache.get(gamePk)?.length ?? 0) > 0;
    setIsLoading(!hasCachedClips);
    setError(null);

    void fetchClips(gamePk, isLive, controller.signal)
      .then((next) => {
        if (cancelled) return;
        setClips(next);
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Failed to load highlights");
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [enabled, gamePk, isLive, refreshKey]);

  return { clips, isLoading, error };
}

/** Seed the shared client cache (e.g. after a server prefetch). */
export function seedGameHighlightsCache(gamePk: number, clips: GameHighlightClip[]): void {
  cache.set(gamePk, clips);
}

export function getCachedHighlightForPlayId(
  gamePk: number,
  playId: string,
): GameHighlightClip | null {
  const clips = cache.get(gamePk);
  if (!clips) return null;
  return clips.find((clip) => clip.playId === playId) ?? null;
}
