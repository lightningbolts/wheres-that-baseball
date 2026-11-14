/**
 * Game world frame (all physics): 1 unit = 1 foot.
 *   origin = point of home plate, +Y up, +Z toward the pitcher / center field,
 *   +X toward the third-base side (right-handed, so -X is the first-base / RF side).
 * Statcast (x toward catcher's right = 1B, y toward mound, z up) maps as
 *   world = (-sx, sz, sy).
 */

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export const v3 = (x = 0, y = 0, z = 0): V3 => ({ x, y, z });
export const add = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a: V3, s: number): V3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const dot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: V3, b: V3): V3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export const len = (a: V3): number => Math.hypot(a.x, a.y, a.z);
export const norm = (a: V3): V3 => {
  const l = len(a);
  return l > 1e-12 ? scale(a, 1 / l) : v3();
};
export const lerp3 = (a: V3, b: V3, t: number): V3 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t,
});
export const horizDist = (a: V3, b: V3 = v3()): number => Math.hypot(a.x - b.x, a.z - b.z);

export const DEG = Math.PI / 180;
export const MPH_TO_FPS = 5280 / 3600;
export const FPS_TO_MPH = 1 / MPH_TO_FPS;
export const RPM_TO_RADS = (2 * Math.PI) / 60;

/** Statcast feet → world feet. */
export const statcastToWorld = (sx: number, sy: number, sz: number): V3 => ({ x: -sx, y: sz, z: sy });

/**
 * Spray angle in degrees for a horizontal world position, 0 = straight to CF,
 * positive toward right field (MLB convention), ±45 = foul lines.
 */
export const sprayAngleDeg = (p: V3): number => Math.atan2(-p.x, p.z) / DEG;

/** Horizontal unit direction for a spray angle (degrees, + toward RF). */
export const sprayDir = (deg: number): V3 => ({ x: -Math.sin(deg * DEG), y: 0, z: Math.cos(deg * DEG) });

export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/** Deterministic, seedable RNG (mulberry32) — sims and replays must be reproducible. */
export class Rng {
  private s: number;
  private spare: number | null = null;

  constructor(seed: number) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }

  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Standard normal (Box–Muller, caches the pair). */
  gauss(mean = 0, sd = 1): number {
    if (this.spare != null) {
      const s = this.spare;
      this.spare = null;
      return mean + sd * s;
    }
    let u = 0;
    while (u <= 1e-12) u = this.next();
    const v = this.next();
    const mag = Math.sqrt(-2 * Math.log(u));
    this.spare = mag * Math.sin(2 * Math.PI * v);
    return mean + sd * mag * Math.cos(2 * Math.PI * v);
  }

  pickWeighted<T>(items: readonly T[], weight: (t: T) => number): T {
    const total = items.reduce((s, it) => s + Math.max(0, weight(it)), 0);
    let roll = this.next() * total;
    for (const it of items) {
      roll -= Math.max(0, weight(it));
      if (roll <= 0) return it;
    }
    return items[items.length - 1];
  }

  /** Serializable state, for save / resume. */
  get state(): number {
    return this.s;
  }
}
