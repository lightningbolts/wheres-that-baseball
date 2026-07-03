import type { PlayPitch } from "@/types/mlb-live";

import { GAMEDAY_PITCH_FX } from "@/lib/mlb/gamedayAssets";

export const VIEW_WIDTH_FT = 4.2;
/** Wider catcher view for Call It game — fits both batter's boxes. */
export const GAME_VIEW_WIDTH_FT = 11.5;
export const PADDING_FT = 0.55;
/** Regulation batter's box: 4 ft wide, inside edge 6 in from plate. */
export const BATTER_BOX_WIDTH_FT = 4;
export const BATTER_BOX_GAP_FT = 6 / 12;
/** Statcast pZ origin — ground at the center of home plate. */
export const GROUND_Z = 0;
/** Extra feet below ground so pitches in the dirt stay in frame. */
export const DIRT_PADDING_FT = 0.5;
/** Bottom band for home plate and pitches below the zone (Gameday-style). */
export const PLATE_BAND_PCT = 18;
export const ZONE_BAND_PCT = 100 - PLATE_BAND_PCT;

export const PITCH_BALL_COLOR = "#22c55e";
export const PITCH_STRIKE_COLOR = "#ef4444";
export const PITCH_IN_PLAY_SAFE_COLOR = "#3b82f6";
export const PITCH_IN_PLAY_OUT_COLOR = "#a855f7";
export const PITCH_NEUTRAL_COLOR = "#737373";
export const PITCH_REVIEW_COLOR = "#f59e0b";

/** ABS zone width — 17 inches at the plate midpoint. */
export const ZONE_WIDTH_FT = 17 / 12;
export const PLATE_HALF_WIDTH_FT = ZONE_WIDTH_FT / 2;
/** Regulation ball radius (~2.9" diameter) for overlap checks. */
export const BALL_RADIUS_FT = 2.9 / 12 / 2;

/** True when the pitch center is inside the ABS rectangle. */
export function isPitchCenterInZone(
  pX: number,
  pZ: number,
  szTop: number,
  szBottom: number,
): boolean {
  return (
    Math.abs(pX) <= PLATE_HALF_WIDTH_FT &&
    pZ >= szBottom &&
    pZ <= szTop
  );
}

/** True when any part of the ball could touch the ABS rectangle. */
export function isAbsStrike(
  pX: number,
  pZ: number,
  szTop: number,
  szBottom: number,
): boolean {
  return (
    Math.abs(pX) - BALL_RADIUS_FT <= PLATE_HALF_WIDTH_FT &&
    pZ + BALL_RADIUS_FT >= szBottom &&
    pZ - BALL_RADIUS_FT <= szTop
  );
}

function horizontalPercent(pX: number, viewWidth = VIEW_WIDTH_FT) {
  const minX = -viewWidth / 2;
  const maxX = viewWidth / 2;
  return Math.min(100, Math.max(0, ((pX - minX) / (maxX - minX)) * 100));
}

