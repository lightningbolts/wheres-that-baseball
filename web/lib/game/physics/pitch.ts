/**
 * Pitches from real arsenals.
 *
 * Each arsenal entry carries the pitcher's average Statcast 9-parameter fit
 * (position/velocity at y = 50 ft, constant acceleration). We back out the
 * Magnus spin that produces that acceleration under our aerodynamic model:
 *   a_T (non-gravity, ⟂ v)  →  spin axis ω̂ = v̂ × â_T,  |ω⊥| from CL⁻¹(|a_T| / kv²)
 * then integrate with the same drag + Magnus physics as batted balls. Total spin
 * (incl. gyro) comes from the measured spin rate. Aiming solves for the release
 * direction that crosses the plate at the intended spot.
 */
import {
  integrateFlight,
  SEA_LEVEL_AIR,
  BALL_RADIUS_FT,
  GRAVITY,
  type Air,
  type BallState,
  type FlightSample,
} from "@/lib/game/physics/ballFlight";
import {
  add,
  cross,
  dot,
  len,
  MPH_TO_FPS,
  norm,
  RPM_TO_RADS,
  scale,
  statcastToWorld,
  sub,
  v3,
  type Rng,
  type V3,
} from "@/lib/game/math";
import type { ArsenalPitch, StatcastKinematics } from "@/lib/game/types";

/** Front edge of home plate (Statcast plate plane), ft from the point of the plate. */
export const PLATE_FRONT_Z = 17 / 12;
/** Half the plate's width (17 in), ft. */
export const PLATE_HALF_WIDTH = 17 / 24;
/** Half plate width plus ball radius: a ball whose center is this close to the middle touches the plate. */
export const ZONE_HALF_WIDTH = PLATE_HALF_WIDTH + BALL_RADIUS_FT;
const STATCAST_Y0 = 50;

export interface CalibratedPitch {
  type: string;
  name: string;
  usage: number;
  /** Mean speed at release, mph. */
  speedMph: number;
  speedSdMph: number;
  /** World-frame position & velocity at y = 50 ft for the pitcher's average pitch. */
  p0: V3;
  v0: V3;
  /** Spin vector (rad/s) that reproduces the measured movement; includes gyro. */
  spin: V3;
  spinRpm: number;
  /** Std. dev. of location around the target (ft) at average command. */
  commandSdFt: number;
  /** Average plate crossing (world) of the untouched average pitch. */
  avgPlate: V3;
}

/** Constant-acceleration Statcast model, solved to the plate plane (validation / reference). */
export function statcastPlateCrossing(k: StatcastKinematics): { t: number; px: number; pz: number } {
  const yf = PLATE_FRONT_Z;
  const a = 0.5 * k.aY;
  const b = k.vY0;
  const c = k.y0 - yf;
  const t = (-b - Math.sqrt(b * b - 4 * a * c)) / (2 * a);
  return {
    t,
    px: k.x0 + k.vX0 * t + 0.5 * k.aX * t * t,
    pz: k.z0 + k.vZ0 * t + 0.5 * k.aZ * t * t,
  };
}

