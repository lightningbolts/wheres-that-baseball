import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  blendTime,
  copyPose,
  lerpPose,
  newPose,
  newPoseCtx,
  newRigOut,
  poseClass,
  poseInto,
  sample1,
  solveRig,
  tab1,
  type ActorDraw,
  type ActorKind,
} from "@/components/game/scene/rig";
import { BONE, BONE_COUNT } from "@/components/game/scene/character/skeleton";
import type { Action } from "@/lib/game/anim/timeline";

const WHITE = new THREE.Color(1, 1, 1);
function actor(kind: ActorKind, action: Action, actionT: number, hand: "L" | "R" = "R", x = 0, z = 0, yaw = 0): ActorDraw {
  return { key: "t", state: { p: { x, y: 0, z }, yaw, speed: 0, action, actionT }, kind, jersey: WHITE, accent: WHITE, skin: WHITE, hand, helmet: false, pos: null };
}

describe("keyframe splines", () => {
  it("hit their keys, hold still across held keys and never overshoot", () => {
    const tb = tab1([[0, 0], [1, 2], [2, 2], [3, 5], [4, 1]]);
    expect(sample1(tb, -1)).toBe(0);
    expect(sample1(tb, 1)).toBeCloseTo(2);
    expect(sample1(tb, 3)).toBeCloseTo(5);
    expect(sample1(tb, 9)).toBe(1);
    for (let x = 1; x <= 2; x += 0.05) expect(sample1(tb, x)).toBeCloseTo(2, 6);
    for (let x = 0; x <= 4; x += 0.01) {
      const v = sample1(tb, x);
      expect(v).toBeGreaterThanOrEqual(-1e-9);
      expect(v).toBeLessThanOrEqual(5 + 1e-9);
    }
  });
});

