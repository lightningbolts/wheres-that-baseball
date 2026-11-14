/**
 * Procedural humanoid rig. A pose is authored as hand/foot targets in the actor's
 * local frame (origin on the ground, +Z forward, +X = the actor's left); two-bone
 * IK turns that into limb segments. Every body part is one InstancedMesh, so the
 * whole cast of ~18 players costs a dozen draw calls.
 */
import * as THREE from "three";
import type { ActorState } from "@/lib/game/anim/timeline";

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
  /** Ball position (world) for catch poses, if near. */
  ball?: THREE.Vector3 | null;
}

export interface Pose {
  hipH: number;
  lean: number;
  twist: number;
  rootPitch: number;
  rootY: number;
  handL: THREE.Vector3;
  handR: THREE.Vector3;
  footL: THREE.Vector3;
  footR: THREE.Vector3;
  /** Bat: handle position (root local) and unit direction (root local), or null. */
  bat: { at: THREE.Vector3; dir: THREE.Vector3 } | null;
  hidden: boolean;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const ease = (t: number) => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};
const lv = (a: THREE.Vector3, b: THREE.Vector3, t: number) => a.clone().lerp(b, clamp01(t));

/** Keyframed vector track: [[t, vec], ...] with smoothstep between keys. */
function keys(t: number, ks: Array<[number, THREE.Vector3]>): THREE.Vector3 {
  if (t <= ks[0][0]) return ks[0][1].clone();
  for (let i = 1; i < ks.length; i += 1) {
    if (t <= ks[i][0]) return lv(ks[i - 1][1], ks[i][1], ease((t - ks[i - 1][0]) / (ks[i][0] - ks[i - 1][0])));
  }
  return ks[ks.length - 1][1].clone();
}
function keysN(t: number, ks: Array<[number, number]>): number {
  if (t <= ks[0][0]) return ks[0][1];
  for (let i = 1; i < ks.length; i += 1) {
    if (t <= ks[i][0]) return lerp(ks[i - 1][1], ks[i][1], ease((t - ks[i - 1][0]) / (ks[i][0] - ks[i - 1][0])));
  }
  return ks[ks.length - 1][1];
}

function standing(): Pose {
  return {
    hipH: 3.0,
    lean: 0.04,
    twist: 0,
    rootPitch: 0,
    rootY: 0,
    handL: V(0.85, 2.85, 0.15),
    handR: V(-0.85, 2.85, 0.15),
    footL: V(0.42, 0.12, 0),
    footR: V(-0.42, 0.12, 0),
    bat: null,
    hidden: false,
  };
}

/** Mirror a right-handed pose for a lefty (swap sides, flip X). */
function mirror(p: Pose): Pose {
  const f = (v: THREE.Vector3) => V(-v.x, v.y, v.z);
  return {
    ...p,
    twist: -p.twist,
    handL: f(p.handR),
    handR: f(p.handL),
    footL: f(p.footR),
    footR: f(p.footL),
    bat: p.bat ? { at: f(p.bat.at), dir: f(p.bat.dir) } : null,
  };
}

