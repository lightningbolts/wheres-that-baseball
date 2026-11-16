/** Human movement timing: fielders and baserunners accelerate, then hold top speed. */
import { BASES } from "@/lib/game/physics/park";
import { MPH_TO_FPS, type V3 } from "@/lib/game/math";

export const RUN_ACCEL = 15; // ft/s² — roughly 0→27 ft/s in 1.8 s

/** Time (s) to cover d feet from a standstill with top speed vmax. */
export function runTime(d: number, vmax: number, accel = RUN_ACCEL): number {
  if (d <= 0) return 0;
  const dAccel = (vmax * vmax) / (2 * accel);
  if (d <= dAccel) return Math.sqrt((2 * d) / accel);
  return vmax / accel + (d - dAccel) / vmax;
}

/** Distance covered after t seconds from a standstill. */
export function runDistance(t: number, vmax: number, accel = RUN_ACCEL): number {
  if (t <= 0) return 0;
  const tAccel = vmax / accel;
  if (t <= tAccel) return 0.5 * accel * t * t;
  return 0.5 * accel * tAccel * tAccel + vmax * (t - tAccel);
}

/** Time to run between consecutive bases already at speed (rounding a base costs ~0.35 s). */
export function baseToBaseAtSpeed(vmax: number): number {
  return 90 / vmax + 0.35;
}

/** Share of max arm a fielder puts on a game throw. */
const GAME_EFFORT = 0.88;

/**
 * Comfortable throwing range (ft) for a Savant arm strength (mph): on a line or one
 * hop, accurate, full speed — ~190 ft for a 78 mph arm, ~250 average (88), ~310 a cannon (98).
 */
export function throwRange(armMph: number): number {
  return Math.min(340, Math.max(160, 250 + (armMph - 88) * 6));
}

/**
 * Flight time (s) of one throw of `d` ft. Inside the comfortable range it's a line
 * drive slowed a little by drag; past it the ball is lofted / bounces and dies, each
 * foot beyond the range costing ~1.8x a foot inside it. (Relays are planned in throws.ts.)
 */
export function legTime(d: number, armMph: number): number {
  const v = armMph * MPH_TO_FPS * GAME_EFFORT;
  const range = throwRange(armMph);
  return (d / v) * (1 + d / 1200) + (d > range ? ((d - range) / v) * 0.8 : 0);
}

/** A direct throw's flight time (s) between two points. */
export function throwTime(from: V3, to: V3, armMph: number): number {
  return legTime(Math.hypot(to.x - from.x, to.z - from.z), armMph);
}

export const BASE_POS: Record<1 | 2 | 3 | 4, V3> = {
  1: BASES.first,
  2: BASES.second,
  3: BASES.third,
  4: BASES.home,
};
