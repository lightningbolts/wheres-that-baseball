/**
 * Procedural humanoid rig. A pose is authored as hand/foot targets in the actor's
 * root frame (origin on the ground, +Z forward, +X = the actor's left); two-bone
 * IK turns that into the world matrices of a 17-bone skeleton (character/skeleton.ts)
 * which drives one smooth-skinned mesh per person.
 *
 * Poses are written into caller-owned objects (nothing is allocated per frame),
 * keyframes are interpolated with monotone cubic splines (no stop-and-go at every
 * key), and all poses are authored right-handed and mirrored for lefties.
 */
import type { Uniform } from "@/components/game/scene/character/uniforms";
import * as THREE from "three";
import type { ActorState } from "@/lib/game/anim/timeline";
import type { FieldPos } from "@/lib/game/types";
import { batStyle, pitchStyle, type BatStyle } from "@/components/game/scene/character/style";
import { BONE, BONE_COUNT, DIM, PELVIS_LEAN, PELVIS_TWIST, SPINE_LEAN, SPINE_TWIST } from "@/components/game/scene/character/skeleton";

export type ActorKind = "fielder" | "catcher" | "pitcher" | "batter" | "runner" | "umpire" | "coach";

export interface ActorDraw {
  key: string;
  state: ActorState;
  kind: ActorKind;
  /** Uniform colors. */
  jersey: THREE.Color;
  accent: THREE.Color;
  skin: THREE.Color;
  /** Throwing / batting hand. */
  hand: "L" | "R";
  helmet: boolean;
  /** Fielding position, for fielders. */
  pos: FieldPos | null;
  /** MLB player id (name, number and looks); 0 or absent for umpires and coaches. */
  id?: number;
  /** Club uniform details (cap mark, lettering, pinstripes); absent for umpires. */
  uni?: Uniform | null;
}

export interface Pose {
  hipH: number;
  lean: number;
  twist: number;
  rootPitch: number;
  rootY: number;
  /** Forward offset of the whole body from the actor's track position (pitcher's stride). */
  rootZ: number;
  handL: THREE.Vector3;
  handR: THREE.Vector3;
  footL: THREE.Vector3;
  footR: THREE.Vector3;
  /** Bat: handle position and unit direction (root frame). */
  hasBat: boolean;
  batAt: THREE.Vector3;
  batDir: THREE.Vector3;
  hidden: boolean;
  /** Where the head looks: yaw / pitch (rad) in the root frame; + yaw is toward the actor's left, + pitch is down. */
  headYaw: number;
  headPitch: number;
  /** How far the glove's fingers are cocked up from the forearm toward the body's "up" (negative: down). */
  gloveUp: number;
  /** Trunk only (hands and feet stay where they are aimed): sideways lean, + toward the actor's left, and sideways hip shift (ft). */
  roll: number;
  sway: number;
  /** 0..1: the elbow is carried up and out (a cocked throwing arm) instead of hanging down. */
  elbowL: number;
  elbowR: number;
  /** Extra heel lift (rad) for a foot that pivots on its toes. */
  toeL: number;
  toeR: number;
}

/** Pose families; a change of family is cross-faded by the renderer. */
export type PoseClass = "loco" | "idle" | "crouch" | "pitch" | "throw" | "catch" | "field" | "dive" | "slide" | "bat" | "swing" | "gone";

/** Per-frame inputs to the pose solver beyond the actor's timeline state. */
export interface PoseCtx {
  /** Real seconds, for idle motion. */
  time: number;
  /** Run-cycle phase (radians). */
  phase: number;
  /** Displayed ground speed, ft/s. */
  speed: number;
  /** Displayed transform of the actor (track position, facing, ground height under the root). */
  x: number;
  z: number;
  yaw: number;
  groundY: number;
  /** World-space reach target (release point, ball, mitt target, swing aim) and its weight. */
  hasTarget: boolean;
  tx: number;
  ty: number;
  tz: number;
  targetW: number;
  /** 0..1: the ball is in this player's glove. */
  hold: number;
  /** Swing: seconds from launch to contact. */
  swingDur: number;
  /** The swing is a bunt: squared around, bat held out over the plate. */
  bunt?: boolean;
  /** Umpire: seconds since he began a strike call (negative: none). */
  callT: number;
  /** 0..1, fixed per actor: de-synchronises idle motion and varies mannerisms. */
  seed: number;
  /** Forward acceleration (ft/s²) and banking lean (rad, + left) of a runner. */
  accel: number;
  bank: number;
  /** How far (ft) a fielder must leave the ground to reach the ball he is about to catch. */
  jump: number;
  /** Seconds since the pitch was released (very negative: no pitch on the way). */
  pitchTau: number;
  /** Where the ball is (world), and how much the head should follow it. */
  bx: number;
  by: number;
  bz: number;
  ballW: number;
}

export function newPoseCtx(): PoseCtx {
  return {
    time: 0, phase: 0, speed: 0, x: 0, z: 0, yaw: 0, groundY: 0, hasTarget: false, tx: 0, ty: 0, tz: 0, targetW: 0, hold: 0, swingDur: 0.15,
    callT: -1, seed: 0, accel: 0, bank: 0, jump: 0, pitchTau: -99, bx: 0, by: 0, bz: 0, ballW: 0,
  };
}

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth = (t: number) => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};

const SCALARS = ["hipH", "lean", "twist", "rootPitch", "rootY", "rootZ", "headYaw", "headPitch", "gloveUp", "roll", "sway", "elbowL", "elbowR", "toeL", "toeR"] as const;
const VECTORS = ["handL", "handR", "footL", "footR"] as const;

export function newPose(): Pose {
  return {
    hipH: 3,
    lean: 0,
    twist: 0,
    rootPitch: 0,
    rootY: 0,
    rootZ: 0,
    handL: new THREE.Vector3(),
    handR: new THREE.Vector3(),
    footL: new THREE.Vector3(),
    footR: new THREE.Vector3(),
    hasBat: false,
    batAt: new THREE.Vector3(),
    batDir: new THREE.Vector3(0, 1, 0),
    hidden: false,
    headYaw: 0,
    headPitch: 0,
    gloveUp: 0.3,
    roll: 0,
    sway: 0,
    elbowL: 0,
    elbowR: 0,
    toeL: 0,
    toeR: 0,
  };
}

export function copyPose(dst: Pose, src: Pose): Pose {
  for (const k of SCALARS) dst[k] = src[k];
  for (const k of VECTORS) dst[k].copy(src[k]);
  dst.hasBat = src.hasBat;
  dst.batAt.copy(src.batAt);
  dst.batDir.copy(src.batDir);
  dst.hidden = src.hidden;
  return dst;
}

/** out = a → b at t. `out` may alias either input. The bat belongs to the target pose. */
export function lerpPose(out: Pose, a: Pose, b: Pose, t: number): Pose {
  const bothBat = a.hasBat && b.hasBat;
  for (const k of SCALARS) out[k] = lerp(a[k], b[k], t);
  for (const k of VECTORS) out[k].lerpVectors(a[k], b[k], t);
  if (bothBat) {
    out.batAt.lerpVectors(a.batAt, b.batAt, t);
    out.batDir.lerpVectors(a.batDir, b.batDir, t);
    if (out.batDir.lengthSq() < 1e-6) out.batDir.copy(b.batDir);
    else out.batDir.normalize();
  } else {
    out.batAt.copy(b.batAt);
    out.batDir.copy(b.batDir);
  }
  out.hasBat = b.hasBat;
  out.hidden = b.hidden;
  return out;
}

/** out = a − b, channel by channel (the bat only when both hold one). Flags come from `a`. */
export function subPose(out: Pose, a: Pose, b: Pose): Pose {
  const bothBat = a.hasBat && b.hasBat;
  for (const k of SCALARS) out[k] = a[k] - b[k];
  for (const k of VECTORS) out[k].subVectors(a[k], b[k]);
  if (bothBat) {
    out.batAt.subVectors(a.batAt, b.batAt);
    out.batDir.subVectors(a.batDir, b.batDir);
  } else {
    out.batAt.set(0, 0, 0);
    out.batDir.set(0, 0, 0);
  }
  out.hasBat = bothBat;
  out.hidden = a.hidden;
  return out;
}

