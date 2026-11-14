/**
 * Pure view math for the plate cameras and the strike-zone overlay (no React, no
 * renderer), plus the overlay state the controller shares with the scene.
 */
import { PLATE_FRONT_Z, ZONE_HALF_WIDTH } from "@/lib/game/physics/pitch";
import { BALL_RADIUS_FT } from "@/lib/game/physics/ballFlight";
import type { Playback } from "@/components/game/scene/playback";

export interface CamPreset {
  pos: [number, number, number];
  look: [number, number, number];
  /** Vertical field of view, degrees. */
  fov: number;
  near: number;
}

const DEG = Math.PI / 180;

/** Vertical fov that shows at least `vDeg` vertically and `hDeg` horizontally at this aspect. */
export function fitFov(vDeg: number, hDeg: number, aspect: number): number {
  const forWidth = (2 * Math.atan(Math.tan((hDeg * DEG) / 2) / Math.max(0.2, aspect))) / DEG;
  return Math.min(82, Math.max(vDeg, forWidth));
}

/**
 * Catcher cam: the catcher's eye line, in front of the umpire (who stands at
 * z ≈ −5.9 and leans over this spot). The near plane starts past the umpire and
 * the controller leaves the catcher out of the cast, so nothing ever stands
 * between the lens and the strike zone. The pitcher sits just above the zone.
 */
export const BATTER_CAM = { x: 0, y: 3.8, z: -4.4, lookY: 2.4, near: 0.7 };

export function plateCam(mode: "batter" | "pitcher", aspect: number): CamPreset {
  if (mode === "batter") {
    const c = BATTER_CAM;
    return { pos: [c.x, c.y, c.z], look: [0, c.lookY, PLATE_FRONT_Z], fov: fitFov(50, 46, aspect), near: c.near };
  }
  // Over the pitcher's shoulder from behind the mound, tight on the plate.
  return { pos: [0, 9.6, 80], look: [0, 2.8, 0], fov: fitFov(14, 9.5, aspect), near: 0.3 };
}

/** The drawn strike zone: a ball whose center is inside this box is a strike. */
export function zoneBox(zoneBottom: number, zoneTop: number): { x0: number; x1: number; y0: number; y1: number } {
  return { x0: -ZONE_HALF_WIDTH, x1: ZONE_HALF_WIDTH, y0: zoneBottom - BALL_RADIUS_FT, y1: zoneTop + BALL_RADIUS_FT };
}

export type MarkKind = "pending" | "ball" | "called_strike" | "swinging_strike" | "foul" | "in_play" | "hbp";

/** Where a pitch crossed the front of the plate (Statcast px / pz) and what came of it. */
export interface PitchMark {
  /** Pitch number within the at-bat (1-based). */
  n: number;
  px: number;
  pz: number;
  kind: MarkKind;
  type: string;
  mph: number;
}

export const MARK_COLOR: Record<MarkKind, string> = {
  pending: "#ffffff",
  ball: "#3ea6ff",
  called_strike: "#ff4d43",
  swinging_strike: "#ff4d43",
  foul: "#ffb020",
  in_play: "#39d98a",
  hbp: "#b98cff",
};

export const MAX_MARKS = 14;

export interface PlateHud {
  /** This at-bat's pitches, oldest first. */
  marks: PitchMark[];
  /** pb.now when the newest mark landed (it pulses), −1 = never. */
  markAt: number;
  /**
   * Pitch-location ring on the zone plane, closing onto the spot where the pitch
   * will cross: the fraction of the flight (0 = release, 1 = plate) at which it
   * appears; null = off.
   */
  assistFrom: number | null;
  /** Where the pitch now in the air crosses the plate (Statcast px / pz), or null. */
  cross: { px: number; pz: number } | null;
}

const huds = new WeakMap<Playback, PlateHud>();

/** Overlay state for a playback (created on first use). */
export function plateHud(pb: Playback): PlateHud {
  let h = huds.get(pb);
  if (!h) {
    h = { marks: [], markAt: -1, assistFrom: null, cross: null };
    huds.set(pb, h);
  }
  return h;
}
