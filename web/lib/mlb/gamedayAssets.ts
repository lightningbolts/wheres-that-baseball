export const GAMEDAY_ASSETS_BASE =
  "https://prod-gameday.mlbstatic.com/responsive-gameday-assets/1.3.0";

/** Native @2x stadium JPEG dimensions — sky/stands layer in pitch-fx. */
export const GAMEDAY_STADIUM_WIDTH = 2316;
export const GAMEDAY_STADIUM_HEIGHT = 888;

/** Gameday pitch-fx view uses a 4:3 field (not the full panorama aspect). */
export const GAMEDAY_PITCH_FX_ASPECT = 4 / 3;

/** Layered backgrounds and player slot from MLB responsive-pitch-fx CSS. */
export const GAMEDAY_PITCH_FX = {
  infieldBgPosition: "50% 100%",
  stadiumBgPosition: "50% 0%",
  playerWidth: 19,
  playerPaddingBottom: 38.6895,
  playerTop: 16.0795,
  playerSide: 25.5665,
  domMarginTop: 6,
  /** Strike zone canvas in the 4:3 pitch-fx overlay (percent of overlay). */
  zoneX: 42,
  zoneY: 48,
  zoneWidth: 16,
  zoneHeight: 22,
} as const;

export type GamedayStadiumVariant = "day" | "night";

export function resolveGamedayStadiumVariant(
  dayNight: string | null | undefined,
): GamedayStadiumVariant {
  return dayNight?.toLowerCase() === "day" ? "day" : "night";
}

export const GAMEDAY_FETCH_HEADERS = {
  Referer: "https://www.mlb.com/",
  "User-Agent": "mlb-atbat-predictor/1.0",
} as const;

/** Sky/stands layer behind the infield dirt. */
export function gamedayStadiumCdnUrl(
  venueId: number | null | undefined,
  variant: GamedayStadiumVariant = "night",
): string {
  const id = venueId && venueId > 0 ? venueId : "default";
  return `${GAMEDAY_ASSETS_BASE}/images/stadiums/${variant}/${id}@2x.jpg`;
}

export function gamedayStadiumProxyUrl(
  venueId: number | null | undefined,
  variant: GamedayStadiumVariant = "night",
): string {
  const id = venueId && venueId > 0 ? venueId : "default";
  return `/api/gameday/stadium?venueId=${encodeURIComponent(String(id))}&variant=${variant}`;
}

/** Infield dirt / plate layer composited at the bottom of pitch-fx. */
export function gamedayInfieldCdnUrl(venueId: number | null | undefined): string {
  const id = venueId && venueId > 0 ? venueId : "default";
  return `${GAMEDAY_ASSETS_BASE}/images/stadiums/infield-full/${id}@2x.jpg`;
}

export function gamedayInfieldProxyUrl(venueId: number | null | undefined): string {
  const id = venueId && venueId > 0 ? venueId : "default";
  return `/api/gameday/infield?venueId=${encodeURIComponent(String(id))}`;
}
