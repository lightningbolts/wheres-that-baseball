import type { BallparkHitsAggregate, BallparkHitsDetail } from "@/lib/mlb/ballparkHits";

function detailCacheKey(season: number, venueId: number): string {
  return `${season}:${venueId}`;
}

const summaryCache = new Map<number, BallparkHitsAggregate>();
const detailCache = new Map<string, BallparkHitsDetail>();

export function getCachedBallparkHitsSummary(season: number): BallparkHitsAggregate | null {
  return summaryCache.get(season) ?? null;
}

export function setCachedBallparkHitsSummary(season: number, data: BallparkHitsAggregate): void {
  summaryCache.set(season, data);
}

export function getCachedBallparkHitsDetail(
  season: number,
  venueId: number,
): BallparkHitsDetail | null {
  return detailCache.get(detailCacheKey(season, venueId)) ?? null;
}

export function setCachedBallparkHitsDetail(
  season: number,
  venueId: number,
  data: BallparkHitsDetail,
): void {
  detailCache.set(detailCacheKey(season, venueId), data);
}

export function updateCachedBallparkHitsDetail(
  season: number,
  venueId: number,
  updater: (current: BallparkHitsDetail) => BallparkHitsDetail,
): void {
  const key = detailCacheKey(season, venueId);
  const current = detailCache.get(key);
  if (!current) return;
  detailCache.set(key, updater(current));
}
