/**
 * Full batted-ball path: air flight, bounces, rolling, wall caroms, home runs,
 * and balls leaving play. Output is a dense, time-ordered sample list the play
 * resolver (fielding) and the renderer both consume.
 */
import { stepFlight, type BallState } from "@/lib/game/physics/ballFlight";
import { SURFACES, isBeyondBases, isFairPosition, type Park } from "@/lib/game/physics/park";
import { add, horizDist, len, scale, sprayAngleDeg, v3, type V3 } from "@/lib/game/math";

export type BallPhase = "air" | "bounce" | "roll" | "dead";

export interface BallSample {
  t: number;
  p: V3;
  v: V3;
  phase: BallPhase;
}

export interface BattedBallPath {
  samples: BallSample[];
  /** First ground contact (time/position), if the ball didn't leave the park in the air. */
  firstLanding: { t: number; p: V3 } | null;
  homeRun: boolean;
  /** Bounced over the wall (ground-rule double). */
  groundRuleDouble: boolean;
  /** Left play in foul territory (into the stands / behind the backstop). */
  outOfPlayFoul: boolean;
  /** Time the path ends (rest, out of play, HR). */
  endT: number;
  /** Max height, ft. */
  apex: number;
  /** Distance where it landed / left the park (Statcast-style projected distance for HRs). */
  distance: number;
  hitWall: boolean;
}

const DT = 1 / 480;
const SAMPLE_EVERY = 4; // → 120 Hz samples
const MAX_T = 14;

export function simulateBattedBall(start: BallState, park: Park): BattedBallPath {
  let s: BallState = start;
  let t = 0;
  let phase: BallPhase = "air";
  let firstLanding: BattedBallPath["firstLanding"] = null;
  let homeRun = false;
  let grd = false;
  let foulOut = false;
  let hitWall = false;
  let apex = s.p.y;
  let touched = false; // touched ground (or wall) yet
  const samples: BallSample[] = [{ t, p: s.p, v: s.v, phase }];
  let step = 0;

  while (t < MAX_T) {
    if (phase === "roll") {
      // Rolling: friction decel along horizontal velocity + light air drag.
      const hv = v3(s.v.x, 0, s.v.z);
      const speed = len(hv);
      const surf = SURFACES[park.surfaceAt(s.p)];
      const decel = surf.roll + 0.0012 * speed * speed;
      const newSpeed = Math.max(0, speed - decel * DT);
      const v = speed > 1e-6 ? scale(hv, newSpeed / speed) : v3();
      s = { p: add(s.p, scale(v, DT)), v, w: v3() };
      if (newSpeed < 0.3) {
        t += DT;
        samples.push({ t, p: s.p, v: v3(), phase: "dead" });
        break;
      }
    } else {
      s = stepFlight(s, DT, park.air);
    }
    t += DT;
    step += 1;
    if (s.p.y > apex) apex = s.p.y;

    const r = horizDist(s.p);
    const spray = sprayAngleDeg(s.p);
    const fairAngle = s.p.z > 0 && Math.abs(spray) <= 45;

    // Fence / home run.
    if (fairAngle && r >= park.fence(spray)) {
      if (s.p.y >= park.wallHeight(spray)) {
        if (touched) grd = true;
        else homeRun = true;
        samples.push({ t, p: s.p, v: s.v, phase: "dead" });
        break;
      }
      // Carom off the wall: kill most radial speed, keep some tangential.
      hitWall = true;
      touched = true;
      const radial = scale(v3(s.p.x, 0, s.p.z), 1 / r);
      const vr = s.v.x * radial.x + s.v.z * radial.z;
      if (vr > 0) {
        const vRad = scale(radial, vr);
        const vTan = v3(s.v.x - vRad.x, 0, s.v.z - vRad.z);
        const out = add(scale(vRad, -0.3), scale(vTan, 0.6));
        s = { p: add(scale(radial, park.fence(spray) - 0.5), v3(0, s.p.y, 0)), v: v3(out.x, s.v.y * 0.6, out.z), w: v3() };
      }
    }

    // Out of play in foul territory.
    if (!fairAngle) {
      // Past the stands' wall (the same loop that's drawn) and low enough to land in the seats.
      if (r > park.wallDist(spray)) {
        if (s.p.y < 30 || touched) {
          foulOut = true;
          samples.push({ t, p: s.p, v: s.v, phase: "dead" });
          break;
        }
      }
    }

    // Ground contact.
    if (phase !== "roll" && s.p.y <= 0 && s.v.y < 0) {
      touched = true;
      if (!firstLanding) firstLanding = { t, p: { ...s.p, y: 0 } };
      const surf = SURFACES[park.surfaceAt(s.p)];
      const vyOut = -s.v.y * surf.e;
      const hv = scale(v3(s.v.x, 0, s.v.z), surf.keep);
      if (vyOut < 3) {
        phase = "roll";
        s = { p: { ...s.p, y: 0 }, v: hv, w: v3() };
      } else {
        phase = "bounce";
        s = { p: { ...s.p, y: 0 }, v: v3(hv.x, vyOut, hv.z), w: scale(s.w, 0.3) };
      }
    }

    if (step % SAMPLE_EVERY === 0) samples.push({ t, p: s.p, v: s.v, phase });
  }

  const last = samples[samples.length - 1];
  const distance = homeRun ? horizDist(last.p) : firstLanding ? horizDist(firstLanding.p) : horizDist(last.p);
  return {
    samples,
    firstLanding,
    homeRun,
    groundRuleDouble: grd,
    outOfPlayFoul: foulOut,
    endT: last.t,
    apex,
    distance,
    hitWall,
  };
}

