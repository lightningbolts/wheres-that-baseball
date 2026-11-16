/**
 * Per-actor animation state: turns an actor's timeline state into a solved skeleton
 * every frame. It owns everything that makes motion read as continuous rather than
 * as a string of clips: the smoothed transform, the run cycle (advanced by ground
 * actually covered, so planted feet do not slide), banking and drive lean, the
 * inertial blend that carries momentum across a change of clip, reach targets
 * (release points, the ball, the catcher's target) and the bat a hitter drops.
 *
 * All filters advance on the animation clock handed in (timeline time while a
 * pitch plays), so a paused timeline holds every body still, and they converge in
 * a fraction of a second, so the picture depends only on the recent timeline.
 */
import * as THREE from "three";
import {
  CATCH_AT,
  THROW_RELEASE_AT,
  UMP_CALL_S,
  addPoseDelta,
  blendTime,
  copyPose,
  cycleLen,
  groundY,
  hideRig,
  newPose,
  newPoseCtx,
  poseClass,
  poseInto,
  scalePoseDelta,
  smooth,
  solveRig,
  subPose,
  type ActorDraw,
  type Pose,
  type PoseClass,
  type RigOut,
} from "@/components/game/scene/rig";
import type { BallState, Timeline } from "@/lib/game/anim/timeline";

export interface AnimEnv {
  tl: Timeline | null;
  ball: BallState | null;
  /** Timeline time, and the animation seconds elapsed since the previous step. */
  T: number;
  dA: number;
  /** Real seconds (idle motion) and the frame counter. */
  now: number;
  frame: number;
  /** Camera cut this frame: snap instead of blending. */
  cut: boolean;
  /** Seconds since the umpire began a strike call (negative: none). */
  callAge: number;
}

const TAU = Math.PI * 2;
function angDiff(to: number, from: number): number {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 0..1 from a string, stable across sessions. */
export function seedOf(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i += 1) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10007) / 10007;
}

const ctx = newPoseCtx();
const target = newPose();
const _v = new THREE.Vector3();
const _q0 = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _one = new THREE.Vector3(1, 1, 1);

/** How long a dropped bat takes to reach the ground. */
const BAT_DROP_S = 0.42;
/** How high (ft) a fielder's glove reaches with his feet on the ground. */
const STAND_REACH = 7.1;
const BAT_REST_Y = 0.12;

export class Animator {
  cls: PoseClass = "idle";
  /** The pose on screen, the one before it and the animation time between them. */
  pose: Pose = newPose();
  private prev: Pose = newPose();
  private prevDt = 0;
  /** Inertial blend: offset and velocity carried over from the previous clip, and their age. */
  private off: Pose = newPose();
  private vel: Pose = newPose();
  private since = 1;
  private dur = 0;
  /** Displayed transform. */
  x = 0;
  z = 0;
  gy = 0;
  yaw = 0;
  private yawRate = 0;
  private rx = 0;
  private rz = 0;
  private ox = 0;
  private oz = 0;
  private speed = 0;
  private vSm = 0;
  private accel = 0;
  private phase: number;
  private hold = 0;
  /** The catch or pick-up in progress: leap needed, the clip (timeline + start time), and when (clip seconds) and where the ball arrives. */
  private jump = 0;
  private arrTl: Timeline | null = null;
  private arrT0 = -99;
  private arrAt = -1;
  private readonly arrP = new THREE.Vector3();
  /** The last point he reached for, its weight, and the clip it belongs to. */
  private readonly lastP = new THREE.Vector3();
  private lastW = 0;
  private lastT0 = -99;
  toHand = 0;
  private hy = 0;
  private hp = 0;
  seen = -10;
  readonly seed: number;
  /** Release point of the throw in progress. */
  private thrAt = -1e9;
  private thrP = new THREE.Vector3();
  private thrOk = false;
  /** The bat he let go of: where it was, when, and for which play. */
  private hadBat = false;
  private batP = new THREE.Vector3();
  private batQ = new THREE.Quaternion();
  private dropTl: Timeline | null = null;
  private dropT0 = 0;
  private dropP0 = new THREE.Vector3();
  private dropQ0 = new THREE.Quaternion();
  private dropP1 = new THREE.Vector3();
  private dropQ1 = new THREE.Quaternion();
  hasDrop = false;
  readonly dropBat = new THREE.Matrix4();

