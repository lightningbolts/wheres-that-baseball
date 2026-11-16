/**
 * Serializable seeded RNG (mulberry32). Franchise state stores the single 32-bit
 * state so a saved league resumes the exact same random stream.
 */
export class FRng {
  s: number;

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

  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Standard normal (Box–Muller, no cached spare so the state stays one number). */
  gauss(mean = 0, sd = 1): number {
    let u = 0;
    while (u <= 1e-12) u = this.next();
    const v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }

  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.next() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }
}

/** Stable 32-bit hash of numbers/strings (deterministic per-player noise). */
export function hash32(...parts: Array<number | string>): number {
  let h = 2166136261 >>> 0;
  for (const part of parts) {
    const s = String(part);
    for (let i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    h ^= 0x2f;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** Uniform [0,1) from a hash. */
export function hashUnit(...parts: Array<number | string>): number {
  return new FRng(hash32(...parts)).next();
}
