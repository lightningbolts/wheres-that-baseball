/**
 * Tiny immediate-mode mesh builder: every static piece of a ballpark (decks, roofs,
 * dugouts, towers, landmarks) is appended into one vertex-colored geometry, so the whole
 * structure renders in a single draw call.
 */
import * as THREE from "three";

export type P3 = readonly [number, number, number];
export type RGB = readonly [number, number, number];

const colorCache = new Map<string, RGB>();
const scratch = new THREE.Color();

/** Hex/CSS color → linear RGB (vertex colors are interpreted as linear). */
export function rgb(c: string | RGB, shade = 1): RGB {
  let v: RGB;
  if (typeof c === "string") {
    let hit = colorCache.get(c);
    if (!hit) {
      scratch.set(c);
      hit = [scratch.r, scratch.g, scratch.b];
      colorCache.set(c, hit);
    }
    v = hit;
  } else v = c;
  return shade === 1 ? v : [v[0] * shade, v[1] * shade, v[2] * shade];
}

/** Blend two colors (linear space). */
export function mix(a: string | RGB, b: string | RGB, t: number): RGB {
  const p = rgb(a);
  const q = rgb(b);
  return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
}

/** Deterministic pseudo-random in [0, 1) from an integer seed. */
export function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export class GeoBuilder {
  readonly pos: number[] = [];
  readonly col: number[] = [];
  readonly uv: number[] = [];
  constructor(private readonly withUv = false) {}

  get triangles(): number {
    return this.pos.length / 9;
  }

  tri(a: P3, b: P3, c: P3, color: string | RGB, shade = 1): void {
    const k = rgb(color, shade);
    this.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    this.col.push(k[0], k[1], k[2], k[0], k[1], k[2], k[0], k[1], k[2]);
    if (this.withUv) this.uv.push(0, 0, 0, 0, 0, 0);
  }

  /** Quad a→b→c→d (perimeter order). */
  quad(a: P3, b: P3, c: P3, d: P3, color: string | RGB, shade = 1): void {
    this.tri(a, b, c, color, shade);
    this.tri(a, c, d, color, shade);
  }

  /** Textured quad: uv per corner, same order as the points. */
  quadUv(a: P3, b: P3, c: P3, d: P3, ua: readonly number[], ub: readonly number[], uc: readonly number[], ud: readonly number[], color: string | RGB, shade = 1): void {
    const k = rgb(color, shade);
    this.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2]);
    for (let i = 0; i < 6; i += 1) this.col.push(k[0], k[1], k[2]);
    this.uv.push(ua[0], ua[1], ub[0], ub[1], uc[0], uc[1], ua[0], ua[1], uc[0], uc[1], ud[0], ud[1]);
  }

  /** Axis-aligned box (center, size) rotated by `yaw` about Y. */
  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, yaw: number, color: string | RGB, shade = 1): void {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const hx = sx / 2;
    const hy = sy / 2;
    const hz = sz / 2;
    const p = (x: number, y: number, z: number): P3 => [cx + x * c + z * s, cy + y, cz - x * s + z * c];
    const v = [p(-hx, -hy, -hz), p(hx, -hy, -hz), p(hx, -hy, hz), p(-hx, -hy, hz), p(-hx, hy, -hz), p(hx, hy, -hz), p(hx, hy, hz), p(-hx, hy, hz)];
    this.quad(v[4], v[7], v[6], v[5], color, shade); // top
    this.quad(v[0], v[1], v[2], v[3], color, shade * 0.7); // bottom
    this.quad(v[3], v[2], v[6], v[7], color, shade * 0.92);
    this.quad(v[1], v[0], v[4], v[5], color, shade * 0.92);
    this.quad(v[0], v[3], v[7], v[4], color, shade * 0.84);
    this.quad(v[2], v[1], v[5], v[6], color, shade * 0.84);
  }

  /** Vertical cylinder / frustum from y0 up by h. */
  cyl(cx: number, y0: number, cz: number, r0: number, r1: number, h: number, color: string | RGB, seg = 8, cap = true): void {
    for (let i = 0; i < seg; i += 1) {
      const a0 = (i / seg) * Math.PI * 2;
      const a1 = ((i + 1) / seg) * Math.PI * 2;
      const c0 = Math.cos(a0);
      const s0 = Math.sin(a0);
      const c1 = Math.cos(a1);
      const s1 = Math.sin(a1);
      const shade = 0.82 + 0.18 * Math.abs(Math.cos(a0 + 0.6));
      this.quad([cx + c0 * r0, y0, cz + s0 * r0], [cx + c1 * r0, y0, cz + s1 * r0], [cx + c1 * r1, y0 + h, cz + s1 * r1], [cx + c0 * r1, y0 + h, cz + s0 * r1], color, shade);
      if (cap && r1 > 0.01) this.tri([cx, y0 + h, cz], [cx + c0 * r1, y0 + h, cz + s0 * r1], [cx + c1 * r1, y0 + h, cz + s1 * r1], color);
    }
  }

  /** UV sphere (optionally squashed) centered at (cx, cy, cz). */
  sphere(cx: number, cy: number, cz: number, r: number, color: string | RGB, seg = 8, sy = 1): void {
    const rings = Math.max(3, Math.floor(seg / 2));
    for (let j = 0; j < rings; j += 1) {
      const t0 = (j / rings) * Math.PI;
      const t1 = ((j + 1) / rings) * Math.PI;
      for (let i = 0; i < seg; i += 1) {
        const a0 = (i / seg) * Math.PI * 2;
        const a1 = ((i + 1) / seg) * Math.PI * 2;
        const pt = (t: number, a: number): P3 => [cx + Math.sin(t) * Math.cos(a) * r, cy + Math.cos(t) * r * sy, cz + Math.sin(t) * Math.sin(a) * r];
        const shade = 0.78 + 0.22 * Math.cos(t0 * 0.9);
        this.quad(pt(t0, a0), pt(t0, a1), pt(t1, a1), pt(t1, a0), color, shade);
      }
    }
  }

  /** Flat horizontal disc. */
  disc(cx: number, y: number, cz: number, r: number, color: string | RGB, seg = 24, shade = 1): void {
    for (let i = 0; i < seg; i += 1) {
      const a0 = (i / seg) * Math.PI * 2;
      const a1 = ((i + 1) / seg) * Math.PI * 2;
      this.tri([cx, y, cz], [cx + Math.cos(a1) * r, y, cz + Math.sin(a1) * r], [cx + Math.cos(a0) * r, y, cz + Math.sin(a0) * r], color, shade);
    }
  }

  /** Flat horizontal polygon (world [x, z] points) with optional holes, at height y. */
  poly(pts: Array<[number, number]>, holes: Array<Array<[number, number]>>, y: number, color: string | RGB, shade = 1): void {
    const v2 = (p: [number, number]) => new THREE.Vector2(p[0], p[1]);
    const contour = pts.map(v2);
    const hs = holes.map((h) => h.map(v2));
    const all = [...pts, ...holes.flat()];
    for (const f of THREE.ShapeUtils.triangulateShape(contour, hs)) {
      const [a, b, c] = f.map((i) => all[i]);
      this.tri([a[0], y, a[1]], [b[0], y, b[1]], [c[0], y, c[1]], color, shade);
    }
  }

  /** Square-section beam between two points. */
  beam(a: P3, b: P3, w: number, color: string | RGB, shade = 1): void {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dz = b[2] - a[2];
    const l = Math.hypot(dx, dy, dz) || 1;
    // Two perpendiculars.
    let ux = -dz;
    let uy = 0;
    let uz = dx;
    let ul = Math.hypot(ux, uz);
    if (ul < 1e-4) {
      ux = 1;
      uz = 0;
      ul = 1;
    }
    ux = (ux / ul) * (w / 2);
    uz = (uz / ul) * (w / 2);
    const vx = ((dy * uz - dz * uy) / l) * 1;
    const vy = (dz * ux - dx * uz) / l;
    const vz = ((dx * uy - dy * ux) / l) * 1;
    const c = (p: P3, su: number, sv: number): P3 => [p[0] + ux * su + vx * sv, p[1] + uy * su + vy * sv, p[2] + uz * su + vz * sv];
    const sides: Array<[number, number, number, number]> = [
      [-1, -1, 1, -1],
      [1, -1, 1, 1],
      [1, 1, -1, 1],
      [-1, 1, -1, -1],
    ];
    sides.forEach(([s0, t0, s1, t1], i) => this.quad(c(a, s0, t0), c(a, s1, t1), c(b, s1, t1), c(b, s0, t0), color, shade * (i % 2 ? 0.85 : 1)));
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    if (this.withUv) g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeVertexNormals();
    return g;
  }
}
