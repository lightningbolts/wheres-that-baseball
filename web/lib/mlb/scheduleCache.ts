/** Server-side TTL cache for MLB schedule responses. */

const TTL_MS = 60_000;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

export async function cachedScheduleFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return hit.value as T;
  }

  const value = await fetcher();
  cache.set(key, { value, expiresAt: Date.now() + TTL_MS });
  return value;
}

export function clearScheduleCache(): void {
  cache.clear();
}
