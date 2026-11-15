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
 * Catcher cam: the classic broadcast-game view from behind the plate, a little above
 * the umpire's head. The catcher and umpire are left out of this view, and the near
 * plane starts past where they would be. The hitter stands whole at the side of the
 * frame, the strike zone sits in the lower middle and the pitcher just above it.
 */
export const BATTER_CAM = { x: 0, y: 5.5, z: -10.5, lookY: 3.0, near: 1 };
/** On a portrait phone the camera comes in close so the zone stays big enough to read. */
const BATTER_CAM_TALL = { x: 0, y: 4.3, z: -5.2, lookY: 2.5, near: 1 };

export function plateCam(mode: "batter" | "pitcher", aspect: number): CamPreset {
  if (mode === "batter") {
    const t = Math.min(1, Math.max(0, (aspect - 0.5) / (1.3 - 0.5)));
    const a = BATTER_CAM_TALL;
    const b = BATTER_CAM;
    const mix = (u: number, v: number) => u + (v - u) * t;
    return {
      pos: [0, mix(a.y, b.y), mix(a.z, b.z)],
      look: [0, mix(a.lookY, b.lookY), PLATE_FRONT_Z],
      fov: fitFov(mix(50, 33), mix(46, 48), aspect),
      near: 1,
    };
  }
  // From behind and above the mound, off the pitcher's glove side: he stands whole in
  // the lower corner of the frame and never covers the plate.
  return { pos: [-4.5, 11, 86], look: [0, 2.7, 0], fov: fitFov(15.5, 13.5, aspect), near: 0.3 };
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
  /**
   * Batting read on the coming pitch: a soft spot on the zone where the catcher set
   * up (blurred by difficulty), shown through the windup (playback T from → to).
   */
  hint: { px: number; pz: number; r: number; from: number; to: number } | null;
}

const huds = new WeakMap<Playback, PlateHud>();

/** Overlay state for a playback (created on first use). */
export function plateHud(pb: Playback): PlateHud {
  let h = huds.get(pb);
  if (!h) {
    h = { marks: [], markAt: -1, assistFrom: null, cross: null, hint: null };
    huds.set(pb, h);
  }
  return h;
}