describe("poses", () => {
  it("blend linearly between two poses and land exactly on the target", () => {
    const ctx = newPoseCtx();
    const a = poseInto(newPose(), actor("fielder", "ready", 0), "loco", ctx);
    const b = poseInto(newPose(), actor("fielder", "throw", 0.3), "throw", ctx);
    const out = newPose();
    lerpPose(out, a, b, 0.5);
    expect(out.hipH).toBeCloseTo((a.hipH + b.hipH) / 2);
    expect(out.handR.x).toBeCloseTo((a.handR.x + b.handR.x) / 2);
    const aliased = copyPose(newPose(), a);
    lerpPose(aliased, aliased, b, 1);
    expect(aliased.handR.distanceTo(b.handR)).toBeLessThan(1e-9);
    expect(aliased.footL.distanceTo(b.footL)).toBeLessThan(1e-9);
  });

  it("run and ready are one pose family, so crossing the speed threshold never triggers a blend", () => {
    expect(poseClass(actor("fielder", "run", 0))).toBe(poseClass(actor("fielder", "ready", 0)));
    expect(blendTime("bat", "swing")).toBeLessThan(0.08);
  });

  it("locomotion changes continuously with speed and phase", () => {
    const ctx = newPoseCtx();
    const prev = newPose();
    const cur = newPose();
    const a = actor("runner", "run", 0);
    let first = true;
    for (let speed = 0; speed <= 28; speed += 0.25) {
      ctx.speed = speed;
      ctx.phase += 0.05;
      poseInto(cur, a, "loco", ctx);
      if (!first) {
        expect(cur.footL.distanceTo(prev.footL)).toBeLessThan(0.45);
        expect(cur.handL.distanceTo(prev.handL)).toBeLessThan(0.3);
        expect(Math.abs(cur.hipH - prev.hipH)).toBeLessThan(0.08);
      }
      first = false;
      copyPose(prev, cur);
    }
  });

  it.each(["pitch", "throw", "field", "dive", "slide"] as const)("%s motion has no pops between frames", (action) => {
    const ctx = newPoseCtx();
    const prev = newPose();
    const cur = newPose();
    const kind: ActorKind = action === "pitch" ? "pitcher" : action === "slide" ? "runner" : "fielder";
    const dt = 1 / 120;
    for (let t = 0; t <= 2.2; t += dt) {
      poseInto(cur, actor(kind, action, t), action, ctx);
      if (t > 0) {
        // Hands stay under ~95 ft/s (a real arm), feet and the body well under that.
        expect(cur.handR.distanceTo(prev.handR), `handR @${t.toFixed(3)}`).toBeLessThan(95 * dt);
        expect(cur.handL.distanceTo(prev.handL), `handL @${t.toFixed(3)}`).toBeLessThan(60 * dt);
        expect(cur.footL.distanceTo(prev.footL), `footL @${t.toFixed(3)}`).toBeLessThan(45 * dt);
        expect(cur.footR.distanceTo(prev.footR), `footR @${t.toFixed(3)}`).toBeLessThan(45 * dt);
        expect(Math.abs(cur.hipH - prev.hipH)).toBeLessThan(16 * dt);
        expect(Math.abs(cur.rootZ - prev.rootZ)).toBeLessThan(14 * dt);
      }
      copyPose(prev, cur);
    }
  });

  it("the pitcher holds the set position on the rubber until his delivery starts", () => {
    const ctx = newPoseCtx();
    const idle = poseInto(newPose(), actor("pitcher", "idle", 7.3), poseClass(actor("pitcher", "idle", 7.3)), ctx);
    const start = poseInto(newPose(), actor("pitcher", "pitch", 0), "pitch", ctx);
    expect(idle.rootZ).toBeCloseTo(start.rootZ);
    expect(idle.rootZ).toBeLessThan(-4);
    expect(idle.handR.distanceTo(start.handR)).toBeLessThan(1e-9);
    const done = poseInto(newPose(), actor("pitcher", "pitch", 2), "pitch", ctx);
    expect(done.rootZ).toBeCloseTo(0);
  });

  it("the pitching hand comes through the pitch's real release point", () => {
    const out = newRigOut();
    for (const hand of ["R", "L"] as const) {
      const ctx = newPoseCtx();
      const a = actor("pitcher", "pitch", 1.1, hand, 0, 56, Math.PI);
      ctx.x = 0;
      ctx.z = 56;
      ctx.yaw = Math.PI;
      ctx.hasTarget = true;
      ctx.targetW = 1;
      ctx.tx = hand === "R" ? 1.9 : -1.9;
      ctx.ty = 5.9;
      ctx.tz = 54.6;
      const pose = poseInto(newPose(), a, "pitch", ctx);
      solveRig(a, pose, 0, 56, Math.PI, 0, out);
      expect(out.throwHand.distanceTo(new THREE.Vector3(ctx.tx, ctx.ty, ctx.tz)), hand).toBeLessThan(0.9);
    }
  });

  it("the barrel's sweet spot passes through the aim point at contact, for both batting sides", () => {
    const aims = [
      { x: 0, y: 2.5, z: 3 },
      { x: 0.7, y: 1.7, z: 2.6 },
      { x: -0.7, y: 3.4, z: 3.3 },
    ];
    for (const hand of ["R", "L"] as const) {
      const bx = hand === "R" ? 2.7 : -2.7;
      const yaw = hand === "R" ? -Math.PI / 2 : Math.PI / 2;
      for (const aim of aims) {
        for (const dur of [0.07, 0.15, 0.22]) {
          const ctx = newPoseCtx();
          ctx.x = bx;
          ctx.z = 0.5;
          ctx.yaw = yaw;
          ctx.hasTarget = true;
          ctx.targetW = 1;
          ctx.tx = aim.x;
          ctx.ty = aim.y;
          ctx.tz = aim.z;
          ctx.swingDur = dur;
          const a = actor("batter", "swing", dur, hand, bx, 0.5, yaw);
          const pose = poseInto(newPose(), a, "swing", ctx);
          // Root frame → world.
          const sweet = pose.batAt.clone().addScaledVector(pose.batDir, 1.9).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
          sweet.x += bx;
          sweet.z += 0.5;
          expect(sweet.distanceTo(new THREE.Vector3(aim.x, aim.y, aim.z)), `${hand} ${JSON.stringify(aim)}`).toBeLessThan(0.08);
          expect(pose.batDir.length()).toBeCloseTo(1);
        }
      }
    }
  });

  it("a swing launches from the loaded stance and accelerates into contact", () => {
    const ctx = newPoseCtx();
    ctx.swingDur = 0.15;
    const loaded = poseInto(newPose(), actor("batter", "stance", 0.3), "bat", ctx);
    const launch = poseInto(newPose(), actor("batter", "swing", 0), "swing", ctx);
    expect(launch.batAt.distanceTo(loaded.batAt)).toBeLessThan(0.05);
    expect(launch.batDir.distanceTo(loaded.batDir)).toBeLessThan(0.05);
    const tip = (t: number) => {
      const p = poseInto(newPose(), actor("batter", "swing", t), "swing", ctx);
      return p.batAt.clone().addScaledVector(p.batDir, 2.4);
    };
    const early = tip(0.03).distanceTo(tip(0.02));
    const late = tip(0.15).distanceTo(tip(0.14));
    expect(late).toBeGreaterThan(early * 2);
    // Continuous through contact: follow-through leaves at about the arrival speed.
    const after = tip(0.16).distanceTo(tip(0.15));
    expect(after / late).toBeGreaterThan(0.6);
    expect(after / late).toBeLessThan(1.6);
  });
});