/** p += k0·off + k1·vel (two pose deltas made by subPose); p keeps its own flags. */
export function addPoseDelta(p: Pose, off: Pose, k0: number, vel: Pose, k1: number): Pose {
  for (const k of SCALARS) p[k] += off[k] * k0 + vel[k] * k1;
  for (const k of VECTORS) p[k].addScaledVector(off[k], k0).addScaledVector(vel[k], k1);
  if (p.hasBat && off.hasBat) {
    p.batAt.addScaledVector(off.batAt, k0).addScaledVector(vel.batAt, k1);
    p.batDir.addScaledVector(off.batDir, k0).addScaledVector(vel.batDir, k1);
    if (p.batDir.lengthSq() > 1e-6) p.batDir.normalize();
    else p.batDir.set(0, 1, 0);
  }
  return p;
}

/** Scale a pose delta in place, limiting how fast any one channel may be said to move. */
export function scalePoseDelta(p: Pose, k: number, maxScalar: number, maxVec: number): Pose {
  for (const key of SCALARS) p[key] = Math.max(-maxScalar, Math.min(maxScalar, p[key] * k));
  for (const key of VECTORS) {
    const v = p[key].multiplyScalar(k);
    const l = v.length();
    if (l > maxVec) v.multiplyScalar(maxVec / l);
  }
  p.batAt.multiplyScalar(k);
  p.batDir.multiplyScalar(k);
  const l = p.batAt.length();
  if (l > maxVec) p.batAt.multiplyScalar(maxVec / l);
  const d = p.batDir.length();
  if (d > maxScalar) p.batDir.multiplyScalar(maxScalar / d);
  return p;
}

// ---------- Keyframe splines ----------

interface Tab1 {
  t: number[];
  v: number[];
  m: number[];
}
interface Tab3 {
  x: Tab1;
  y: Tab1;
  z: Tab1;
}

/**
 * Scalar keyframes → cubic Hermite spline with Catmull-Rom tangents. Tangents are
 * zeroed at holds and local extrema, so held keys stay still and nothing overshoots.
 */
export function tab1(ks: Array<[number, number]>): Tab1 {
  const t = ks.map((k) => k[0]);
  const v = ks.map((k) => k[1]);
  const m = v.map(() => 0);
  for (let i = 1; i < v.length - 1; i += 1) {
    const d0 = v[i] - v[i - 1];
    const d1 = v[i + 1] - v[i];
    if (d0 * d1 > 0) m[i] = (v[i + 1] - v[i - 1]) / (t[i + 1] - t[i - 1]);
  }
  return { t, v, m };
}
export function tab3(ks: Array<[number, number, number, number]>): Tab3 {
  return { x: tab1(ks.map((k) => [k[0], k[1]])), y: tab1(ks.map((k) => [k[0], k[2]])), z: tab1(ks.map((k) => [k[0], k[3]])) };
}
export function sample1(tb: Tab1, x: number): number {
  const { t, v, m } = tb;
  const n = t.length;
  if (x <= t[0]) return v[0];
  if (x >= t[n - 1]) return v[n - 1];
  let i = 1;
  while (x > t[i]) i += 1;
  const dt = t[i] - t[i - 1];
  const s = (x - t[i - 1]) / dt;
  const s2 = s * s;
  const s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * v[i - 1] + (s3 - 2 * s2 + s) * dt * m[i - 1] + (-2 * s3 + 3 * s2) * v[i] + (s3 - s2) * dt * m[i];
}
export function sample3(out: THREE.Vector3, tb: Tab3, x: number): THREE.Vector3 {
  return out.set(sample1(tb.x, x), sample1(tb.y, x), sample1(tb.z, x));
}

// ---------- Pose classes ----------

export function poseClass(a: ActorDraw): PoseClass {
  switch (a.state.action) {
    case "gone":
      return "gone";
    case "run":
    case "ready":
      return "loco";
    case "idle":
      return a.kind === "pitcher" ? "pitch" : "idle";
    case "stance":
      return "bat";
    default:
      return a.state.action;
  }
}

/** Cross-fade time (s) when an actor's pose family changes. */
export function blendTime(from: PoseClass, to: PoseClass): number {
  if (to === "swing") return 0.05;
  if (to === "dive") return 0.1;
  if (to === "slide") return 0.12;
  if (to === "throw") return from === "crouch" ? 0.22 : 0.13;
  if (to === "field") return 0.18;
  if (to === "catch") return 0.25;
  if (to === "pitch") return from === "loco" ? 0.6 : 0.25;
  if (to === "bat") return 0.3;
  if (from === "dive") return 0.45;
  if (from === "swing") return 0.22;
  return 0.3;
}

/** Ground covered by one full run cycle (two steps) at a given speed. */
export const cycleLen = (speed: number) => 3.7 + 0.33 * Math.min(32, Math.max(0, speed));

const GROUND = 0.12;
const BAT_SWEET = 1.9;

// Pitch delivery (RHP): 0 set · 0.55 leg lift · 1.0 foot strike · 1.1 release · 2.0 squared up.
const RUBBER_Z = -4.3;
const PITCH = {
  rootZ: tab1([[0, RUBBER_Z], [0.55, -4.25], [1.0, -1.5], [1.1, -0.8], [1.4, -0.25], [2.0, 0]]),
  hipH: tab1([[0, 3.0], [0.55, 3.05], [1.0, 2.55], [1.1, 2.55], [1.35, 2.4], [2.0, 2.75]]),
  lean: tab1([[0, 0.03], [0.55, -0.05], [1.0, 0.12], [1.1, 0.5], [1.3, 0.8], [1.6, 0.5], [2.0, 0.18]]),
  twist: tab1([[0, -0.6], [0.55, -1.0], [1.0, -0.8], [1.1, 0.45], [1.3, 0.9], [1.6, 0.4], [2.0, 0]]),
  // Feet are keyed relative to the track position (so a planted foot stays planted).
  footL: tab3([[0, 0.4, GROUND, -4.2], [0.55, 0.15, 2.0, -3.7], [0.8, 0.3, 1.0, -2.0], [1.0, 0.4, GROUND, 0.2], [1.5, 0.4, GROUND, 0.2], [2.0, 0.6, GROUND, 0]]),
  footR: tab3([[0, -0.4, GROUND, -4.4], [0.9, -0.4, GROUND, -4.4], [1.1, -0.45, 0.5, -3.3], [1.3, -0.7, 1.1, -1.9], [1.6, -0.6, GROUND, 0.1], [2.0, -0.6, GROUND, 0]]),
  handR: tab3([[0, -0.1, 4.1, 0.65], [0.55, -0.1, 4.35, 0.6], [0.85, -1.5, 3.7, -1.1], [1.0, -1.35, 5.6, -0.7], [1.1, -1.1, 5.9, 1.6], [1.28, 0.7, 2.4, 1.5], [1.6, 0.2, 2.5, 1.1], [2.0, -0.75, 2.75, 0.45]]),
  handL: tab3([[0, 0.1, 4.1, 0.7], [0.55, 0.1, 4.35, 0.65], [0.85, 1.1, 4.5, 1.3], [1.1, 0.8, 3.5, 0.3], [1.5, 0.8, 3.3, 0.5], [2.0, 0.75, 2.75, 0.45]]),
};
export const PITCH_RELEASE_AT = 1.1;
const PITCH_REL_HAND = sample3(new THREE.Vector3(), PITCH.handR, PITCH_RELEASE_AT);
const PITCH_REL_ROOTZ = sample1(PITCH.rootZ, PITCH_RELEASE_AT);

// Throw: 0 gather · 0.18 cocked · 0.3 release · 0.8 recovered. He rocks back, strides and comes over the front leg.
const THROW = {
  rootZ: tab1([[0, 0], [0.18, -0.45], [0.3, -0.25], [0.5, 0.35], [0.8, 0.3]]),
  sway: tab1([[0, 0], [0.18, -0.2], [0.3, 0.25], [0.5, 0.3], [0.8, 0.1]]),
  roll: tab1([[0, 0], [0.18, -0.12], [0.3, 0.3], [0.5, 0.25], [0.8, 0.05]]),
  hipH: tab1([[0, 2.7], [0.18, 2.55], [0.3, 2.5], [0.5, 2.35], [0.8, 2.6]]),
  lean: tab1([[0, 0.15], [0.18, -0.08], [0.3, 0.45], [0.5, 0.75], [0.8, 0.35]]),
  twist: tab1([[0, -0.3], [0.18, -1.15], [0.3, 0.5], [0.5, 1.0], [0.8, 0.15]]),
  // Feet are keyed relative to the track position.
  footL: tab3([[0, 0.45, GROUND, 0.1], [0.16, 0.4, 0.6, 1.2], [0.27, 0.4, GROUND, 2.3], [0.8, 0.4, GROUND, 2.3]]),
  footR: tab3([[0, -0.45, GROUND, -0.3], [0.3, -0.45, GROUND, -0.4], [0.5, -0.6, 0.7, 0.6], [0.7, -0.7, GROUND, 1.5], [0.8, -0.7, GROUND, 1.5]]),
  handR: tab3([[0, -0.2, 4.0, 0.8], [0.1, -0.9, 4.0, -0.3], [0.18, -1.45, 5.0, -1.1], [0.3, -0.6, 5.75, 1.45], [0.44, 0.75, 2.6, 1.7], [0.8, -0.4, 2.8, 1.1]]),
  handL: tab3([[0, 0.2, 4.0, 0.85], [0.18, 0.9, 4.7, 1.5], [0.32, 0.75, 3.6, 0.4], [0.8, 0.5, 2.8, 1.0]]),
  elbowR: tab1([[0, 0], [0.12, 1], [0.3, 0.8], [0.45, 0], [0.8, 0]]),
};
export const THROW_RELEASE_AT = 0.3;
/** Seconds into the catch clip at which the ball arrives. */
export const CATCH_AT = 0.7;
const THROW_REL_HAND = sample3(new THREE.Vector3(), THROW.handR, THROW_RELEASE_AT);
const THROW_REL_ROOTZ = sample1(THROW.rootZ, THROW_RELEASE_AT);

