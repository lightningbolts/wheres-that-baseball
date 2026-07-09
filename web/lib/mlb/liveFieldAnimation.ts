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
import { buildPhysicsPitchPath, FEET_TO_SCENE } from "@/lib/mlb/pitchPhysics";
import type { Vec3 } from "@/lib/mlb/ballTrajectory";
import type { FieldDefender } from "@/lib/mlb/fieldDefense";
import type { BaseRunner, HitData, PlayPitch } from "@/types/mlb-live";

export { FEET_TO_SCENE };

const HIT_DEFAULT_FLIGHT_S = 3.2;
const RUNNER_MOVE_S = 0.9;
const FIELDER_REACT_S = 0.5;

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

/** Pitch path — Statcast physics when available, else pfx heuristic. */
export function buildPitchPath(
  mapper: BallparkSceneMapper,
  pitch: PlayPitch,
): { points: Vec3[]; durationMs: number; source?: "physics" | "heuristic" } {
  return buildPhysicsPitchPath(mapper, pitch);
}

export function buildHitPath(
  mapper: BallparkSceneMapper,
  hit: HitData,
): { points: Vec3[]; durationMs: number } {
  const points = computeSceneTrajectoryPoints(hit, mapper, 40);
  const distance = Math.max(hit.totalDistance, 30);
  const speed = Math.max(hit.launchSpeed, 60);
  const durationS = Math.min(
    5.5,
    Math.max(1.2, (distance / Math.max(speed * 1.25, 45)) * (HIT_DEFAULT_FLIGHT_S / 3)),
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

function dist2(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0];
  const dz = a[2] - b[2];
  return dx * dx + dz * dz;
}

/**
 * Schematic pursuit: nearest fielders commit harder; OF on fly balls,
 * IF on grounders; pitcher covers home-side bunts.
 */
export function pursuitTargets(
  mapper: BallparkSceneMapper,
  defense: FieldDefender[],
  hit: HitData,
): Map<string, Vec3> {
  const landing = mapper.hitCoordToScene(hit.coordX, hit.coordY, 0.14);
  const traj = hit.trajectory.toLowerCase();
  const isGround = traj.includes("ground") || traj.includes("bunt") || hit.launchAngle < 8;
  const isFly = traj.includes("fly") || traj.includes("line") || hit.launchAngle >= 15;
  const result = new Map<string, Vec3>();

  const ranked = defense
    .filter((d) => d.position !== "C")
    .map((d) => {
      const homePos = defenseSlotToScene(mapper, d.position);
      return { d, homePos, dist: dist2(homePos, landing) };
    })
    .sort((a, b) => a.dist - b.dist);

  ranked.forEach(({ d, homePos }, index) => {
    const isOf = d.position === "LF" || d.position === "CF" || d.position === "RF";
    const isP = d.position === "P";
    let blend = 0.12;
    if (index === 0) blend = isGround ? 0.72 : 0.62;
    else if (index === 1) blend = isGround ? 0.45 : 0.4;
    else if (index === 2) blend = 0.22;

    if (isOf && isFly) blend = Math.max(blend, index === 0 ? 0.7 : 0.35);
    if (!isOf && isGround) blend = Math.max(blend, index === 0 ? 0.75 : blend);
    if (isP && isGround && hit.totalDistance < 80) blend = 0.55;
    if (isP && !isGround) blend = Math.min(blend, 0.12);

    result.set(`fielder-${d.position}`, lerpVec(homePos, landing, blend));
  });

  return result;
}

/** Approximate basepath polyline for runner animation (home→1→2→3→home). */
export function runnerPathBetween(
  mapper: BallparkSceneMapper,
  from: FieldBaseSlot,
  to: FieldBaseSlot,
): Vec3[] {
  const ring: FieldBaseSlot[] = ["home", "first", "second", "third"];
  const startIdx = ring.indexOf(from);
  const endIdx = ring.indexOf(to);
  if (startIdx < 0 || endIdx < 0) {
    return [baseSlotToScene(mapper, from), baseSlotToScene(mapper, to)];
  }
  if (startIdx === endIdx) {
    return [baseSlotToScene(mapper, from)];
  }
  const points: Vec3[] = [baseSlotToScene(mapper, ring[startIdx])];
  let i = startIdx;
  let guard = 0;
  while (i !== endIdx && guard < 4) {
    i = (i + 1) % ring.length;
    points.push(baseSlotToScene(mapper, ring[i]));
    guard += 1;
  }
  return points;
}

export { samplePath, trailUpTo, lerpVec, easeInOut, clamp01, RUNNER_MOVE_S, FIELDER_REACT_S };

export function getMapper(venueId?: number | null): BallparkSceneMapper {
  return getParkSceneMapper(venueId);
}
