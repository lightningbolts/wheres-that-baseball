/**
 * Real ballpark outlines → fence distance by spray angle, in feet.
 *
 * `data/ballparks/index.json` carries each park's wall outline (`outfield_outer`, a closed
 * loop around the whole playing field) in a normalized SVG space. Here it is put into the
 * game's polar frame: home plate is the apex of the foul lines, the foul lines define ±45°,
 * and the radial scale is calibrated against the published `fieldInfo` distances. The
 * outline supplies the *shape* (Fenway's wall and triangle, Yankee Stadium's short porch,
 * Oracle's Triples Alley); the published numbers pin the *size*.
 */
import type { BallparkData } from "@/types/ballpark";

export type FenceKey = "leftLine" | "left" | "leftCenter" | "center" | "rightCenter" | "right" | "rightLine";

/** Stats API fieldInfo label → nominal spray angle (deg, + toward RF). */
export const FIELD_INFO_ANGLES: ReadonlyArray<readonly [FenceKey, number]> = [
  ["leftLine", -45],
  ["left", -32],
  ["leftCenter", -18],
  ["center", 0],
  ["rightCenter", 18],
  ["right", 32],
  ["rightLine", 45],
];

/** Table resolution: fence distance every half degree from −45° to +45°. */
export const FENCE_STEP_DEG = 0.5;
export const FENCE_N = 181;

/**
 * A published number is trusted as an anchor at its nominal angle only when it agrees with
 * the foul-line-calibrated outline this closely. Larger gaps mean the label describes a
 * different spot on the wall (Fenway's "center 420" is the triangle in right-center), so the
 * outline's shape wins there.
 */
const CENTER_TOLERANCE = 0.06;
const GAP_TOLERANCE = 0.035;

export interface FenceMarker {
  /** Spray angle of the painted distance sign. */
  deg: number;
  /** Published distance, ft. */
  ft: number;
}

export interface ParkOutline {
  /** Fence distance (ft) at −45°, −44.5°, … +45°. */
  fence: Float32Array;
  /** Published distances located on the wall (for painted signs). */
  markers: FenceMarker[];
  /** Mean perpendicular distance from the foul lines to the stands near the infield, ft. */
  foulSpace: number;
  /** Distance from home plate to the backstop, ft. */
  backstop: number;
  /** Whole wall loop in polar form (deg in −180..180, feet), for reference/debugging. */
  loop: Array<{ deg: number; ft: number }>;
}

type Pt = readonly [number, number];

/** Parse an `M x y L x y … Z` path into its first subpath's points. */
export function parsePathPoints(d: string): Pt[] {
  const out: Pt[] = [];
  const re = /([MLZ])\s*(-?[\d.]+)?[\s,]*(-?[\d.]+)?/g;
  let m: RegExpExecArray | null;
  let subpaths = 0;
  while ((m = re.exec(d))) {
    if (m[1] === "M") {
      subpaths += 1;
      if (subpaths > 1) break;
    }
    if (m[1] !== "Z" && m[2] != null && m[3] != null) out.push([Number(m[2]), Number(m[3])]);
  }
  return out;
}

function lerpTable(t: Float32Array, deg: number): number {
  const f = (Math.min(45, Math.max(-45, deg)) + 45) / FENCE_STEP_DEG;
  const i = Math.min(FENCE_N - 2, Math.floor(f));
  return t[i] + (t[i + 1] - t[i]) * (f - i);
}

/** Sample a half-degree fence table. */
export function sampleFence(t: Float32Array, deg: number): number {
  return lerpTable(t, deg);
}

/** Cosine-eased interpolation through (angle, value) knots sorted by angle. */
function easeKnots(knots: Array<[number, number]>, a: number): number {
  if (a <= knots[0][0]) return knots[0][1];
  for (let i = 1; i < knots.length; i += 1) {
    const [a1, v1] = knots[i];
    if (a <= a1) {
      const [a0, v0] = knots[i - 1];
      const s = (1 - Math.cos(((a - a0) / (a1 - a0)) * Math.PI)) / 2;
      return v0 + (v1 - v0) * s;
    }
  }
  return knots[knots.length - 1][1];
}