// Fielding a grounder: 0 approach · 0.38 glove down · 0.75 up with the ball.
const FIELD = {
  hipH: tab1([[0, 2.5], [0.38, 1.75], [0.75, 2.45]]),
  lean: tab1([[0, 0.5], [0.38, 1.05], [0.75, 0.45]]),
  handL: tab3([[0, 0.4, 1.6, 1.5], [0.36, 0.25, 0.3, 1.9], [0.75, 0.3, 3.2, 0.9]]),
  handR: tab3([[0, -0.4, 1.8, 1.4], [0.36, -0.3, 0.55, 1.8], [0.75, -0.2, 3.3, 0.85]]),
};

const DIVE = {
  hipH: tab1([[0, 2.4], [0.2, 1.7], [0.42, 0.5], [1, 0.5]]),
  pitch: tab1([[0, 0.25], [0.26, 1.4], [1, 1.45]]),
};
// Feet-first slide: 0 running · 0.26 down · 0.62 on the bag · 0.95 back on his feet.
const SLIDE_K = tab1([[0, 0], [0.26, 1], [0.62, 1], [0.95, 0]]);
const SLIDE_PITCH = -1.15;

// Umpire's strike call, in seconds: up out of the crouch, cock the fist, punch it out, hold, settle.
const UMP_CALL = {
  up: tab1([[0, 0], [0.24, 1], [1.0, 1], [1.5, 0]]),
  twist: tab1([[0, 0], [0.26, 0.22], [0.44, -0.7], [0.98, -0.7], [1.5, 0]]),
  handR: tab3([[0, -0.5, 2.3, 0.75], [0.26, -0.5, 4.5, 0.3], [0.44, -1.8, 4.75, 0.95], [0.98, -1.8, 4.75, 0.95], [1.5, -0.5, 2.3, 0.75]]),
  elbow: tab1([[0, 0], [0.26, 0.8], [0.44, 0.5], [0.98, 0.5], [1.5, 0]]),
};
export const UMP_CALL_S = 1.5;

// Swing (RHB), keyed on progress: 0 loaded · 0.5 contact · 1 finish. `handle` is the bat's handle.
const SWING = {
  hipH: tab1([[0, 2.66], [0.5, 2.58], [1, 2.72]]),
  lean: tab1([[0, 0.3], [0.5, 0.28], [1, 0.14]]),
  twist: tab1([[0, -0.45], [0.5, 0.85], [1, 1.75]]),
  footR: tab3([[0, -1.05, GROUND, 0], [0.5, -0.95, 0.2, 0.1], [1, -0.8, 0.3, 0.15]]),
  handle: tab3([[0, -0.8, 4.25, 0.35], [0.3, -0.5, 3.75, 0.8], [0.5, 0.25, 3.1, 1.4], [0.75, 1.0, 3.6, 0.9], [1, 0.85, 4.7, -0.35]]),
  az: tab1([[0, -2.5], [0.3, -2.0], [0.5, 0.15], [0.75, 1.7], [1, 3.5]]),
  el: tab1([[0, 1.0], [0.3, 0.45], [0.5, -0.12], [0.75, 0.2], [1, 0.55]]),
  // Weight goes from the back side onto a firm front leg; the back foot spins up onto its toes.
  sway: tab1([[0, -0.14], [0.5, 0.2], [1, 0.3]]),
  roll: tab1([[0, 0.05], [0.5, -0.12], [1, -0.05]]),
  toeR: tab1([[0, 0], [0.5, 0.75], [1, 0.95]]),
};
const SWING_FOLLOW_S = 0.38;

const _t = new THREE.Vector3();
const _d = new THREE.Vector3();
const _h = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _hc = new THREE.Vector3();
const _dc = new THREE.Vector3();
const _stance = newPose();

function batDir(out: THREE.Vector3, az: number, el: number): THREE.Vector3 {
  // Azimuth from +Z toward +X (the pitcher's side for a righty), elevation above horizontal.
  return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
}
const SW_H05 = sample3(new THREE.Vector3(), SWING.handle, 0.5);
const SW_D05 = batDir(new THREE.Vector3(), sample1(SWING.az, 0.5), sample1(SWING.el, 0.5));

/** Hands grip the handle wherever the bat is. */
function gripBat(p: Pose, handle: THREE.Vector3, dir: THREE.Vector3) {
  p.hasBat = true;
  p.batAt.copy(handle);
  p.batDir.copy(dir);
  p.handL.copy(handle).addScaledVector(dir, 0.05);
  p.handR.copy(handle).addScaledVector(dir, 0.38);
}

function standing(p: Pose) {
  p.hipH = 3.0;
  p.lean = 0.04;
  p.twist = 0;
  p.rootPitch = 0;
  p.rootY = 0;
  p.rootZ = 0;
  p.handL.set(0.85, 2.85, 0.15);
  p.handR.set(-0.85, 2.85, 0.15);
  p.footL.set(0.42, GROUND, 0);
  p.footR.set(-0.42, GROUND, 0);
  p.hasBat = false;
  p.hidden = false;
  p.headYaw = 0;
  p.headPitch = 0;
  p.gloveUp = 0.3;
  p.roll = 0;
  p.sway = 0;
  p.elbowL = 0;
  p.elbowR = 0;
  p.toeL = 0;
  p.toeR = 0;
}

/** World reach target → the actor's root frame (x flipped for a mirrored lefty). */
function localTarget(out: THREE.Vector3, c: PoseCtx, rootZ: number, flip: number): THREE.Vector3 {
  const dx = c.tx - c.x;
  const dz = c.tz - c.z;
  const s = Math.sin(c.yaw);
  const co = Math.cos(c.yaw);
  return out.set((dx * co - dz * s) * flip, c.ty - c.groundY, dx * s + dz * co - rootZ);
}

function footCycle(out: THREE.Vector3, side: number, u: number, stance: number, amp: number, lift: number) {
  if (u < stance) {
    out.set(side * 0.33, GROUND, amp * (1 - (2 * u) / stance));
  } else {
    // Recovery: the heel kicks up behind, then the knee drives the foot through low and forward.
    const v = (u - stance) / (1 - stance);
    const e = v * v * (3 - 2 * v);
    out.set(side * 0.33, GROUND + lift * Math.pow(Math.sin(Math.PI * Math.pow(v, 0.8)), 1.2), -amp * Math.cos(Math.PI * e));
  }
}

/** Turn the head toward a point given in the root frame, by weight w. */
function lookAt(p: Pose, t: THREE.Vector3, w: number) {
  const flat = Math.hypot(t.x, t.z);
  if (flat < 0.5 || w <= 0) return;
  p.headYaw = lerp(p.headYaw, Math.max(-1.35, Math.min(1.35, Math.atan2(t.x, t.z))), w);
  p.headPitch = lerp(p.headPitch, Math.max(-0.7, Math.min(0.8, -Math.atan2(t.y - (p.hipH + 2.5), flat))), w);
}

/**
 * A point given in the upright root frame (y above the ground) → the frame the solver uses
 * when the whole body is pitched by `th` about the hips (slides, dives).
 */
function pitched(out: THREE.Vector3, x: number, y: number, z: number, hipH: number, th: number): THREE.Vector3 {
  const c = Math.cos(th);
  const s = Math.sin(th);
  const dy = y - hipH;
  return out.set(x, hipH + dy * c + z * s, -dy * s + z * c);
}

const TAU = Math.PI * 2;
const frac = (x: number) => x - Math.floor(x);