export function calibratePitch(entry: ArsenalPitch, air: Air = SEA_LEVEL_AIR): CalibratedPitch {
  const k = entry.kin;
  const p0 = statcastToWorld(k.x0, k.y0 ?? STATCAST_Y0, k.z0);
  const v0 = statcastToWorld(k.vX0, k.vY0, k.vZ0);
  const aTot = statcastToWorld(k.aX, k.aY, k.aZ);
  const ref = statcastPlateCrossing(k);
  // Mid-flight velocity is the right place to split drag (∥v) from lift (⟂v).
  const vMid = add(v0, scale(aTot, ref.t / 2));
  const vHat = norm(vMid);
  const aNonGrav = sub(aTot, v3(0, -GRAVITY, 0));
  const aT = sub(aNonGrav, scale(vHat, dot(aNonGrav, vHat)));
  const aTMag = len(aT);
  const speedMid = len(vMid);
  const cl = Math.min(0.42, aTMag / (air.k * speedMid * speedMid));
  const s = (0.4 * cl) / Math.max(1e-6, 1 - 2.32 * cl);
  const wPerpMag = (s * speedMid) / BALL_RADIUS_FT;
  const wPerp = aTMag > 1e-6 ? scale(norm(cross(vHat, aT)), wPerpMag) : v3();
  const measuredTotal = (entry.spin ?? wPerpMag / RPM_TO_RADS) * RPM_TO_RADS;
  const gyroMag = Math.sqrt(Math.max(0, measuredTotal ** 2 - wPerpMag ** 2));
  const spin = add(wPerp, scale(vHat, -gyroMag));

  const [sx, sz] = entry.locSd;
  // Location spread includes intentional targeting; ~55% of it is execution error.
  const commandSdFt = 0.55 * Math.hypot(sx ?? 0.75, sz ?? 0.8) / Math.SQRT2;

  const cal: CalibratedPitch = {
    type: entry.type,
    name: entry.name,
    usage: entry.usage,
    speedMph: entry.speed,
    speedSdMph: entry.speedSd ?? 0.9,
    p0,
    v0,
    spin,
    spinRpm: measuredTotal / RPM_TO_RADS,
    commandSdFt,
    avgPlate: v3(),
  };
  cal.avgPlate = flyToPlate({ p: p0, v: v0, w: spin }, air).cross.p;
  return cal;
}

export interface PitchFlight {
  type: string;
  /** Ball state at y = 50 ft. Release (~54 ft) is extrapolated for visuals. */
  start: BallState;
  samples: FlightSample[];
  /** Crossing of the front plate plane. */
  cross: FlightSample;
  /** Statcast-style plate location (px + toward 1B, pz height), ft. */
  px: number;
  pz: number;
  releaseSpeedMph: number;
}

function flyToPlate(start: BallState, air: Air): { cross: FlightSample; samples: FlightSample[] } {
  // Integrate a bit past the plate so the batter can make contact out in front or deep.
  const { samples } = integrateFlight(start, air, (s) => s.p.z <= -1.5 || s.p.y <= 0, {
    dt: 1 / 960,
    maxT: 1.5,
    sampleEvery: 4,
  });
  let cross = samples[samples.length - 1];
  for (let i = 1; i < samples.length; i += 1) {
    const a = samples[i - 1];
    const b = samples[i];
    if (a.p.z >= PLATE_FRONT_Z && b.p.z < PLATE_FRONT_Z) {
      const f = (a.p.z - PLATE_FRONT_Z) / (a.p.z - b.p.z);
      cross = {
        t: a.t + (b.t - a.t) * f,
        p: add(a.p, scale(sub(b.p, a.p), f)),
        v: add(a.v, scale(sub(b.v, a.v), f)),
      };
      break;
    }
  }
  return { cross, samples };
}

export interface ThrowPitchOptions {
  /** Intended plate location, Statcast frame (px + toward 1B side, pz height), ft. */
  targetPx: number;
  targetPz: number;
  /**
   * Execution quality multiplier on command error (1 = the pitcher's real command;
   * human pitching meter maps to ~0.6 (perfect) … 2.2 (poor)).
   */
  commandMult?: number;
  /** Velocity offset from fatigue / max effort, mph. */
  speedDeltaMph?: number;
  air?: Air;
}

/**
 * Throw a pitch at a target with physical execution error. Solves the release
 * direction by Newton shooting (the flight is smooth in v0, so 3 iterations hit < 0.1 in).
 */