  constructor(key = "") {
    this.seed = seedOf(key);
    this.phase = this.seed * TAU;
  }

  /** Aim the pose solver at whatever this actor is reaching for. `big` is the far-distance scale he is drawn at. */
  private aim(a: ActorDraw, cls: PoseClass, env: AnimEnv, big: number) {
    const { tl, ball, T } = env;
    ctx.hasTarget = false;
    ctx.bunt = false;
    ctx.targetW = 0;
    ctx.jump = 0;
    if (!tl) return;
    const s = a.state;
    let px = 0;
    let py = 0;
    let pz = 0;
    let ok = false;
    if (cls === "pitch") {
      const p = tl.releaseP;
      px = p.x;
      py = p.y;
      pz = p.z;
      ok = true;
      ctx.targetW = 1;
    } else if (cls === "swing" && tl.swing) {
      const p = tl.swing.aim;
      px = p.x;
      py = p.y;
      pz = p.z;
      ok = true;
      ctx.targetW = 1;
      ctx.swingDur = tl.swing.contactT - tl.swing.startT;
      ctx.bunt = !!tl.swing.bunt;
    } else if (cls === "throw") {
      const start = T - s.actionT;
      if (Math.abs(start - this.thrAt) > 0.05) {
        this.thrAt = start;
        const b = tl.ball(start + THROW_RELEASE_AT + 0.004);
        this.thrOk = !b.held && b.visible;
        if (this.thrOk) this.thrP.set(b.p.x, b.p.y, b.p.z);
      }
      if (this.thrOk && Math.hypot(this.thrP.x - s.p.x, this.thrP.z - s.p.z) < 5) {
        px = this.thrP.x;
        py = this.thrP.y;
        pz = this.thrP.z;
        ok = true;
        ctx.targetW = 1;
      }
    } else if (cls === "crouch" && a.kind === "catcher") {
      // The mitt travels to the spot as the pitch comes in, gives with the ball, pulls it
      // a touch toward the zone, holds, then relaxes.
      const r = tl.receive;
      const lead = tl.releaseT + 0.12;
      let w = smooth((T - lead) / Math.max(0.05, r.t - lead - 0.03));
      const done = tl.contactT != null && tl.contactT < r.t ? tl.contactT : r.t + 0.55;
      w *= 1 - smooth((T - done) / 0.4);
      const after = T - r.t;
      const give = after > 0 ? Math.sin(Math.PI * clamp(after / 0.22, 0, 1)) : 0;
      const frame = smooth(after / 0.22);
      px = r.p.x + (0 - r.p.x) * 0.22 * frame;
      py = r.p.y + (2.5 - r.p.y) * 0.2 * frame;
      pz = r.p.z - 0.32 * give - 0.1 * frame;
      ok = true;
      ctx.targetW = w;
    } else if (cls === "catch" || cls === "field") {
      // Work out once per clip where and when the ball gets to him: the glove goes there and waits
      // (rather than chasing a ball still on its way), and a ball over his reach means a leap.
      const t0 = T - s.actionT;
      if (this.arrTl !== tl || Math.abs(t0 - this.arrT0) > 0.05) {
        this.arrTl = tl;
        this.arrT0 = t0;
        this.arrAt = -1;
        this.jump = 0;
        for (let u = Math.max(0, s.actionT - 0.02); u < 1.3; u += 1 / 60) {
          const b = tl.ball(t0 + u);
          if (b.held) {
            if (b.holder !== a.pos) this.arrAt = -1;
            else if (this.arrAt >= 0) {
              // Close in on the instant it lands in the glove.
              let lo = this.arrAt;
              let hi = u;
              for (let i = 0; i < 6; i += 1) {
                const mid = (lo + hi) / 2;
                const m = tl.ball(t0 + mid);
                if (m.held) hi = mid;
                else {
                  lo = mid;
                  this.arrP.set(m.p.x, m.p.y, m.p.z);
                }
              }
              this.arrAt = lo;
            }
            break;
          }
          if (!b.visible) continue;
          this.arrAt = u;
          this.arrP.set(b.p.x, b.p.y, b.p.z);
        }
        if (this.arrAt >= 0 && cls === "catch" && Math.abs(this.arrAt - CATCH_AT) < 0.06) this.jump = clamp((this.arrP.y - this.gy) / big - STAND_REACH, 0, 2.4);
      }
      if (cls === "catch") ctx.jump = this.jump;
      if (ball && ball.visible && !ball.held) {
        const d = Math.hypot(ball.p.x - this.x, ball.p.z - this.z, ball.p.y - 3.5);
        // He reaches as the ball closes on him, and is fully committed by the time it arrives.
        const near = cls === "catch" ? smooth(1 - (d - 2.5) / 9) : smooth(1 - (d - 1.5) / 5);
        if (this.arrAt >= 0) {
          px = this.arrP.x;
          py = this.arrP.y;
          pz = this.arrP.z;
          ctx.targetW = Math.max(near, smooth((s.actionT - this.arrAt + 0.42) / 0.32));
        } else {
          px = ball.p.x;
          py = ball.p.y;
          pz = ball.p.z;
          ctx.targetW = near;
        }
        ok = true;
        this.lastT0 = t0;
        this.lastP.set(px, py, pz);
        this.lastW = ctx.targetW;
      } else if (ball && ball.held && Math.abs(t0 - this.lastT0) < 0.05) {
        // Ball in the glove: the reach eases out from where he caught it (the pose fades it with `hold`).
        px = this.lastP.x;
        py = this.lastP.y;
        pz = this.lastP.z;
        ok = true;
        ctx.targetW = this.lastW;
      }
    }
    if (!ok) return;
    ctx.hasTarget = true;
    // A far player is drawn larger than life about his feet: aim in his own scale so the
    // drawn hand (or barrel) lands on the real point.
    const k = 1 / big;
    ctx.tx = this.x + (px - this.x) * k;
    ctx.ty = this.gy + (py - this.gy) * k;
    ctx.tz = this.z + (pz - this.z) * k;
  }