/** Standing ↔ walking ↔ sprinting, blended continuously by speed. */
function locoPose(p: Pose, a: ActorDraw, c: PoseCtx) {
  const athletic = a.kind === "fielder" || a.kind === "catcher";
  const sd = c.seed;
  const breath = Math.sin(c.time * (1.5 + 0.5 * sd) + sd * 40);
  const shift = Math.sin(c.time * (0.31 + 0.22 * sd) + sd * 17);
  if (athletic) {
    // Between pitches he stands easy; he sinks into the ready position as the pitcher
    // delivers and takes a little hop as the pitch reaches the plate, landing set to move.
    const tau = c.pitchTau;
    const set = smooth((tau + 1.0 + 0.25 * sd) / 0.6) * (1 - smooth((tau - 1.7) / 0.9));
    const hk = (tau - 0.13 - 0.06 * sd) / 0.27;
    const hop = hk > 0 && hk < 1 ? Math.sin(Math.PI * hk) : 0;
    const landed = smooth(hk) * (1 - smooth((tau - 1.1) / 0.6));
    const easy = 1 - set;
    p.hipH = lerp(2.74, 2.44, set) - 0.12 * landed + 0.06 * hop + breath * 0.014 * easy;
    p.rootY = 0.17 * hop;
    p.lean = lerp(0.2, 0.44, set) + 0.07 * landed;
    p.sway = shift * 0.16 * easy;
    p.roll = -shift * 0.04 * easy;
    const wide = lerp(0.72, 0.98, set) + 0.08 * landed;
    p.footL.set(wide, GROUND, 0.05 * set);
    p.footR.set(-wide, GROUND, -0.05 * set);
    p.handL.set(lerp(0.78, 0.5, set), lerp(2.75, 2.35, set) - 0.15 * landed, lerp(0.35, 1.2, set));
    p.handR.set(lerp(-0.78, -0.5, set), lerp(2.75, 2.35, set) - 0.15 * landed, lerp(0.35, 1.2, set));
    p.headYaw = Math.sin(c.time * 0.4 + sd * 31) * 0.2 * easy;
  } else {
    p.hipH = 2.78 + breath * 0.012;
    p.lean = 0.16;
    p.sway = shift * 0.12;
    p.roll = -shift * 0.03;
    p.footL.set(0.6, GROUND, 0);
    p.footR.set(-0.6, GROUND, 0);
    p.handL.set(0.78, 2.75, 0.4);
    p.handR.set(-0.78, 2.75, 0.4);
  }
  const w = smooth((c.speed - 0.6) / 5.4);
  if (w <= 0) return;
  const sp = Math.min(32, c.speed);
  const cyc = cycleLen(sp);
  // A planted foot covers exactly the ground the body does; the legs can reach about ±1.3 ft.
  const stance = Math.min(0.58, 2.6 / cyc);
  const amp = (stance * cyc) / 2;
  const fast = clamp01(sp / 26);
  const lift = 0.3 + 1.15 * fast;
  const u = frac(c.phase / TAU);
  const cs = Math.cos(c.phase);
  const sn = Math.sin(c.phase);
  const armA = 0.35 + 0.75 * fast;
  // Drive: he leans into acceleration and sits back when he pulls up.
  const drive = Math.max(-0.22, Math.min(0.3, c.accel * 0.011));
  p.hipH = lerp(p.hipH, 2.72 - 0.1 * fast + (0.05 + 0.05 * fast) * Math.cos(2 * c.phase + 0.5), w);
  p.rootY *= 1 - w;
  p.lean = lerp(p.lean, 0.1 + 0.26 * fast + drive, w);
  p.twist = (0.16 + 0.14 * fast) * cs * w;
  p.sway = lerp(p.sway, 0.07 * sn, w);
  p.roll = lerp(p.roll, c.bank - 0.04 * sn, w);
  p.headYaw *= 1 - w;
  footCycle(_t, 1, u, stance, amp, lift);
  p.footL.lerp(_t, w);
  footCycle(_t, -1, frac(u + 0.5), stance, amp, lift);
  p.footR.lerp(_t, w);
  // Arms pump opposite the legs: the forward hand comes up toward the chin, the back one past the hip.
  const fl = Math.max(0, -cs);
  const fr = Math.max(0, cs);
  p.handL.lerp(_t.set(0.78 - 0.3 * fl, 3.45 - (0.25 + 0.75 * fast) * cs * 0.9 + 0.2 * fast, 0.3 - armA * cs), w);
  p.handR.lerp(_t.set(-0.78 + 0.3 * fr, 3.45 + (0.25 + 0.75 * fast) * cs * 0.9 + 0.2 * fast, 0.3 + armA * cs), w);
  p.gloveUp = lerp(p.gloveUp, 0.1, w);
}

/** Where a shoulder sits in the root frame for the trunk the pose describes (side 1 left, −1 right; roll ignored). */
export function shoulderAt(out: THREE.Vector3, p: Pose, side: number): THREE.Vector3 {
  const x = side * DIM.shoulderX;
  const y = DIM.shoulderY * Math.cos(p.lean);
  const z = DIM.shoulderY * Math.sin(p.lean);
  const c = Math.cos(p.twist);
  const s = Math.sin(p.twist);
  return out.set(p.sway + x * c + z * s, p.hipH + y, -x * s + z * c);
}

/** The bat's handle and direction for a stance at load `L` (0 waiting … 1 fully loaded). */
function stanceBat(p: Pose, st: BatStyle, L: number, wag: number, outHandle: THREE.Vector3, outDir: THREE.Vector3) {
  // Hands just in front of the back shoulder and in toward the chest, at about its height;
  // the load takes them back toward the catcher and a touch up.
  shoulderAt(outHandle, p, -1);
  outHandle.x += 0.42 - 0.3 * L + 0.04 * wag;
  outHandle.y += -0.02 + st.hands + 0.06 * L + 0.03 * wag;
  outHandle.z += 0.62 + st.depth - 0.15 * L;
  // Tip back over the shoulder toward the catcher, at his own angle; loading lays it a little flatter and wraps it.
  const az = -2.0 + st.tip - 0.35 * L + wag * 0.6;
  const el = lerp(st.angle, Math.min(st.angle, 0.95), L) + wag * 0.25;
  batDir(outDir, az, el);
}

function stanceInto(p: Pose, tau: number, time: number, st: BatStyle) {
  // The load starts as the pitcher delivers (a leg kick earlier than a toe tap) and is
  // done just after release; it relaxes again if the ball goes by.
  const start = st.stride === "kick" ? 0.5 : st.stride === "tap" ? 0.32 : 0.22;
  const L = smooth((tau + start) / (start + 0.22)) * (1 - smooth((tau - 0.85) / 0.5));
  const still = 1 - smooth((tau + start + 0.4) / 0.4) * (1 - smooth((tau - 1.0) / 0.5));
  // The front foot comes up through the load and is back down, striding, by its end.
  const up = Math.sin(Math.PI * smooth(L / 0.85));
  const bob = Math.sin(time * st.tempo * 0.5) * still;
  standing(p);
  p.hipH = 2.8 - 0.3 * st.crouch - 0.04 * L + 0.02 * st.bounce * bob;
  p.lean = 0.2 + 0.12 * st.crouch;
  // Shoulders a touch closed; an open stance starts open and closes up as he loads.
  p.twist = lerp(-0.22 + 0.2 * Math.min(0, st.open) - 0.08 * Math.max(0, st.open), -0.45, L);
  // Weight on the back side, more so in the load; a small rock while he waits.
  p.sway = -0.08 - 0.12 * L + 0.04 * bob;
  p.roll = 0.03 + 0.05 * L;
  // Both eyes on the pitcher.
  p.headYaw = 1.5;
  p.headPitch = 0.08;
  const fx = st.width * 0.52;
  const fz = 0.45 * Math.min(0, st.open) + 0.2 * Math.max(0, st.open);
  const land = landing(st);
  // Leg kick: the knee comes up and in toward the back leg before the stride; a tap barely leaves the ground.
  const tuck = st.stride === "kick" ? 0.45 * up : 0.08 * up;
  const sL = smooth((L - 0.45) / 0.55);
  p.footL.set(lerp(fx, land.x, sL) - tuck, GROUND + st.lift * up, lerp(fz, land.z, sL));
  p.toeL = st.stride === "kick" ? 0.35 * up : 0;
  p.footR.set(-st.width * 0.48, GROUND, 0);
  p.elbowR = st.elbow * (1 - 0.3 * L);
  const wag = Math.sin(time * st.tempo) * (st.waggle / 0.12) * still;
  stanceBat(p, st, L, wag, _h, _dir);
  gripBat(p, _h, _dir);
}

