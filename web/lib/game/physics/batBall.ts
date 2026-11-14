/**
 * Bat–ball collision.
 *
 * The bat is a cylinder (barrel radius 1.3 in) swept through the zone. In the
 * bat's rest frame the ball's normal velocity rebounds with the collision
 * efficiency q (≈0.20 on the sweet spot for wood, falling off toward the
 * handle/end), which in the lab frame is the familiar
 *     v_exit = q·v_pitch + (1+q)·v_bat.
 * Tangential velocity is converted to spin by friction (rolling-sphere limit),
 * so undercutting the ball produces backspin and lift and topping it produces
 * topspin grounders — fly/grounder/popup/foul all fall out of contact geometry.
 */
import { BALL_RADIUS_FT, type BallState } from "@/lib/game/physics/ballFlight";
import {
  DEG,
  MPH_TO_FPS,
  RPM_TO_RADS,
  add,
  clamp,
  cross,
  dot,
  len,
  norm,
  scale,
  sub,
  v3,
  type V3,
} from "@/lib/game/math";

export const BAT_RADIUS_FT = 1.3 / 12;
const CONTACT_RADIUS = BALL_RADIUS_FT + BAT_RADIUS_FT;
/** Peak collision efficiency at the sweet spot (wood). */
export const Q_SWEET = 0.2;
/** Sweet spot is ~5.5 in from the barrel end of a 34 in bat. */
export const BAT_LENGTH_FT = 34 / 12;
const SWEET_FROM_END_FT = 5.5 / 12;
const SPIN_GRIP = 0.6;

export interface Swing {
  /** Bat speed at the sweet spot, mph (MLB avg ≈ 71–72). */
  batSpeedMph: number;
  /** Vertical attack angle of the bat path, degrees (+ = upward). */
  attackAngleDeg: number;
  /**
   * Horizontal direction the barrel is moving at contact, as a spray angle
   * (degrees, + toward RF). Early swing → pulled, late → opposite field.
   */
  pathSprayDeg: number;
  /** Vertical miss: ball center height minus bat center line height, ft (+ = undercut). */
  verticalOffsetFt: number;
  /** Distance from the sweet spot along the barrel, ft (+ toward the end, − toward the handle). */
  alongBarrelFt: number;
}

export interface ContactResult {
  contact: boolean;
  /** Ball just after contact (world frame). */
  ball?: BallState;
  exitSpeedMph?: number;
  launchAngleDeg?: number;
  sprayDeg?: number;
  backspinRpm?: number;
  /** Collision efficiency used — exposed for tuning/feedback (“barreled it”). */
  q?: number;
}

/** Collision efficiency vs. impact location along the barrel (wood bat vibrational-node fit). */
export function collisionEfficiency(alongBarrelFt: number): number {
  const d = alongBarrelFt;
  if (d > SWEET_FROM_END_FT || d < -(BAT_LENGTH_FT - 0.9)) return -1; // off the end / on the hands → miss
  // Falls off faster toward the end than toward the handle.
  const falloff = d >= 0 ? (d / SWEET_FROM_END_FT) ** 2 * 0.2 : (d / 1.0) ** 2 * 0.14;
  return clamp(Q_SWEET - falloff, -0.05, Q_SWEET);
}

/** Bat speed scales with radius from the pivot (handle region moves slower). */
function localBatSpeedFactor(alongBarrelFt: number): number {
  const fromKnob = BAT_LENGTH_FT - SWEET_FROM_END_FT + alongBarrelFt + 0.6; // + hands-to-pivot
  const sweet = BAT_LENGTH_FT - SWEET_FROM_END_FT + 0.6;
  return clamp(fromKnob / sweet, 0.35, 1.15);
}

/**
 * Resolve contact between an incoming pitch (velocity at the contact point) and a swing.
 * `contactPoint` is where the ball is when the bat meets it.
 */