/** Perpendicular horizontal distance outside the nearer foul line (0 if fair). */
export function distanceToFoulLine(p: V3): number {
  // Foul lines: 1B line direction (-1,0,1)/√2, 3B line (1,0,1)/√2.
  const u = (-p.x + p.z) / Math.SQRT2;
  const w = (p.x + p.z) / Math.SQRT2;
  if (u >= 0 && w >= 0) return 0;
  return Math.max(-u, -w);
}

export function sampleAt(path: BattedBallPath, t: number): BallSample {
  const s = path.samples;
  if (t <= s[0].t) return s[0];
  // Samples are uniform except the last; binary search is cheap and robust.
  let lo = 0;
  let hi = s.length - 1;
  if (t >= s[hi].t) return s[hi];
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (s[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = s[lo];
  const b = s[hi];
  const f = (t - a.t) / (b.t - a.t || 1);
  return {
    t,
    p: add(a.p, scale(v3(b.p.x - a.p.x, b.p.y - a.p.y, b.p.z - a.p.z), f)),
    v: add(a.v, scale(v3(b.v.x - a.v.x, b.v.y - a.v.y, b.v.z - a.v.z), f)),
    phase: a.phase,
  };
}

/**
 * Fair/foul judgment (MLB rule 5.09 / definitions):
 *  - a ball that first lands beyond 1B/3B is judged where it first lands;
 *  - otherwise it's judged where it's touched by a fielder / comes to rest,
 *    or as it passes first or third base.
 * `touchT` = time a fielder touches the ball (or null).
 */
export function judgeFair(path: BattedBallPath, touchT: number | null): boolean {
  if (path.homeRun) return true;
  if (path.outOfPlayFoul && !path.firstLanding) return false;
  const fl = path.firstLanding;
  if (fl && isBeyondBases(fl.p)) return isFairPosition(fl.p);
  if (!fl) {
    // Caught (or touched) in the air: fair if touched over fair territory.
    if (touchT == null) return false;
    return isFairPosition(sampleAt(path, touchT).p);
  }
  // Landed in the infield region: follow it until it passes a base, is touched, or stops.
  for (const s of path.samples) {
    if (s.t < fl.t) continue;
    if (touchT != null && s.t >= touchT) return isFairPosition(s.p);
    if (isBeyondBases(s.p)) return isFairPosition(s.p);
    if (s.phase === "dead") return isFairPosition(s.p);
  }
  return isFairPosition(path.samples[path.samples.length - 1].p);
}
