/**
 * Field geometry in world feet, generated from the same Park model the physics uses — so
 * the wall you see is the wall the ball hits. The wall is one closed loop around the whole
 * field (outfield fence, foul-territory walls, backstop), ordered by bearing from home.
 */
import * as THREE from "three";
import type { Park } from "@/lib/game/physics/park";
import { BASES, MOUND } from "@/lib/game/physics/park";
import type { ParkLayout, WallSkin } from "@/lib/game/data/parkLayouts";
import { GeoBuilder } from "@/components/game/scene/parks/geo";

const S2 = Math.SQRT1_2;
const RAD = Math.PI / 180;

/** Height of the world outside the park (a little below the field so nothing z-fights). */
export const GROUND_Y = -2;
/** Mowing-pattern texture footprint in world feet: x ∈ [−320, 320], z ∈ [−100, 540]. */
export const TURF_SPAN = 640;
export const TURF_X0 = -320;
export const TURF_Z0 = -100;

/** Spray angle (deg, + toward RF) → horizontal unit vector in world (x, z). */
export function dirXZ(deg: number): [number, number] {
  const r = deg * RAD;
  return [-Math.sin(r), Math.cos(r)];
}

/** Diamond coordinates (u toward 1B, w toward 3B) → world [x, z]. */
function diamond(u: number, w: number): [number, number] {
  return [(w - u) * S2, (u + w) * S2];
}

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
function foulSide(park: Park, sigma: 1 | -1): Raw[] {
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

export function buildWallLoop(park: Park): WallLoop {
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

/** Rows of the wall texture atlas (8 rows; see parks/textures.ts). */
export const SKIN_ROW: Record<WallSkin, number> = { pad: 0, brick: 1, ivy: 2, monster: 3, board: 4, chain: 5, stone: 6 };

export function skinAt(steps: Array<[number, WallSkin]>, beta: number): WallSkin {
  let k = steps[0][1];
  for (let i = 1; i < steps.length; i += 1) {
    if (beta >= steps[i][0]) k = steps[i][1];
    else break;
  }
  return k;
}

/** Textured wall ribbon around the whole loop (one draw call). */
export function wallGeometry(loop: WallLoop, layout: ParkLayout): THREE.BufferGeometry {
  const b = new GeoBuilder(true);
  const { pts } = loop;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p = pts[i];
    const q = pts[i + 1];
    if (Math.hypot(q.x - p.x, q.z - p.z) < 1e-3) continue;
    const of = p.kind === "of" && q.kind === "of";
    const skin = of ? skinAt(layout.skins, (p.beta + q.beta) / 2) : layout.foulSkin;
    const row = SKIN_ROW[skin];
    const v0 = 1 - (row + 1) / 8 + 0.008;
    const v1 = 1 - row / 8 - 0.008;
    const tint = skin === "pad" || skin === "monster" ? layout.wall : "#ffffff";
    const bands = Math.max(1, Math.ceil(Math.max(p.h, q.h) / 10));
    const u0 = p.s / 64;
    const u1 = q.s / 64;
    for (let k = 0; k < bands; k += 1) {
      const f0 = k / bands;
      const f1 = (k + 1) / bands;
      b.quadUv([p.x, p.h * f0, p.z], [q.x, q.h * f0, q.z], [q.x, q.h * f1, q.z], [p.x, p.h * f1, p.z], [u0, v0], [u1, v0], [u1, v1], [u0, v1], tint);
    }
  }
  return b.build();
}

/** Yellow home-run line along the outfield fence and a trim cap on the foul walls. */
export function wallCaps(loop: WallLoop, b: GeoBuilder, trim: string): void {
  const { pts } = loop;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p = pts[i];
    const q = pts[i + 1];
    if (Math.hypot(q.x - p.x, q.z - p.z) < 1e-3) continue;
    const of = p.kind === "of" && q.kind === "of";
    const d = of ? 0.5 : 0.35;
    const o = 0.08;
    const c = of ? "#e7c23b" : trim;
    b.quad(
      [p.x - p.nx * o, p.h - d, p.z - p.nz * o],
      [q.x - q.nx * o, q.h - d, q.z - q.nz * o],
      [q.x - q.nx * o, q.h + 0.04, q.z - q.nz * o],
      [p.x - p.nx * o, p.h + 0.04, p.z - p.nz * o],
      c,
    );
    // Top of the wall (it has a little thickness seen from above).
    b.quad([p.x - p.nx * o, p.h + 0.04, p.z - p.nz * o], [q.x - q.nx * o, q.h + 0.04, q.z - q.nz * o], [q.x + q.nx, q.h + 0.04, q.z + q.nz], [p.x + p.nx, p.h + 0.04, p.z + p.nz], c, 0.8);
  }
}

