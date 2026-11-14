/**
 * A small procedural mesh builder for skinned characters. Everything is made of
 * parametric grids (lofted rings, deformed ellipsoids, swept tubes); each vertex
 * carries a UV into the character atlas, a baked occlusion shade and up to two
 * bone influences. Normals are smoothed across coincident vertices at the end, so
 * pieces that share an edge (or a UV seam) shade as one continuous surface.
 */

/** One vertex being written by a grid callback. */
export interface VOut {
  x: number;
  y: number;
  z: number;
  u: number;
  v: number;
  /** Baked shade, 0 (black) .. 1 (unshaded). */
  ao: number;
  /** Bones and the weight of the second one. */
  b0: number;
  b1: number;
  w: number;
}

export interface MeshData {
  position: Float32Array;
  normal: Float32Array;
  uv: Float32Array;
  color: Float32Array;
  skinIndex: Uint16Array;
  skinWeight: Float32Array;
  index: Uint32Array;
}

export type V3 = [number, number, number];

export class MeshBuilder {
  private pos: number[] = [];
  private uv: number[] = [];
  private ao: number[] = [];
  private bi: number[] = [];
  private bw: number[] = [];
  private idx: number[] = [];
  private o: VOut = { x: 0, y: 0, z: 0, u: 0, v: 0, ao: 1, b0: 0, b1: 0, w: 0 };

  get vertexCount(): number {
    return this.pos.length / 3;
  }
  get triangleCount(): number {
    return this.idx.length / 3;
  }

  /**
   * A (rows × cols)-quad patch; `fn(s, t, out)` fills the vertex at s, t ∈ [0, 1].
   * The winding is fixed up so the patch faces away from its own centroid, unless
   * `orient` forces it (+1 keeps the natural winding, −1 flips it).
   */
  grid(rows: number, cols: number, fn: (s: number, t: number, o: VOut) => void, orient = 0): void {
    const v0 = this.vertexCount;
    const i0 = this.idx.length;
    const o = this.o;
    for (let i = 0; i <= rows; i += 1) {
      for (let j = 0; j <= cols; j += 1) {
        o.ao = 1;
        o.b1 = 0;
        o.w = 0;
        fn(i / rows, j / cols, o);
        this.pos.push(o.x, o.y, o.z);
        this.uv.push(o.u, o.v);
        this.ao.push(o.ao);
        const w = Math.min(1, Math.max(0, o.w));
        this.bi.push(o.b0, w > 0 ? o.b1 : o.b0);
        this.bw.push(1 - w, w);
      }
    }
    const n = cols + 1;
    for (let i = 0; i < rows; i += 1) {
      for (let j = 0; j < cols; j += 1) {
        const a = v0 + i * n + j;
        const b = a + 1;
        const c = a + n;
        const d = c + 1;
        this.idx.push(a, b, c, b, d, c);
      }
    }
    let flip = orient < 0;
    if (orient === 0) {
      // Signed volume about the centroid: negative means the patch faces inward.
      const p = this.pos;
      let cx = 0;
      let cy = 0;
      let cz = 0;
      const vn = this.vertexCount - v0;
      for (let k = v0; k < v0 + vn; k += 1) {
        cx += p[k * 3];
        cy += p[k * 3 + 1];
        cz += p[k * 3 + 2];
      }
      cx /= vn;
      cy /= vn;
      cz /= vn;
      let vol = 0;
      for (let k = i0; k < this.idx.length; k += 3) {
        const a = this.idx[k] * 3;
        const b = this.idx[k + 1] * 3;
        const c = this.idx[k + 2] * 3;
        const ax = p[a] - cx;
        const ay = p[a + 1] - cy;
        const az = p[a + 2] - cz;
        const bx = p[b] - cx;
        const by = p[b + 1] - cy;
        const bz = p[b + 2] - cz;
        const ex = p[c] - cx;
        const ey = p[c + 1] - cy;
        const ez = p[c + 2] - cz;
        vol += ax * (by * ez - bz * ey) + ay * (bz * ex - bx * ez) + az * (bx * ey - by * ex);
      }
      flip = vol < 0;
    }
    if (flip) {
      for (let k = i0; k < this.idx.length; k += 3) {
        const t = this.idx[k + 1];
        this.idx[k + 1] = this.idx[k + 2];
        this.idx[k + 2] = t;
      }
    }
  }

