/**
 * Field and stadium geometry in world feet, generated from the same Park model the
 * physics uses — so the wall you see is the wall the ball hits.
 */
import * as THREE from "three";
import type { Park } from "@/lib/game/physics/park";
import { MOUND } from "@/lib/game/physics/park";

const S2 = Math.SQRT1_2;

/** Spray angle (deg, + toward RF) → horizontal unit vector in world (x, z). */
export function dirXZ(deg: number): [number, number] {
  const r = (deg * Math.PI) / 180;
  return [-Math.sin(r), Math.cos(r)];
}

/** Diamond coordinates (u toward 1B, w toward 3B) → world [x, z]. */
function diamond(u: number, w: number): [number, number] {
  return [(w - u) * S2, (u + w) * S2];
}

/** Ground shape builder: shape in the XY plane where shape y = world −z (so rotation −π/2 about X maps it flat). */
function toShapePts(pts: Array<[number, number]>): THREE.Vector2[] {
  return pts.map(([x, z]) => new THREE.Vector2(x, -z));
}

function flatGeometry(shape: THREE.Shape, y: number, segments = 1): THREE.BufferGeometry {
  const g = new THREE.ShapeGeometry(shape, segments);
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  return g;
}

function circlePts(cx: number, cz: number, r: number, n = 48, a0 = 0, a1 = Math.PI * 2): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i <= n; i += 1) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
  }
  return out;
}

/** Infield skin: the 95 ft arc around the rubber, inside the foul lines (+6 ft), minus the grass square. */
export function infieldDirt(): THREE.BufferGeometry {
  const R = 95;
  // Points of the circle around the mound whose spray angle is within ±(45°+margin).
  const pts: Array<[number, number]> = [];
  const margin = 6;
  // Walk along the 1B line (offset outward into foul by `margin`) out to the arc.
  const lineEnd = (sideSign: number): [number, number] => {
    // On the line offset: p = s·d + margin·n; find s where |p − mound| = R.
    const d: [number, number] = [sideSign * S2, S2];
    const n: [number, number] = [sideSign * S2, -S2];
    let lo = 0;
    let hi = 200;
    for (let i = 0; i < 40; i += 1) {
      const s = (lo + hi) / 2;
      const x = s * d[0] + margin * n[0];
      const z = s * d[1] + margin * n[1];
      if (Math.hypot(x - MOUND.x, z - MOUND.z) < R) lo = s;
      else hi = s;
    }
    return [lo * d[0] + margin * n[0], lo * d[1] + margin * n[1]];
  };
  const rb = lineEnd(-1); // 1B side (−x)
  const lb = lineEnd(1); // 3B side (+x)
  const aR = Math.atan2(rb[1] - MOUND.z, rb[0] - MOUND.x);
  const aL = Math.atan2(lb[1] - MOUND.z, lb[0] - MOUND.x);
  pts.push([0, -margin * Math.SQRT2]);
  pts.push(rb);
  // Arc from the 1B end over the top (through +z) to the 3B end: angle decreases from ~162° to ~18°.
  pts.push(...circlePts(MOUND.x, MOUND.z, R, 64, aR, aL).slice(1, -1));
  pts.push(lb);
  const shape = new THREE.Shape(toShapePts(pts));
  // Grass square inside the base paths.
  const hole = [diamond(4, 4), diamond(86, 4), diamond(86, 86), diamond(4, 86)];
  shape.holes.push(new THREE.Path(toShapePts([...hole].reverse())));
  return flatGeometry(shape, 0.03);
}

export function dirtCircle(cx: number, cz: number, r: number, y: number): THREE.BufferGeometry {
  const g = new THREE.CircleGeometry(r, 48);
  g.rotateX(-Math.PI / 2);
  g.translate(cx, y, cz);
  return g;
}

/** Pitcher's mound: a low dome (10 in high at the rubber, 18 ft across). */
export function moundGeometry(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(1.2, 9, 0.83, 40, 3);
  g.translate(MOUND.x, 0.83 / 2 + 0.03, MOUND.z);
  return g;
}