/** Playing surface: the polygon inside the wall loop, with UVs spanning the mowing texture. */
export function fieldGrass(loop: WallLoop): THREE.BufferGeometry {
  const ring: THREE.Vector2[] = [];
  for (const p of loop.pts) {
    const last = ring[ring.length - 1];
    if (!last || Math.hypot(last.x - p.x, last.y + p.z) > 1e-3) ring.push(new THREE.Vector2(p.x, -p.z));
  }
  if (ring.length > 1 && ring[0].distanceTo(ring[ring.length - 1]) < 1e-3) ring.pop();
  const g = new THREE.ShapeGeometry(new THREE.Shape(ring));
  g.rotateX(-Math.PI / 2);
  const pos = g.getAttribute("position");
  const uv = g.getAttribute("uv");
  for (let i = 0; i < pos.count; i += 1) uv.setXY(i, (pos.getX(i) - TURF_X0) / TURF_SPAN, (pos.getZ(i) - TURF_Z0) / TURF_SPAN);
  uv.needsUpdate = true;
  return g;
}

function circlePts(cx: number, cz: number, r: number, n: number, a0: number, a1: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i <= n; i += 1) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
  }
  return out;
}

/** Infield skin outline: the 95 ft arc around the rubber inside the foul lines (+6 ft). */
function infieldOutline(): Array<[number, number]> {
  const R = 95;
  const margin = 6;
  const lineEnd = (sideSign: number): [number, number] => {
    const d: [number, number] = [sideSign * S2, S2];
    const n: [number, number] = [sideSign * S2, -S2];
    let lo = 0;
    let hi = 200;
    for (let i = 0; i < 40; i += 1) {
      const s = (lo + hi) / 2;
      if (Math.hypot(s * d[0] + margin * n[0] - MOUND.x, s * d[1] + margin * n[1] - MOUND.z) < R) lo = s;
      else hi = s;
    }
    return [lo * d[0] + margin * n[0], lo * d[1] + margin * n[1]];
  };
  const rb = lineEnd(-1);
  const lb = lineEnd(1);
  const aR = Math.atan2(rb[1] - MOUND.z, rb[0] - MOUND.x);
  const aL = Math.atan2(lb[1] - MOUND.z, lb[0] - MOUND.x);
  return [[0, -margin * Math.SQRT2], rb, ...circlePts(MOUND.x, MOUND.z, R, 64, aR, aL).slice(1, -1), lb];
}

/** Where the on-deck circles sit (world x, z), 3B side first. */
export function onDeckSpots(loop: WallLoop): Array<[number, number]> {
  return [-102, 102].map((beta) => {
    const w = loop.atBeta(beta);
    const r = Math.min(38, Math.hypot(w.x, w.z) - 9);
    const [dx, dz] = dirXZ(beta);
    return [dx * r, dz * r] as [number, number];
  });
}

/**
 * Everything painted or laid on the grass, merged into one vertex-colored mesh: infield
 * skin, base cutouts, mound, warning tracks, on-deck circles, chalk, bases and the plate.
 */