  build(): MeshData {
    const n = this.vertexCount;
    const position = new Float32Array(this.pos);
    const index = new Uint32Array(this.idx);
    // Area-weighted face normals, accumulated per welded position.
    const weld = new Int32Array(n);
    const seen = new Map<string, number>();
    for (let i = 0; i < n; i += 1) {
      const key = `${Math.round(position[i * 3] * 2000)},${Math.round(position[i * 3 + 1] * 2000)},${Math.round(position[i * 3 + 2] * 2000)}`;
      const j = seen.get(key);
      if (j === undefined) {
        seen.set(key, i);
        weld[i] = i;
      } else weld[i] = j;
    }
    const acc = new Float64Array(n * 3);
    for (let k = 0; k < index.length; k += 3) {
      const a = index[k] * 3;
      const b = index[k + 1] * 3;
      const c = index[k + 2] * 3;
      const ux = position[b] - position[a];
      const uy = position[b + 1] - position[a + 1];
      const uz = position[b + 2] - position[a + 2];
      const vx = position[c] - position[a];
      const vy = position[c + 1] - position[a + 1];
      const vz = position[c + 2] - position[a + 2];
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      for (let m = 0; m < 3; m += 1) {
        const w = weld[index[k + m]] * 3;
        acc[w] += nx;
        acc[w + 1] += ny;
        acc[w + 2] += nz;
      }
    }
    const normal = new Float32Array(n * 3);
    for (let i = 0; i < n; i += 1) {
      const w = weld[i] * 3;
      const l = Math.hypot(acc[w], acc[w + 1], acc[w + 2]);
      if (l > 1e-12) {
        normal[i * 3] = acc[w] / l;
        normal[i * 3 + 1] = acc[w + 1] / l;
        normal[i * 3 + 2] = acc[w + 2] / l;
      } else normal[i * 3 + 1] = 1;
    }
    const color = new Float32Array(n * 3);
    const skinIndex = new Uint16Array(n * 4);
    const skinWeight = new Float32Array(n * 4);
    for (let i = 0; i < n; i += 1) {
      color[i * 3] = color[i * 3 + 1] = color[i * 3 + 2] = this.ao[i];
      skinIndex[i * 4] = this.bi[i * 2];
      skinIndex[i * 4 + 1] = this.bi[i * 2 + 1];
      skinWeight[i * 4] = this.bw[i * 2];
      skinWeight[i * 4 + 1] = this.bw[i * 2 + 1];
    }
    return { position, normal, uv: new Float32Array(this.uv), color, skinIndex, skinWeight, index };
  }
}

export type UVFn = (o: VOut, t: number, f: number) => void;
export type SkinFn = (o: VOut) => void;

/** A horizontal cross-section of a loft: an ellipse (or superellipse) at height y. */
export interface Ring {
  y: number;
  rx: number;
  rz: number;
  cx?: number;
  cz?: number;
  /** UV for the band from this ring to the next (defaults to the previous band's). */
  uv?: UVFn;
  ao?: number;
}

export interface LoftOpts {
  seg: number;
  skin: SkinFn;
  /** Angle of the first column and the angle swept (default: a full turn from +X). */
  theta0?: number;
  arc?: number;
  /** Superellipse exponent (2 = ellipse, larger = boxier). */
  n?: number;
  /** Extra shade by angle and height. */
  shade?: (theta: number, y: number) => number;
  /** Replace the cross-section: called with the ring and angle once the default position is set, before skin and UV. */
  shape?: (o: VOut, ring: Ring, theta: number) => void;
  /** Final tweak of each vertex (after position, UV and skin are set). */
  post?: (o: VOut, theta: number) => void;
}

const TAU = Math.PI * 2;
const sgnPow = (c: number, e: number) => (c < 0 ? -Math.pow(-c, e) : Math.pow(c, e));

/**
 * Stack of rings (monotonic in y) joined into a tube. Each band between two rings is its own strip
 * (so bands can use unrelated UVs) and the builder welds their normals together.
 * Angle 0 is +X, π/2 is +Z (the figure's front).
 */
