/**
 * The closed wall loop around the whole field (outfield fence, foul-territory walls,
 * backstop), ordered by bearing from home. Shared by the physics (where the ball leaves
 * play, where a fielder can stand) and the renderer, so the wall you see is the wall
 * the ball and the fielders respect.
 */
import type { Park } from "@/lib/game/physics/park";

const RAD = Math.PI / 180;

/** Spray angle (deg, + toward RF) → horizontal unit vector in world (x, z). */
export function dirXZ(deg: number): [number, number] {
  const r = deg * RAD;
  return [-Math.sin(r), Math.cos(r)];
}

/** The parts of a park the wall loop is built from. */
export type WallPark = Pick<Park, "fence" | "wallHeight" | "wallBreaks" | "foulSpace" | "backstop">;

export type WallKind = "of" | "foul" | "back";

export interface WallSample {
  x: number;
  z: number;
  /** Wall height, ft. */
  h: number;
  /** Outward unit normal (away from the field). */
  nx: number;
  nz: number;
  /** Bearing from home, degrees (−180..180, 0 = center field, + toward right field). */
  beta: number;
  /** Arc length along the loop from the point directly behind home, ft. */
  s: number;
}

export interface WallPoint extends WallSample {
  kind: WallKind;
}

export interface WallLoop {
  pts: WallPoint[];
  length: number;
  /** Wall at an arc length. */
  at(s: number): WallSample;
  /** Arc length where the wall crosses a bearing. */
  sOf(beta: number): number;
  atBeta(beta: number): WallSample;
}

const FOUL_H = 4.5;
const BACK_H = 5;
const smooth = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

type Raw = Pick<WallPoint, "x" | "z" | "h" | "beta" | "kind">;

/** One foul side, from the pole around to the point directly behind home. */
function foulSide(park: WallPark, sigma: 1 | -1): Raw[] {
  const L = park.fence(sigma * 45);
  const off = park.foulSpace;
  const B = Math.max(park.backstop, off + 6);
  // The stands close in on the line toward the pole.
  const wEnd = Math.max(16, off * 0.5);
  const [ux, uz] = dirXZ(sigma * 45);
  const [px, pz] = dirXZ(sigma * 135);
  const out: Raw[] = [];
  const add = (s: number, w: number, kind: WallKind) =>
    out.push({
      x: s * ux + w * px,
      z: s * uz + w * pz,
      h: kind === "back" ? BACK_H : FOUL_H,
      beta: sigma * (45 + Math.atan2(w, s) / RAD),
      kind,
    });
  add(L, 0, "foul");
  add(L, wEnd * 0.5, "foul");
  add(L, wEnd, "foul");
  const t0 = 0.6 * L;
  const side = (to: number) => {
    for (let s = L - 10; s > to + 4; s -= 10) add(s, off + (wEnd - off) * smooth((s - t0) / (L - t0)), "foul");
    add(to, off, "foul");
  };
  if (off * Math.SQRT2 < B + 2) {
    // Tight foul ground: the two side walls would meet before reaching the backstop
    // circle, so close them with a flat wall behind the plate instead.
    const d0 = off * Math.SQRT2 - 8;
    side(off - d0 * Math.SQRT2);
    const c = d0 * Math.SQRT1_2;
    for (const f of [0.5, 1]) add(off - d0 * Math.SQRT2 + (-c - (off - d0 * Math.SQRT2)) * f, off + (c - off) * f, "back");
    return out;
  }
  const sB = -Math.sqrt(B * B - off * off);
  side(sB);
  const a0 = Math.atan2(off, sB);
  const a1 = 135 * RAD;
  const n = Math.max(2, Math.ceil((a1 - a0) / (5 * RAD)));
  for (let i = 1; i <= n; i += 1) {
    const a = a0 + ((a1 - a0) * i) / n;
    add(B * Math.cos(a), B * Math.sin(a), "back");
  }
  return out;
}

export function buildWallLoop(park: WallPark): WallLoop {
  const raw: Raw[] = [...foulSide(park, -1).reverse()];
  const breaks = park.wallBreaks.filter((b) => b > -45 && b < 45);
  const angles = new Set<number>(breaks);
  for (let a = -45; a <= 45; a += 1) angles.add(a);
  for (const a of [...angles].sort((p, q) => p - q)) {
    const [dx, dz] = dirXZ(a);
    const f = park.fence(a);
    if (breaks.includes(a)) raw.push({ x: dx * f, z: dz * f, h: park.wallHeight(a - 1e-4), beta: a, kind: "of" });
    raw.push({ x: dx * f, z: dz * f, h: park.wallHeight(a), beta: a, kind: "of" });
  }
  raw.push(...foulSide(park, 1));

  const n = raw.length;
  const pts: WallPoint[] = [];
  let s = 0;
  for (let i = 0; i < n; i += 1) {
    if (i > 0) s += Math.hypot(raw[i].x - raw[i - 1].x, raw[i].z - raw[i - 1].z);
    pts.push({ ...raw[i], nx: 0, nz: 0, s });
  }
  const same = (a: Raw, b: Raw) => Math.hypot(a.x - b.x, a.z - b.z) < 1e-3;
  for (let i = 0; i < n; i += 1) {
    const p = pts[i];
    let j = (i - 1 + n) % n;
    while (j !== i && same(pts[j], p)) j = (j - 1 + n) % n;
    let k = (i + 1) % n;
    while (k !== i && same(pts[k], p)) k = (k + 1) % n;
    let nx = pts[k].z - pts[j].z;
    let nz = -(pts[k].x - pts[j].x);
    const l = Math.hypot(nx, nz) || 1;
    nx /= l;
    nz /= l;
    if (nx * p.x + nz * p.z < 0) {
      nx = -nx;
      nz = -nz;
    }
    p.nx = nx;
    p.nz = nz;
  }

  const lerp = (a: WallPoint, b: WallPoint, f: number): WallSample => {
    let nx = a.nx + (b.nx - a.nx) * f;
    let nz = a.nz + (b.nz - a.nz) * f;
    const l = Math.hypot(nx, nz) || 1;
    nx /= l;
    nz /= l;
    return {
      x: a.x + (b.x - a.x) * f,
      z: a.z + (b.z - a.z) * f,
      h: a.h + (b.h - a.h) * f,
      nx,
      nz,
      beta: a.beta + (b.beta - a.beta) * f,
      s: a.s + (b.s - a.s) * f,
    };
  };
  const search = (key: "s" | "beta", v: number): [number, number] => {
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (pts[mid][key] <= v) lo = mid;
      else hi = mid;
    }
    const d = pts[hi][key] - pts[lo][key];
    return [lo, d > 1e-9 ? Math.min(1, Math.max(0, (v - pts[lo][key]) / d)) : 0];
  };
  const at = (sv: number): WallSample => {
    const [i, f] = search("s", Math.min(s, Math.max(0, sv)));
    return lerp(pts[i], pts[Math.min(n - 1, i + 1)], f);
  };
  const sOf = (beta: number): number => {
    const [i, f] = search("beta", Math.min(180, Math.max(-180, beta)));
    const a = pts[i];
    const b = pts[Math.min(n - 1, i + 1)];
    return a.s + (b.s - a.s) * f;
  };
  return { pts, length: s, at, sOf, atBeta: (beta) => at(sOf(beta)) };
}

