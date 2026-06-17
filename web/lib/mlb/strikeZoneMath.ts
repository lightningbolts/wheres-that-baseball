import type { PlayPitch } from "@/types/mlb-live";

export const VIEW_WIDTH_FT = 3.2;
export const PADDING_FT = 0.35;
/** Statcast pZ origin — ground at the center of home plate. */
export const GROUND_Z = 0;
/** Extra feet below ground so pitches in the dirt stay in frame. */
export const DIRT_PADDING_FT = 0.25;
/** Bottom band for home plate and pitches below the zone (Gameday-style). */
export const PLATE_BAND_PCT = 18;
export const ZONE_BAND_PCT = 100 - PLATE_BAND_PCT;

export const PITCH_BALL_COLOR = "#22c55e";
export const PITCH_STRIKE_COLOR = "#ef4444";
export const PITCH_IN_PLAY_SAFE_COLOR = "#3b82f6";
export const PITCH_IN_PLAY_OUT_COLOR = "#a855f7";
export const PITCH_NEUTRAL_COLOR = "#737373";
export const PITCH_REVIEW_COLOR = "#f59e0b";

const ZONE_WIDTH_FT = 1.42;

function horizontalPercent(pX: number) {
  const minX = -VIEW_WIDTH_FT / 2;
  const maxX = VIEW_WIDTH_FT / 2;
  return Math.min(100, Math.max(0, ((pX - minX) / (maxX - minX)) * 100));
}

function zoneVerticalBounds(szTop: number, szBottom: number) {
  return {
    minZ: szBottom - PADDING_FT,
    maxZ: szTop + PADDING_FT,
  };
}

function plateVerticalBounds(szBottom: number) {
  return {
    minZ: GROUND_Z - DIRT_PADDING_FT,
    maxZ: szBottom - PADDING_FT,
  };
}

function zToSvgY(pZ: number, minZ: number, maxZ: number, bandTop: number, bandHeight: number) {
  return bandTop + (1 - (pZ - minZ) / (maxZ - minZ)) * bandHeight;
}

export function toSvgPercent(
  pX: number,
  pZ: number,
  szTop: number,
  szBottom: number,
): { x: number; y: number } {
  const zone = zoneVerticalBounds(szTop, szBottom);
  const plate = plateVerticalBounds(szBottom);

  let y: number;
  if (pZ >= zone.minZ) {
    y = zToSvgY(pZ, zone.minZ, zone.maxZ, 0, ZONE_BAND_PCT);
  } else {
    y = zToSvgY(pZ, plate.minZ, plate.maxZ, ZONE_BAND_PCT, PLATE_BAND_PCT);
  }

  return {
    x: horizontalPercent(pX),
    y: Math.min(100, Math.max(0, y)),
  };
}

export function zoneRectPercent(szTop: number, szBottom: number) {
  const { minZ, maxZ } = zoneVerticalBounds(szTop, szBottom);
  const minX = -VIEW_WIDTH_FT / 2;
  const maxX = VIEW_WIDTH_FT / 2;

  const left = ((-ZONE_WIDTH_FT / 2 - minX) / (maxX - minX)) * 100;
  const right = ((ZONE_WIDTH_FT / 2 - minX) / (maxX - minX)) * 100;
  const top = zToSvgY(szTop, minZ, maxZ, 0, ZONE_BAND_PCT);
  const bottom = zToSvgY(szBottom, minZ, maxZ, 0, ZONE_BAND_PCT);

  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Home plate at ground level (pZ=0), zone width, Gameday-style catcher view. */
export function homePlatePath(
  zone: { x: number; y: number; width: number; height: number },
  szTop: number,
  szBottom: number,
): string {
  const cx = zone.x + zone.width / 2;
  const halfW = zone.width / 2;
  const groundY = toSvgPercent(0, GROUND_Z, szTop, szBottom).y;
  const depth = zone.width * 0.22;
  const backY = groundY - depth;
  const pointY = groundY;

  return `M${cx - halfW} ${backY} L${cx + halfW} ${backY} L${cx} ${pointY} Z`;
}

export function pitchResultColor(
  pitch: Pick<PlayPitch, "isBall" | "isStrike" | "isInPlay" | "isOut" | "isPitch" | "review">,
): string {
  if (pitch.review) return PITCH_REVIEW_COLOR;
  if (!pitch.isPitch) return PITCH_NEUTRAL_COLOR;
  if (pitch.isInPlay) {
    return pitch.isOut ? PITCH_IN_PLAY_OUT_COLOR : PITCH_IN_PLAY_SAFE_COLOR;
  }
  if (pitch.isBall) return PITCH_BALL_COLOR;
  if (pitch.isStrike) return PITCH_STRIKE_COLOR;
  return PITCH_NEUTRAL_COLOR;
}