/** Where the front foot lands at the end of the stride (RHB root frame). */
function landing(st: BatStyle): { x: number; z: number } {
  return { x: st.width * 0.52 + st.reach, z: 0.05 + 0.15 * Math.min(0, st.open) };
}

const _load = newPose();

function swingInto(p: Pose, t: number, c: PoseCtx, flip: number, time: number, st: BatStyle) {
  const D = Math.max(0.04, c.swingDur);
  const F = SWING_FOLLOW_S;
  let prog: number;
  if (t < D) prog = 0.5 * Math.pow(Math.max(0, t) / D, 1.6);
  else {
    // Follow-through leaves contact at the speed the barrel arrived with.
    const k = Math.min(5, Math.max(1.6, (1.6 * F) / D));
    prog = 0.5 + 0.5 * (1 - Math.pow(1 - Math.min(1, (t - D) / F), k));
  }
  standing(p);
  p.hipH = sample1(SWING.hipH, prog) - 0.2 * st.crouch * (1 - prog);
  p.lean = sample1(SWING.lean, prog);
  p.twist = sample1(SWING.twist, prog);
  p.sway = sample1(SWING.sway, prog);
  p.roll = sample1(SWING.roll, prog);
  p.toeR = sample1(SWING.toeR, prog);
  // Head stays on the ball through contact, then follows the swing round.
  p.headYaw = prog < 0.5 ? lerp(1.5, 1.0, prog * 2) : lerp(1.0, 0.7, prog * 2 - 1);
  p.headPitch = 0.08 + 0.25 * Math.sin(Math.PI * prog);
  const land = landing(st);
  p.footL.set(land.x, GROUND, land.z);
  sample3(p.footR, SWING.footR, prog);
  p.footR.x += (1.05 - st.width * 0.48) * (1 - prog);
  sample3(_h, SWING.handle, prog);
  batDir(_dir, sample1(SWING.az, prog), sample1(SWING.el, prog) + 0.25 * st.finish * smooth((prog - 0.6) / 0.4));
  if (c.hasTarget) {
    // Bend the swing plane so the sweet spot passes exactly through the aim point at contact.
    localTarget(_t, c, 0, flip);
    _d.copy(SW_H05).addScaledVector(SW_D05, BAT_SWEET);
    _t.sub(_d);
    const l = _t.length();
    if (l > 2.6) _t.multiplyScalar(2.6 / l);
    _d.add(_t); // sweet-spot target
    _hc.copy(SW_H05).addScaledVector(_t, 0.6);
    _dc.subVectors(_d, _hc).normalize();
    _hc.copy(_d).addScaledVector(_dc, -BAT_SWEET);
    const sn = Math.sin(Math.PI * prog);
    const w = sn * sn;
    _h.addScaledVector(_hc.sub(SW_H05), w);
    _dir.addScaledVector(_dc.sub(SW_D05), w).normalize();
    p.lean += 0.12 * w * Math.max(-1, Math.min(1.5, _t.z));
  }
  gripBat(p, _h, _dir);
  // Launch from his own loaded stance: it hands over to the swing by the time the barrel turns.
  const fade = 1 - smooth(prog / 0.32);
  if (fade > 0) {
    stanceInto(_load, 0.5, time, st);
    lerpPose(p, p, _load, fade);
  }
  if (st.oneHand) {
    // The top hand lets go in the finish and comes down across the chest.
    const w = smooth((prog - 0.68) / 0.2);
    if (w > 0) p.handR.lerp(_t.set(0.25, 3.75, 1.15), w);
  }
  const rec = smooth((t - D - F - 0.15) / 0.45);
  if (rec > 0) {
    stanceInto(_stance, -10, time, st);
    lerpPose(p, p, _stance, rec);
  }
}

/**
 * Bunt: he squares around early (t is time since he showed bunt; swingDur → contact),
 * knees bent, the bat level out in front with the barrel over the plate, then catches
 * the ball on it — the sweet spot is set on the aim point.
 */
function buntInto(p: Pose, t: number, c: PoseCtx, flip: number, time: number, st: BatStyle) {
  const D = Math.max(0.2, c.swingDur);
  const sq = smooth(t / 0.35);
  stanceInto(_stance, -10, time, st);
  standing(p);
  p.hipH = lerp(2.95, 2.55, sq);
  p.lean = lerp(0.04, 0.22, sq);
  p.twist = lerp(0, 0.9, sq);
  p.headYaw = lerp(1.3, 0.6, sq);
  p.headPitch = 0.15;
  p.footL.set(1.3, GROUND, 0.25);
  p.footR.set(lerp(-1.2, -0.35, sq), GROUND, lerp(0.1, 0.9, sq));
  _h.set(0.15, 3.65, 1.2);
  _dir.set(0.95, 0.12, 0.3).normalize();
  if (c.hasTarget) {
    localTarget(_t, c, 0, flip);
    // Barrel's sweet spot on the ball; the hands stay a forearm out in front of the chest.
    _d.copy(_t);
    _dc.subVectors(_d, _h);
    const l = _dc.length();
    if (l > 0.2) {
      _dc.multiplyScalar(1 / l);
      _hc.copy(_d).addScaledVector(_dc, -Math.min(BAT_SWEET * 0.75, l));
      const w = sq;
      _h.lerp(_hc, 0.7 * w);
      _dir.lerp(_dc, w).normalize();
    }
  }
  gripBat(p, _h, _dir);
  // After the ball is off the bat he comes out of it toward first.
  const rec = smooth((t - D - 0.15) / 0.35);
  if (rec > 0) lerpPose(p, p, _stance, rec * 0.5);
}

function mirror(p: Pose) {
  p.twist = -p.twist;
  p.headYaw = -p.headYaw;
  p.roll = -p.roll;
  p.sway = -p.sway;
  let e = p.elbowL;
  p.elbowL = p.elbowR;
  p.elbowR = e;
  e = p.toeL;
  p.toeL = p.toeR;
  p.toeR = e;
  _t.copy(p.handL);
  p.handL.set(-p.handR.x, p.handR.y, p.handR.z);
  p.handR.set(-_t.x, _t.y, _t.z);
  _t.copy(p.footL);
  p.footL.set(-p.footR.x, p.footR.y, p.footR.z);
  p.footR.set(-_t.x, _t.y, _t.z);
  p.batAt.x = -p.batAt.x;
  p.batDir.x = -p.batDir.x;
}