export function fieldMarks(park: Park, loop: WallLoop): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const turf = park.turf;
  const dirt = turf ? "#8a7361" : "#b8845c";
  const track = turf ? "#7a6657" : "#93694b";
  const chalk = "#f4f1ea";
  const { pts } = loop;

  // Warning tracks: 15 ft inside the outfield fence, 9 ft inside the foul walls and backstop.
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p = pts[i];
    const q = pts[i + 1];
    if (Math.hypot(q.x - p.x, q.z - p.z) < 1e-3) continue;
    const w = p.kind === "of" && q.kind === "of" ? 15 : 9;
    b.quad([p.x + p.nx * 0.5, 0.035, p.z + p.nz * 0.5], [q.x + q.nx * 0.5, 0.035, q.z + q.nz * 0.5], [q.x - q.nx * w, 0.035, q.z - q.nz * w], [p.x - p.nx * w, 0.035, p.z - p.nz * w], track);
  }
  // Infield skin with the grass square cut out.
  const hole = [diamond(4, 4), diamond(86, 4), diamond(86, 86), diamond(4, 86)];
  b.poly(infieldOutline(), [hole], 0.04, dirt);
  b.disc(0, 0.05, 0, 13, dirt, 36);
  for (const base of [BASES.first, BASES.second, BASES.third]) b.disc(base.x, 0.045, base.z, 9, dirt, 28);
  // Pitcher's mound: a low dome, 10 in high at the rubber.
  b.cyl(MOUND.x, 0.04, MOUND.z, 9, 1.2, 0.83, dirt, 32);
  for (const [x, z] of onDeckSpots(loop)) {
    b.disc(x, 0.05, z, 2.6, dirt, 16);
    b.disc(x, 0.07, z, 1.1, chalk, 12, 0.92);
  }

  // Chalk.
  const yC = 0.1;
  const strip = (ax: number, az: number, bx: number, bz: number, w: number) => {
    const dx = bx - ax;
    const dz = bz - az;
    const l = Math.hypot(dx, dz) || 1;
    const nx = (-dz / l) * (w / 2);
    const nz = (dx / l) * (w / 2);
    b.quad([ax + nx, yC, az + nz], [bx + nx, yC, bz + nz], [bx - nx, yC, bz - nz], [ax - nx, yC, az - nz], chalk);
  };
  const lf = park.fence(-45);
  const rf = park.fence(45);
  strip(0, 0, -rf * S2, rf * S2, 0.33);
  strip(0, 0, lf * S2, lf * S2, 0.33);
  for (const sx of [1, -1]) {
    // Batter's boxes (4 × 6 ft, 6 in off the plate).
    const x0 = sx * 0.71;
    const x1 = sx * 4.71;
    strip(x0, -2.3, x0, 3.7, 0.25);
    strip(x1, -2.3, x1, 3.7, 0.25);
    strip(x0, 3.7, x1, 3.7, 0.25);
    strip(x0, -2.3, x1, -2.3, 0.25);
    // Catcher's box.
    strip(sx * 1.8, -2.3, sx * 1.8, -8, 0.25);
    // Coach's boxes, 15 ft outside the lines.
    const c0 = diamond(sx > 0 ? -15 : 70, sx > 0 ? 70 : -15);
    const c1 = diamond(sx > 0 ? -15 : 90, sx > 0 ? 90 : -15);
    strip(c0[0], c0[1], c1[0], c1[1], 0.25);
  }
  strip(-1.8, -8, 1.8, -8, 0.25);

  // Bases, plate, rubber.
  for (const base of [BASES.first, BASES.second, BASES.third]) b.box(base.x, 0.14, base.z, 1.5, 0.24, 1.5, Math.PI / 4, "#fbfbf8");
  const yP = 0.11;
  const plate: Array<[number, number]> = [[0, 0], [0.708, 0.708], [0.708, 1.417], [-0.708, 1.417], [-0.708, 0.708]];
  for (let i = 1; i < plate.length - 1; i += 1) b.tri([plate[0][0], yP, plate[0][1]], [plate[i][0], yP, plate[i][1]], [plate[i + 1][0], yP, plate[i + 1][1]], "#fbfbf8");
  b.box(MOUND.x, 0.9, MOUND.z, 2, 0.1, 0.5, 0, "#fbfbf8");
  return b.build();
}
