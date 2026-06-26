/** In-memory cache for slow-changing MLB player stats (matchup, RISP). */

const TTL_MS = 3_600_000; // 1 hour

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

function cacheKey(parts: string[]): string {
  return parts.join(":");
}

export async function cachedStatsFetch<T>(
  keyParts: string[],
  fetcher: () => Promise<T>,
): Promise<T> {
  const key = cacheKey(keyParts);
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return hit.value as T;
  }

  const value = await fetcher();
  cache.set(key, { value, expiresAt: Date.now() + TTL_MS });
  return value;
}

export function clearStatsCache(): void {
  cache.clear();
}