describe("skeleton", () => {
  it("solves every pose to rigid, finite bone matrices with the hands on their wrists", () => {
    const cases: Array<[ActorKind, Action, number, "L" | "R"]> = [
      ["fielder", "ready", 0, "R"],
      ["fielder", "throw", 0.3, "L"],
      ["fielder", "dive", 0.6, "R"],
      ["fielder", "field", 0.38, "R"],
      ["pitcher", "pitch", 1.1, "R"],
      ["pitcher", "pitch", 0.55, "L"],
      ["catcher", "crouch", 0, "R"],
      ["batter", "stance", 0.2, "L"],
      ["batter", "swing", 0.14, "R"],
      ["runner", "slide", 0.4, "R"],
      ["umpire", "crouch", 0, "R"],
      ["coach", "idle", 0, "R"],
    ];
    const ctx = newPoseCtx();
    const out = newRigOut();
    const cx = new THREE.Vector3();
    const cy = new THREE.Vector3();
    const cz = new THREE.Vector3();
    const at = new THREE.Vector3();
    for (const [kind, action, t, hand] of cases) {
      const a = actor(kind, action, t, hand, 12, -7, 0.9);
      const pose = poseInto(newPose(), a, poseClass(a), ctx);
      solveRig(a, pose, 12, -7, 0.9, 0, out);
      const label = `${kind}/${action}`;
      expect(out.bones.length).toBe(BONE_COUNT);
      for (let b = 0; b < BONE_COUNT; b += 1) {
        const m = out.bones[b];
        expect(m.elements.every(Number.isFinite), label).toBe(true);
        m.extractBasis(cx, cy, cz);
        expect(cx.length(), label).toBeCloseTo(1, 4);
        expect(cy.length(), label).toBeCloseTo(1, 4);
        expect(cz.length(), label).toBeCloseTo(1, 4);
        expect(Math.abs(cx.dot(cy)) + Math.abs(cy.dot(cz)) + Math.abs(cz.dot(cx)), label).toBeLessThan(1e-3);
        expect(m.determinant(), label).toBeGreaterThan(0.99);
      }
      // The glove is on the left hand of a right-hander, and the other way round.
      const glove = hand === "R" ? BONE.handL : BONE.handR;
      const bare = hand === "R" ? BONE.handR : BONE.handL;
      expect(at.setFromMatrixPosition(out.bones[glove]).distanceTo(out.gloveHand), label).toBeLessThan(0.45);
      expect(at.setFromMatrixPosition(out.bones[bare]).distanceTo(out.throwHand), label).toBeLessThan(0.45);
      // Nobody is solved far from where he stands (a pitcher strides well down the mound).
      expect(Math.hypot(out.center.x - 12, out.center.z + 7), label).toBeLessThan(6);
    }
  });
});