function batterBoxInnerEdgeFt() {
  return PLATE_HALF_WIDTH_FT + BATTER_BOX_GAP_FT;
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

  const left = ((-PLATE_HALF_WIDTH_FT - minX) / (maxX - minX)) * 100;
  const right = ((PLATE_HALF_WIDTH_FT - minX) / (maxX - minX)) * 100;
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

/** Home plate path for the widened Call It game scene. */
export function gameHomePlatePath(
  zone: { x: number; y: number; width: number; height: number },
  szTop: number,
  szBottom: number,
): string {
  const cx = zone.x + zone.width / 2;
  const halfW = zone.width / 2;
  const groundY = gameToSvgPercent(0, GROUND_Z, szTop, szBottom).y;
  const depth = zone.width * 0.22;
  const backY = groundY - depth;
  const pointY = groundY;

  return `M${cx - halfW} ${backY} L${cx + halfW} ${backY} L${cx} ${pointY} Z`;
}

export function pitchResultColor(
  pitch: Pick<PlayPitch, "isBall" | "isStrike" | "isInPlay" | "isOut" | "isPitch" | "review" | "callDescription">,
): string {
  if (pitch.review) return PITCH_REVIEW_COLOR;
  if (!pitch.isPitch) return PITCH_NEUTRAL_COLOR;
  if (pitch.isInPlay) {
    const desc = pitch.callDescription.toLowerCase();
    const isOut = pitch.isOut || desc.includes("in play, out");
    return isOut ? PITCH_IN_PLAY_OUT_COLOR : PITCH_IN_PLAY_SAFE_COLOR;
  }
  if (pitch.isBall) return PITCH_BALL_COLOR;
  if (pitch.isStrike) return PITCH_STRIKE_COLOR;
  return PITCH_NEUTRAL_COLOR;
}

export interface SvgRectPercent {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BatterBoxRects {
  /** Third-base side (RHB). */
  rightHanded: SvgRectPercent;
  /** First-base side (LHB). */
  leftHanded: SvgRectPercent;
  activeSide: "rightHanded" | "leftHanded";
}

/** Catcher-view coordinates for the Call It game scene. */
export function gameToSvgPercent(
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
    x: horizontalPercent(pX, GAME_VIEW_WIDTH_FT),
    y: Math.min(100, Math.max(0, y)),
  };
}

export function gameZoneRectPercent(szTop: number, szBottom: number): SvgRectPercent {
  const { minZ, maxZ } = zoneVerticalBounds(szTop, szBottom);
  const minX = -GAME_VIEW_WIDTH_FT / 2;
  const maxX = GAME_VIEW_WIDTH_FT / 2;

  const left = ((-PLATE_HALF_WIDTH_FT - minX) / (maxX - minX)) * 100;
  const right = ((PLATE_HALF_WIDTH_FT - minX) / (maxX - minX)) * 100;
  const top = zToSvgY(szTop, minZ, maxZ, 0, ZONE_BAND_PCT);
  const bottom = zToSvgY(szBottom, minZ, maxZ, 0, ZONE_BAND_PCT);

  return { x: left, y: top, width: right - left, height: bottom - top };
}

function batterBoxHorizontalBounds(side: "rightHanded" | "leftHanded") {
  const inner = batterBoxInnerEdgeFt();
  if (side === "rightHanded") {
    const outer = inner + BATTER_BOX_WIDTH_FT;
    return { minX: -outer, maxX: -inner };
  }
  const outer = inner + BATTER_BOX_WIDTH_FT;
  return { minX: inner, maxX: outer };
}

function rectPercentFromHorizontalBounds(
  bounds: { minX: number; maxX: number },
  szTop: number,
  szBottom: number,
): SvgRectPercent {
  const minView = -GAME_VIEW_WIDTH_FT / 2;
  const maxView = GAME_VIEW_WIDTH_FT / 2;
  const x = ((bounds.minX - minView) / (maxView - minView)) * 100;
  const right = ((bounds.maxX - minView) / (maxView - minView)) * 100;
  const zone = zoneRectPercent(szTop, szBottom);
  const plateY = gameToSvgPercent(0, GROUND_Z, szTop, szBottom).y;
  const top = Math.max(0, zone.y - zone.height * 0.35);
  const bottom = Math.min(100, plateY + PLATE_BAND_PCT * 0.55);

  return {
    x,
    y: top,
    width: right - x,
    height: bottom - top,
  };
}

/** Both batter's boxes with active side derived from batSide (L/R). */
export function batterBoxRectsPercent(
  batSide: string | null | undefined,
  szTop: number,
  szBottom: number,
): BatterBoxRects {
  const activeSide: BatterBoxRects["activeSide"] =
    batSide?.toUpperCase() === "L" ? "leftHanded" : "rightHanded";

  return {
    rightHanded: rectPercentFromHorizontalBounds(
      batterBoxHorizontalBounds("rightHanded"),
      szTop,
      szBottom,
    ),
    leftHanded: rectPercentFromHorizontalBounds(
      batterBoxHorizontalBounds("leftHanded"),
      szTop,
      szBottom,
    ),
    activeSide,
  };
}

/** Mound arc at top of catcher scene for depth cue. */
export function moundArcPath(szTop: number, szBottom: number): string {
  const zone = gameZoneRectPercent(szTop, szBottom);
  const cx = zone.x + zone.width / 2;
  const y = Math.max(2, zone.y - zone.height * 0.12);
  const rx = zone.width * 1.8;
  return `M${cx - rx} ${y} A${rx} ${rx * 0.35} 0 0 1 ${cx + rx} ${y}`;
}

/** Batter's boxes in the plate band — Gameday chalk lines flanking home plate. */
export function plateBandBatterBoxes(
  batSide: string | null | undefined,
): BatterBoxRects {
  const activeSide: BatterBoxRects["activeSide"] =
    batSide?.toUpperCase() === "L" ? "leftHanded" : "rightHanded";
  const bandTop = ZONE_BAND_PCT + 1;
  const bandHeight = 100 - bandTop - 0.5;

  return {
    rightHanded: { x: 5, y: bandTop, width: 36, height: bandHeight },
    leftHanded: { x: 59, y: bandTop, width: 36, height: bandHeight },
    activeSide,
  };
}

/** Gameday pitch-fx scene layout (4:3 field, canvas strike zone). */
export interface PitchFxSceneLayout {
  activeSide: BatterBoxRects["activeSide"];
  zone: SvgRectPercent;
}

/** Strike zone placement in the MLB responsive-pitch-fx 4:3 frame. */
export function pitchFxSceneLayout(
  batSide: string | null | undefined,
  _szTop: number,
  _szBottom: number,
): PitchFxSceneLayout {
  const boxes = batterBoxRectsPercent(batSide, _szTop, _szBottom);

  return {
    activeSide: boxes.activeSide,
    zone: {
      x: GAMEDAY_PITCH_FX.zoneX,
      y: GAMEDAY_PITCH_FX.zoneY,
      width: GAMEDAY_PITCH_FX.zoneWidth,
      height: GAMEDAY_PITCH_FX.zoneHeight,
    },
  };
}

/** Strike zone grid for the floating Gameday overlay (zone-only coordinates). */
export function zoneOverlayRect(szTop: number, szBottom: number): SvgRectPercent {
  const pad = 5;
  return { x: pad, y: pad, width: 100 - pad * 2, height: 100 - pad * 2 };
}

/** Map plate coordinates into the zone-only overlay SVG. */
export function zoneOverlayToSvgPercent(
  pX: number,
  pZ: number,
  szTop: number,
  szBottom: number,
): { x: number; y: number } {
  const zone = zoneVerticalBounds(szTop, szBottom);
  const overlay = zoneOverlayRect(szTop, szBottom);
  const minX = -VIEW_WIDTH_FT / 2;
  const maxX = VIEW_WIDTH_FT / 2;

  const x = overlay.x + ((pX - minX) / (maxX - minX)) * overlay.width;
  let y: number;
  if (pZ >= zone.minZ) {
    y = overlay.y + (1 - (pZ - zone.minZ) / (zone.maxZ - zone.minZ)) * overlay.height;
  } else {
    y = overlay.y + overlay.height;
  }

  return {
    x: Math.min(overlay.x + overlay.width, Math.max(overlay.x, x)),
    y: Math.min(overlay.y + overlay.height, Math.max(overlay.y, y)),
  };
}

/** Map plate coordinates into a scene-space zone rect (viewBox 0–100). */
export function sceneZoneToSvgPercent(
  pX: number,
  pZ: number,
  szTop: number,
  szBottom: number,
  sceneZone: SvgRectPercent,
): { x: number; y: number } {
  const overlay = zoneOverlayRect(szTop, szBottom);
  const pt = zoneOverlayToSvgPercent(pX, pZ, szTop, szBottom);
  const relX = (pt.x - overlay.x) / overlay.width;
  const relY = (pt.y - overlay.y) / overlay.height;

  return {
    x: sceneZone.x + relX * sceneZone.width,
    y: sceneZone.y + relY * sceneZone.height,
  };
}
