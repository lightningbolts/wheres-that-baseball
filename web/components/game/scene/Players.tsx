"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  blendTime,
  copyPose,
  cycleLen,
  groundY,
  hideRig,
  lerpPose,
  newPose,
  newPoseCtx,
  newRigOut,
  poseClass,
  poseInto,
  smooth,
  solveRig,
  type ActorDraw,
  type Pose,
  type PoseClass,
  type RigOut,
} from "@/components/game/scene/rig";
import { MAX_FRAME_DT, actorsAt, type Playback } from "@/components/game/scene/playback";
import type { BallState, Timeline } from "@/lib/game/anim/timeline";

const MAX = 20;

/** Per-actor animation memory: smoothed transform, pose cross-fade and run cycle. */
interface Anim {
  cls: PoseClass;
  pose: Pose;
  from: Pose;
  blend: number;
  dur: number;
  yaw: number;
  /** Last raw track position, and the glide offset that hides track discontinuities. */
  rx: number;
  rz: number;
  ox: number;
  oz: number;
  speed: number;
  phase: number;
  hold: number;
  toHand: number;
  gy: number;
  seen: number;
}

function newAnim(): Anim {
  return { cls: "idle", pose: newPose(), from: newPose(), blend: 0, dur: 0, yaw: 0, rx: 0, rz: 0, ox: 0, oz: 0, speed: 0, phase: 0, hold: 0, toHand: 0, gy: 0, seen: -10 };
}