/**
 * Build the calibrated outline for one park, or null when the data is unusable (the caller
 * then falls back to interpolating the published numbers).
 */
export function buildOutline(data: BallparkData): ParkOutline | null {
  const wall = parsePathPoints(data.segments?.outfield_outer ?? "");
  const foul = parsePathPoints(data.segments?.foul_lines ?? "");
  if (wall.length < 20 || foul.length < 10) return null;

  // Home plate = apex of the foul lines (lowest point); the poles are their far ends.
  let home = foul[0];
  let poleL = foul[0];
  let poleR = foul[0];
  for (const p of foul) {
    if (p[1] > home[1]) home = p;
    if (p[0] < poleL[0]) poleL = p;
    if (p[0] > poleR[0]) poleR = p;
  }
  const bearing = (p: Pt) => (Math.atan2(p[0] - home[0], home[1] - p[1]) * 180) / Math.PI;
  // The wall points nearest the ends of the foul lines are the foul poles; the stretch of
  // loop between them (through center field) is the outfield fence.
  const nearest = (t: Pt) => {
    let best = 0;
    let bd = Infinity;
    wall.forEach((p, i) => {
      const d = Math.hypot(p[0] - t[0], p[1] - t[1]);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  };
  const iL = nearest(poleL);
  const iR = nearest(poleR);
  const aL = bearing(wall[iL]);
  const aR = bearing(wall[iR]);
  if (!(aL < -35 && aL > -55 && aR > 35 && aR < 55) || iL === iR) return null;
  // Rotate so the poles sit symmetric about 0°, and stretch so they open exactly 90°.
  const rot = (aL + aR) / 2;
  const half = (aR - aL) / 2;
  const open = 45 / half;
  const n = wall.length;
  const polar = wall.map((p) => {
    let deg = bearing(p) - rot;
    if (deg > 180) deg -= 360;
    if (deg < -180) deg += 360;
    // Only fair territory is stretched; foul territory keeps its angular size.
    const d = Math.abs(deg) <= half ? deg * open : Math.sign(deg) * (45 + (Math.abs(deg) - half));
    return { deg: d, r: Math.hypot(p[0] - home[0], p[1] - home[1]) };
  });
  // Walk pole → pole in the direction that passes center field.
  const walk = (step: number) => {
    const out: Array<{ deg: number; r: number }> = [];
    for (let i = iL, guard = 0; guard <= n; i = (i + step + n) % n, guard += 1) {
      out.push(polar[i]);
      if (i === iR) break;
    }
    return out;
  };
  const fwd = walk(1);
  const back = walk(-1);
  const spread = (arc: Array<{ deg: number }>) => arc.reduce((m, p) => Math.max(m, Math.abs(p.deg)), 0);
  const arc = (spread(fwd) <= spread(back) ? fwd : back).map((p) => ({ deg: Math.min(45, Math.max(-45, p.deg)), r: p.r }));
  arc[0] = { deg: -45, r: arc[0].r };
  arc[arc.length - 1] = { deg: 45, r: arc[arc.length - 1].r };

  // Ray-cast every half degree against the fence; the farthest crossing wins.
  const rad = Math.PI / 180;
  const raw = new Float32Array(FENCE_N);
  for (let k = 0; k < FENCE_N; k += 1) {
    const a = -45 + k * FENCE_STEP_DEG;
    let best = 0;
    for (let i = 0; i + 1 < arc.length; i += 1) {
      const p = arc[i];
      const q = arc[i + 1];
      if ((p.deg - a) * (q.deg - a) > 0) continue;
      // Intersect in Cartesian space so straight walls stay straight.
      let r: number;
      if (Math.abs(q.deg - p.deg) < 1e-9) r = Math.max(p.r, q.r);
      else {
        const px = p.r * Math.sin(p.deg * rad);
        const py = p.r * Math.cos(p.deg * rad);
        const ex = q.r * Math.sin(q.deg * rad) - px;
        const ey = q.r * Math.cos(q.deg * rad) - py;
        const dx = Math.sin(a * rad);
        const dy = Math.cos(a * rad);
        const den = dx * ey - dy * ex;
        r = Math.abs(den) < 1e-9 ? Math.max(p.r, q.r) : (px * ey - py * ex) / den;
      }
      if (r > best) best = r;
    }
    raw[k] = best;
  }
  // Fill any gaps (no crossing found) from neighbours.
  for (let k = 0; k < FENCE_N; k += 1) {
    if (raw[k] > 0) continue;
    let lo = k - 1;
    let hi = k + 1;
    while (lo >= 0 && raw[lo] <= 0) lo -= 1;
    while (hi < FENCE_N && raw[hi] <= 0) hi += 1;
    if (lo < 0 && hi >= FENCE_N) return null;
    raw[k] = lo < 0 ? raw[hi] : hi >= FENCE_N ? raw[lo] : raw[lo] + ((raw[hi] - raw[lo]) * (k - lo)) / (hi - lo);
  }

  // Calibrate SVG units → feet. The foul poles are unambiguous anchors.
  const fi = data.fieldInfo;
  const kL = fi.leftLine ? fi.leftLine / raw[0] : null;
  const kR = fi.rightLine ? fi.rightLine / raw[FENCE_N - 1] : null;
  // Fallback: MLBAM hit coordinates are ≈2.5 ft per unit.
  const kDefault = (2.495 / data.transform.scale) * 0.965;
  const left = kL ?? kR ?? kDefault;
  const right = kR ?? kL ?? kDefault;
  const knots: Array<[number, number]> = [
    [-45, left],
    [45, right],
  ];
  const lineK = (a: number) => left + ((right - left) * (a + 45)) / 90;
  const markers: FenceMarker[] = [];
  if (fi.leftLine) markers.push({ deg: -45, ft: fi.leftLine });
  if (fi.rightLine) markers.push({ deg: 45, ft: fi.rightLine });
  const unplaced: Array<[number, number]> = [];
  for (const [key, a] of FIELD_INFO_ANGLES) {
    if (a === -45 || a === 45) continue;
    const pub = fi[key];
    if (!pub) continue;
    const k = pub / lerpTable(raw, a);
    const tol = a === 0 ? CENTER_TOLERANCE : GAP_TOLERANCE;
    if (Math.abs(k / lineK(a) - 1) <= tol) {
      knots.push([a, k]);
      markers.push({ deg: a, ft: pub });
    } else unplaced.push([a, pub]);
  }
  knots.sort((p, q) => p[0] - q[0]);

  const fence = new Float32Array(FENCE_N);
  for (let k = 0; k < FENCE_N; k += 1) fence[k] = raw[k] * easeKnots(knots, -45 + k * FENCE_STEP_DEG);

  // Labels that did not fit their nominal angle: paint them where the wall is that deep.
  for (const [a, pub] of unplaced) {
    let bestDeg: number | null = null;
    for (let off = 0; off <= 15 && bestDeg == null; off += FENCE_STEP_DEG) {
      for (const s of [-1, 1]) {
        const deg = a + s * off;
        if (Math.abs(deg) > 44) continue;
        if (Math.abs(lerpTable(fence, deg) - pub) <= 1.5) {
          bestDeg = deg;
          break;
        }
      }
    }
    if (bestDeg != null && markers.every((m) => Math.abs(m.deg - bestDeg!) > 6)) markers.push({ deg: bestDeg, ft: pub });
  }
  markers.sort((p, q) => p.deg - q.deg);

  // Foul territory: use the same loop, scaled by the nearer pole's factor.
  const loop = polar.map((p) => ({ deg: p.deg, ft: p.r * (p.deg < 0 ? left : right) }));
  let perpSum = 0;
  let perpN = 0;
  let backSum = 0;
  let backN = 0;
  for (const p of loop) {
    const ad = Math.abs(p.deg);
    if (ad >= 150) {
      backSum += p.ft;
      backN += 1;
    } else if (ad > 47 && ad < 135) {
      const off = ((ad - 45) * Math.PI) / 180;
      const along = p.ft * Math.cos(off);
      if (along > 40 && along < 190) {
        perpSum += p.ft * Math.sin(off);
        perpN += 1;
      }
    }
  }
  const clampTo = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  return {
    fence,
    markers,
    foulSpace: perpN ? clampTo(perpSum / perpN, 34, 58) : 45,
    backstop: backN ? clampTo(backSum / backN, 45, 64) : 60,
    loop,
  };
}