export function poseFor(a: ActorDraw, runPhase: number, time: number): Pose {
  const s = a.state;
  const t = s.actionT;
  let p = standing();
  switch (s.action) {
    case "gone":
      p.hidden = true;
      return p;
    case "run": {
      const ph = runPhase;
      const stride = Math.min(1.5, 0.45 + s.speed * 0.04);
      p.hipH = 2.78 - Math.abs(Math.cos(ph)) * 0.08;
      p.lean = 0.22;
      p.footL = V(0.35, 0.12 + Math.max(0, Math.sin(ph + Math.PI / 2)) * 0.9, Math.sin(ph) * stride);
      p.footR = V(-0.35, 0.12 + Math.max(0, Math.sin(ph - Math.PI / 2)) * 0.9, -Math.sin(ph) * stride);
      p.handL = V(0.72, 3.9 + Math.sin(-ph) * 0.3, -Math.sin(ph) * 0.9 + 0.3);
      p.handR = V(-0.72, 3.9 + Math.sin(ph) * 0.3, Math.sin(ph) * 0.9 + 0.3);
      return p;
    }
    case "ready": {
      p.hipH = 2.45;
      p.lean = 0.42;
      p.footL = V(0.95, 0.12, 0);
      p.footR = V(-0.95, 0.12, 0);
      p.handL = V(0.5, 2.6, 1.15);
      p.handR = V(-0.5, 2.6, 1.15);
      // Fielders shuffle a little while waiting.
      p.hipH += Math.sin(time * 2.1 + a.key.length) * 0.03;
      return p;
    }
    case "crouch": {
      p.hipH = a.kind === "umpire" ? 2.1 : 1.35;
      p.lean = a.kind === "umpire" ? 0.55 : 0.3;
      p.footL = V(0.95, 0.12, 0.25);
      p.footR = V(-0.95, 0.12, 0.25);
      if (a.kind === "umpire") {
        p.handL = V(0.35, 3.3, 0.9);
        p.handR = V(-0.35, 3.3, 0.9);
      } else {
        p.handL = V(0.45, 2.3, 1.55);
        p.handR = V(-0.55, 1.75, 0.6);
        if (a.ball) p.handL.copy(a.ball);
      }
      return a.hand === "L" ? mirror(p) : p;
    }
    case "pitch": {
      // RHP: glove side = left. t: 0 set, 0.6 leg lift, 1.0 foot strike, 1.1 release, 1.5 finish.
      p.hipH = keysN(t, [[0, 3.0], [0.6, 3.05], [1.0, 2.35], [1.25, 2.3], [1.5, 2.55]]);
      p.lean = keysN(t, [[0, 0.05], [0.6, -0.05], [1.0, 0.15], [1.12, 0.55], [1.5, 0.75]]);
      p.twist = keysN(t, [[0, 0], [0.6, -0.9], [1.0, -0.7], [1.12, 0.5], [1.5, 0.9]]);
      p.footL = keys(t, [[0, V(0.45, 0.12, 0)], [0.6, V(0.1, 2.1, 0.5)], [1.0, V(0.5, 0.12, 4.2)], [1.5, V(0.5, 0.12, 4.2)]]);
      p.footR = keys(t, [[0, V(-0.45, 0.12, 0)], [1.05, V(-0.4, 0.12, 0.2)], [1.25, V(-0.6, 0.8, 1.3)], [1.5, V(-0.8, 0.12, 3.2)]]);
      p.handR = keys(t, [[0, V(-0.15, 4.0, 0.7)], [0.55, V(-0.1, 4.2, 0.6)], [0.85, V(-1.6, 4.4, -1.0)], [1.0, V(-1.2, 5.6, -0.4)], [1.1, V(-0.45, 6.0, 1.7)], [1.3, V(0.7, 2.5, 1.6)], [1.5, V(0.4, 2.9, 1.0)]]);
      p.handL = keys(t, [[0, V(0.1, 4.0, 0.7)], [0.55, V(0.1, 4.2, 0.6)], [0.85, V(1.2, 4.6, 1.2)], [1.1, V(0.9, 3.4, 0.2)], [1.5, V(0.8, 3.6, 0.6)]]);
      return a.hand === "L" ? mirror(p) : p;
    }
    case "throw": {
      p.hipH = 2.75;
      p.lean = keysN(t, [[0, 0.1], [0.25, 0.0], [0.38, 0.5], [0.55, 0.45]]);
      p.twist = keysN(t, [[0, -0.2], [0.25, -0.8], [0.38, 0.5], [0.55, 0.6]]);
      p.footL = keys(t, [[0, V(0.45, 0.12, 0.2)], [0.25, V(0.5, 0.6, 1.2)], [0.33, V(0.5, 0.12, 2.0)]]);
      p.footR = V(-0.45, 0.12, -0.4);
      p.handR = keys(t, [[0, V(-0.3, 4.2, 0.9)], [0.25, V(-1.4, 5.0, -0.9)], [0.36, V(-0.4, 5.8, 1.4)], [0.55, V(0.6, 3.0, 1.5)]]);
      p.handL = keys(t, [[0, V(0.2, 4.2, 0.9)], [0.25, V(1.0, 4.6, 1.1)], [0.4, V(0.9, 3.6, 0.3)]]);
      return a.hand === "L" ? mirror(p) : p;
    }
    case "catch": {
      p.hipH = 2.85;
      p.lean = 0.05;
      p.footL = V(0.55, 0.12, 0.25);
      p.footR = V(-0.55, 0.12, -0.2);
      p.handL = V(0.35, 4.9, 1.4);
      p.handR = V(-0.25, 4.7, 1.3);
      if (a.ball && a.ball.y > 1.5) {
        p.handL.copy(a.ball);
        p.handR.copy(a.ball).add(V(-0.35, -0.2, -0.1));
      }
      return p;
    }
    case "field": {
      p.hipH = keysN(t, [[0, 2.6], [0.25, 2.0], [0.5, 2.3]]);
      p.lean = keysN(t, [[0, 0.5], [0.25, 1.1], [0.5, 0.6]]);
      p.footL = V(1.0, 0.12, 0.5);
      p.footR = V(-1.0, 0.12, -0.2);
      p.handL = V(0.3, 0.45, 1.9);
      p.handR = V(-0.3, 0.6, 1.8);
      return p;
    }
    case "dive": {
      const k = ease(t / 0.25);
      p.rootPitch = 1.35 * k;
      p.rootY = Math.sin(clamp01(t / 0.45) * Math.PI) * 1.2 + k * 0.6;
      p.hipH = 0.2;
      p.lean = 0;
      p.handL = V(0.35, 5.9, 0.4);
      p.handR = V(-0.35, 5.7, 0.4);
      p.footL = V(0.4, -2.6, -0.6);
      p.footR = V(-0.4, -2.6, -0.2);
      return p;
    }
    case "slide": {
      const k = ease(t / 0.2);
      p.rootPitch = -1.05 * k;
      p.rootY = 0.3 * k;
      p.hipH = lerp(2.7, 0.9, k);
      p.lean = 0.2;
      p.footL = V(0.35, 0.3, 2.6);
      p.footR = V(-0.35, 0.6, 1.6);
      p.handL = V(0.9, 4.7, -0.2);
      p.handR = V(-0.9, 4.7, -0.2);
      return p;
    }
    case "stance":
    case "swing": {
      // Right-handed batter; root faces the plate, left side toward the pitcher (+X).
      p.hipH = 2.7;
      p.lean = 0.32;
      const swing = s.action === "swing";
      // Progress: 0 = load, 0.5 = contact (0.16 s in), 1 = finish.
      const prog = swing ? (t < 0.16 ? (t / 0.16) * 0.5 : 0.5 + clamp01((t - 0.16) / 0.28) * 0.5) : 0;
      const waggle = swing ? 0 : Math.sin(time * 2.4) * 0.12;
      p.twist = keysN(prog, [[0, -0.35], [0.5, 0.75], [1, 1.75]]);
      p.footL = keys(prog, [[0, V(1.25, 0.12, 0)], [0.2, V(1.6, 0.4, 0.05)], [0.4, V(1.75, 0.12, 0.1)]]);
      p.footR = V(-1.0, 0.12, 0);
      const hands = keys(prog, [[0, V(-0.55, 4.75, 0.45)], [0.3, V(-0.45, 4.1, 0.75)], [0.5, V(0.2, 3.4, 1.35)], [0.75, V(0.9, 3.9, 0.9)], [1, V(0.75, 4.9, -0.3)]]);
      p.handR = hands.clone().add(V(0, -0.12, 0));
      p.handL = hands.clone().add(V(0.0, -0.3, 0.05));
      const az = keysN(prog, [[0, -2.5 + waggle], [0.3, -2.1], [0.5, 0.1], [0.75, 1.6], [1, 3.4]]);
      const el = keysN(prog, [[0, 1.05], [0.3, 0.5], [0.5, -0.12], [0.75, 0.2], [1, 0.55]]);
      // Azimuth from +Z toward +X (pitcher side), elevation above horizontal.
      const dir = V(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
      p.bat = { at: hands.clone().add(V(0, -0.35, 0)), dir };
      return a.hand === "L" ? mirror(p) : p;
    }
    case "idle":
    default: {
      if (a.kind === "coach") {
        p.handL = V(0.5, 4.1, 0.5);
        p.handR = V(-0.5, 4.1, 0.5);
      }
      return p;
    }
  }
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
  /** World position of the glove hand (to snap a held ball). */
  gloveHand: THREE.Vector3;
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

/** Two-bone IK: returns the elbow/knee world position. */
function ik(s: THREE.Vector3, target: THREE.Vector3, a: number, b: number, pole: THREE.Vector3, outMid: THREE.Vector3, outEnd: THREE.Vector3) {
  const d = new THREE.Vector3().subVectors(target, s);
  let dist = d.length();
  const max = a + b - 0.02;
  if (dist > max) {
    d.multiplyScalar(max / dist);
    dist = max;
  }
  dist = Math.max(0.15, dist);
  const dh = d.clone().normalize();
  const cosA = Math.min(1, Math.max(-1, (a * a + dist * dist - b * b) / (2 * a * dist)));
  const sinA = Math.sqrt(1 - cosA * cosA);
  const perp = pole.clone().sub(dh.clone().multiplyScalar(pole.dot(dh)));
  if (perp.lengthSq() < 1e-6) perp.set(0, 0, 1);
  perp.normalize();
  outMid.copy(s).addScaledVector(dh, a * cosA).addScaledVector(perp, a * sinA);
  outEnd.copy(s).addScaledVector(dh, dist);
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
};

const HIDE = new THREE.Matrix4().makeScale(0, 0, 0);

export function solveRig(a: ActorDraw, pose: Pose, out: RigOut): void {
  if (pose.hidden) {
    for (const k of ["torso", "pelvis", "head", "glove"] as const) out[k].copy(HIDE);
    for (const k of ["upperArm", "foreArm", "thigh", "shin", "foot"] as const) {
      out[k][0].copy(HIDE);
      out[k][1].copy(HIDE);
    }
    out.hasBat = false;
    return;
  }
  const s = a.state;
  // Root: position, yaw, then whole-body pitch about the hips (dives, slides).
  const R = tmp.root;
  R.makeTranslation(s.p.x, (s.p.y ?? 0) + pose.rootY, s.p.z);
  R.multiply(_m.makeRotationY(s.yaw));
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
  const sides = [1, -1];
  const hands = [pose.handL, pose.handR];
  for (let i = 0; i < 2; i += 1) {
    const sh = tmp.sh[i].set(sides[i] * SHOULDER_X, SHOULDER_Y + 0.2, 0).applyMatrix4(T);
    tmp.target.copy(hands[i]).applyMatrix4(R);
    // Elbows point down, out and back.
    tmp.pole.set(sides[i] * 0.6, -1, -0.8).transformDirection(T);
    ik(sh, tmp.target, PART_LEN.upperArm, PART_LEN.foreArm, tmp.pole, tmp.mid, tmp.end);
    segment(out.upperArm[i], sh, tmp.mid);
    segment(out.foreArm[i], tmp.mid, tmp.end);
    const gloveSide = a.hand === "R" ? 0 : 1;
    if (i === gloveSide) {
      out.gloveHand.copy(tmp.end);
      out.glove.compose(tmp.end, _q.setFromRotationMatrix(_m.extractRotation(T)), _one);
    }
  }
  // Legs: knees point forward.
  const feet = [pose.footL, pose.footR];
  for (let i = 0; i < 2; i += 1) {
    const hip = tmp.hip[i].set(sides[i] * HIP_X, -0.05, 0).applyMatrix4(P);
    tmp.target.copy(feet[i]).applyMatrix4(R);
    tmp.pole.set(0, 0.2, 1).transformDirection(R);
    ik(hip, tmp.target, PART_LEN.thigh, PART_LEN.shin, tmp.pole, tmp.mid, tmp.end);
    segment(out.thigh[i], hip, tmp.mid);
    segment(out.shin[i], tmp.mid, tmp.end);
    tmp.rootQ.setFromRotationMatrix(_m.extractRotation(R));
    out.foot[i].compose(tmp.end, tmp.rootQ, _one);
  }
  if (pose.bat) {
    const at = pose.bat.at.clone().applyMatrix4(R);
    const dir = pose.bat.dir.clone().transformDirection(R);
    _q.setFromUnitVectors(_up, dir);
    // Bat geometry has its handle at the origin and extends +Y.
    out.bat.compose(at, _q, _one);
    out.hasBat = true;
  } else out.hasBat = false;
}
