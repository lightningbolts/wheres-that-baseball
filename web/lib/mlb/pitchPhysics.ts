import type { PitchKinematics, PlayPitch } from "@/types/mlb-live";
import type { Vec3 } from "@/lib/mlb/ballTrajectory";
import type { BallparkSceneMapper } from "@/lib/mlb/ballparkScene";
import { FIELD_BASE_SLOTS, FIELD_DEFENSE_SLOTS } from "@/lib/mlb/fieldPositions";

/**
 * MLB Statcast pitch frame (feet):
 *   +x toward 1B (catcher's right)
 *   +y from plate toward mound (pitcher stands at ~y=50–55)
 *   +z up
 *
 * Our Three.js park scene (from spray chart):
 *   home at origin-ish; +Z toward CF; -X toward 1B (catcher's right)
 */
export const FEET_TO_SCENE = 0.024;
const PITCH_DEFAULT_PLATE_TIME_S = 0.425;
const PITCH_RELEASE_HEIGHT_FT = 6;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpVec(a: Vec3, b: Vec3, t: number): Vec3 {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

/** Map Statcast feet (x,y,z) → scene units relative to home plate. */
export function mlbFeetToScene(xFt: number, yFt: number, zFt: number): Vec3 {
  return [
    -xFt * FEET_TO_SCENE,
    Math.max(zFt, 0) * FEET_TO_SCENE,
    yFt * FEET_TO_SCENE,
  ];
}

function svgSlotToScene(
  mapper: BallparkSceneMapper,
  x: number,
  y: number,
  height: number,
): Vec3 {
  return mapper.svgToScene(x, y, height);
}

function hasKinematics(k: PitchKinematics | null | undefined): k is PitchKinematics {
  return k != null && Number.isFinite(k.x0) && Number.isFinite(k.vY0);
}

/**
 * Integrate Statcast quadratic motion from release to the plate plane (y ≈ 1.417 ft).
 * Position(t) = p0 + v0*t + 0.5*a*t²
 */
export function integratePitchPhysics(
  k: PitchKinematics,
  plateTimeS: number,
  segments = 32,
): Vec3[] {
  const duration = Math.max(plateTimeS, 0.25);
  const points: Vec3[] = [];
  for (let i = 0; i <= segments; i += 1) {
    const t = (i / segments) * duration;
    const x = k.x0 + k.vX0 * t + 0.5 * k.aX * t * t;
    const y = k.y0 + k.vY0 * t + 0.5 * k.aY * t * t;
    const z = k.z0 + k.vZ0 * t + 0.5 * k.aZ * t * t;
    points.push(mlbFeetToScene(x, Math.max(y, 0), z));
  }
  return points;
}

/** Heuristic mound → plate path when kinematics are missing. */
function buildHeuristicPitchPath(
  mapper: BallparkSceneMapper,
  pitch: PlayPitch,
): Vec3[] {
  const mound = FIELD_DEFENSE_SLOTS.P;
  const home = FIELD_BASE_SLOTS.home;
  const releaseY =
    pitch.extension != null && pitch.extension > 0
      ? 60.5 - pitch.extension
      : 54.5;
  const startHeight =
    (pitch.kinematics?.z0 ?? PITCH_RELEASE_HEIGHT_FT) * FEET_TO_SCENE;

  // Prefer physics-frame start when we only have extension.
  const startFromFeet = mlbFeetToScene(0, releaseY, PITCH_RELEASE_HEIGHT_FT);
  const startSvg = svgSlotToScene(mapper, mound.x, mound.y, startHeight);
  const start: Vec3 = [
    startFromFeet[0] * 0.35 + startSvg[0] * 0.65,
    startHeight,
    startFromFeet[2] * 0.65 + startSvg[2] * 0.35,
  ];

  const plateX = pitch.hasPlateLocation ? pitch.plateX : 0;
  const plateZ = pitch.hasPlateLocation
    ? pitch.plateZ
    : (pitch.strikeZoneTop + pitch.strikeZoneBottom) / 2;
  const homeScene = mapper.svgToScene(home.x, home.y, 0);
  const end: Vec3 = [
    homeScene[0] - plateX * FEET_TO_SCENE,
    Math.max(plateZ, 0.5) * FEET_TO_SCENE,
    homeScene[2],
  ];

  // Slight break curve from pfx (inches → feet).
  const pfxXFt = (pitch.pfxX ?? 0) / 12;
  const pfxZFt = (pitch.pfxZ ?? 0) / 12;
  const midT = 0.55;
  const mid: Vec3 = [
    lerp(start[0], end[0], midT) - pfxXFt * FEET_TO_SCENE * 0.5,
    lerp(start[1], end[1], midT) + pfxZFt * FEET_TO_SCENE * 0.35 + 0.04,
    lerp(start[2], end[2], midT),
  ];

  const points: Vec3[] = [];
  const segments = 28;
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    const ab = lerpVec(start, mid, t);
    const bc = lerpVec(mid, end, t);
    points.push(lerpVec(ab, bc, t));
  }
  return points;
}

/**
 * Build a pitch path using Statcast kinematics when available,
 * otherwise a pfx-aware heuristic. Duration uses plateTime.
 */
export function buildPhysicsPitchPath(
  mapper: BallparkSceneMapper,
  pitch: PlayPitch,
): { points: Vec3[]; durationMs: number; source: "physics" | "heuristic" } {
  const plateTime =
    pitch.plateTime && pitch.plateTime > 0.2
      ? pitch.plateTime
      : PITCH_DEFAULT_PLATE_TIME_S;

  if (hasKinematics(pitch.kinematics)) {
    const points = integratePitchPhysics(pitch.kinematics, plateTime);
    // Snap final sample to measured plate location when present.
    if (pitch.hasPlateLocation && points.length > 0) {
      const home = FIELD_BASE_SLOTS.home;
      const homeScene = mapper.svgToScene(home.x, home.y, 0);
      points[points.length - 1] = [
        homeScene[0] - pitch.plateX * FEET_TO_SCENE,
        Math.max(pitch.plateZ, 0.4) * FEET_TO_SCENE,
        homeScene[2],
      ];
    }
    return {
      points,
      durationMs: Math.round(plateTime * 1000),
      source: "physics",
    };
  }

  return {
    points: buildHeuristicPitchPath(mapper, pitch),
    durationMs: Math.round(plateTime * 1000),
    source: "heuristic",
  };
}
