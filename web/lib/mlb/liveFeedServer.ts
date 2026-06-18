import type { MLBLiveFeedResponse } from "@/types/mlb-live";

const MLB_FEED_BASE = "https://statsapi.mlb.com/api/v1.1";
/** Coalesce rapid client polls into one upstream MLB request per game. */
const CACHE_MS = 80;

interface CacheEntry {
  feed: MLBLiveFeedResponse;
  fetchedAt: number;
}

const feedCache = new Map<number, CacheEntry>();
const inflight = new Map<number, Promise<MLBLiveFeedResponse>>();

export async function getCachedLiveFeed(gamePk: number): Promise<MLBLiveFeedResponse> {
  const cached = feedCache.get(gamePk);
  if (cached && Date.now() - cached.fetchedAt < CACHE_MS) {
    return cached.feed;
  }

  const pending = inflight.get(gamePk);
  if (pending) return pending;

  const promise = fetch(`${MLB_FEED_BASE}/game/${gamePk}/feed/live`, { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`MLB live feed failed: ${response.status}`);
      }
      const feed = (await response.json()) as MLBLiveFeedResponse;
      feedCache.set(gamePk, { feed, fetchedAt: Date.now() });
      inflight.delete(gamePk);
      return feed;
    })
    .catch((error) => {
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