export function resolveContact(pitchVel: V3, contactPoint: V3, swing: Swing): ContactResult {
  const off = swing.verticalOffsetFt;
  if (Math.abs(off) >= CONTACT_RADIUS) return { contact: false };
  const q = collisionEfficiency(swing.alongBarrelFt);
  if (q < -0.04) return { contact: false };

  const pathDir = v3(
    -Math.sin(swing.pathSprayDeg * DEG) * Math.cos(swing.attackAngleDeg * DEG),
    Math.sin(swing.attackAngleDeg * DEG),
    Math.cos(swing.pathSprayDeg * DEG) * Math.cos(swing.attackAngleDeg * DEG),
  );
  const batVel = scale(pathDir, swing.batSpeedMph * MPH_TO_FPS * localBatSpeedFactor(swing.alongBarrelFt));

  // Contact normal: rotate the swing-path direction about the bat's axis by φ,
  // where sin φ = offset / (r_ball + r_bat). Bat axis ⟂ path, horizontal-ish.
  const batAxis = norm(cross(v3(0, 1, 0), pathDir));
  const up = norm(cross(pathDir, batAxis)); // ⟂ path, pointing up-ish
  const phi = Math.asin(off / CONTACT_RADIUS);
  const n = norm(add(scale(pathDir, Math.cos(phi)), scale(up, Math.sin(phi))));

  // Bat rest frame.
  const u = sub(pitchVel, batVel);
  const un = dot(u, n);
  if (un >= 0) return { contact: false }; // moving apart — glancing miss
  const uNormal = scale(n, un);
  const uTan = sub(u, uNormal);

  const uNormalOut = scale(n, -q * un);
  // Friction: a ball that reached the rolling limit would keep 5/7 of its tangential
  // speed; real impacts don't fully grip (Nathan / Cross measurements), so less
  // tangential speed is lost and spin is ~60% of the rolling estimate.
  const uTanOut = scale(uTan, 0.8);
  const vOut = add(batVel, add(uNormalOut, uTanOut));

  // Spin about n × t̂ (rolling-limit ω = v_t / r, scaled by grip).
  const tanSpeedOut = len(uTanOut);
  let w = v3();
  if (tanSpeedOut > 1e-6) {
    const axis = norm(cross(n, uTanOut));
    w = scale(axis, (SPIN_GRIP * tanSpeedOut) / BALL_RADIUS_FT);
  }
  // Cap at observed MLB batted-ball spin extremes (~6000 rpm on popups).
  const wMag = len(w);
  const wCap = 6000 * RPM_TO_RADS;
  if (wMag > wCap) w = scale(w, wCap / wMag);

  const speed = len(vOut);
  const horiz = Math.hypot(vOut.x, vOut.z);
  const launch = Math.atan2(vOut.y, horiz) / DEG;
  const spray = Math.atan2(-vOut.x, vOut.z) / DEG;
  const backAxis = norm(cross(v3(vOut.x, 0, vOut.z), v3(0, 1, 0)));
  const backspin = (dot(w, backAxis) / RPM_TO_RADS) | 0;

  return {
    contact: true,
    ball: { p: contactPoint, v: vOut, w },
    exitSpeedMph: speed / MPH_TO_FPS,
    launchAngleDeg: launch,
    sprayDeg: spray,
    backspinRpm: backspin,
    q,
  };
}

/** Build a batted ball directly from Statcast-style launch parameters (tests, replays of real hits). */
export function battedBallFromLaunch(
  exitSpeedMph: number,
  launchAngleDeg: number,
  sprayDeg: number,
  backspinRpm: number,
  sidespinRpm = 0,
  start: V3 = v3(0, 3, 1.5),
): BallState {
  const la = launchAngleDeg * DEG;
  const sp = sprayDeg * DEG;
  const speed = exitSpeedMph * MPH_TO_FPS;
  const v = v3(-Math.sin(sp) * Math.cos(la) * speed, Math.sin(la) * speed, Math.cos(sp) * Math.cos(la) * speed);
  const backAxis = norm(cross(v3(v.x, 0, v.z), v3(0, 1, 0)));
  // Positive sidespin hooks the ball toward +X (left field).
  const w = add(scale(backAxis, backspinRpm * RPM_TO_RADS), v3(0, sidespinRpm * RPM_TO_RADS, 0));
  return { p: start, v, w };
}