/** Write the actor's pose for this frame into `p`. */
export function poseInto(p: Pose, a: ActorDraw, cls: PoseClass, c: PoseCtx): Pose {
  // A pitcher who is not yet in his delivery holds the set position (delivery time 0).
  const t = cls === "pitch" && a.state.action !== "pitch" ? 0 : a.state.actionT;
  const lefty = a.hand === "L";
  const flip = lefty ? -1 : 1;
  const sd = c.seed;
  let look = 0;
  standing(p);
  switch (cls) {
    case "gone":
      p.hidden = true;
      return p;
    case "loco":
      locoPose(p, a, c);
      look = a.kind === "runner" || a.kind === "batter" ? 0 : 1 - 0.35 * smooth((c.speed - 8) / 12);
      break;
    case "crouch": {
      p.footL.set(0.95, GROUND, 0.25);
      p.footR.set(-0.95, GROUND, 0.25);
      look = 1;
      if (a.kind === "umpire") {
        const ct = c.callT;
        const k = ct < 0 ? 0 : sample1(UMP_CALL.up, ct);
        p.hipH = lerp(2.1, 2.9, k) + Math.sin(c.time * 1.4) * 0.012;
        p.lean = lerp(0.55, 0.06, k);
        p.handL.set(0.5, lerp(2.3, 2.9, k), lerp(0.75, 0.4, k));
        p.handR.set(-0.5, 2.3, 0.75);
        if (ct >= 0) {
          p.twist = sample1(UMP_CALL.twist, ct);
          sample3(p.handR, UMP_CALL.handR, ct);
          p.elbowR = sample1(UMP_CALL.elbow, ct);
          p.sway = -0.15 * k;
          look = 1 - k;
          p.headYaw = -0.35 * k;
        }
      } else {
        const br = Math.sin(c.time * 1.6 + sd * 9);
        p.hipH = 1.35 + br * 0.012;
        p.lean = 0.3;
        p.sway = Math.sin(c.time * 0.5 + sd * 5) * 0.05;
        p.gloveUp = 0.9;
        p.handL.set(0.3, 2.4, 1.5);
        p.handR.set(-0.6, 1.6, 0.3);
        if (c.hasTarget && c.targetW > 0) {
          localTarget(_t, c, 0, flip);
          p.handL.lerp(_t, c.targetW);
          p.hipH += 0.25 * c.targetW * clamp01((_t.y - 3) / 2);
          // He shifts behind the pitch and turns the glove over for a low one.
          p.sway += 0.35 * c.targetW * Math.max(-1, Math.min(1, _t.x));
          p.gloveUp = lerp(0.9, lerp(0.9, 0.1, clamp01((2.0 - _t.y) / 1.2)), c.targetW);
        }
      }
      break;
    }
    case "pitch": {
      const z = sample1(PITCH.rootZ, t);
      p.rootZ = z;
      p.hipH = sample1(PITCH.hipH, t);
      p.lean = sample1(PITCH.lean, t);
      p.twist = sample1(PITCH.twist, t);
      sample3(p.footL, PITCH.footL, t).z -= z;
      sample3(p.footR, PITCH.footR, t).z -= z;
      sample3(p.handR, PITCH.handR, t);
      sample3(p.handL, PITCH.handL, t);
      {
        // His own windup: how high the knee comes, how far he coils it back, where the hands set.
        const ps = pitchStyle(a.id);
        const kick = Math.sin(Math.PI * clamp01((t - 0.15) / 0.75));
        if (kick > 0) {
          p.footL.y = GROUND + (p.footL.y - GROUND) * lerp(1, ps.lift, kick);
          p.footL.x -= 0.35 * ps.coil * kick;
          p.twist -= 0.25 * ps.coil * kick;
        }
        const setW = 1 - smooth((t - 0.5) / 0.3);
        p.handR.y += ps.set * setW;
        p.handL.y += ps.set * setW;
      }
      // Arm cocked with the elbow up through foot strike; he falls off toward the glove side after release.
      p.elbowR = smooth((t - 0.7) / 0.2) * (1 - smooth((t - 1.12) / 0.14));
      p.roll = 0.28 * smooth((t - 1.08) / 0.25) * (1 - smooth((t - 1.5) / 0.5));
      p.toeR = 0.8 * smooth((t - 0.95) / 0.15) * (1 - smooth((t - 1.5) / 0.2));
      if (t <= 0) {
        // On the rubber: breathing, looking in for the sign.
        p.hipH += Math.sin(c.time * 1.5 + sd * 7) * 0.012;
        p.sway = Math.sin(c.time * 0.45 + sd * 3) * 0.04;
      }
      p.headPitch = 0.12 + 0.25 * smooth((t - 1.0) / 0.3) * (1 - smooth((t - 1.5) / 0.4));
      if (c.hasTarget) {
        // Bring the hand through the real release point of this pitch.
        const w = t < PITCH_RELEASE_AT ? smooth((t - 0.85) / 0.25) : 1 - smooth((t - PITCH_RELEASE_AT) / 0.18);
        if (w > 0) {
          localTarget(_t, c, PITCH_REL_ROOTZ, flip).sub(PITCH_REL_HAND);
          const l = _t.length();
          if (l > 1.8) _t.multiplyScalar(1.8 / l);
          p.handR.addScaledVector(_t, w);
        }
      }
      break;
    }
    case "throw": {
      const z = sample1(THROW.rootZ, t);
      p.rootZ = z;
      p.sway = sample1(THROW.sway, t);
      p.roll = sample1(THROW.roll, t);
      p.hipH = sample1(THROW.hipH, t);
      p.lean = sample1(THROW.lean, t);
      p.twist = sample1(THROW.twist, t);
      sample3(p.footL, THROW.footL, t).z -= z;
      sample3(p.footR, THROW.footR, t).z -= z;
      sample3(p.handR, THROW.handR, t);
      sample3(p.handL, THROW.handL, t);
      p.elbowR = sample1(THROW.elbowR, t);
      p.toeR = 0.7 * smooth((t - 0.24) / 0.12) * (1 - smooth((t - 0.6) / 0.15));
      p.headPitch = 0.1;
      if (c.hasTarget) {
        // The hand comes through the point the ball actually leaves from.
        const w = t < THROW_RELEASE_AT ? smooth((t - 0.14) / 0.16) : 1 - smooth((t - THROW_RELEASE_AT) / 0.14);
        if (w > 0) {
          localTarget(_t, c, THROW_REL_ROOTZ, flip).sub(THROW_REL_HAND);
          const l = _t.length();
          if (l > 1.6) _t.multiplyScalar(1.6 / l);
          p.handR.addScaledVector(_t, w);
        }
      }
      break;
    }
    case "catch": {
      const hold = c.hold;
      p.hipH = 2.8 - 0.12 * hold;
      p.lean = 0.06 + 0.1 * hold;
      p.footL.set(0.6, GROUND, 0.35);
      p.footR.set(-0.6, GROUND, -0.25);
      p.handL.set(lerp(0.45, 0.2, hold), lerp(4.5, 3.7, hold), lerp(1.2, 0.8, hold));
      p.handR.set(lerp(-0.3, -0.1, hold), lerp(4.0, 3.6, hold), lerp(1.05, 0.85, hold));
      const w = c.hasTarget ? c.targetW * (1 - hold) : 0;
      p.gloveUp = 0.9;
      look = 1;
      if (c.jump > 0) {
        // A ball over his reach: he gathers, goes up for it (peaking as it arrives) and lands soft.
        const up = Math.sin(Math.PI * clamp01((t - CATCH_AT + 0.28) / 0.56));
        const load = Math.sin(Math.PI * clamp01((t - CATCH_AT + 0.5) / 0.3)) + 0.7 * Math.sin(Math.PI * clamp01((t - CATCH_AT - 0.24) / 0.3));
        const k = c.jump / 2.4;
        p.rootY = c.jump * up;
        p.hipH -= 0.4 * k * load;
        p.lean += 0.14 * k * load;
        p.toeL = 0.9 * up;
        p.toeR = 0.9 * up;
        p.footL.y += 0.25 * k * up;
        p.footR.y += 0.5 * k * up;
      }
      if (w > 0) {
        localTarget(_t, c, 0, flip);
        _t.y -= p.rootY;
        const low = clamp01((3.2 - _t.y) / 2.5) * w;
        const high = clamp01((_t.y - 5.6) / 2) * w;
        // A shoestring catch close to the body: sit down into it, not just bend.
        const shoe = clamp01((2.0 - _t.y) / 1.0) * clamp01((1.6 - Math.hypot(_t.x, _t.z)) / 1.0) * w;
        p.hipH += 0.14 * high - 0.55 * low - 0.55 * shoe;
        p.lean += 0.4 * low - 0.1 * high + 0.25 * shoe;
        p.footL.z += 0.35 * shoe;
        p.sway = 0.3 * w * Math.max(-1, Math.min(1, _t.x * 0.6));
        p.toeR = Math.max(p.toeR, 0.5 * high);
        // Fingers up for a ball above the belt, down for one below it.
        p.gloveUp = lerp(0.9, -0.3, low);
        p.handL.lerp(_t, w);
        p.handR.lerp(_t.add(_d.set(-0.4, -0.25, -0.15)), w * 0.6);
      }
      break;
    }
    case "field": {
      p.hipH = sample1(FIELD.hipH, t);
      p.lean = sample1(FIELD.lean, t);
      p.footL.set(1.0, GROUND, 0.45);
      p.footR.set(-1.0, GROUND, -0.15);
      sample3(p.handL, FIELD.handL, t);
      sample3(p.handR, FIELD.handR, t);
      const w = c.hasTarget ? c.targetW * (1 - c.hold) : 0;
      // Glove fingers down while he is bent over the ball, eyes on it.
      const down = clamp01((2.4 - p.hipH) / 0.6);
      p.gloveUp = lerp(0.3, -0.9, down);
      p.headPitch = 0.55 * down;
      look = 1 - c.hold;
      if (w > 0) {
        localTarget(_t, c, 0, flip);
        // A ball on the grass: he gets his backside down and his glove on the ground.
        const low = clamp01((1.3 - _t.y) / 1.1) * w * clamp01((2.6 - p.hipH) / 0.6);
        p.hipH -= 0.42 * low;
        p.lean += 0.16 * low;
        _t.y = Math.max(0.2, _t.y);
        p.sway = 0.3 * w * Math.max(-1, Math.min(1, _t.x * 0.6));
        p.handL.lerp(_t, w);
        p.handR.lerp(_t.add(_d.set(-0.35, 0.2, -0.1)), w * 0.7);
      }
      break;
    }
    case "dive": {
      p.hipH = sample1(DIVE.hipH, t);
      p.rootPitch = sample1(DIVE.pitch, t);
      p.lean = 0;
      p.headPitch = -0.55 * p.rootPitch;
      p.gloveUp = 0;
      p.handL.set(0.3, p.hipH + 3.75, 0.25);
      p.handR.set(-0.4, p.hipH + 3.2, 0.3);
      p.footL.set(0.35, p.hipH - 2.75, -0.25);
      p.footR.set(-0.35, p.hipH - 2.6, -0.5);
      break;
    }
    case "slide": {
      // Feet first: lead leg out at the bag, the other folded under it, sitting back on one hand.
      const k = sample1(SLIDE_K, t);
      const th = SLIDE_PITCH * k;
      p.rootPitch = th;
      p.hipH = lerp(2.7, 0.62, k);
      p.lean = lerp(0.2, 0.5, k);
      p.twist = 0.25 * k;
      p.roll = 0.12 * k;
      p.headPitch = 0.9 * k;
      const h = p.hipH;
      p.footR.lerp(pitched(_t, -0.3, 0.3, 2.75, h, th), k);
      p.footL.lerp(pitched(_t, 0.55, 0.22, 1.05, h, th), k);
      p.handL.lerp(pitched(_t, 1.0, 0.35, -1.0, h, th), k);
      p.handR.lerp(pitched(_t, -1.1, h + 2.1, 0.5, h, th), k);
      p.elbowR = 0.6 * k;
      break;
    }
    case "bat":
      stanceInto(p, t, c.time + sd * 5, batStyle(a.id));
      look = t < 0.6 ? 0.85 : 0;
      break;
    case "swing":
      if (c.bunt) buntInto(p, t, c, flip, c.time + sd * 5, batStyle(a.id));
      else swingInto(p, t, c, flip, c.time + sd * 5, batStyle(a.id));
      break;
    case "idle":
    default: {
      const shift = Math.sin(c.time * (0.3 + 0.25 * sd) + sd * 23);
      p.hipH = 3.0 + Math.sin(c.time * (1.3 + 0.4 * sd) + sd * 11) * 0.015 - 0.03 * Math.abs(shift);
      p.sway = shift * 0.18;
      p.roll = -shift * 0.05;
      p.headYaw = Math.sin(c.time * 0.37 + sd * 29) * 0.28;
      look = 0.8;
      if (a.kind === "coach") {
        // Hands on hips, or arms folded low, by temperament.
        if (sd > 0.5) {
          p.handL.set(0.72, 3.3, 0.12);
          p.handR.set(-0.72, 3.3, 0.12);
        } else {
          p.handL.set(0.25, 3.7, 0.75);
          p.handR.set(-0.3, 3.55, 0.8);
        }
      }
      break;
    }
  }
  if (look > 0 && c.ballW > 0) {
    const dx = c.bx - c.x;
    const dz = c.bz - c.z;
    const s = Math.sin(c.yaw);
    const co = Math.cos(c.yaw);
    _t.set((dx * co - dz * s) * flip, c.by - c.groundY, dx * s + dz * co - p.rootZ);
    lookAt(p, _t, look * c.ballW);
  }
  if (lefty) mirror(p);
  return p;
}