/** Warning track: 15 ft ribbon inside the fence, foul pole to foul pole. */
export function warningTrack(park: Park): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const steps = 90;
  for (let i = 0; i <= steps; i += 1) {
    const a = -46 + (92 * i) / steps;
    const [dx, dz] = dirXZ(a);
    const f = park.fence(a);
    pos.push(dx * (f - 15), 0.035, dz * (f - 15), dx * (f + 0.5), 0.035, dz * (f + 0.5));
    if (i < steps) {
      const k = i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Wall path: list of points along the top of every wall (outfield fence + foul walls + backstop). */
export interface WallPoint {
  x: number;
  z: number;
  h: number;
  /** Outward unit normal (away from the field). */
  nx: number;
  nz: number;
}

export function wallPath(park: Park): WallPoint[] {
  const out: WallPoint[] = [];
  const foulH = 4.5;
  const push = (x: number, z: number, h: number) => out.push({ x, z, h, nx: 0, nz: 0 });
  // 3B/LF foul wall from the backstop out to the LF pole, then the outfield fence to RF, then back.
  const off = park.foulSpace;
  const s0 = Math.sqrt(Math.max(0, park.backstop ** 2 - off ** 2));
  const lineDist = (a: number) => park.fence(a);
  // Backstop arc behind home, from the 1B-side wall to the 3B-side wall.
  const pA = [(-s0 - off) * S2, (s0 - off) * S2]; // 1B side
  const pB = [(s0 + off) * S2, (s0 - off) * S2]; // 3B side
  const aA = Math.atan2(pA[1], pA[0]);
  const aB = Math.atan2(pB[1], pB[0]);
  for (let i = 0; i <= 24; i += 1) {
    const a = aA + ((aB - aA) * i) / 24;
    push(Math.cos(a) * park.backstop, Math.sin(a) * park.backstop, 9);
  }
  // 3B-side foul wall out to the LF corner.
  const lf = lineDist(-45);
  for (let s = s0 + 20; s < lf; s += 20) push((s + off) * S2, (s - off) * S2, foulH);
  push((lf + off) * S2, (lf - off) * S2, foulH);
  // Outfield fence pole to pole.
  for (let a = -45; a <= 45.001; a += 1) {
    const [dx, dz] = dirXZ(a);
    const f = park.fence(a);
    push(dx * f, dz * f, park.wallHeight(a));
  }
  const rf = lineDist(45);
  push(-(rf + off) * S2, (rf - off) * S2, foulH);
  for (let s = Math.floor((rf - 1) / 20) * 20; s > s0 + 10; s -= 20) push(-(s + off) * S2, (s - off) * S2, foulH);
  // Close the loop at the backstop start.
  push(pA[0], pA[1], 9);
  // Normals: perpendicular to the path, pointing away from the field center.
  const c = { x: 0, z: 150 };
  for (let i = 0; i < out.length; i += 1) {
    const a = out[Math.max(0, i - 1)];
    const b = out[Math.min(out.length - 1, i + 1)];
    let nx = b.z - a.z;
    let nz = -(b.x - a.x);
    const l = Math.hypot(nx, nz) || 1;
    nx /= l;
    nz /= l;
    const p = out[i];
    // Behind home, "outward" is away from home plate, not the field center.
    const ref = p.z < 30 ? { x: 0, z: 30 } : c;
    if (nx * (p.x - ref.x) + nz * (p.z - ref.z) < 0) {
      nx = -nx;
      nz = -nz;
    }
    p.nx = nx;
    p.nz = nz;
  }
  return out;
}

/** Vertical wall ribbon along the path (padding), with the top cap stripe as a second geometry. */
export function wallGeometry(path: WallPoint[]): { wall: THREE.BufferGeometry; cap: THREE.BufferGeometry } {
  const pos: number[] = [];
  const cap: number[] = [];
  const idx: number[] = [];
  path.forEach((p, i) => {
    pos.push(p.x, 0, p.z, p.x, p.h, p.z);
    cap.push(p.x, p.h - 0.6, p.z, p.x, p.h + 0.05, p.z);
    if (i < path.length - 1) {
      const k = i * 2;
      idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
  });
  const make = (arr: number[]) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };
  return { wall: make(pos), cap: make(cap) };
}

/**
 * Seating bowl: tiers rising outward from the wall tops. Returns the bowl mesh
 * and seat positions for the instanced crowd.
 */
export function bowlGeometry(path: WallPoint[]): { bowl: THREE.BufferGeometry; seats: Float32Array; seatYaw: Float32Array } {
  const rowsPer = 28;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const seats: number[] = [];
  const yaws: number[] = [];
  const profile = (p: WallPoint, outfield: boolean) => {
    // (horizontal offset, height) pairs: a walkway, lower bowl, concourse, upper deck.
    const base = p.h + 0.5;
    return outfield
      ? [
          [0, base],
          [6, base],
          [70, base + 30],
          [78, base + 30],
          [130, base + 62],
        ]
      : [
          [0, base],
          [4, base],
          [80, base + 32],
          [92, base + 34],
          [96, base + 52],
          [160, base + 92],
        ];
  };
  const isOF = (p: WallPoint) => Math.hypot(p.x, p.z) > 240;
  const profiles = path.map((p) => profile(p, isOF(p)));
  const nProf = Math.max(...profiles.map((x) => x.length));
  const at = (pr: number[][], k: number) => pr[Math.min(k, pr.length - 1)];
  const concrete = [0.48, 0.49, 0.52];
  const seat = [0.1, 0.16, 0.3];
  path.forEach((p, i) => {
    const pr = profiles[i];
    for (let k = 0; k < nProf; k += 1) {
      const [o, h] = at(pr, k);
      pos.push(p.x + p.nx * o, h, p.z + p.nz * o);
      const isSeat = k === 2 || k === nProf - 1;
      const c = isSeat ? seat : concrete;
      col.push(c[0], c[1], c[2]);
    }
    if (i < path.length - 1) {
      for (let k = 0; k < nProf - 1; k += 1) {
        const a = i * nProf + k;
        const b = (i + 1) * nProf + k;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
      // Crowd seats on the sloped seating sections.
      const q = path[i + 1];
      const segLen = Math.hypot(q.x - p.x, q.z - p.z);
      const yaw = Math.atan2(-p.nx, -p.nz);
      for (const [k0, k1] of pr.length === 5 ? [[1, 2], [3, 4]] : [[1, 2], [4, 5]]) {
        const A = at(pr, k0);
        const B = at(pr, k1);
        const rows = Math.max(2, Math.round(((B[0] - A[0]) / 80) * rowsPer));
        const perRow = Math.max(1, Math.floor(segLen / 2.1));
        for (let r = 0; r < rows; r += 1) {
          const f = (r + 0.5) / rows;
          const o = A[0] + (B[0] - A[0]) * f;
          const h = A[1] + (B[1] - A[1]) * f;
          for (let s = 0; s < perRow; s += 1) {
            const g = (s + 0.5) / perRow;
            const x = p.x + (q.x - p.x) * g + p.nx * o;
            const z = p.z + (q.z - p.z) * g + p.nz * o;
            seats.push(x, h, z);
            yaws.push(yaw);
          }
        }
      }
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return { bowl: g, seats: new Float32Array(seats), seatYaw: new Float32Array(yaws) };
}

/** Thin chalk strip from a to b on the ground. */
export function chalkStrip(ax: number, az: number, bx: number, bz: number, w: number, y = 0.06): THREE.BufferGeometry {
  const dx = bx - ax;
  const dz = bz - az;
  const l = Math.hypot(dx, dz) || 1;
  const nx = (-dz / l) * (w / 2);
  const nz = (dx / l) * (w / 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([ax + nx, y, az + nz, ax - nx, y, az - nz, bx + nx, y, bz + nz, bx - nx, y, bz - nz], 3),
  );
  g.setIndex([0, 2, 1, 1, 2, 3]);
  g.computeVertexNormals();
  return g;
}

/** Mowing pattern: diagonal checkerboard aligned with the base lines. */
export function grassTexture(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const g = c.getContext("2d")!;
  const a = "#3f7f3a";
  const b = "#4a8d41";
  g.fillStyle = a;
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = b;
  g.fillRect(0, 0, 128, 128);
  g.fillRect(128, 128, 128, 128);
  // Fine blade noise so close cameras don't see flat color.
  const img = g.getImageData(0, 0, 256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 14;
    img.data[i] += n;
    img.data[i + 1] += n * 1.2;
    img.data[i + 2] += n * 0.6;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function dirtTexture(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#a8714a";
  g.fillRect(0, 0, 128, 128);
  const img = g.getImageData(0, 0, 128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 26;
    img.data[i] += n;
    img.data[i + 1] += n * 0.8;
    img.data[i + 2] += n * 0.6;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