export function throwPitch(pitch: CalibratedPitch, opts: ThrowPitchOptions, rng: Rng): PitchFlight {
  const air = opts.air ?? SEA_LEVEL_AIR;
  const sd = pitch.commandSdFt * (opts.commandMult ?? 1);
  const aimPx = opts.targetPx + rng.gauss(0, sd);
  const aimPz = opts.targetPz + rng.gauss(0, sd);
  const speed =
    (pitch.speedMph + (opts.speedDeltaMph ?? 0) + rng.gauss(0, pitch.speedSdMph * 0.8)) / pitch.speedMph;

  // Spin scales with arm speed (≈ constant spin/velo “Bauer units” per pitch).
  const spin = scale(pitch.spin, speed);
  let v0 = scale(pitch.v0, speed);
  const wantX = -aimPx; // world x
  const wantY = aimPz;
  let flight = flyToPlate({ p: pitch.p0, v: v0, w: spin }, air);
  for (let it = 0; it < 4; it += 1) {
    const ex = wantX - flight.cross.p.x;
    const ey = wantY - flight.cross.p.y;
    if (Math.abs(ex) < 0.005 && Math.abs(ey) < 0.005) break;
    const t = flight.cross.t;
    v0 = add(v0, v3(ex / t, ey / t, 0));
    flight = flyToPlate({ p: pitch.p0, v: v0, w: spin }, air);
  }
  return {
    type: pitch.type,
    start: { p: pitch.p0, v: v0, w: spin },
    samples: flight.samples,
    cross: flight.cross,
    px: -flight.cross.p.x,
    pz: flight.cross.p.y,
    releaseSpeedMph: (len(v0) / MPH_TO_FPS) * 1.005,
  };
}

/** Ball position/velocity at time t along a pitch flight (linear interpolation of samples). */
export function pitchStateAt(flight: PitchFlight, t: number): FlightSample {
  const s = flight.samples;
  if (t <= s[0].t) return s[0];
  for (let i = 1; i < s.length; i += 1) {
    if (s[i].t >= t) {
      const a = s[i - 1];
      const b = s[i];
      const f = (t - a.t) / (b.t - a.t);
      return { t, p: add(a.p, scale(sub(b.p, a.p), f)), v: add(a.v, scale(sub(b.v, a.v), f)) };
    }
  }
  return s[s.length - 1];
}

/** Statcast strike zone test for a plate crossing (front plane only). */
export function isStrike(px: number, pz: number, zoneBottom: number, zoneTop: number): boolean {
  return Math.abs(px) <= ZONE_HALF_WIDTH && pz >= zoneBottom - BALL_RADIUS_FT && pz <= zoneTop + BALL_RADIUS_FT;
}

/** Half-width of home plate at depth z (ft from the point): square front half, then the 45° point. */
export function plateHalfWidthAt(z: number): number {
  if (z < 0 || z > PLATE_FRONT_Z) return -1;
  return Math.min(PLATE_HALF_WIDTH, z);
}

/**
 * The rulebook strike: any part of the ball passes through the zone — the volume over
 * the whole five-sided plate, 17 in deep, between the batter's knees and the midpoint of
 * his torso. A ball whose leading edge only clips the back corner, or a breaking ball
 * that drops onto the bottom edge as it crosses the plate, is a strike.
 */
export function crossesZone(flight: PitchFlight, zoneBottom: number, zoneTop: number): boolean {
  return zoneContact(flight, zoneBottom, zoneTop) != null;
}

/**
 * Where the ball touched the zone (Statcast px / pz of its center), or null for a ball.
 * The front-plane crossing when it already touches there; otherwise the first point over
 * the plate where it does (a backdoor breaker or a curve dropping onto the knees).
 */
export function zoneContact(flight: PitchFlight, zoneBottom: number, zoneTop: number): { px: number; pz: number } | null {
  if (isStrike(flight.px, flight.pz, zoneBottom, zoneTop)) return { px: flight.px, pz: flight.pz };
  const vz = Math.abs(flight.cross.v.z) || 130;
  const t0 = flight.cross.t;
  const t1 = t0 + PLATE_FRONT_Z / vz;
  const steps = 10;
  for (let i = 1; i <= steps; i += 1) {
    const s = pitchStateAt(flight, t0 + ((t1 - t0) * i) / steps);
    const half = plateHalfWidthAt(s.p.z);
    if (half < 0) continue;
    const y = s.p.y;
    if (Math.abs(s.p.x) <= half + BALL_RADIUS_FT && y >= zoneBottom - BALL_RADIUS_FT && y <= zoneTop + BALL_RADIUS_FT) return { px: -s.p.x, pz: y };
  }
  return null;
}
