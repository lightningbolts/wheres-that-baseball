"use client";

import { useEffect, useState } from "react";

import type { ResolvedPlayVideo } from "@/lib/mlb/playVideo";
import { isValidPlayId, savantSportyVideosUrl } from "@/lib/mlb/playVideo";
import { getCachedHighlightForPlayId } from "@/hooks/useGameHighlights";

type Status = "idle" | "loading" | "ready" | "unavailable" | "error";

interface UsePlayVideoResult {
  status: Status;
  video: ResolvedPlayVideo | null;
  savantUrl: string | null;
  error: string | null;
}

interface UsePlayVideoOptions {
  /** When set, resolve via MLB Content first (works during live games). */
  gamePk?: number | null;
  /** Extra pitch GUIDs from the same PA (Content often keys the in-play pitch). */
  candidatePlayIds?: string[] | null;
  /** Skip network resolve when the gallery already has a direct MP4. */
  preset?: Pick<ResolvedPlayVideo, "url" | "title"> | null;
}

const sharedCache = new Map<string, ResolvedPlayVideo | null>();
const inflight = new Map<string, Promise<ResolvedPlayVideo | null>>();

function cacheKey(
  playId: string,
  gamePk: number | null | undefined,
  candidates: string[] = [],
): string {
  const extras = candidates.filter((id) => id !== playId).join(",");
  const base = gamePk != null && gamePk > 0 ? `${playId}|${gamePk}` : playId;
  return extras ? `${base}|${extras}` : base;
}

async function fetchResolved(
  playId: string,
  gamePk?: number | null,
  candidatePlayIds?: string[] | null,
): Promise<ResolvedPlayVideo | null> {
  const candidates = (candidatePlayIds ?? []).filter((id) => isValidPlayId(id));
  const key = cacheKey(playId, gamePk, candidates);
  if (sharedCache.has(key)) {
    return sharedCache.get(key) ?? null;
  }

  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = (async () => {
    const params = new URLSearchParams({ playId });
    if (gamePk != null && gamePk > 0) params.set("gamePk", String(gamePk));
    const alts = candidates.filter((id) => id !== playId);
    if (alts.length > 0) params.set("playIds", alts.join(","));
    const response = await fetch(`/api/plays/video?${params.toString()}`);
    if (response.status === 404) {
      // Don't permanently cache misses — clips often appear minutes later live.
      return null;
    }
    if (!response.ok) {
      throw new Error(`Video resolve failed: ${response.status}`);
    }
    const data = (await response.json()) as ResolvedPlayVideo;
    sharedCache.set(key, data);
    return data;
  })().finally(() => {
    inflight.delete(key);
  });

  inflight.set(key, promise);
  return promise;
}

function fromPreset(
  playId: string,
  preset: Pick<ResolvedPlayVideo, "url" | "title">,
): ResolvedPlayVideo {
  return {
    playId,
    url: preset.url,
    title: preset.title ?? null,
    savantUrl: savantSportyVideosUrl(playId),
  };
}

/**
 * Resolve a Savant/Content MP4 for a playId. Pass `enabled=false` until the user
 * opens the player or the card enters the viewport.
 */
export function usePlayVideo(
  playId: string | null | undefined,
  enabled = true,
  options: UsePlayVideoOptions = {},
): UsePlayVideoResult {
  const validId = playId && isValidPlayId(playId) ? playId : null;
  const gamePk = options.gamePk;
  const preset = options.preset;
  const candidatePlayIds = options.candidatePlayIds ?? null;
  const candidateKey = (candidatePlayIds ?? []).filter(isValidPlayId).join(",");
  const key = validId ? cacheKey(validId, gamePk, candidatePlayIds ?? []) : null;

  const [status, setStatus] = useState<Status>(() => {
    if (!validId || !enabled) return "idle";
    if (preset?.url) return "ready";
    if (key && sharedCache.has(key)) {
      return sharedCache.get(key) ? "ready" : "unavailable";
    }
    return "loading";
  });
  const [video, setVideo] = useState<ResolvedPlayVideo | null>(() => {
    if (!validId) return null;
    if (preset?.url) return fromPreset(validId, preset);
    if (key && sharedCache.has(key)) return sharedCache.get(key) ?? null;
    return null;
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!validId || !enabled) {
      setStatus("idle");
      setVideo(null);
      setError(null);
      return;
    }

    if (preset?.url) {
      const resolved = fromPreset(validId, preset);
      sharedCache.set(cacheKey(validId, gamePk, candidatePlayIds ?? []), resolved);
      setVideo(resolved);
      setStatus("ready");
      setError(null);
      return;
    }

    if (gamePk != null && gamePk > 0) {
      const idsToCheck = [validId, ...(candidatePlayIds ?? [])];
      for (const id of idsToCheck) {
        if (!isValidPlayId(id)) continue;
        const cachedClip = getCachedHighlightForPlayId(gamePk, id);
        if (cachedClip?.url) {
          const resolved = fromPreset(validId, {
            url: cachedClip.url,
            title: cachedClip.title,
          });
          sharedCache.set(cacheKey(validId, gamePk, candidatePlayIds ?? []), resolved);
          setVideo(resolved);
          setStatus("ready");
          setError(null);
          return;
        }
      }
    }

    const resolveKey = cacheKey(validId, gamePk, candidatePlayIds ?? []);
    if (sharedCache.has(resolveKey)) {
      const cached = sharedCache.get(resolveKey) ?? null;
      setVideo(cached);
      setStatus(cached ? "ready" : "unavailable");
      setError(null);
      return;
    }

    let cancelled = false;
    let settled = false;
    setStatus("loading");
    setError(null);

    const retryId = window.setInterval(() => {
      if (cancelled || settled) return;
      void fetchResolved(validId, gamePk, candidatePlayIds).then((resolved) => {
        if (cancelled || settled || !resolved) return;
        settled = true;
        sharedCache.set(cacheKey(validId, gamePk, candidatePlayIds ?? []), resolved);
        setVideo(resolved);
        setStatus("ready");
        setError(null);
        window.clearInterval(retryId);
      });
    }, 8_000);

    void fetchResolved(validId, gamePk, candidatePlayIds)
      .then((resolved) => {
        if (cancelled || settled) return;
        if (resolved) {
          settled = true;
          window.clearInterval(retryId);
        }
        setVideo(resolved);
        setStatus(resolved ? "ready" : "unavailable");
      })
      .catch((err: unknown) => {
        if (cancelled || settled) return;
        setVideo(null);
        setStatus("error");
        setError(err instanceof Error ? err.message : "Failed to load video");
      });

    const stopId = window.setTimeout(() => {
      window.clearInterval(retryId);
    }, 90_000);

    return () => {
      cancelled = true;
      window.clearInterval(retryId);
      window.clearTimeout(stopId);
    };
  }, [validId, enabled, gamePk, preset?.url, preset?.title, candidateKey]);

  return {
    status,
    video,
    savantUrl: validId ? savantSportyVideosUrl(validId) : null,
    error,
  };
}
