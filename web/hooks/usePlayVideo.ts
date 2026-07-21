"use client";

import { useEffect, useState } from "react";

import type { ResolvedPlayVideo } from "@/lib/mlb/playVideo";
import { isValidPlayId, savantSportyVideosUrl } from "@/lib/mlb/playVideo";

type Status = "idle" | "loading" | "ready" | "unavailable" | "error";

interface UsePlayVideoResult {
  status: Status;
  video: ResolvedPlayVideo | null;
  savantUrl: string | null;
  error: string | null;
}

const sharedCache = new Map<string, ResolvedPlayVideo | null>();
const inflight = new Map<string, Promise<ResolvedPlayVideo | null>>();

async function fetchResolved(playId: string): Promise<ResolvedPlayVideo | null> {
  if (sharedCache.has(playId)) {
    return sharedCache.get(playId) ?? null;
  }

  const pending = inflight.get(playId);
  if (pending) return pending;

  const promise = (async () => {
    const response = await fetch(`/api/plays/video?playId=${encodeURIComponent(playId)}`);
    if (response.status === 404) {
      sharedCache.set(playId, null);
      return null;
    }
    if (!response.ok) {
      throw new Error(`Video resolve failed: ${response.status}`);
    }
    const data = (await response.json()) as ResolvedPlayVideo;
    sharedCache.set(playId, data);
    return data;
  })().finally(() => {
    inflight.delete(playId);
  });

  inflight.set(playId, promise);
  return promise;
}

/**
 * Resolve a Savant MP4 for a playId. Pass `enabled=false` until the user
 * opens the player or the card enters the viewport.
 */
export function usePlayVideo(
  playId: string | null | undefined,
  enabled = true,
): UsePlayVideoResult {
  const validId = playId && isValidPlayId(playId) ? playId : null;
  const [status, setStatus] = useState<Status>(() => {
    if (!validId || !enabled) return "idle";
    if (sharedCache.has(validId)) {
      return sharedCache.get(validId) ? "ready" : "unavailable";
    }
    return "loading";
  });
  const [video, setVideo] = useState<ResolvedPlayVideo | null>(() =>
    validId && sharedCache.has(validId) ? (sharedCache.get(validId) ?? null) : null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!validId || !enabled) {
      setStatus("idle");
      setVideo(null);
      setError(null);
      return;
    }

    if (sharedCache.has(validId)) {
      const cached = sharedCache.get(validId) ?? null;
      setVideo(cached);
      setStatus(cached ? "ready" : "unavailable");
      setError(null);
      return;
    }

    let cancelled = false;
    setStatus("loading");
    setError(null);

    void fetchResolved(validId)
      .then((resolved) => {
        if (cancelled) return;
        setVideo(resolved);
        setStatus(resolved ? "ready" : "unavailable");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setVideo(null);
        setStatus("error");
        setError(err instanceof Error ? err.message : "Failed to load video");
      });

    return () => {
      cancelled = true;
    };
  }, [validId, enabled]);

  return {
    status,
    video,
    savantUrl: validId ? savantSportyVideosUrl(validId) : null,
    error,
  };
}
