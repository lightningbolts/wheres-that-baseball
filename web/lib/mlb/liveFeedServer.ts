import type { MLBLiveFeedResponse } from "@/types/mlb-live";

import { recordFetchMetric } from "@/lib/mlb/fetchMetrics";

const MLB_FEED_BASE = "https://statsapi.mlb.com/api/v1.1";
/** Coalesce rapid server-side polls without adding live pitch lag. */
const CACHE_MS = 400;

interface CacheEntry {
  feed: MLBLiveFeedResponse;
  fetchedAt: number;
  etag: string | null;
}

const feedCache = new Map<number, CacheEntry>();
const inflight = new Map<number, Promise<MLBLiveFeedResponse>>();

async function fetchLiveFeedFromMlb(
  gamePk: number,
  priorEtag: string | null,
): Promise<{ feed: MLBLiveFeedResponse | null; etag: string | null; notModified: boolean; status: number; bytes: number }> {
  const headers: HeadersInit = { Accept: "application/json" };
  if (priorEtag) {
    headers["If-None-Match"] = priorEtag;
  }

  const started = performance.now();
  const response = await fetch(`${MLB_FEED_BASE}/game/${gamePk}/feed/live`, {
    cache: "no-store",
    headers,
  });

  const latencyMs = performance.now() - started;

  if (response.status === 304) {
    recordFetchMetric({
      gamePk,
      source: "server",
      latencyMs,
      payloadBytes: 0,
      status: 304,
      notModified: true,
      at: new Date().toISOString(),
    });
    return {
      feed: null,
      etag: response.headers.get("etag") ?? priorEtag,
      notModified: true,
      status: 304,
      bytes: 0,
    };
  }

  if (!response.ok) {
    recordFetchMetric({
      gamePk,
      source: "server",
      latencyMs,
      payloadBytes: 0,
      status: response.status,
      notModified: false,
      at: new Date().toISOString(),
    });
    throw new Error(`MLB live feed failed: ${response.status}`);
  }

  const text = await response.text();
  const feed = JSON.parse(text) as MLBLiveFeedResponse;
  const etag = response.headers.get("etag");

  recordFetchMetric({
    gamePk,
    source: "server",
    latencyMs,
    payloadBytes: text.length,
    status: response.status,
    notModified: false,
    at: new Date().toISOString(),
  });

  return { feed, etag, notModified: false, status: response.status, bytes: text.length };
}

export async function getCachedLiveFeed(gamePk: number): Promise<MLBLiveFeedResponse> {
  const cached = feedCache.get(gamePk);
  if (cached && Date.now() - cached.fetchedAt < CACHE_MS) {
    return cached.feed;
  }

  const pending = inflight.get(gamePk);
  if (pending) return pending;

  const promise = (async () => {
    const prior = feedCache.get(gamePk);
    const result = await fetchLiveFeedFromMlb(gamePk, prior?.etag ?? null);

    if (result.notModified && prior) {
      feedCache.set(gamePk, { ...prior, fetchedAt: Date.now() });
      inflight.delete(gamePk);
      return prior.feed;
    }

    if (!result.feed) {
      inflight.delete(gamePk);
      throw new Error(`MLB live feed empty for gamePk=${gamePk}`);
    }

    feedCache.set(gamePk, {
      feed: result.feed,
      fetchedAt: Date.now(),
      etag: result.etag,
    });
    inflight.delete(gamePk);
    return result.feed;
  })().catch((error) => {
    inflight.delete(gamePk);
    throw error;
  });

  inflight.set(gamePk, promise);
  return promise;
}

export function clearLiveFeedCache(gamePk?: number): void {
  if (gamePk == null) {
    feedCache.clear();
    inflight.clear();
    return;
  }
  feedCache.delete(gamePk);
  inflight.delete(gamePk);
}
