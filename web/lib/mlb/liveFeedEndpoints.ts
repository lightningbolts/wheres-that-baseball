/**
 * MLB live feed endpoints.
 *
 * The live dashboard hydrates `GET /feed/live` with ETag. Shallow `fields=`
 * strips nested currentPlay. `/timestamps` lags the live document (gating on
 * it skipped pitches until reload). Keep those URL helpers for tests / future
 * use — they are not the hot path.
 */

export const MLB_LIVE_FEED_BASE = "https://statsapi.mlb.com/api/v1.1";

export const MLB_LIVE_FEED_PATH = "/game/{gamePk}/feed/live";

/**
 * Shallow `fields=` does not return nested currentPlay / playEvents.
 * Keep false so callers do not treat fields-filtered live feed as sufficient.
 */
export const MLB_LIVE_FEED_SUPPORTS_PARTIAL_HYDRATE = false;

/** Documented fields list — not used on the hot path (nested nodes come back empty). */
export const MLB_LIVE_FEED_HOT_FIELDS =
  "metaData,gameData,status,liveData,plays,currentPlay,linescore";

export function mlbLiveFeedUrl(gamePk: number): string {
  return `${MLB_LIVE_FEED_BASE}/game/${gamePk}/feed/live`;
}

export function mlbLiveFeedFieldsUrl(
  gamePk: number,
  fields: string = MLB_LIVE_FEED_HOT_FIELDS,
): string {
  return `${mlbLiveFeedUrl(gamePk)}?fields=${encodeURIComponent(fields)}`;
}

export function mlbLiveFeedTimestampsUrl(gamePk: number): string {
  return `${mlbLiveFeedUrl(gamePk)}/timestamps`;
}

export function mlbLiveFeedDiffPatchUrl(gamePk: number, startTimecode: string): string {
  const params = new URLSearchParams({ startTimecode });
  return `${mlbLiveFeedUrl(gamePk)}/diffPatch?${params.toString()}`;
}
