export const GAMEDAY_ASSETS_BASE =
  "https://prod-gameday.mlbstatic.com/responsive-gameday-assets/1.3.0";

/** Native @2x stadium JPEG dimensions — all venues share this frame. */
export const GAMEDAY_STADIUM_WIDTH = 2316;
export const GAMEDAY_STADIUM_HEIGHT = 888;

/** Overlay anchors measured on the native 2316×888 stadium JPEG. */
export const GAMEDAY_FRAME = {
  /** Home-plate center in the panorama (percent from top / left). */
  plateY: 80.7,
  plateX: 35.5,
  /** Bottom of the batter silhouette — waist line on the infield dirt. */
  batterBottomY: 81.5,
  /** Strike-zone height as a percent of frame height. */
  zoneHeight: 13,
  /** Gap between zone bottom and plate center. */
  zoneAbovePlate: 1.5,
  /** Batter silhouette width / max-height (percent of frame). */
  batterWidth: 24,
  batterHeight: 52,
  /** RHB / LHB anchor X on the native frame. */
  batterRightX: 19,
  batterLeftX: 81,
} as const;

export const GAMEDAY_FETCH_HEADERS = {
  Referer: "https://www.mlb.com/",
  "User-Agent": "mlb-atbat-predictor/1.0",
} as const;

/** Night stadium photo used behind the Gameday pitch view. */
export function gamedayStadiumCdnUrl(venueId: number | null | undefined): string {
  const id = venueId && venueId > 0 ? venueId : "default";
  return `${GAMEDAY_ASSETS_BASE}/images/stadiums/night/${id}@2x.jpg`;
}

export function gamedayStadiumProxyUrl(venueId: number | null | undefined): string {
  const id = venueId && venueId > 0 ? venueId : "default";
  return `/api/gameday/stadium?venueId=${encodeURIComponent(String(id))}`;
}
