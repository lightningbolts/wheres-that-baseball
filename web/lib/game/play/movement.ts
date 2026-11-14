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

/** A thrown ball's flight time (s): fielders throw ~88% of max arm on game throws; long throws bounce/relay. */
export function throwTime(from: V3, to: V3, armMph: number): number {
  const d = Math.hypot(to.x - from.x, to.z - from.z);
  const v = armMph * MPH_TO_FPS * 0.88;
  // Air drag slows long throws; beyond ~250 ft a cutoff relay costs extra.
  const dragPenalty = 1 + d / 1200;
  const relay = d > 250 ? 0.45 : 0;
  return (d / v) * dragPenalty + relay;
}

export const BASE_POS: Record<1 | 2 | 3 | 4, V3> = {
  1: BASES.first,
  2: BASES.second,
  3: BASES.third,
  4: BASES.home,
};
