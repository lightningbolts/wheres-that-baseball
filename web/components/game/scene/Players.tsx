"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
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
import { Person, Wardrobe } from "@/components/game/scene/character/person";
import { hash01 } from "@/components/game/scene/character/paint";
import { BAT_COLORS, batGeometry, batMaterial } from "@/components/game/scene/character/bat";
import { loadRoster } from "@/components/game/scene/character/roster";
import type { BallState, Timeline } from "@/lib/game/anim/timeline";

const MAX = 24;

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

/** Screen-height fractions at which a person switches between the close-up, mid-field and distant models (with hysteresis). */
const LOD_NEAR = 0.12;
const LOD_FAR = 0.09;
const LOD_MID = 0.036;
const LOD_TINY = 0.028;
/** Below this screen-height fraction a person is drawn a little larger than life, so far fielders stay readable. */
const BIG_BELOW = 0.07;
const BIG_MAX = 1.4;
const _big = new THREE.Matrix4();
/** Uniform repaints per frame (each is a canvas redraw and a texture upload). */
const PAINTS_PER_FRAME = 2;

/**
 * Every on-field person: one smooth-skinned mesh each (one draw call, plus its shadow),
 * posed by the rig solver, and one instanced mesh for the bats.
 */
export function Players({ pb }: { pb: Playback }) {
  const kit = useMemo(() => {
    const wardrobe = new Wardrobe();
    const people = Array.from({ length: MAX }, () => new Person(wardrobe));
    const group = new THREE.Group();
    for (const p of people) group.add(p.mesh);
    const batGeo = batGeometry();
    const batMat = batMaterial();
    const bats = new THREE.InstancedMesh(batGeo, batMat, MAX);
    bats.castShadow = true;
    bats.frustumCulled = false;
    bats.count = 0;
    bats.setColorAt(0, BAT_COLORS[0]);
    group.add(bats);
    return { wardrobe, people, group, bats, batGeo, batMat };
  }, []);
  useEffect(() => {
    loadRoster();
    return () => {
      for (const p of kit.people) p.dispose();
      kit.wardrobe.dispose();
      kit.batGeo.dispose();
      kit.batMat.dispose();
      kit.bats.dispose();
    };
  }, [kit]);

  const slots = useRef(new Map<string, number>());
  const rigs = useMemo(() => Array.from({ length: MAX }, () => newRigOut()), []);
  const anims = useRef(new Map<string, Anim>());
  const lastCut = useRef(-1);
  const slotOf = useMemo(() => new Int32Array(MAX), []);

  useFrame((state, rawDt) => {
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
    const n = Math.min(MAX, actors.length);
    const { people, bats } = kit;
    const cam = state.camera;
    const tanHalf = Math.tan((((cam as THREE.PerspectiveCamera).fov ?? 50) * Math.PI) / 360);
    let paints = 0;
    let nBats = 0;
    // Slots: an actor keeps his mesh from frame to frame; newcomers take the longest-idle one.
    const slotMap = slots.current;
    for (let i = 0; i < n; i += 1) {
      const s = slotMap.get(actors[i].key);
      slotOf[i] = s ?? -1;
      if (s !== undefined) people[s].seen = frame;
    }
    for (let i = 0; i < n; i += 1) {
      if (slotOf[i] >= 0) continue;
      let best = 0;
      for (let k = 1; k < MAX; k += 1) if (people[k].seen < people[best].seen) best = k;
      const p = people[best];
      if (p.key) slotMap.delete(p.key);
      p.key = actors[i].key;
      p.seen = frame;
      slotMap.set(p.key, best);
      slotOf[i] = best;
    }
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
      // Draw: the slot's mesh, dressed for the role, at the level of detail its size on screen calls for.
      const person = people[slotOf[i]];
      if (out.hidden) {
        person.mesh.visible = false;
      } else {
        const frac = 6 / (2 * Math.max(1, cam.position.distanceTo(out.center)) * tanHalf);
        const was = person.lod;
        const lod = frac > LOD_NEAR ? 0 : frac > LOD_FAR ? (was === 0 ? 0 : 1) : frac > LOD_MID ? 1 : frac > LOD_TINY ? (was === 2 ? 2 : 1) : 2;
        // Distant people grow smoothly up to BIG_MAX about the spot they stand on.
        const big = Math.min(BIG_MAX, Math.max(1, BIG_BELOW / frac));
        const fx = out.center.x;
        const fz = out.center.z;
        if (big > 1) {
          const h = pb.hands.get(a.key);
          if (h) {
            h.ballP.x = fx + (h.ballP.x - fx) * big;
            h.ballP.y = an.gy + (h.ballP.y - an.gy) * big;
            h.ballP.z = fz + (h.ballP.z - fz) * big;
          }
        }
        person.dress(a, lod);
        if (person.stale(a) && paints < PAINTS_PER_FRAME) {
          person.paint(a);
          paints += 1;
        }
        // Never show a uniform that was painted for somebody else.
        const ready = person.stale(a) !== 2;
        person.mesh.visible = ready;
        if (ready) person.pose(out, big, fx, an.gy, fz);
        if (ready && out.hasBat && nBats < MAX) {
          if (big > 1) {
            _big.makeScale(big, big, big).setPosition(fx * (1 - big), an.gy * (1 - big), fz * (1 - big));
            out.bat.premultiply(_big);
          }
          bats.setMatrixAt(nBats, out.bat);
          bats.setColorAt(nBats, BAT_COLORS[Math.floor(hash01(a.id ?? 0, 11) * BAT_COLORS.length)]);
          nBats += 1;
        }
      }
    }
    for (let i = 0; i < MAX; i += 1) if (people[i].seen !== frame) people[i].mesh.visible = false;
    if (map.size > 120) for (const [k, an] of map) if (an.seen < frame - 600) map.delete(k);
    bats.count = nBats;
    bats.instanceMatrix.needsUpdate = true;
    if (bats.instanceColor) bats.instanceColor.needsUpdate = true;
  });

  return <primitive object={kit.group} />;
}
