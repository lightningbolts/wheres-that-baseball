/**
 * Procedural humanoid rig. A pose is authored as hand/foot targets in the actor's
 * root frame (origin on the ground, +Z forward, +X = the actor's left); two-bone
 * IK turns that into limb segments. Every body part is one InstancedMesh, so the
 * whole cast of ~18 players costs a dozen draw calls.
 *
 * Poses are written into caller-owned objects (nothing is allocated per frame),
 * keyframes are interpolated with monotone cubic splines (no stop-and-go at every
 * key), and all poses are authored right-handed and mirrored for lefties.
 */
import * as THREE from "three";
import type { ActorState } from "@/lib/game/anim/timeline";
import type { FieldPos } from "@/lib/game/types";

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
  /** Umpire: strike-call gesture 0..1. */
  call: number;
}

export function newPoseCtx(): PoseCtx {
  return { time: 0, phase: 0, speed: 0, x: 0, z: 0, yaw: 0, groundY: 0, hasTarget: false, tx: 0, ty: 0, tz: 0, targetW: 0, hold: 0, swingDur: 0.15, call: 0 };
}

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth = (t: number) => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};

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
  };
}

export function copyPose(dst: Pose, src: Pose): Pose {
  dst.hipH = src.hipH;
  dst.lean = src.lean;
  dst.twist = src.twist;
  dst.rootPitch = src.rootPitch;
  dst.rootY = src.rootY;
  dst.rootZ = src.rootZ;
  dst.handL.copy(src.handL);
  dst.handR.copy(src.handR);
  dst.footL.copy(src.footL);
  dst.footR.copy(src.footR);
  dst.hasBat = src.hasBat;
  dst.batAt.copy(src.batAt);
  dst.batDir.copy(src.batDir);
  dst.hidden = src.hidden;
  return dst;
}

/** out = a → b at t. `out` may alias either input. The bat belongs to the target pose. */
export function lerpPose(out: Pose, a: Pose, b: Pose, t: number): Pose {
  const bothBat = a.hasBat && b.hasBat;
  out.hipH = lerp(a.hipH, b.hipH, t);
  out.lean = lerp(a.lean, b.lean, t);
  out.twist = lerp(a.twist, b.twist, t);
  out.rootPitch = lerp(a.rootPitch, b.rootPitch, t);
  out.rootY = lerp(a.rootY, b.rootY, t);
  out.rootZ = lerp(a.rootZ, b.rootZ, t);
  out.handL.lerpVectors(a.handL, b.handL, t);
  out.handR.lerpVectors(a.handR, b.handR, t);
  out.footL.lerpVectors(a.footL, b.footL, t);
  out.footR.lerpVectors(a.footR, b.footR, t);
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
export const cycleLen = (speed: number) => 4.5 + 0.3 * Math.min(32, Math.max(0, speed));

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

// Throw: 0 gather · 0.18 cocked · 0.3 release · 0.8 recovered.
const THROW = {
  hipH: tab1([[0, 2.7], [0.18, 2.6], [0.3, 2.55], [0.5, 2.5], [0.8, 2.55]]),
  lean: tab1([[0, 0.12], [0.18, -0.02], [0.3, 0.42], [0.5, 0.55], [0.8, 0.35]]),
  twist: tab1([[0, -0.3], [0.18, -0.95], [0.3, 0.45], [0.5, 0.8], [0.8, 0.1]]),
  footL: tab3([[0, 0.45, GROUND, 0.1], [0.16, 0.4, 0.55, 1.1], [0.26, 0.4, GROUND, 1.9], [0.8, 0.4, GROUND, 1.9]]),
  footR: tab3([[0, -0.45, GROUND, -0.3], [0.3, -0.45, GROUND, -0.4], [0.5, -0.6, 0.5, 0.3], [0.7, -0.8, GROUND, 0.9], [0.8, -0.8, GROUND, 0.9]]),
  handR: tab3([[0, -0.2, 4.1, 0.8], [0.18, -1.35, 4.9, -1.0], [0.3, -0.5, 5.9, 1.5], [0.46, 0.65, 2.9, 1.6], [0.8, -0.4, 2.8, 1.1]]),
  handL: tab3([[0, 0.2, 4.1, 0.85], [0.18, 1.0, 4.6, 1.2], [0.32, 0.85, 3.5, 0.3], [0.8, 0.5, 2.8, 1.0]]),
};

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
const SLIDE_K = tab1([[0, 0], [0.22, 1], [0.6, 1], [0.95, 0]]);

// Swing (RHB), keyed on progress: 0 loaded · 0.5 contact · 1 finish. `handle` is the bat's handle.
const SWING = {
  hipH: tab1([[0, 2.66], [0.5, 2.58], [1, 2.72]]),
  lean: tab1([[0, 0.3], [0.5, 0.28], [1, 0.14]]),
  twist: tab1([[0, -0.45], [0.5, 0.85], [1, 1.75]]),
  footR: tab3([[0, -1.05, GROUND, 0], [0.5, -0.95, 0.2, 0.1], [1, -0.8, 0.3, 0.15]]),
  handle: tab3([[0, -0.8, 4.25, 0.35], [0.3, -0.5, 3.75, 0.8], [0.5, 0.25, 3.1, 1.4], [0.75, 1.0, 3.6, 0.9], [1, 0.85, 4.7, -0.35]]),
  az: tab1([[0, -2.5], [0.3, -2.0], [0.5, 0.15], [0.75, 1.7], [1, 3.5]]),
  el: tab1([[0, 1.0], [0.3, 0.45], [0.5, -0.12], [0.75, 0.2], [1, 0.55]]),
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
    const v = (u - stance) / (1 - stance);
    out.set(side * 0.33, GROUND + lift * Math.sin(Math.PI * v), -amp * Math.cos(Math.PI * v));
  }
}

