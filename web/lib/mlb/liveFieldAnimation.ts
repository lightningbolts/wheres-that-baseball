import {
  FIELD_BASE_SLOTS,
  FIELD_DEFENSE_SLOTS,
  type FieldBaseSlot,
  type FieldPositionCode,
} from "@/lib/mlb/fieldPositions";
import {
  computeSceneTrajectoryPoints,
  getParkSceneMapper,
  type BallparkSceneMapper,
} from "@/lib/mlb/ballparkScene";
import type { Vec3 } from "@/lib/mlb/ballTrajectory";
import type { FieldDefender } from "@/lib/mlb/fieldDefense";
import type { BaseRunner, HitData, PlayPitch } from "@/types/mlb-live";

/** Approximate feet → Three.js scene units (aligned with spray-chart parks). */
export const FEET_TO_SCENE = 0.024;

const PITCH_RELEASE_HEIGHT_FT = 6;
const PITCH_DEFAULT_PLATE_TIME_S = 0.425;
const HIT_DEFAULT_FLIGHT_S = 3.2;
const RUNNER_MOVE_S = 0.85;
const FIELDER_REACT_S = 0.55;

export type LiveBallPhase = "idle" | "pitch" | "hit" | "settled";

export interface LiveBallState {
  phase: LiveBallPhase;
  position: Vec3;
  trail: Vec3[];
  pitchNumber: number | null;
}

