"use client";

import { useEffect, useState } from "react";

import { toPlayableClipUrl, type FastballFeed } from "@/lib/mlb/fastballClips";
import type { ResolvedPlayVideo } from "@/lib/mlb/playVideo";
import { isValidPlayId, savantSportyVideosUrl } from "@/lib/mlb/playVideo";

type Status = "idle" | "loading" | "ready" | "unavailable" | "error";

interface UsePlayVideoResult {
  status: Status;
  video: ResolvedPlayVideo | null;
  savantUrl: string | null;
  error: string | null;
}

interface UsePlayVideoOptions {
  /** When set, resolve via MLB Content / Fastball for this game. */
  gamePk?: number | null;
  /** Extra pitch GUIDs from the same PA (Content often keys the in-play pitch). */
  candidatePlayIds?: string[] | null;
  /** Skip network resolve when the gallery already has a direct MP4. */
  preset?: Pick<ResolvedPlayVideo, "url" | "title"> | null;
  /** Preferred Fastball broadcast angle when multiple feeds exist. */
  feed?: FastballFeed | null;
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

function withPreferredFeed(
  video: ResolvedPlayVideo,
  feed: FastballFeed | null | undefined,
  requestedPlayId?: string | null,
): ResolvedPlayVideo {
  if (!feed || !(video.availableFeeds ?? []).includes(feed)) return video;
  if (video.gamePk == null || video.gamePk <= 0) return video;
  // Always key the stream URL to the play GUID we asked for — never a stale
  // playId from a shared/mismatched cache entry.
  const playId = requestedPlayId && isValidPlayId(requestedPlayId)
    ? requestedPlayId
    : video.playId;
  if (video.feed === feed && video.playId === playId) {
    // Still rewrite legacy query-proxy URLs onto the path-keyed form.
    const nextUrl = `/api/plays/video/stream/${video.gamePk}/${feed}/${encodeURIComponent(playId)}`;
    if (video.url === nextUrl) return video;
    return { ...video, playId, url: nextUrl };
  }
  return {
    ...video,
    playId,
    feed,
    url: `/api/plays/video/stream/${video.gamePk}/${feed}/${encodeURIComponent(playId)}`,
  };
}

/** Drop clips that don't belong to the requested play GUID (or its PA candidates). */
function clipMatchesRequestedPlay(
  video: ResolvedPlayVideo,
  playId: string,
  candidates: string[],
): boolean {
  const allowed = new Set([playId, ...candidates.filter(isValidPlayId)]);
  // Fastball/Film Room/Savant responses should echo the terminal GUID we asked for.
  if (!video.playId) return false;
  return allowed.has(video.playId);
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
    if (!clipMatchesRequestedPlay(data, playId, candidates)) {
      return null;
    }
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
    url: toPlayableClipUrl(preset.url),
    title: preset.title ?? null,
    savantUrl: savantSportyVideosUrl(playId),
    feed: null,
    availableFeeds: [],
  };
}

function initialStatus(
  validId: string | null,
  enabled: boolean,
  key: string | null,
  presetUrl: string | null | undefined,
): Status {
  if (!validId || !enabled) return "idle";
  if (presetUrl) return "ready";
  if (key && sharedCache.has(key)) {
    return sharedCache.get(key) ? "ready" : "unavailable";
  }
  return "loading";
}

function initialVideo(
  validId: string | null,
  key: string | null,
  preset: Pick<ResolvedPlayVideo, "url" | "title"> | null | undefined,
): ResolvedPlayVideo | null {
  if (!validId) return null;
  if (preset?.url) return fromPreset(validId, preset);
  if (key && sharedCache.has(key)) return sharedCache.get(key) ?? null;
  return null;
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
  const preferredFeed = options.feed ?? null;
  const candidatePlayIds = options.candidatePlayIds ?? null;
  const candidateKey = (candidatePlayIds ?? []).filter(isValidPlayId).join(",");
  const key = validId ? cacheKey(validId, gamePk, candidatePlayIds ?? []) : null;

  const [status, setStatus] = useState<Status>(() =>
    initialStatus(validId, enabled, key, preset?.url),
  );
  const [baseVideo, setBaseVideo] = useState<ResolvedPlayVideo | null>(() =>
    initialVideo(validId, key, preset),
  );
  const [error, setError] = useState<string | null>(null);
  // Track which resolve key the current state belongs to so a dialog switch
  // never paints the previous at-bat's clip for one frame.
  const [stateKey, setStateKey] = useState<string | null>(key);

  if (key !== stateKey) {
    setStateKey(key);
    setStatus(initialStatus(validId, enabled, key, preset?.url));
    setBaseVideo(initialVideo(validId, key, preset));
    setError(null);
  }

  useEffect(() => {
    if (!validId || !enabled) {
      setStatus("idle");
      setBaseVideo(null);
      setError(null);
      return;
    }

    if (preset?.url) {
      const resolved = fromPreset(validId, preset);
      sharedCache.set(cacheKey(validId, gamePk, candidatePlayIds ?? []), resolved);
      setBaseVideo(resolved);
      setStatus("ready");
      setError(null);
      return;
    }

    const resolveKey = cacheKey(validId, gamePk, candidatePlayIds ?? []);
    if (sharedCache.has(resolveKey)) {
      const cached = sharedCache.get(resolveKey) ?? null;
      setBaseVideo(cached);
      setStatus(cached ? "ready" : "unavailable");
      setError(null);
      return;
    }

    let cancelled = false;
    let settled = false;
    setStatus("loading");
    setBaseVideo(null);
    setError(null);

    const retryId = window.setInterval(() => {
      if (cancelled || settled) return;
      void fetchResolved(validId, gamePk, candidatePlayIds).then((resolved) => {
        if (cancelled || settled || !resolved) return;
        settled = true;
        sharedCache.set(cacheKey(validId, gamePk, candidatePlayIds ?? []), resolved);
        setBaseVideo(resolved);
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
        setBaseVideo(resolved);
        setStatus(resolved ? "ready" : "unavailable");
      })
      .catch((err: unknown) => {
        if (cancelled || settled) return;
        setBaseVideo(null);
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

  const video = baseVideo ? withPreferredFeed(baseVideo, preferredFeed, validId) : null;

  return {
    status,
    video,
    savantUrl: validId ? savantSportyVideosUrl(validId) : null,
    error,
  };
}