const TAU = Math.PI * 2;
const frac = (x: number) => x - Math.floor(x);

/** Standing ↔ walking ↔ sprinting, blended continuously by speed. */
function locoPose(p: Pose, a: ActorDraw, c: PoseCtx) {
  const athletic = a.kind === "fielder" || a.kind === "catcher";
  const bob = Math.sin(c.time * 2.1 + a.key.length * 1.7) * 0.03;
  // Standing base.
  if (athletic) {
    p.hipH = 2.45 + bob;
    p.lean = 0.42;
    p.footL.set(0.95, GROUND, 0);
    p.footR.set(-0.95, GROUND, 0);
    p.handL.set(0.5, 2.6, 1.15);
    p.handR.set(-0.5, 2.6, 1.15);
  } else {
    p.hipH = 2.75 + bob * 0.6;
    p.lean = 0.18;
    p.footL.set(0.6, GROUND, 0);
    p.footR.set(-0.6, GROUND, 0);
    p.handL.set(0.75, 2.75, 0.45);
    p.handR.set(-0.75, 2.75, 0.45);
  }
  const w = smooth((c.speed - 0.6) / 5.4);
  if (w <= 0) return;
  const sp = Math.min(32, c.speed);
  const stance = 0.6 - 0.22 * clamp01(sp / 24);
  const amp = Math.min(1.75, (stance * cycleLen(sp)) / 2);
  const lift = Math.min(1.25, 0.3 + 0.04 * sp);
  const u = frac(c.phase / TAU);
  const cs = Math.cos(c.phase);
  const armA = Math.min(1.0, 0.3 + 0.03 * sp);
  p.hipH = lerp(p.hipH, 2.8 + 0.06 * Math.cos(2 * c.phase), w);
  p.lean = lerp(p.lean, 0.1 + Math.min(0.24, sp * 0.009), w);
  p.twist = 0.2 * cs * w;
  footCycle(_t, 1, u, stance, amp, lift);
  p.footL.lerp(_t, w);
  footCycle(_t, -1, frac(u + 0.5), stance, amp, lift);
  p.footR.lerp(_t, w);
  p.handL.lerp(_t.set(0.72, 3.8 - 0.35 * cs, 0.35 - armA * cs), w);
  p.handR.lerp(_t.set(-0.72, 3.8 + 0.35 * cs, 0.35 + armA * cs), w);
}

