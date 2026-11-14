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
import { buildWallLoop, dirXZ, type WallLoop, type WallPoint, type WallSample, type WallKind } from "@/lib/game/physics/wallLoop";

export { buildWallLoop, dirXZ };
export type { WallLoop, WallPoint, WallSample, WallKind };

const S2 = Math.SQRT1_2;
const RAD = Math.PI / 180;

/** Height of the world outside the park (a little below the field so nothing z-fights). */
export const GROUND_Y = -2;
/** Mowing-pattern texture footprint in world feet: x ∈ [−320, 320], z ∈ [−100, 540]. */
export const TURF_SPAN = 640;
export const TURF_X0 = -320;
export const TURF_Z0 = -100;

/** Diamond coordinates (u toward 1B, w toward 3B) → world [x, z]. */
function diamond(u: number, w: number): [number, number] {
  return [(w - u) * S2, (u + w) * S2];
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
    // Padding is painted dark; upright faces only catch a grazing key light, so lift the
    // paint or the whole fence reads as a black band.
    const lift = skin === "pad" || skin === "monster" ? 2.1 : 1.25;
    const bands = Math.max(1, Math.ceil(Math.max(p.h, q.h) / 10));
    const u0 = p.s / 64;
    const u1 = q.s / 64;
    for (let k = 0; k < bands; k += 1) {
      const f0 = k / bands;
      const f1 = (k + 1) / bands;
      b.quadUv([p.x, p.h * f0, p.z], [q.x, q.h * f0, q.z], [q.x, q.h * f1, q.z], [p.x, p.h * f1, p.z], [u0, v0], [u1, v0], [u1, v1], [u0, v1], tint, lift);
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