// ---------- Skeleton ----------

export const PART_LEN = { upperArm: DIM.upperArm, foreArm: DIM.foreArm, thigh: DIM.thigh, shin: DIM.shin };

const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _right = new THREE.Vector3(1, 0, 0);
const _one = new THREE.Vector3(1, 1, 1);

export interface RigOut {
  /** World matrix of every bone, indexed by BONE (character/skeleton.ts). */
  bones: THREE.Matrix4[];
  bat: THREE.Matrix4;
  hasBat: boolean;
  hidden: boolean;
  /** World positions of the glove hand and the throwing hand (centre of the palm). */
  /** World positions of the glove's pocket and of the throwing hand's palm. */
  gloveHand: THREE.Vector3;
  throwHand: THREE.Vector3;
  /** World position of the pelvis (for bounds). */
  center: THREE.Vector3;
}

export function newRigOut(): RigOut {
  return {
    bones: Array.from({ length: BONE_COUNT }, () => new THREE.Matrix4()),
    bat: new THREE.Matrix4(),
    hasBat: false,
    hidden: false,
    gloveHand: new THREE.Vector3(),
    throwHand: new THREE.Vector3(),
    center: new THREE.Vector3(),
  };
}

const _ikD = new THREE.Vector3();
const _ikP = new THREE.Vector3();

/**
 * Two-bone IK: writes the elbow/knee, the (reach-clamped) end position and the hinge
 * axis of the joint (unit, perpendicular to both segments; `sign` picks its sense).
 */
function ik(
  s: THREE.Vector3,
  target: THREE.Vector3,
  a: number,
  b: number,
  pole: THREE.Vector3,
  sign: number,
  outMid: THREE.Vector3,
  outEnd: THREE.Vector3,
  outAxis: THREE.Vector3,
) {
  const d = _ikD.subVectors(target, s);
  let dist = d.length();
  if (dist < 1e-4) {
    d.set(0, -1, 0);
    dist = 1e-4;
  }
  d.multiplyScalar(1 / dist);
  dist = Math.min(a + b - 0.02, Math.max(0.15, dist));
  const cosA = Math.min(1, Math.max(-1, (a * a + dist * dist - b * b) / (2 * a * dist)));
  const sinA = Math.sqrt(1 - cosA * cosA);
  const perp = _ikP.copy(pole).addScaledVector(d, -pole.dot(d));
  if (perp.lengthSq() < 1e-6) perp.set(0, 0, 1).addScaledVector(d, -d.z);
  if (perp.lengthSq() < 1e-6) perp.set(1, 0, 0);
  perp.normalize();
  outMid.copy(s).addScaledVector(d, a * cosA).addScaledVector(perp, a * sinA);
  outEnd.copy(s).addScaledVector(d, dist);
  outAxis.crossVectors(perp, d).multiplyScalar(sign);
}

const _fx = new THREE.Vector3();
const _fy = new THREE.Vector3();
const _fz = new THREE.Vector3();

/** Limb bone: origin at its joint, +Y back along the bone (it hangs down at rest), X the hinge axis. */
function limbFrame(out: THREE.Matrix4, origin: THREE.Vector3, child: THREE.Vector3, axis: THREE.Vector3) {
  _fy.subVectors(origin, child).normalize();
  _fx.copy(axis).addScaledVector(_fy, -axis.dot(_fy));
  if (_fx.lengthSq() < 1e-8) _fx.set(1, 0, 0).addScaledVector(_fy, -_fy.x);
  _fx.normalize();
  _fz.crossVectors(_fx, _fy);
  out.makeBasis(_fx, _fy, _fz).setPosition(origin);
}

/** Hand bone: +Y toward the wrist (fingers along −Y), +Z out of the palm, as close to `palm` as it can face. */
function handFrame(out: THREE.Matrix4, origin: THREE.Vector3, y: THREE.Vector3, palm: THREE.Vector3) {
  _fz.copy(palm).addScaledVector(y, -palm.dot(y));
  if (_fz.lengthSq() < 1e-6) _fz.set(y.y, y.z, y.x).addScaledVector(y, -(y.x * y.y + y.y * y.z + y.z * y.x));
  _fz.normalize();
  _fx.crossVectors(y, _fz);
  out.makeBasis(_fx, y, _fz).setPosition(origin);
}

const tmp = {
  root: new THREE.Matrix4(),
  pelvis: new THREE.Matrix4(),
  torso: new THREE.Matrix4(),
  sh: new THREE.Vector3(),
  hip: new THREE.Vector3(),
  mid: new THREE.Vector3(),
  end: new THREE.Vector3(),
  axis: new THREE.Vector3(),
  target: new THREE.Vector3(),
  pole: new THREE.Vector3(),
  rootQ: new THREE.Quaternion(),
  chestQ: new THREE.Quaternion(),
  headQ: new THREE.Quaternion(),
  tx: new THREE.Vector3(),
  ty: new THREE.Vector3(),
  tz: new THREE.Vector3(),
  y: new THREE.Vector3(),
  ref: new THREE.Vector3(),
  at: new THREE.Vector3(),
  dir: new THREE.Vector3(),
};

const SIDES = [1, -1];
const ARM = [BONE.armL, BONE.armR];
const LEG = [BONE.thighL, BONE.thighR];
/** The head turns at most this far (rad) from where the chest points. */
const NECK_LIMIT = 1.45;

/** The glove's pocket, from the wrist: along the fingers and out of the palm (ft). */
export const GLOVE_POCKET_Y = 0.34;
export const GLOVE_POCKET_Z = 0.1;