function stanceInto(p: Pose, tau: number, time: number) {
  // Load as the pitch is delivered, relax again if the ball goes by.
  const L = smooth((tau + 0.2) / 0.45) * (1 - smooth((tau - 0.85) / 0.5));
  const still = 1 - L;
  standing(p);
  p.hipH = 2.7 - 0.04 * L + Math.sin(time * 1.7) * 0.02 * still;
  p.lean = 0.3;
  p.twist = -0.3 - 0.15 * L;
  p.footL.set(1.15 + 0.35 * L, GROUND + 0.3 * Math.sin(Math.PI * L), 0.05 * L);
  p.footR.set(-1.05, GROUND, 0);
  const waggle = Math.sin(time * 2.4) * 0.12 * still;
  sample3(_h, SWING.handle, 0);
  _h.lerpVectors(_t.set(-0.55, 4.4, 0.45), _h, L);
  batDir(_dir, lerp(-2.5 + waggle, sample1(SWING.az, 0), L), lerp(1.05 + waggle * 0.3, sample1(SWING.el, 0), L));
  gripBat(p, _h, _dir);
}

function swingInto(p: Pose, t: number, c: PoseCtx, flip: number, time: number) {
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
  p.hipH = sample1(SWING.hipH, prog);
  p.lean = sample1(SWING.lean, prog);
  p.twist = sample1(SWING.twist, prog);
  p.footL.set(1.5, GROUND, 0.05);
  sample3(p.footR, SWING.footR, prog);
  sample3(_h, SWING.handle, prog);
  batDir(_dir, sample1(SWING.az, prog), sample1(SWING.el, prog));
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
  const rec = smooth((t - D - F - 0.15) / 0.45);
  if (rec > 0) {
    stanceInto(_stance, -10, time);
    lerpPose(p, p, _stance, rec);
  }
}