export function loft(b: MeshBuilder, rings: Ring[], opts: LoftOpts): void {
  const th0 = opts.theta0 ?? 0;
  const arc = opts.arc ?? TAU;
  const e = 2 / (opts.n ?? 2);
  let uv: UVFn | undefined;
  // With columns running +X → +Z, a top-down stack winds outward as built; bottom-up needs flipping.
  const orient = rings[rings.length - 1].y < rings[0].y ? 1 : -1;
  for (let i = 0; i < rings.length - 1; i += 1) {
    const r0 = rings[i];
    const r1 = rings[i + 1];
    uv = r0.uv ?? uv;
    if (!uv) throw new Error("loft: first ring needs a uv");
    const uvf = uv;
    b.grid(1, opts.seg, (s, t, o) => {
      const r = s < 0.5 ? r0 : r1;
      const th = th0 + arc * t;
      o.x = (r.cx ?? 0) + r.rx * sgnPow(Math.cos(th), e);
      o.y = r.y;
      o.z = (r.cz ?? 0) + r.rz * sgnPow(Math.sin(th), e);
      o.ao = (r.ao ?? 1) * (opts.shade ? opts.shade(th, r.y) : 1);
      if (opts.shape) opts.shape(o, r, th);
      opts.skin(o);
      uvf(o, t, s);
      if (opts.post) opts.post(o, th);
    }, orient);
  }
}

export interface BlobOpts {
  c: V3;
  r: V3;
  seg: number;
  rows: number;
  uv: UVFn;
  skin: SkinFn;
  /** Polar range from the +Y pole (default the whole sphere); the end may vary with azimuth. */
  polar0?: number;
  polar1?: number | ((theta: number) => number);
  theta0?: number;
  arc?: number;
  /** Reshape a vertex; (dx, dy, dz) is its direction on the unit sphere. */
  deform?: (o: VOut, dx: number, dy: number, dz: number, s: number) => void;
  orient?: number;
}

/** A deformed ellipsoid (or a patch of one). */
export function blob(b: MeshBuilder, opts: BlobOpts): void {
  const th0 = opts.theta0 ?? 0;
  const arc = opts.arc ?? TAU;
  const p0 = opts.polar0 ?? 0;
  const p1 = opts.polar1 ?? Math.PI;
  b.grid(
    opts.rows,
    opts.seg,
    (s, t, o) => {
      const th = th0 + arc * t;
      const end = typeof p1 === "number" ? p1 : p1(th);
      const ph = p0 + (end - p0) * s;
      const sp = Math.sin(ph);
      const dx = sp * Math.cos(th);
      const dy = Math.cos(ph);
      const dz = sp * Math.sin(th);
      o.x = opts.c[0] + opts.r[0] * dx;
      o.y = opts.c[1] + opts.r[1] * dy;
      o.z = opts.c[2] + opts.r[2] * dz;
      if (opts.deform) opts.deform(o, dx, dy, dz, s);
      opts.skin(o);
      opts.uv(o, t, s);
    },
    opts.orient ?? 1,
  );
}

/** A round tube swept along a polyline, closed at both ends. */
export function tube(b: MeshBuilder, pts: V3[], radius: number | number[], sides: number, uv: UVFn, skin: SkinFn): void {
  const n = pts.length;
  // Parallel-transported frames along the path.
  const fr: Array<{ nx: number; ny: number; nz: number; bx: number; by: number; bz: number }> = [];
  let px = 0;
  let py = 0;
  let pz = 0;
  for (let i = 0; i < n; i += 1) {
    const a = pts[Math.max(0, i - 1)];
    const c = pts[Math.min(n - 1, i + 1)];
    let tx = c[0] - a[0];
    let ty = c[1] - a[1];
    let tz = c[2] - a[2];
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl;
    ty /= tl;
    tz /= tl;
    if (i === 0) {
      // Any vector not parallel to the tangent.
      if (Math.abs(ty) < 0.9) {
        px = 0;
        py = 1;
        pz = 0;
      } else {
        px = 1;
        py = 0;
        pz = 0;
      }
    }
    const d = px * tx + py * ty + pz * tz;
    let nx = px - d * tx;
    let ny = py - d * ty;
    let nz = pz - d * tz;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl;
    ny /= nl;
    nz /= nl;
    px = nx;
    py = ny;
    pz = nz;
    fr.push({ nx, ny, nz, bx: ty * nz - tz * ny, by: tz * nx - tx * nz, bz: tx * ny - ty * nx });
  }
  const rad = (i: number) => (typeof radius === "number" ? radius : radius[i]);
  b.grid(n + 1, sides, (s, t, o) => {
    const k = Math.round(s * (n + 1)) - 1;
    const i = Math.min(n - 1, Math.max(0, k));
    const r = k < 0 || k > n - 1 ? 0 : rad(i);
    const f = fr[i];
    const th = TAU * t;
    const c = Math.cos(th) * r;
    const sn = Math.sin(th) * r;
    o.x = pts[i][0] + f.nx * c + f.bx * sn;
    o.y = pts[i][1] + f.ny * c + f.by * sn;
    o.z = pts[i][2] + f.nz * c + f.bz * sn;
    skin(o);
    uv(o, t, s);
  });
}

export const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