  /** target pose (+ what is left of the previous clip's momentum) → this.pose. */
  private compose(a: ActorDraw, cls: PoseClass) {
    poseInto(target, a, cls, ctx);
    const pose = copyPose(this.pose, target);
    if (this.since < this.dur) {
      // Critically damped decay of the offset the old clip left us with, faded out completely by `dur`.
      const lam = 5 / this.dur;
      const t = this.since;
      const e = Math.exp(-lam * t) * (1 - smooth((t / this.dur - 0.6) / 0.4));
      addPoseDelta(pose, this.off, (1 + lam * t) * e, this.vel, t * e);
    }
    pose.headYaw = this.hy;
    pose.headPitch = this.hp;
  }

  /**
   * Advance by env.dA and solve the skeleton into `out`. `ballP` receives where a ball this
   * actor holds is drawn. `big` scales the drawn figure about (x, gy, z).
   */
  step(a: ActorDraw, env: AnimEnv, big: number, out: RigOut, ballP: THREE.Vector3): void {
    const s = a.state;
    const { tl, ball, dA, frame } = env;
    const cls = poseClass(a);
    // Snap (no blending) on a camera cut or when the actor was not on screen last frame.
    let snap = env.cut || this.seen < frame - 1;
    this.seen = frame;
    if (!snap) {
      const jump = Math.hypot(s.p.x - this.rx, s.p.z - this.rz);
      if (jump > (s.speed + this.speed) * dA + 0.75) {
        // The track itself jumped (timeline swap): glide across small gaps, cut across big ones.
        if (jump < 14) {
          this.ox += this.rx - s.p.x;
          this.oz += this.rz - s.p.z;
        } else snap = true;
      }
    }
    this.rx = s.p.x;
    this.rz = s.p.z;
    const holding = ball && ball.held && ball.holder === a.pos ? 1 : 0;
    const inHand = cls === "throw" || cls === "pitch" ? 1 : 0;
    let glide = 0;
    if (snap) {
      this.ox = 0;
      this.oz = 0;
      this.yaw = s.yaw;
      this.yawRate = 0;
      this.hold = holding;
      this.toHand = inHand;
      this.vSm = s.speed;
      this.accel = 0;
    } else if (dA > 0) {
      const ol = Math.hypot(this.ox, this.oz);
      if (ol > 1e-3) {
        const step = Math.min(ol, ol * (1 - Math.exp(-dA / 0.12)) + 2 * dA, 18 * dA);
        this.ox -= (this.ox / ol) * step;
        this.oz -= (this.oz / ol) * step;
        glide = step / dA;
      }
      const dy = angDiff(s.yaw, this.yaw) * (1 - Math.exp(-dA / 0.09));
      this.yaw += dy;
      const kf = 1 - Math.exp(-dA / 0.14);
      this.yawRate += (dy / dA - this.yawRate) * kf;
      this.hold += (holding - this.hold) * (1 - Math.exp(-dA / 0.1));
      this.toHand += (inHand - this.toHand) * (1 - Math.exp(-dA / 0.07));
      const v0 = this.vSm;
      this.vSm += (s.speed - v0) * (1 - Math.exp(-dA / 0.1));
      this.accel += (clamp((this.vSm - v0) / dA, -40, 40) - this.accel) * kf;
    }
    const x = s.p.x + this.ox;
    const z = s.p.z + this.oz;
    this.x = x;
    this.z = z;
    const speed = s.speed + glide;
    this.speed = s.speed;
    this.phase = (this.phase + (TAU * speed * dA) / cycleLen(speed)) % TAU;

    ctx.time = env.now;
    ctx.phase = this.phase;
    ctx.speed = speed;
    ctx.x = x;
    ctx.z = z;
    ctx.yaw = this.yaw;
    ctx.groundY = this.gy;
    ctx.hold = this.hold;
    ctx.seed = this.seed;
    ctx.accel = this.accel;
    // He leans into a turn about as hard as he is turning.
    ctx.bank = clamp(this.yawRate * Math.min(speed, 28) * 0.007, -0.2, 0.2);
    ctx.pitchTau = tl ? env.T - tl.releaseT : -99;
    ctx.callT = a.kind === "umpire" && env.callAge >= 0 && env.callAge < UMP_CALL_S ? env.callAge : -1;
    const watch = !!(tl && ball && ball.visible) && !(a.kind === "batter" && tl.contactT != null && env.T > tl.contactT);
    ctx.ballW = watch ? 1 : 0;
    if (watch && ball) {
      ctx.bx = ball.p.x;
      ctx.by = ball.p.y;
      ctx.bz = ball.p.z;
    }
    this.aim(a, cls, env, big);

    // A change of clip keeps the body's momentum: the old pose's offset and velocity decay away.
    if (cls !== this.cls) {
      if (!snap) {
        poseInto(target, a, cls, ctx);
        const hadBat = this.pose.hasBat && target.hasBat;
        if (this.prevDt > 1e-4) scalePoseDelta(subPose(this.vel, this.pose, this.prev), 1 / this.prevDt, 5, 22);
        else scalePoseDelta(this.vel, 0, 0, 0);
        subPose(this.off, this.pose, target);
        if (target.hasBat && !hadBat) {
          // Picking up a bat: the hands go straight to the handle.
          this.off.handL.set(0, 0, 0);
          this.off.handR.set(0, 0, 0);
          this.vel.handL.set(0, 0, 0);
          this.vel.handR.set(0, 0, 0);
        }
        this.since = 0;
        this.dur = blendTime(this.cls, cls);
      }
      this.cls = cls;
    }
    if (snap) {
      this.since = 1;
      this.dur = 0;
    }
    const wasHidden = this.pose.hidden;
    const hadBat = this.pose.hasBat && !wasHidden;
    if (dA > 0 && !snap) {
      copyPose(this.prev, this.pose);
      this.prevDt = dA;
      this.since += dA;
    }
    this.compose(a, cls);
    // The head follows its target with a short lag of its own, so the eyes never snap.
    const hk = snap ? 1 : 1 - Math.exp(-dA / 0.085);
    this.hy += (target.headYaw - this.hy) * hk;
    this.hp += (target.headPitch - this.hp) * hk;
    this.pose.headYaw = this.hy;
    this.pose.headPitch = this.hp;
    if (snap) {
      copyPose(this.prev, this.pose);
      this.prevDt = 0;
    }

    const pose = this.pose;
    this.updateDrop(env, hadBat && !pose.hasBat && !snap && !!tl && tl.inPlay);
    if (pose.hidden) {
      hideRig(out);
      return;
    }
    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);
    this.gy = groundY(x + sy * pose.rootZ, z + cy * pose.rootZ);
    solveRig(a, pose, x, z, this.yaw, this.gy, out);
    if (ctx.hasTarget && (cls === "catch" || cls === "field" || cls === "crouch")) {
      // The hand is aimed at the wrist; nudge it so the glove's pocket is what meets the ball.
      const w = Math.min(1, ctx.targetW * 1.5) * (1 - this.hold);
      if (w > 0.05) {
        _v.set(ctx.tx, ctx.ty, ctx.tz).sub(out.gloveHand);
        const l = _v.length();
        if (l > 0.01 && l < 2.5) {
          if (l > 0.9) _v.multiplyScalar(0.9 / l);
          ctx.tx += _v.x;
          ctx.ty += _v.y;
          ctx.tz += _v.z;
          this.compose(a, cls);
          solveRig(a, pose, x, z, this.yaw, this.gy, out);
        }
      }
    }
    if (out.hasBat) {
      out.bat.decompose(this.batP, this.batQ, _s);
      this.hadBat = true;
    } else this.hadBat = false;
    ballP.lerpVectors(out.gloveHand, out.throwHand, this.toHand);
    if (big !== 1) {
      ballP.x = x + (ballP.x - x) * big;
      ballP.y = this.gy + (ballP.y - this.gy) * big;
      ballP.z = z + (ballP.z - z) * big;
    }
  }

  /** The bat a hitter lets go of as he leaves the box falls beside the plate and lies there until the play is over. */
  private updateDrop(env: AnimEnv, letGo: boolean) {
    const tl = env.tl;
    if (letGo && tl && this.hadBat) {
      this.dropTl = tl;
      this.dropT0 = env.T;
      this.dropP0.copy(this.batP);
      this.dropQ0.copy(this.batQ);
      // It lands flat, pointing roughly the way it was pointing, a step behind him.
      _v.set(0, 1, 0).applyQuaternion(this.batQ);
      _v.y = 0;
      if (_v.lengthSq() < 0.01) _v.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      _v.normalize();
      this.dropQ1.setFromUnitVectors(_up, _v);
      this.dropP1.copy(this.batP).addScaledVector(_v, -0.6);
      this.dropP1.y = groundY(this.dropP1.x, this.dropP1.z) + BAT_REST_Y;
    }
    const u = tl && tl === this.dropTl ? env.T - this.dropT0 : -1;
    this.hasDrop = u >= 0;
    if (!this.hasDrop) {
      if (tl !== this.dropTl) this.dropTl = null;
      return;
    }
    const k = Math.min(1, u / BAT_DROP_S);
    // Falls under gravity, turning flat as it goes, with one small settling bounce.
    _v.lerpVectors(this.dropP0, this.dropP1, k);
    _v.y = this.dropP0.y + (this.dropP1.y - this.dropP0.y) * k * k;
    const b = (u - BAT_DROP_S) / 0.16;
    if (b > 0 && b < 1) _v.y += 0.12 * Math.sin(Math.PI * b);
    _q0.copy(this.dropQ0).slerp(this.dropQ1, smooth(k * 1.15));
    this.dropBat.compose(_v, _q0, _one);
  }
}