function mirror(p: Pose) {
  p.twist = -p.twist;
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
  standing(p);
  switch (cls) {
    case "gone":
      p.hidden = true;
      return p;
    case "loco":
      locoPose(p, a, c);
      break;
    case "crouch": {
      p.footL.set(0.95, GROUND, 0.25);
      p.footR.set(-0.95, GROUND, 0.25);
      if (a.kind === "umpire") {
        const k = c.call;
        p.hipH = lerp(2.1, 2.9, k);
        p.lean = lerp(0.55, 0.08, k);
        p.twist = 0.3 * k;
        p.handL.set(0.5, lerp(2.3, 2.9, k), 0.75);
        p.handR.set(lerp(-0.5, -1.0, k), lerp(2.3, 5.4, k), lerp(0.75, 0.6, k));
      } else {
        p.hipH = 1.35;
        p.lean = 0.3;
        p.handL.set(0.3, 2.4, 1.5);
        p.handR.set(-0.6, 1.6, 0.3);
        if (c.hasTarget && c.targetW > 0) {
          localTarget(_t, c, 0, flip);
          p.handL.lerp(_t, c.targetW);
          p.hipH += 0.25 * c.targetW * clamp01((_t.y - 3) / 2);
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
      p.hipH = sample1(THROW.hipH, t);
      p.lean = sample1(THROW.lean, t);
      p.twist = sample1(THROW.twist, t);
      sample3(p.footL, THROW.footL, t);
      sample3(p.footR, THROW.footR, t);
      sample3(p.handR, THROW.handR, t);
      sample3(p.handL, THROW.handL, t);
      break;
    }
    case "catch": {
      const hold = c.hold;
      p.hipH = 2.8;
      p.lean = 0.06;
      p.footL.set(0.55, GROUND, 0.3);
      p.footR.set(-0.55, GROUND, -0.2);
      p.handL.set(lerp(0.45, 0.2, hold), lerp(4.7, 3.9, hold), lerp(1.3, 0.85, hold));
      p.handR.set(lerp(-0.2, -0.1, hold), lerp(4.3, 3.8, hold), lerp(1.15, 0.9, hold));
      const w = c.hasTarget ? c.targetW * (1 - hold) : 0;
      if (w > 0) {
        localTarget(_t, c, 0, flip);
        const low = clamp01((3.2 - _t.y) / 2.5) * w;
        p.hipH -= 0.55 * low;
        p.lean += 0.4 * low;
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
      if (w > 0) {
        localTarget(_t, c, 0, flip);
        _t.y = Math.max(0.2, _t.y);
        p.handL.lerp(_t, w);
        p.handR.lerp(_t.add(_d.set(-0.35, 0.2, -0.1)), w * 0.7);
      }
      break;
    }
    case "dive": {
      p.hipH = sample1(DIVE.hipH, t);
      p.rootPitch = sample1(DIVE.pitch, t);
      p.lean = 0;
      p.handL.set(0.3, p.hipH + 3.75, 0.25);
      p.handR.set(-0.4, p.hipH + 3.2, 0.3);
      p.footL.set(0.35, p.hipH - 2.75, -0.25);
      p.footR.set(-0.35, p.hipH - 2.6, -0.5);
      break;
    }
    case "slide": {
      const k = sample1(SLIDE_K, t);
      p.rootPitch = -1.25 * k;
      p.hipH = lerp(2.7, 0.85, k);
      p.lean = lerp(0.2, 0.55, k);
      p.footL.lerp(_t.set(0.3, p.hipH - 2.8, 0.1), k);
      p.footR.lerp(_t.set(-0.3, p.hipH - 1.9, 0.9), k);
      p.handL.lerp(_t.set(0.9, p.hipH + 2.6, 0.9), k);
      p.handR.lerp(_t.set(-0.9, p.hipH + 2.9, 0.7), k);
      break;
    }
    case "bat":
      stanceInto(p, t, c.time);
      break;
    case "swing":
      swingInto(p, t, c, flip, c.time);
      break;
    case "idle":
    default: {
      p.hipH = 3.0 + Math.sin(c.time * 1.3 + a.key.length) * 0.015;
      if (a.kind === "coach") {
        p.handL.set(0.62, 3.25, 0.1);
        p.handR.set(-0.62, 3.25, 0.1);
      }
      break;
    }
  }
  if (lefty) mirror(p);
  return p;
}

// ---------- Matrices ----------

export const PART_LEN = { upperArm: 1.0, foreArm: 0.98, thigh: 1.48, shin: 1.45 };
const SHOULDER_Y = 1.62;
const SHOULDER_X = 0.66;
const HIP_X = 0.3;
const TORSO_H = 1.85;

const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _one = new THREE.Vector3(1, 1, 1);

export interface RigOut {
  torso: THREE.Matrix4;
  pelvis: THREE.Matrix4;
  head: THREE.Matrix4;
  upperArm: [THREE.Matrix4, THREE.Matrix4];
  foreArm: [THREE.Matrix4, THREE.Matrix4];
  thigh: [THREE.Matrix4, THREE.Matrix4];
  shin: [THREE.Matrix4, THREE.Matrix4];
  foot: [THREE.Matrix4, THREE.Matrix4];
  glove: THREE.Matrix4;
  bat: THREE.Matrix4;
  hasBat: boolean;
  /** World positions of the glove hand and the throwing hand. */
  gloveHand: THREE.Vector3;
  throwHand: THREE.Vector3;
}

export function newRigOut(): RigOut {
  const M = () => new THREE.Matrix4();
  return {
    torso: M(),
    pelvis: M(),
    head: M(),
    upperArm: [M(), M()],
    foreArm: [M(), M()],
    thigh: [M(), M()],
    shin: [M(), M()],
    foot: [M(), M()],
    glove: M(),
    bat: M(),
    hasBat: false,
    gloveHand: new THREE.Vector3(),
    throwHand: new THREE.Vector3(),
  };
}

/** Segment matrix: a Y-aligned unit-centered mesh stretched from A to B (length fixed by geometry). */
function segment(out: THREE.Matrix4, a: THREE.Vector3, b: THREE.Vector3) {
  _v.subVectors(b, a);
  const l = _v.length() || 1;
  _q.setFromUnitVectors(_up, _v.multiplyScalar(1 / l));
  _v.addVectors(a, b).multiplyScalar(0.5);
  out.compose(_v, _q, _one);
}

const _ikD = new THREE.Vector3();
const _ikP = new THREE.Vector3();

/** Two-bone IK: writes the elbow/knee and the (reach-clamped) end position. */
function ik(s: THREE.Vector3, target: THREE.Vector3, a: number, b: number, pole: THREE.Vector3, outMid: THREE.Vector3, outEnd: THREE.Vector3) {
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
  if (perp.lengthSq() < 1e-6) perp.set(0, 0, 1);
  perp.normalize();
  outMid.copy(s).addScaledVector(d, a * cosA).addScaledVector(perp, a * sinA);
  outEnd.copy(s).addScaledVector(d, dist);
}

const tmp = {
  root: new THREE.Matrix4(),
  pelvis: new THREE.Matrix4(),
  torso: new THREE.Matrix4(),
  sh: [new THREE.Vector3(), new THREE.Vector3()],
  hip: [new THREE.Vector3(), new THREE.Vector3()],
  mid: new THREE.Vector3(),
  end: new THREE.Vector3(),
  target: new THREE.Vector3(),
  pole: new THREE.Vector3(),
  rootQ: new THREE.Quaternion(),
  at: new THREE.Vector3(),
  dir: new THREE.Vector3(),
};

const HIDE = new THREE.Matrix4().makeScale(0, 0, 0);
const SIDES = [1, -1];

export function hideRig(out: RigOut): void {
  out.torso.copy(HIDE);
  out.pelvis.copy(HIDE);
  out.head.copy(HIDE);
  out.glove.copy(HIDE);
  for (let i = 0; i < 2; i += 1) {
    out.upperArm[i].copy(HIDE);
    out.foreArm[i].copy(HIDE);
    out.thigh[i].copy(HIDE);
    out.shin[i].copy(HIDE);
    out.foot[i].copy(HIDE);
  }
  out.hasBat = false;
}

/**
 * Pose → world matrices, with the actor standing at (x, groundY, z) facing `yaw`
 * (the renderer's smoothed transform, not necessarily the raw timeline state).
 */
export function solveRig(a: ActorDraw, pose: Pose, x: number, z: number, yaw: number, groundY: number, out: RigOut): void {
  if (pose.hidden) {
    hideRig(out);
    return;
  }
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
  const P = tmp.pelvis.copy(R).multiply(_m.makeTranslation(0, pose.hipH, 0));
  out.pelvis.copy(P).multiply(_m.makeTranslation(0, 0.1, 0));
  const T = tmp.torso.copy(P).multiply(_m.makeRotationY(pose.twist)).multiply(_m2.makeRotationX(pose.lean));
  out.torso.copy(T).multiply(_m.makeTranslation(0, TORSO_H / 2 + 0.2, 0));
  out.head.copy(T).multiply(_m.makeTranslation(0, TORSO_H + 0.62, 0.02));

  // Arms (index 0 = left, 1 = right).
  const gloveSide = a.hand === "R" ? 0 : 1;
  for (let i = 0; i < 2; i += 1) {
    const sh = tmp.sh[i].set(SIDES[i] * SHOULDER_X, SHOULDER_Y + 0.2, 0).applyMatrix4(T);
    tmp.target.copy(i === 0 ? pose.handL : pose.handR).applyMatrix4(R);
    // Elbows point down, out and back.
    tmp.pole.set(SIDES[i] * 0.6, -1, -0.8).transformDirection(T);
    ik(sh, tmp.target, PART_LEN.upperArm, PART_LEN.foreArm, tmp.pole, tmp.mid, tmp.end);
    segment(out.upperArm[i], sh, tmp.mid);
    segment(out.foreArm[i], tmp.mid, tmp.end);
    if (i === gloveSide) {
      out.gloveHand.copy(tmp.end);
      out.glove.compose(tmp.end, _q.setFromRotationMatrix(_m.extractRotation(T)), _one);
    } else out.throwHand.copy(tmp.end);
  }
  // Legs: knees point forward.
  tmp.rootQ.setFromRotationMatrix(_m.extractRotation(R));
  for (let i = 0; i < 2; i += 1) {
    const hip = tmp.hip[i].set(SIDES[i] * HIP_X, -0.05, 0).applyMatrix4(P);
    tmp.target.copy(i === 0 ? pose.footL : pose.footR).applyMatrix4(R);
    tmp.pole.set(0, 0.2, 1).transformDirection(R);
    ik(hip, tmp.target, PART_LEN.thigh, PART_LEN.shin, tmp.pole, tmp.mid, tmp.end);
    segment(out.thigh[i], hip, tmp.mid);
    segment(out.shin[i], tmp.mid, tmp.end);
    out.foot[i].compose(tmp.end, tmp.rootQ, _one);
  }
  if (pose.hasBat) {
    tmp.at.copy(pose.batAt).applyMatrix4(R);
    tmp.dir.copy(pose.batDir).transformDirection(R);
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