const TAU = Math.PI * 2;
function angDiff(to: number, from: number): number {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

const ctx = newPoseCtx();
const target = newPose();

/** Aim the pose solver at whatever this actor is reaching for (release point, ball, mitt target, swing aim). */
function setTarget(a: ActorDraw, cls: PoseClass, tl: Timeline | null, ball: BallState | null, T: number, x: number, z: number) {
  ctx.hasTarget = false;
  ctx.targetW = 0;
  if (!tl) return;
  let p: { x: number; y: number; z: number } | null = null;
  if (cls === "pitch") {
    p = tl.releaseP;
    ctx.targetW = 1;
  } else if (cls === "swing" && tl.swing) {
    p = tl.swing.aim;
    ctx.targetW = 1;
    ctx.swingDur = tl.swing.contactT - tl.swing.startT;
  } else if (cls === "crouch" && a.kind === "catcher") {
    // The mitt travels to the spot as the pitch comes in, holds, then relaxes.
    const r = tl.receive;
    const lead = tl.releaseT + 0.12;
    let w = smooth((T - lead) / Math.max(0.05, r.t - lead - 0.03));
    const done = tl.contactT != null && tl.contactT < r.t ? tl.contactT : r.t + 0.45;
    w *= 1 - smooth((T - done) / 0.4);
    p = r.p;
    ctx.targetW = w;
  } else if ((cls === "catch" || cls === "field") && ball && ball.visible && !ball.held) {
    const d = Math.hypot(ball.p.x - x, ball.p.z - z, ball.p.y - 3.5);
    p = ball.p;
    ctx.targetW = cls === "catch" ? smooth(1 - (d - 2.5) / 9) : smooth(1 - (d - 1.5) / 5);
  }
  if (!p) return;
  ctx.hasTarget = true;
  ctx.tx = p.x;
  ctx.ty = p.y;
  ctx.tz = p.z;
}

type PartKey = "torso" | "pelvis" | "head" | "cap" | "upperArm" | "foreArm" | "thigh" | "shin" | "foot" | "glove" | "bat";
const PAIRED = ["upperArm", "foreArm", "thigh", "shin", "foot"] as const;
const isPaired = (k: PartKey) => (PAIRED as readonly string[]).includes(k);
const PART_KEYS: PartKey[] = ["torso", "pelvis", "head", "cap", "upperArm", "foreArm", "thigh", "shin", "foot", "glove", "bat"];

function buildGeometries(): Record<PartKey, THREE.BufferGeometry> {
  const torso = new THREE.CylinderGeometry(0.64, 0.5, 1.85, 12, 1);
  torso.scale(1, 1, 0.62);
  const pelvis = new THREE.CylinderGeometry(0.52, 0.46, 0.6, 12, 1);
  pelvis.scale(1, 1, 0.7);
  const head = new THREE.SphereGeometry(0.36, 14, 10);
  const dome = new THREE.SphereGeometry(0.39, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2);
  dome.translate(0, 0.04, 0);
  const brim = new THREE.CylinderGeometry(0.3, 0.3, 0.04, 14, 1);
  brim.scale(1, 1, 1.15);
  brim.translate(0, 0.05, 0.3);
  const cap = mergeGeometries([dome.toNonIndexed(), brim.toNonIndexed()]) ?? dome;
  dome.dispose();
  brim.dispose();
  const upperArm = new THREE.CylinderGeometry(0.17, 0.14, 1.0, 8, 1);
  const foreArm = new THREE.CylinderGeometry(0.13, 0.1, 0.98, 8, 1);
  const thigh = new THREE.CylinderGeometry(0.25, 0.18, 1.48, 8, 1);
  const shin = new THREE.CylinderGeometry(0.17, 0.12, 1.45, 8, 1);
  const foot = new THREE.BoxGeometry(0.34, 0.2, 0.78);
  foot.translate(0, -0.03, 0.2);
  const glove = new THREE.SphereGeometry(0.3, 8, 6);
  glove.scale(1, 1.2, 0.55);
  const bat = new THREE.CylinderGeometry(0.11, 0.045, 2.8, 8, 1);
  bat.translate(0, 1.0, 0);
  return { torso, pelvis, head, cap, upperArm, foreArm, thigh, shin, foot, glove, bat };
}

const SHOE = new THREE.Color("#141414");
const GLOVE = new THREE.Color("#7a4a22");
const BAT = new THREE.Color("#c9a26a");
const PANTS_DARKEN = 0.92;

/**
 * Every on-field person, drawn as instanced body parts. One InstancedMesh per part
 * type (11 draw calls total, plus shadows).
 */
export function Players({ pb }: { pb: Playback }) {
  const geos = useMemo(() => buildGeometries(), []);
  const mats = useMemo(() => {
    const m = () => new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0 });
    return { body: m(), skin: m(), dark: m() };
  }, []);
  useEffect(
    () => () => {
      Object.values(geos).forEach((g) => g.dispose());
      Object.values(mats).forEach((m) => m.dispose());
    },
    [geos, mats],
  );

  const refs = useRef<Partial<Record<PartKey, THREE.InstancedMesh | null>>>({});
  const rigs = useMemo(() => Array.from({ length: MAX }, () => newRigOut()), []);
  const anims = useRef(new Map<string, Anim>());
  const lastCut = useRef(-1);
  const color = useMemo(() => new THREE.Color(), []);
  const hide = useMemo(() => new THREE.Matrix4().makeScale(0, 0, 0), []);

  useFrame((_, rawDt) => {
    const tl = pb.timeline;
    // Animation clock: timeline time while a pitch is playing (so slow-mo, hit-stop and
    // pauses apply to bodies too), real time between pitches.
    const dA = tl ? pb.dT : Math.min(Math.max(rawDt, 0), MAX_FRAME_DT);
    const actors = actorsAt(pb);
    const ball = tl ? tl.ball(pb.T) : null;
    const cut = lastCut.current !== pb.cutSeq;
    lastCut.current = pb.cutSeq;
    const frame = pb.frame;
    const map = anims.current;
    const r = refs.current;
    const n = Math.min(MAX, actors.length);
    ctx.time = pb.now;
    const callAge = pb.fx.umpCallAt < 0 ? -1 : pb.now - pb.fx.umpCallAt;
    for (let i = 0; i < n; i += 1) {
      const a = actors[i];
      const s = a.state;
      const out: RigOut = rigs[i];
      let an = map.get(a.key);
      if (!an) {
        an = newAnim();
        map.set(a.key, an);
      }
      const cls = poseClass(a);
      // Snap (no blending) on a camera cut or when the actor was not on screen last frame.
      let snap = cut || an.seen < frame - 1;
      an.seen = frame;
      if (!snap) {
        const jump = Math.hypot(s.p.x - an.rx, s.p.z - an.rz);
        if (jump > (s.speed + an.speed) * dA + 0.75) {
          // The track itself jumped (timeline swap): glide across small gaps, cut across big ones.
          if (jump < 14) {
            an.ox += an.rx - s.p.x;
            an.oz += an.rz - s.p.z;
          } else snap = true;
        }
      }
      an.rx = s.p.x;
      an.rz = s.p.z;
      let glide = 0;
      if (snap) {
        an.ox = 0;
        an.oz = 0;
        an.yaw = s.yaw;
        an.hold = ball && ball.held && ball.holder === a.pos ? 1 : 0;
        an.toHand = cls === "throw" || cls === "pitch" ? 1 : 0;
      } else {
        const ol = Math.hypot(an.ox, an.oz);
        if (ol > 1e-3) {
          const step = Math.min(ol, ol * (1 - Math.exp(-dA / 0.12)) + 2 * dA, 18 * dA);
          an.ox -= (an.ox / ol) * step;
          an.oz -= (an.oz / ol) * step;
          glide = dA > 1e-5 ? step / dA : 0;
        }
        an.yaw += angDiff(s.yaw, an.yaw) * (1 - Math.exp(-dA / 0.08));
        const holding = ball && ball.held && ball.holder === a.pos ? 1 : 0;
        an.hold += (holding - an.hold) * (1 - Math.exp(-dA / 0.1));
        const inHand = cls === "throw" || cls === "pitch" ? 1 : 0;
        an.toHand += (inHand - an.toHand) * (1 - Math.exp(-dA / 0.07));
      }
      const x = s.p.x + an.ox;
      const z = s.p.z + an.oz;
      const speed = s.speed + glide;
      an.speed = s.speed;
      an.phase = (an.phase + (TAU * speed * dA) / cycleLen(speed)) % TAU;

      ctx.phase = an.phase;
      ctx.speed = speed;
      ctx.x = x;
      ctx.z = z;
      ctx.yaw = an.yaw;
      ctx.groundY = an.gy;
      ctx.hold = an.hold;
      ctx.call = a.kind === "umpire" && callAge >= 0 ? smooth(callAge / 0.14) * (1 - smooth((callAge - 0.75) / 0.35)) : 0;
      setTarget(a, cls, tl, ball, pb.T, x, z);
      poseInto(target, a, cls, ctx);
      if (cls !== an.cls) {
        if (!snap) {
          copyPose(an.from, an.pose);
          an.blend = 0;
          an.dur = blendTime(an.cls, cls);
        }
        an.cls = cls;
      }
      if (snap) an.dur = 0;
      if (an.blend < an.dur) {
        an.blend += dA;
        lerpPose(an.pose, an.from, target, smooth(an.blend / an.dur));
      } else copyPose(an.pose, target);

      const pose = an.pose;
      if (pose.hidden) hideRig(out);
      else {
        const sy = Math.sin(an.yaw);
        const cy = Math.cos(an.yaw);
        an.gy = groundY(x + sy * pose.rootZ, z + cy * pose.rootZ);
        solveRig(a, pose, x, z, an.yaw, an.gy, out);
        let h = pb.hands.get(a.key);
        if (!h) {
          if (pb.hands.size > 200) pb.hands.clear();
          h = { ballP: new THREE.Vector3(), frame: -1 };
          pb.hands.set(a.key, h);
        }
        h.ballP.lerpVectors(out.gloveHand, out.throwHand, an.toHand);
        h.frame = frame;
      }
      r.torso?.setMatrixAt(i, out.torso);
      r.pelvis?.setMatrixAt(i, out.pelvis);
      r.head?.setMatrixAt(i, out.head);
      r.cap?.setMatrixAt(i, out.head);
      r.glove?.setMatrixAt(i, a.kind === "fielder" || a.kind === "pitcher" || a.kind === "catcher" ? out.glove : hide);
      r.bat?.setMatrixAt(i, out.hasBat ? out.bat : hide);
      for (const k of PAIRED) {
        r[k]?.setMatrixAt(i * 2, out[k][0]);
        r[k]?.setMatrixAt(i * 2 + 1, out[k][1]);
      }
      // Colors: jersey top, slightly darker pants, team-color socks & cap.
      r.torso?.setColorAt(i, a.jersey);
      r.pelvis?.setColorAt(i, color.copy(a.jersey).multiplyScalar(PANTS_DARKEN));
      r.head?.setColorAt(i, a.skin);
      r.cap?.setColorAt(i, a.accent);
      r.glove?.setColorAt(i, GLOVE);
      r.bat?.setColorAt(i, BAT);
      for (let side = 0; side < 2; side += 1) {
        r.upperArm?.setColorAt(i * 2 + side, a.jersey);
        r.foreArm?.setColorAt(i * 2 + side, a.kind === "umpire" ? a.jersey : a.skin);
        r.thigh?.setColorAt(i * 2 + side, color.copy(a.jersey).multiplyScalar(PANTS_DARKEN));
        r.shin?.setColorAt(i * 2 + side, a.accent);
        r.foot?.setColorAt(i * 2 + side, SHOE);
      }
    }
    if (map.size > 120) for (const [k, an] of map) if (an.seen < frame - 600) map.delete(k);
    for (const k of PART_KEYS) {
      const mesh = r[k];
      if (!mesh) continue;
      const per = isPaired(k) ? 2 : 1;
      mesh.count = n * per;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  });

  const part = (k: PartKey, mat: THREE.Material, shadow = true) => {
    const per = isPaired(k) ? 2 : 1;
    return (
      <instancedMesh
        key={k}
        ref={(m) => {
          refs.current[k] = m;
          if (m && !m.instanceColor) {
            m.setColorAt(0, new THREE.Color(1, 1, 1));
          }
        }}
        args={[geos[k], mat, MAX * per]}
        castShadow={shadow}
        frustumCulled={false}
      />
    );
  };

  return (
    <group>
      {part("torso", mats.body)}
      {part("pelvis", mats.body)}
      {part("upperArm", mats.body)}
      {part("thigh", mats.body)}
      {part("shin", mats.body)}
      {part("head", mats.skin)}
      {part("foreArm", mats.skin)}
      {part("cap", mats.dark, false)}
      {part("foot", mats.dark, false)}
      {part("glove", mats.dark, false)}
      {part("bat", mats.dark)}
    </group>
  );
}
