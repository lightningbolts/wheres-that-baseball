/**
 * Full batted-ball path: air flight, bounces, rolling, wall caroms, home runs,
 * and balls leaving play. Output is a dense, time-ordered sample list the play
 * resolver (fielding) and the renderer both consume.
 */
import { stepFlight, type BallState } from "@/lib/game/physics/ballFlight";
import { SURFACES, isBeyondBases, isFairPosition, tropRoofHit, type CatwalkRing, type Park } from "@/lib/game/physics/park";
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
  /**
   * First time the ball touched the outfield wall. From then on it's a live ball: a fielder
   * who gloves it off the wall before it lands has *not* caught a fly (no out).
   */
  wallT: number | null;
  /** Wrigley Field: the ball stuck in the ivy (ground-rule double unless fielded first). */
  lodged: boolean;
  /** Tropicana Field: catwalk ring the ball struck, and when. */
  catwalk: { ring: CatwalkRing; t: number } | null;
  /**
   * Render-only continuation after the ball leaves play (home runs and foul balls into the
   * seats): it carries on, clatters off the seats and comes to rest. Not part of `endT`.
   */
  tail: BallSample[];
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
  let touched = false; // touched the ground yet
  let wallT: number | null = null;
  let lodged = false;
  let catwalk: BattedBallPath["catwalk"] = null;
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
        // Over the fence: a homer unless it bounced first (off the wall on the fly — top of
        // the Monster, the yellow line — still counts).
        if (touched) grd = true;
        else homeRun = true;
        samples.push({ t, p: s.p, v: s.v, phase: "dead" });
        break;
      }
      // Carom off the wall: kill most radial speed, keep some tangential.
      hitWall = true;
      const radial = scale(v3(s.p.x, 0, s.p.z), 1 / r);
      const vr = s.v.x * radial.x + s.v.z * radial.z;
      if (wallT == null) {
        wallT = t;
        if (park.rules.ivy && ivyHolds(s, vr)) {
          // Wrigley: it dies in the vines at the base of the wall.
          lodged = true;
          s = { p: add(scale(radial, park.fence(spray) - 0.5), v3(0, Math.min(s.p.y, park.wallHeight(spray) - 1), 0)), v: v3(), w: v3() };
          samples.push({ t, p: s.p, v: s.v, phase: "dead" });
          break;
        }
      }
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

    // Tropicana Field's roof: catwalk rings and the fabric above them.
    if (park.rules.catwalks && !catwalk) {
      const ring = tropRoofHit(s.p);
      if (ring) {
        catwalk = { ring, t };
        if (ring === "C" || ring === "D") {
          // Outer rings: a home run over fair territory, dead (foul) over foul ground.
          if (fairAngle) homeRun = true;
          else foulOut = true;
          samples.push({ t, p: s.p, v: s.v, phase: "dead" });
          break;
        }
        // A / B ring: knocked down, still live (catchable).
        s = { p: s.p, v: v3(s.v.x * 0.35, -Math.abs(s.v.y) * 0.25, s.v.z * 0.35), w: v3() };
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
  const leftPlay = homeRun || foulOut || grd;
  const tail = leftPlay ? seatTail(s, t, park, homeRun || grd) : [];
  // Statcast's projected distance for a homer: where it would have come down at field level.
  const distance = homeRun ? projectedDistance(s, park) : firstLanding ? horizDist(firstLanding.p) : horizDist(last.p);
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
    wallT,
    lodged,
    catwalk,
    tail,
  };
}

/**
 * Does a ball that reaches Wrigley's ivy stay in it? Hard liners carom off the brick; a ball
 * that bounces or rolls up to the vines, or arrives soft, often dies in them. Deterministic
 * per trajectory (the path has to be reproducible), roughly 1 in 7 for slow balls.
 */
function ivyHolds(s: BallState, radialSpeed: number): boolean {
  if (s.p.y > 11) return false;
  const p = radialSpeed < 35 ? 0.14 : radialSpeed < 60 ? 0.04 : 0.01;
  const h = Math.sin(s.v.x * 12.9898 + s.v.z * 78.233 + s.p.y * 37.719) * 43758.5453;
  return h - Math.floor(h) < p;
}


/** Rake of a seating bowl: feet of rise per foot back. */
const SEAT_RAKE = 0.45;

/** Height of the seats under a point beyond the wall (fair: over the fence; foul: past the rail). */
function seatHeight(p: V3, park: Park, fair: boolean): number {
  const spray = sprayAngleDeg(p);
  const wall = park.wallDist(spray) || park.fence(Math.max(-45, Math.min(45, spray)));
  const base = fair ? park.wallHeight(Math.max(-45, Math.min(45, spray))) : 4;
  const back = horizDist(p) - wall;
  if (back < 3) return -Infinity;
  return base + 1.5 + (back - 3) * SEAT_RAKE;
}

/** The ball's flight on into the stands, then a couple of clattering hops and rest. */
function seatTail(from: BallState, t0: number, park: Park, fair: boolean): BallSample[] {
  let s = from;
  let t = t0;
  let bounces = 0;
  const out: BallSample[] = [];
  for (let step = 1; t < t0 + 3.5; step += 1) {
    s = stepFlight(s, DT, park.air);
    t += DT;
    const floor = seatHeight(s.p, park, fair);
    if (s.p.y <= floor && s.v.y < 0) {
      bounces += 1;
      const vy = -s.v.y * 0.32;
      if (vy < 4 || bounces > 3) {
        // Comes to rest among the seats (a fan has it).
        out.push({ t, p: { ...s.p, y: floor }, v: v3(), phase: "dead" });
        return out;
      }
      s = { p: { ...s.p, y: floor }, v: v3(s.v.x * 0.42, vy, s.v.z * 0.42), w: v3() };
    }
    if (step % SAMPLE_EVERY === 0) out.push({ t, p: s.p, v: s.v, phase: bounces ? "bounce" : "air" });
  }
  if (out.length) out[out.length - 1] = { ...out[out.length - 1], phase: "dead" };
  return out;
}

function projectedDistance(from: BallState, park: Park): number {
  let s = from;
  for (let i = 0; i < 480 * 6 && s.p.y > 0; i += 1) s = stepFlight(s, DT, park.air);
  return horizDist(s.p);
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
  // Off the outfield wall before landing: the wall stands in fair territory.
  if (path.wallT != null && (!fl || path.wallT < fl.t)) return true;
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