export function hideRig(out: RigOut): void {
  out.hidden = true;
  out.hasBat = false;
}

/**
 * Pose → bone world matrices, with the actor standing at (x, groundY, z) facing `yaw`
 * (the renderer's smoothed transform, not necessarily the raw timeline state).
 */
export function solveRig(a: ActorDraw, pose: Pose, x: number, z: number, yaw: number, groundY: number, out: RigOut): void {
  if (pose.hidden) {
    hideRig(out);
    return;
  }
  out.hidden = false;
  const B = out.bones;
  // Root: position, yaw, stride offset, then whole-body pitch about the hips (dives, slides).
  const R = tmp.root;
  R.makeTranslation(x, groundY + pose.rootY, z);
  R.multiply(_m.makeRotationY(yaw));
  if (pose.rootZ) R.multiply(_m.makeTranslation(0, 0, pose.rootZ));
  if (pose.rootPitch) {
    R.multiply(_m.makeTranslation(0, pose.hipH, 0));
    R.multiply(_m.makeRotationX(pose.rootPitch));
    R.multiply(_m.makeTranslation(0, -pose.hipH, 0));
  }
  tmp.rootQ.setFromRotationMatrix(R);
  // The trunk turns and bends progressively from the pelvis up to the chest.
  // Sideways shift and lean move the trunk only: hands and feet stay on their targets.
  const P = tmp.pelvis.copy(R).multiply(_m.makeTranslation(pose.sway, pose.hipH, 0));
  if (pose.roll) P.multiply(_m.makeRotationZ(-pose.roll));
  const pelvis = B[BONE.pelvis].copy(P).multiply(_m.makeRotationY(pose.twist * PELVIS_TWIST)).multiply(_m2.makeRotationX(pose.lean * PELVIS_LEAN));
  B[BONE.spine].copy(P).multiply(_m.makeRotationY(pose.twist * SPINE_TWIST)).multiply(_m2.makeRotationX(pose.lean * SPINE_LEAN));
  const T = tmp.torso.copy(P).multiply(_m.makeRotationY(pose.twist)).multiply(_m2.makeRotationX(pose.lean));
  B[BONE.chest].copy(T);
  out.center.setFromMatrixPosition(P);
  T.extractBasis(tmp.tx, tmp.ty, tmp.tz);

  // Head: looks where the pose says (root frame), as far as the neck allows.
  tmp.chestQ.setFromRotationMatrix(T);
  tmp.headQ.copy(tmp.rootQ).multiply(_q.setFromAxisAngle(_up, pose.headYaw)).multiply(_q2.setFromAxisAngle(_right, pose.headPitch));
  const turn = tmp.chestQ.angleTo(tmp.headQ);
  _q.copy(tmp.chestQ).slerp(tmp.headQ, turn > NECK_LIMIT ? NECK_LIMIT / turn : 1);
  tmp.at.set(0, DIM.headY, 0).applyMatrix4(T);
  B[BONE.head].compose(tmp.at, _q, _one);
  _q2.copy(tmp.chestQ).slerp(_q, 0.5);
  tmp.at.set(0, DIM.neckY, DIM.neckZ).applyMatrix4(T);
  B[BONE.neck].compose(tmp.at, _q2, _one);

  // Arms (index 0 = left, 1 = right).
  const gloved = a.kind === "fielder" || a.kind === "pitcher" || a.kind === "catcher";
  const gloveSide = a.hand === "R" ? 0 : 1;
  // A righty's back (top) hand on the bat is his right.
  const batBack = a.hand === "R" ? 1 : 0;
  if (pose.hasBat) tmp.dir.copy(pose.batDir).transformDirection(R);
  for (let i = 0; i < 2; i += 1) {
    const side = SIDES[i];
    const sh = tmp.sh.set(side * DIM.shoulderX, DIM.shoulderY, 0).applyMatrix4(T);
    tmp.target.copy(i === 0 ? pose.handL : pose.handR).applyMatrix4(R);
    // Elbows point down, out and back; a cocked arm carries its elbow up and out.
    const up = i === 0 ? pose.elbowL : pose.elbowR;
    if (pose.hasBat && !gloved) {
      // On the bat: the back elbow hangs down and a little back (higher for a high-elbow
      // hitter); the front elbow points down in front of the chest, the arm across it.
      if (i === batBack) tmp.pole.set(side * (0.45 + 0.35 * up), -1 + 0.9 * up, -0.45);
      else tmp.pole.set(side * 0.2, -1, 0.5);
      tmp.pole.transformDirection(T);
    } else tmp.pole.set(side * (0.6 + 0.5 * up), -1 + 2.1 * up, -0.8).transformDirection(T);
    ik(sh, tmp.target, DIM.upperArm, DIM.foreArm, tmp.pole, -1, tmp.mid, tmp.end, tmp.axis);
    limbFrame(B[ARM[i]], sh, tmp.mid, tmp.axis);
    limbFrame(B[ARM[i] + 1], tmp.mid, tmp.end, tmp.axis);
    const y = tmp.y.subVectors(tmp.mid, tmp.end).normalize();
    const hand = B[ARM[i] + 2];
    if (gloved && i === gloveSide) {
      // The glove's fingers cock up from the forearm; its pocket faces forward and a little inward.
      y.addScaledVector(tmp.ty, -Math.max(-0.9, Math.min(0.9, pose.gloveUp))).normalize();
      tmp.ref.copy(tmp.tz).addScaledVector(tmp.tx, -0.5 * side);
      handFrame(hand, tmp.end, y, tmp.ref);
      out.gloveHand.copy(tmp.end).addScaledVector(y, -GLOVE_POCKET_Y).addScaledVector(_fz, GLOVE_POCKET_Z);
    } else {
      if (i !== gloveSide) out.throwHand.copy(tmp.end);
      else out.gloveHand.copy(tmp.end);
      // Palms face in toward the body.
      tmp.ref.copy(tmp.tx).multiplyScalar(-side).addScaledVector(tmp.tz, 0.25);
      if (pose.hasBat) {
        // Fingers wrap the handle: the bat runs across the palm, along the hand's X axis.
        _fx.copy(tmp.dir).addScaledVector(y, -tmp.dir.dot(y));
        if (_fx.lengthSq() > 0.01) {
          _fx.normalize();
          _fz.crossVectors(_fx, y);
          if (_fz.dot(tmp.ref) < 0) {
            _fx.negate();
            _fz.negate();
          }
          hand.makeBasis(_fx, y, _fz).setPosition(tmp.end);
          continue;
        }
      }
      handFrame(hand, tmp.end, y, tmp.ref);
    }
  }

  // Legs: knees point forward; a lifted foot points its toes down.
  const flat = 1 - Math.min(1, Math.abs(pose.rootPitch) * 2);
  for (let i = 0; i < 2; i += 1) {
    const side = SIDES[i];
    const foot = i === 0 ? pose.footL : pose.footR;
    const hip = tmp.hip.set(side * DIM.hipX, DIM.hipY, 0).applyMatrix4(pelvis);
    tmp.target.copy(foot).applyMatrix4(R);
    tmp.pole.set(side * 0.12, 0.2, 1).transformDirection(R);
    ik(hip, tmp.target, DIM.thigh, DIM.shin, tmp.pole, 1, tmp.mid, tmp.end, tmp.axis);
    limbFrame(B[LEG[i]], hip, tmp.mid, tmp.axis);
    limbFrame(B[LEG[i] + 1], tmp.mid, tmp.end, tmp.axis);
    const toes = Math.min(1.2, Math.max(0, Math.min(0.95, (foot.y - GROUND) * 0.6)) * flat + (i === 0 ? pose.toeL : pose.toeR));
    _q.copy(tmp.rootQ).multiply(_q2.setFromAxisAngle(_up, side * 0.16));
    if (toes > 0) _q.multiply(_q2.setFromAxisAngle(_right, toes));
    B[LEG[i] + 2].compose(tmp.end, _q, _one);
  }

  if (pose.hasBat) {
    tmp.at.copy(pose.batAt).applyMatrix4(R);
    _q.setFromUnitVectors(_up, tmp.dir);
    // Bat geometry has its handle at the origin and extends +Y.
    out.bat.compose(tmp.at, _q, _one);
    out.hasBat = true;
  } else out.hasBat = false;
}

/** Height of the playing surface (the mound is the only relief on the field). */
export function groundY(x: number, z: number): number {
  const r = Math.hypot(x, z - 60.5);
  if (r >= 9) return 0;
  return 0.03 + 0.83 * Math.min(1, (9 - r) / 7.8);
}