export interface LiveActorState {
  id: string;
  kind: "fielder" | "runner" | "batter";
  label: string;
  positionCode?: FieldPositionCode;
  position: Vec3;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpVec(a: Vec3, b: Vec3, t: number): Vec3 {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

function clamp01(t: number): number {
  return Math.min(1, Math.max(0, t));
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function samplePath(points: Vec3[], t: number): Vec3 {
  if (points.length === 0) return [0, 0, 0];
  if (points.length === 1) return points[0];
  const clamped = clamp01(t);
  const scaled = clamped * (points.length - 1);
  const i = Math.min(Math.floor(scaled), points.length - 2);
  const local = scaled - i;
  return lerpVec(points[i], points[i + 1], local);
}

function trailUpTo(points: Vec3[], t: number): Vec3[] {
  if (points.length < 2) return points;
  const end = samplePath(points, t);
  const count = Math.max(2, Math.floor(t * (points.length - 1)) + 1);
  return [...points.slice(0, count), end];
}

export function svgSlotToScene(
  mapper: BallparkSceneMapper,
  x: number,
  y: number,
  height = 0.12,
): Vec3 {
  return mapper.svgToScene(x, y, height);
}

export function baseSlotToScene(
  mapper: BallparkSceneMapper,
  slot: FieldBaseSlot,
  height = 0.14,
): Vec3 {
  const pt = FIELD_BASE_SLOTS[slot];
  return svgSlotToScene(mapper, pt.x, pt.y, height);
}

export function defenseSlotToScene(
  mapper: BallparkSceneMapper,
  code: FieldPositionCode,
  height = 0.14,
): Vec3 {
  const pt = FIELD_DEFENSE_SLOTS[code];
  return svgSlotToScene(mapper, pt.x, pt.y, height);
}

/** Pitch path: mound → plate (plateX/plateZ in feet). */
export function buildPitchPath(
  mapper: BallparkSceneMapper,
  pitch: PlayPitch,
): { points: Vec3[]; durationMs: number } {
  const mound = FIELD_DEFENSE_SLOTS.P;
  const home = FIELD_BASE_SLOTS.home;
  const start = svgSlotToScene(mapper, mound.x, mound.y, PITCH_RELEASE_HEIGHT_FT * FEET_TO_SCENE);

  const plateX = pitch.hasPlateLocation ? pitch.plateX : 0;
  const plateZ = pitch.hasPlateLocation
    ? pitch.plateZ
    : (pitch.strikeZoneTop + pitch.strikeZoneBottom) / 2;

  // Match ballparkScene X negation: catcher's right ( +plateX ) → 1B / SVG +x → scene -x.
  const end: Vec3 = [
    mapper.svgToScene(home.x, home.y, 0)[0] - plateX * FEET_TO_SCENE,
    Math.max(plateZ, 0.5) * FEET_TO_SCENE,
    mapper.svgToScene(home.x, home.y, 0)[2],
  ];

  const midT = 0.55;
  const mid: Vec3 = [
    lerp(start[0], end[0], midT),
    lerp(start[1], end[1], midT) + 0.08,
    lerp(start[2], end[2], midT),
  ];

  const points: Vec3[] = [];
  const segments = 24;
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    const ab = lerpVec(start, mid, t);
    const bc = lerpVec(mid, end, t);
    points.push(lerpVec(ab, bc, t));
  }

  const plateTime = pitch.plateTime && pitch.plateTime > 0.2
    ? pitch.plateTime
    : PITCH_DEFAULT_PLATE_TIME_S;

  return { points, durationMs: Math.round(plateTime * 1000) };
}

export function buildHitPath(
  mapper: BallparkSceneMapper,
  hit: HitData,
): { points: Vec3[]; durationMs: number } {
  const points = computeSceneTrajectoryPoints(hit, mapper, 40);
  const distance = Math.max(hit.totalDistance, 30);
  const speed = Math.max(hit.launchSpeed, 60);
  // Rough flight time from distance / horizontal component.
  const durationS = Math.min(
    5.5,
    Math.max(1.4, (distance / Math.max(speed * 1.2, 40)) * HIT_DEFAULT_FLIGHT_S / 3),
  );
  return { points, durationMs: Math.round(durationS * 1000) };
}

export interface LiveFieldTargets {
  defense: FieldDefender[];
  batterName: string | null;
  showBatter: boolean;
  runnerFirst: BaseRunner | null;
  runnerSecond: BaseRunner | null;
  runnerThird: BaseRunner | null;
}

export function buildActorTargets(
  mapper: BallparkSceneMapper,
  targets: LiveFieldTargets,
): LiveActorState[] {
  const actors: LiveActorState[] = [];

  for (const d of targets.defense) {
    actors.push({
      id: `fielder-${d.position}`,
      kind: "fielder",
      label: d.position,
      positionCode: d.position,
      position: defenseSlotToScene(mapper, d.position),
    });
  }

  if (targets.showBatter && targets.batterName && targets.batterName !== "—") {
    actors.push({
      id: "batter",
      kind: "batter",
      label: targets.batterName,
      position: baseSlotToScene(mapper, "home", 0.16),
    });
  }

  if (targets.runnerFirst) {
    actors.push({
      id: `runner-1B-${targets.runnerFirst.id}`,
      kind: "runner",
      label: targets.runnerFirst.name,
      position: baseSlotToScene(mapper, "first"),
    });
  }
  if (targets.runnerSecond) {
    actors.push({
      id: `runner-2B-${targets.runnerSecond.id}`,
      kind: "runner",
      label: targets.runnerSecond.name,
      position: baseSlotToScene(mapper, "second"),
    });
  }
  if (targets.runnerThird) {
    actors.push({
      id: `runner-3B-${targets.runnerThird.id}`,
      kind: "runner",
      label: targets.runnerThird.name,
      position: baseSlotToScene(mapper, "third"),
    });
  }

  return actors;
}

/** Nudge fielders toward the ball landing during a hit (schematic pursuit). */
export function pursuitTargets(
  mapper: BallparkSceneMapper,
  defense: FieldDefender[],
  hit: HitData,
): Map<string, Vec3> {
  const landing = mapper.hitCoordToScene(hit.coordX, hit.coordY, 0.14);
  const home = baseSlotToScene(mapper, "home");
  const result = new Map<string, Vec3>();

  for (const d of defense) {
    if (d.position === "P" || d.position === "C") continue;
    const homePos = defenseSlotToScene(mapper, d.position);
    // Blend toward landing — outfielders more, infielders less.
    const isOf = d.position === "LF" || d.position === "CF" || d.position === "RF";
    const blend = isOf ? 0.55 : 0.28;
    result.set(`fielder-${d.position}`, lerpVec(homePos, landing, blend));
  }

  // Keep pitcher near mound / home blend for bunts.
  void home;
  return result;
}

export { samplePath, trailUpTo, lerpVec, easeInOut, clamp01, RUNNER_MOVE_S, FIELDER_REACT_S };

export function getMapper(venueId?: number | null): BallparkSceneMapper {
  return getParkSceneMapper(venueId);
}
