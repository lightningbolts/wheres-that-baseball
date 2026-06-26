/**
 * MLB live feed endpoint notes (audit P2 #21).
 *
 * GET /api/v1.1/game/{gamePk}/feed/live returns the full live JSON document.
 * There is no documented `hydrate` or field-filter parameter on this endpoint —
 * partial responses are not supported. Optimizations must happen client-side
 * (snapshot projection, incremental play chunks) or via caching (ETag 304).
 */

export const MLB_LIVE_FEED_BASE = "https://statsapi.mlb.com/api/v1.1";

export const MLB_LIVE_FEED_PATH = "/game/{gamePk}/feed/live";

/** Whether MLB documents partial hydration on the live feed endpoint. */
export const MLB_LIVE_FEED_SUPPORTS_PARTIAL_HYDRATE = false;

export function mlbLiveFeedUrl(gamePk: number): string {
  return `${MLB_LIVE_FEED_BASE}/game/${gamePk}/feed/live`;
}
