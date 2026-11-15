/**
 * Baseball aerodynamics: gravity + drag + Magnus lift, RK4-integrated.
 *
 * Model follows Alan Nathan's published baseball-flight work (drag coefficient
 * ~0.33–0.35 at game speeds; lift coefficient CL = S / (0.4 + 2.32·S) where
 * S = rω⊥/v is the spin factor). Spin decays slowly (τ ≈ 25 s). Air density
 * comes from park elevation and temperature, so Coors Field really carries.
 */
import { add, cross, dot, len, norm, scale, sub, v3, type V3 } from "@/lib/game/math";

export const GRAVITY = 32.174; // ft/s²
export const BALL_RADIUS_FT = 0.1198; // 9.125 in circumference
const BALL_MASS_KG = 0.1453;
const BALL_AREA_M2 = Math.PI * (BALL_RADIUS_FT * 0.3048) ** 2;
const SPIN_DECAY_TAU_S = 25;

/** Air density (kg/m³) from elevation (ft) and temperature (°F); dry air. */
export function airDensity(elevationFt = 0, tempF = 72): number {
  const elevM = elevationFt * 0.3048;
  const pressurePa = 101325 * Math.exp(-elevM / 8434);
  const tempK = ((tempF - 32) * 5) / 9 + 273.15;
  return pressurePa / (287.05 * tempK);
}

export interface Air {
  /** kg/m³ */
  rho: number;
  /** ½ρA/m expressed per foot (multiplies v² in ft²/s² → ft/s²). */
  k: number;
}

export function makeAir(elevationFt = 0, tempF = 72): Air {
  const rho = airDensity(elevationFt, tempF);
  const kPerM = (0.5 * rho * BALL_AREA_M2) / BALL_MASS_KG;
  return { rho, k: kPerM * 0.3048 };
}

export const SEA_LEVEL_AIR = makeAir(0, 72);

export function liftCoefficient(spinFactor: number): number {
  if (spinFactor <= 0) return 0;
  return spinFactor / (0.4 + 2.32 * spinFactor);
}

/** Slight spin-dependent drag rise, as seen in wind-tunnel / Trackman fits. */
export function dragCoefficient(spinFactor: number): number {
  return 0.36 + 0.1 * Math.min(spinFactor, 0.5);
}

export interface BallState {
  p: V3; // ft
  v: V3; // ft/s
  /** spin vector, rad/s (right-hand rule) */
  w: V3;
}

/** Acceleration on a ball in flight (ft/s²). */
export function ballAccel(v: V3, w: V3, air: Air): V3 {
  const speed = len(v);
  const g = v3(0, -GRAVITY, 0);
  if (speed < 1e-6) return g;
  const vHat = scale(v, 1 / speed);
  // Only the spin component perpendicular to velocity makes lift (gyro spin doesn't).
  const wPerp = sub(w, scale(vHat, dot(w, vHat)));
  const wPerpMag = len(wPerp);
  const s = (BALL_RADIUS_FT * wPerpMag) / speed;
  const q = air.k * speed * speed;
  const drag = scale(vHat, -q * dragCoefficient(s));
  let lift = v3();
  if (wPerpMag > 1e-6) {
    lift = scale(norm(cross(wPerp, v)), q * liftCoefficient(s));
  }
  return add(g, add(drag, lift));
}

/** One RK4 step of free flight. */
export function stepFlight(state: BallState, dt: number, air: Air): BallState {
  const { p, v, w } = state;
  const a1 = ballAccel(v, w, air);
  const v2 = add(v, scale(a1, dt / 2));
  const a2 = ballAccel(v2, w, air);
  const v3_ = add(v, scale(a2, dt / 2));
  const a3 = ballAccel(v3_, w, air);
  const v4 = add(v, scale(a3, dt));
  const a4 = ballAccel(v4, w, air);
  const dv = scale(add(add(a1, scale(a2, 2)), add(scale(a3, 2), a4)), dt / 6);
  const dp = scale(add(add(v, scale(v2, 2)), add(scale(v3_, 2), v4)), dt / 6);
  return { p: add(p, dp), v: add(v, dv), w: scale(w, Math.exp(-dt / SPIN_DECAY_TAU_S)) };
}

export interface FlightSample {
  t: number;
  p: V3;
  v: V3;
}

/** Integrate free flight until `stop` returns true or maxT elapses. */
export function integrateFlight(
  start: BallState,
  air: Air,
  stop: (s: BallState, t: number) => boolean,
  { dt = 1 / 480, maxT = 12, sampleEvery = 4 } = {},
): { samples: FlightSample[]; final: BallState; t: number } {
  let s = start;
  let t = 0;
  let i = 0;
  const samples: FlightSample[] = [{ t, p: s.p, v: s.v }];
  while (t < maxT) {
    s = stepFlight(s, dt, air);
    t += dt;
    i += 1;
    if (i % sampleEvery === 0) samples.push({ t, p: s.p, v: s.v });
    if (stop(s, t)) break;
  }
  if (samples[samples.length - 1].t !== t) samples.push({ t, p: s.p, v: s.v });
  return { samples, final: s, t };
}
