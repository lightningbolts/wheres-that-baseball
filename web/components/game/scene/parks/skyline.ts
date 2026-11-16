/**
 * City skylines and named towers. Every facade goes into the shared `city` mesh (one draw
 * call, the window-grid atlas from `cityTexture`); spires, masts and caps go into the lit
 * structure; aviation beacons and crown lights into `glow` (night only).
 *
 * A skyline is three layers: hazy far towers, a core whose heights swell toward the named
 * landmarks, and nearer mid-rise blocks. Buildings get podiums, setbacks, chamfered plans,
 * rooftop plant, spires and caps from a seeded hash, so no two parks repeat.
 */
import type { Feature, TowerStyle } from "@/lib/game/data/parkLayouts";
import { dirXZ, GROUND_Y } from "@/components/game/scene/fieldGeometry";
import { GeoBuilder, hash, mix, rgb, type P3, type RGB } from "@/components/game/scene/parks/geo";
import { CITY_CELL, CITY_ROOF, CITY_STYLE, cityQuadrant, type CityStyle } from "@/components/game/scene/parks/textures";

/** A local frame on the ground: +lx to the viewer's right seen from home, +lz toward home. */
export interface Frame {
  x: number;
  z: number;
  yaw: number;
  rx: number;
  rz: number;
  fx: number;
  fz: number;
}

export function frameYaw(x: number, z: number, yaw: number): Frame {
  return { x, z, yaw, rx: Math.cos(yaw), rz: -Math.sin(yaw), fx: Math.sin(yaw), fz: Math.cos(yaw) };
}
export const loc = (f: Frame, lx: number, y: number, lz: number): P3 => [f.x + f.rx * lx + f.fx * lz, y, f.z + f.rz * lx + f.fz * lz];

/** Frame at a bearing and distance from home, facing home. */
export function far(beta: number, dist: number): Frame {
  const [dx, dz] = dirXZ(beta);
  return frameYaw(dx * dist, dz * dist, Math.atan2(-dx, -dz));
}

export interface SkyCtx {
  city: GeoBuilder;
  st: GeoBuilder;
  glow: GeoBuilder;
  lit: boolean;
}

type Plan = Array<[number, number]>;

/** Daylight direction the facades are shaded against (world xz, from behind third base). */
const SUN: [number, number] = [0.6, -0.8];
/** Horizon haze facades fade toward by layer (the city material adds height haze on top). */
const HAZE = "#c3d2e1";
const BEACON: RGB = [1, 0.16, 0.08];
const CROWN: RGB = [1, 0.93, 0.78];

const PALETTE: Record<CityStyle, string[]> = {
  [CITY_STYLE.glass]: ["#6f8599", "#7f97ab", "#5b6f84", "#86a0a6", "#56707a", "#46525f", "#90a4b8"],
  [CITY_STYLE.stone]: ["#cfc7b6", "#bdb6a8", "#d9d3c4", "#aaa59a", "#c4b59c"],
  [CITY_STYLE.brick]: ["#a0634d", "#8c5a47", "#ab7c61", "#7f5b4c", "#b38a6c"],
  [CITY_STYLE.ribbon]: ["#bcbfc0", "#cbc8bd", "#a9afb5", "#c2b8a6"],
};

export const rectPlan = (w: number, d: number): Plan => [
  [-w / 2, -d / 2],
  [w / 2, -d / 2],
  [w / 2, d / 2],
  [-w / 2, d / 2],
];

/** Rectangle with its corners cut back by `c` (an octagon). */
export const chamferPlan = (w: number, d: number, c: number): Plan => [
  [-w / 2 + c, -d / 2],
  [w / 2 - c, -d / 2],
  [w / 2, -d / 2 + c],
  [w / 2, d / 2 - c],
  [w / 2 - c, d / 2],
  [-w / 2 + c, d / 2],
  [-w / 2, d / 2 - c],
  [-w / 2, -d / 2 + c],
];

export const circlePlan = (r: number, seg = 12): Plan => Array.from({ length: seg }, (_, i): [number, number] => [Math.cos((i / seg) * Math.PI * 2) * r, Math.sin((i / seg) * Math.PI * 2) * r]);

const scalePlan = (p: Plan, s: number, t = s): Plan => p.map(([x, z]): [number, number] => [x * s, z * t]);

/** Vertex color for a facade: lit offices at night, else the material faded by its layer's haze. */
function tone(c: SkyCtx, base: string | RGB, haze: number, k: number): RGB {
  if (c.lit) return rgb("#ffffff", (0.8 + 0.28 * hash(k * 3.1)) * (1 - haze * 0.5));
  return mix(base, HAZE, haze);
}

/**
 * Textured walls between a bottom and a top outline (same vertex count; equal for a prism),
 * centred at (ox, oz) in the frame, plus a roof cap. Walls are cut into pieces no bigger than
 * a quadrant of the atlas so the window grid never wraps.
 */
function shell(c: SkyCtx, fr: Frame, ox: number, oz: number, y0: number, y1: number, bottom: Plan, top: Plan, color: RGB, style: CityStyle, k: number, cap = true): void {
  const n = CITY_CELL.n;
  const [qu, qv] = cityQuadrant(style);
  const m = bottom.length;
  let cx = 0;
  let cz = 0;
  for (const [x, z] of bottom) {
    cx += x / m;
    cz += z / m;
  }
  const rows = Math.max(1, Math.round((y1 - y0) / CITY_CELL.h));
  for (let i = 0; i < m; i += 1) {
    const a0 = bottom[i];
    const b0 = bottom[(i + 1) % m];
    const a1 = top[i];
    const b1 = top[(i + 1) % m];
    const len = Math.hypot(b0[0] - a0[0], b0[1] - a0[1]);
    if (len < 0.5) continue;
    // Outward normal (away from the plan's centre), in world space for the sun shading.
    let nx = b0[1] - a0[1];
    let nz = -(b0[0] - a0[0]);
    if (nx * ((a0[0] + b0[0]) / 2 - cx) + nz * ((a0[1] + b0[1]) / 2 - cz) < 0) {
      nx = -nx;
      nz = -nz;
    }
    const wx = fr.rx * nx + fr.fx * nz;
    const wz = fr.rz * nx + fr.fz * nz;
    const wl = Math.hypot(wx, wz) || 1;
    const sun = Math.max(0, (wx * SUN[0] + wz * SUN[1]) / wl);
    const shade = c.lit ? 0.86 + 0.14 * sun : 0.6 + 0.42 * sun;
    const cols = Math.max(1, Math.round(len / CITY_CELL.w));
    for (let c0 = 0; c0 < cols; c0 += n) {
      const cc = Math.min(n, cols - c0);
      for (let r0 = 0; r0 < rows; r0 += n) {
        const rc = Math.min(n, rows - r0);
        const ou = Math.floor(hash(k * 3.3 + i * 1.7 + c0 * 0.13) * (n - cc + 1));
        const ov = Math.floor(hash(k * 5.1 + r0 * 0.11 + i) * (n - rc + 1));
        const u0 = qu + (ou / n) * 0.5;
        const u1 = qu + ((ou + cc) / n) * 0.5;
        const v0 = qv + (ov / n) * 0.5;
        const v1 = qv + ((ov + rc) / n) * 0.5;
        const s0 = c0 / cols;
        const s1 = (c0 + cc) / cols;
        const t0 = r0 / rows;
        const t1 = (r0 + rc) / rows;
        const pt = (s: number, t: number): P3 => {
          const bx = a0[0] + (b0[0] - a0[0]) * s;
          const bz = a0[1] + (b0[1] - a0[1]) * s;
          const tx = a1[0] + (b1[0] - a1[0]) * s;
          const tz = a1[1] + (b1[1] - a1[1]) * s;
          return loc(fr, ox + bx + (tx - bx) * t, y0 + (y1 - y0) * t, oz + bz + (tz - bz) * t);
        };
        c.city.quadUv(pt(s0, t0), pt(s1, t0), pt(s1, t1), pt(s0, t1), [u0, v0], [u1, v0], [u1, v1], [u0, v1], color, shade);
      }
    }
  }
  if (!cap) return;
  let tx = 0;
  let tz = 0;
  for (const [x, z] of top) {
    tx += x / m;
    tz += z / m;
  }
  const mid = loc(fr, ox + tx, y1, oz + tz);
  for (let i = 0; i < m; i += 1) {
    const a = top[i];
    const b = top[(i + 1) % m];
    c.city.triUv(mid, loc(fr, ox + a[0], y1, oz + a[1]), loc(fr, ox + b[0], y1, oz + b[1]), CITY_ROOF, CITY_ROOF, CITY_ROOF, color, 0.62);
  }
}

const prism = (c: SkyCtx, fr: Frame, ox: number, oz: number, y0: number, y1: number, plan: Plan, color: RGB, style: CityStyle, k: number, cap = true) => shell(c, fr, ox, oz, y0, y1, plan, plan, color, style, k, cap);

/** A pointed cap over an outline (pyramid roofs, spike tops): plain cladding, shaded per face. */
function pyramid(c: SkyCtx, fr: Frame, ox: number, oz: number, y0: number, h: number, plan: Plan, color: RGB): void {
  const apex = loc(fr, ox, y0 + h, oz);
  const m = plan.length;
  for (let i = 0; i < m; i += 1) {
    const a = plan[i];
    const b = plan[(i + 1) % m];
    let nx = b[1] - a[1];
    let nz = -(b[0] - a[0]);
    if (nx * (a[0] + b[0]) + nz * (a[1] + b[1]) < 0) {
      nx = -nx;
      nz = -nz;
    }
    const wx = fr.rx * nx + fr.fx * nz;
    const wz = fr.rz * nx + fr.fz * nz;
    const sun = Math.max(0, (wx * SUN[0] + wz * SUN[1]) / (Math.hypot(wx, wz) || 1));
    c.city.triUv(loc(fr, ox + a[0], y0, oz + a[1]), loc(fr, ox + b[0], y0, oz + b[1]), apex, CITY_ROOF, CITY_ROOF, CITY_ROOF, color, c.lit ? 0.5 : 0.7 + 0.35 * sun);
  }
}

/** Red aviation beacon (lit at dusk and night). */
function beacon(c: SkyCtx, p: P3, size = 7): void {
  if (c.lit) c.glow.box(p[0], p[1] + size / 2, p[2], size, size, size, 0, BEACON);
}

/** Mast or antenna in the lit structure, beacon on top. */
function mast(c: SkyCtx, fr: Frame, ox: number, oz: number, y: number, h: number, r: number, color = "#9aa1a9"): void {
  const p = loc(fr, ox, y, oz);
  c.st.cyl(p[0], p[1], p[2], r, r * 0.35, h, color, 6, false);
  beacon(c, [p[0], p[1] + h, p[2]]);
}

/** Night crown lighting: a glowing band just under a roofline. */
function crownBand(c: SkyCtx, fr: Frame, ox: number, oz: number, y: number, h: number, plan: Plan, color: RGB = CROWN): void {
  if (!c.lit) return;
  const m = plan.length;
  for (let i = 0; i < m; i += 1) {
    const a = plan[i];
    const b = plan[(i + 1) % m];
    const o = 1.04;
    c.glow.quad(loc(fr, ox + a[0] * o, y, oz + a[1] * o), loc(fr, ox + b[0] * o, y, oz + b[1] * o), loc(fr, ox + b[0] * o, y + h, oz + b[1] * o), loc(fr, ox + a[0] * o, y + h, oz + a[1] * o), color, 0.85);
  }
}

/** Rooftop plant: a penthouse box, sometimes with a second smaller one. */
function plant(c: SkyCtx, fr: Frame, ox: number, oz: number, y: number, w: number, d: number, color: RGB, k: number): void {
  const pw = w * (0.35 + 0.25 * hash(k * 2.9));
  const pd = d * (0.35 + 0.25 * hash(k * 4.3));
  const ph = 12 + hash(k * 6.1) * 14;
  const dark = mix(color, "#5d636b", 0.45);
  prism(c, fr, ox + (hash(k * 7.7) - 0.5) * (w - pw) * 0.6, oz, y, y + ph, rectPlan(pw, pd), dark, CITY_STYLE.ribbon, k + 5);
  if (hash(k * 8.3) < 0.4) prism(c, fr, ox - w * 0.22, oz + d * 0.15, y, y + ph * 0.6, rectPlan(pw * 0.5, pd * 0.6), dark, CITY_STYLE.ribbon, k + 9);
}

/** Wooden water tank on legs (pre-war masonry blocks). */
function waterTank(c: SkyCtx, fr: Frame, ox: number, oz: number, y: number): void {
  const p = loc(fr, ox, y, oz);
  for (const [a, b] of [[-3, -3], [3, -3], [3, 3], [-3, 3]]) {
    const q = loc(fr, ox + a, y, oz + b);
    c.st.beam(q, [q[0], q[1] + 9, q[2]], 0.7, "#4a4440");
  }
  c.st.cyl(p[0], p[1] + 9, p[2], 6, 6, 11, "#7a5a44", 8, false);
  c.st.cyl(p[0], p[1] + 20, p[2], 6.4, 0.5, 5, "#4f4540", 8, false);
}

interface Generic {
  h: number;
  w: number;
  d: number;
  style: CityStyle;
  color: RGB;
  /** Allow podiums, setbacks, caps and spires. */
  rich: boolean;
  /** Fraction of the skyline's peak height this building reaches (beacons on the tallest). */
  rank: number;
}

/** A seeded generic building: plan, podium, setbacks and a crown. */
function building(c: SkyCtx, fr: Frame, g: Generic, k: number): void {
  const { h, w, d, color, style } = g;
  let y = GROUND_Y;
  let plan = g.rich && hash(k * 3.7) < 0.3 ? chamferPlan(w, d, Math.min(w, d) * 0.17) : rectPlan(w, d);
  // Podium: a wider masonry base under a tower.
  if (g.rich && h > 240 && hash(k * 2.2) < 0.5) {
    const ph = 45 + hash(k * 2.7) * 45;
    const ps = hash(k * 3.1) < 0.5 ? CITY_STYLE.stone : CITY_STYLE.brick;
    prism(c, fr, 0, 0, y, y + ph, rectPlan(w * 1.45, d * 1.3), tone(c, PALETTE[ps][Math.floor(hash(k * 3.9) * PALETTE[ps].length)], 0.04, k + 1), ps, k + 2);
    y += ph;
  }
  const tiers = h > 300 && hash(k * 5.5) < 0.55 ? (h > 480 && hash(k * 6.6) < 0.5 ? 3 : 2) : 1;
  const tops = tiers === 3 ? [0.6, 0.82, 1] : tiers === 2 ? [0.68 + 0.14 * hash(k * 7.3), 1] : [1];
  const scales = [1, 0.76, 0.56];
  let topPlan = plan;
  let top = y;
  for (let t = 0; t < tiers; t += 1) {
    const y1 = GROUND_Y + (h - GROUND_Y) * tops[t];
    topPlan = scalePlan(plan, scales[t]);
    prism(c, fr, 0, 0, top, y1, topPlan, color, style, k + t * 11);
    top = y1;
  }
  const cw = w * scales[tiers - 1];
  const cd = d * scales[tiers - 1];
  const crown = hash(k * 9.1);
  if (g.rich && crown < 0.13 && h > 220) {
    pyramid(c, fr, 0, 0, top, Math.min(cw, cd) * (0.5 + 0.4 * hash(k * 9.7)), topPlan, mix(color, "#5d6670", 0.35));
  } else if (g.rich && crown < 0.27 && h > 280) {
    plant(c, fr, 0, 0, top, cw, cd, color, k);
    mast(c, fr, 0, 0, top + 14, h * (0.12 + 0.1 * hash(k * 4.4)), 2.4);
  } else if (crown < 0.8) {
    plant(c, fr, 0, 0, top, cw, cd, color, k);
    if (g.rank > 0.72) beacon(c, loc(fr, 0, top + 26, 0));
  } else if (style === CITY_STYLE.brick && h < 200) {
    waterTank(c, fr, cw * 0.2, 0, top);
  }
  if (g.rich && c.lit && hash(k * 12.1) < 0.18) crownBand(c, fr, 0, 0, top - 9, 5, topPlan);
}

const STYLE_COLOR: Partial<Record<TowerStyle, string>> = {
  stepped: "#3a414b",
  pyramid: "#e4e0d4",
  spike: "#e7e5df",
  taper: "#8ea3b6",
  bullet: "#b4c0c8",
  deco: "#cdc4b1",
  bundled: "#34383f",
  hancock: "#33363c",
  cylinder: "#8399ab",
  rencen: "#7d8f9f",
  gothic: "#56677a",
  gable: "#7c93a9",
  slab: "#7d93a6",
};

/**
 * A named landmark tower of height `h` (base at grade) in frame `fr`. Proportions follow the
 * real buildings closely enough to read at a glance: Columbia Center's stepped dark tiers,
 * Smith Tower's pyramid, Willis Tower's bundled tubes, the Transamerica spike, and so on.
 */
export function tower(c: SkyCtx, fr: Frame, style: TowerStyle, h: number, k: number, colorHex?: string): void {
  const base = colorHex ?? STYLE_COLOR[style] ?? "#7d93a6";
  const color = tone(c, base, 0.04, k);
  const G = GROUND_Y;
  const H = h - G;
  const glass = CITY_STYLE.glass;
  const stone = CITY_STYLE.stone;
  const top = (t: number) => G + H * t;
  switch (style) {
    case "stepped": {
      // Columbia Center: three dark tiers on a notched plan, each smaller than the last.
      const w = Math.max(90, h * 0.19);
      const plan = chamferPlan(w, w * 0.92, w * 0.26);
      const tiers: Array<[number, number, number]> = [
        [0, 0.6, 1],
        [0.6, 0.83, 0.8],
        [0.83, 1, 0.6],
      ];
      for (const [a, b, s] of tiers) prism(c, fr, 0, (1 - s) * w * 0.12, top(a), top(b), scalePlan(plan, s), color, glass, k + a * 100);
      plant(c, fr, 0, w * 0.05, top(1), w * 0.5, w * 0.4, color, k);
      beacon(c, loc(fr, 0, top(1) + 24, w * 0.05));
      break;
    }
    case "pyramid": {
      // Smith Tower / Key Tower / Metropolitan Square: a broad base, a slimmer shaft, a pyramid
      // and a finial.
      const w = Math.max(60, h * 0.2);
      prism(c, fr, 0, 0, G, top(0.42), rectPlan(w, w * 0.8), color, stone, k);
      const sp = rectPlan(w * 0.6, w * 0.6);
      prism(c, fr, 0, 0, top(0.42), top(0.8), sp, color, stone, k + 1);
      pyramid(c, fr, 0, 0, top(0.8), H * 0.15, sp, c.lit ? color : mix(base, "#9fb0b4", 0.25));
      mast(c, fr, 0, 0, top(0.95), H * 0.06, 1.8, "#d9d6cc");
      crownBand(c, fr, 0, 0, top(0.8) - 6, 4, sp);
      break;
    }
    case "spike": {
      // Transamerica Pyramid: a tapering four-sided spike with a hollow-looking spire.
      const w = Math.max(70, h * 0.27);
      const steps = 4;
      for (let i = 0; i < steps; i += 1) {
        const a = (i / steps) * 0.86;
        const b = ((i + 1) / steps) * 0.86;
        shell(c, fr, 0, 0, top(a), top(b), rectPlan(w * (1 - a), w * (1 - a)), rectPlan(w * (1 - b), w * (1 - b)), color, CITY_STYLE.stone, k + i, i === steps - 1);
      }
      pyramid(c, fr, 0, 0, top(0.86), H * 0.14, rectPlan(w * 0.14, w * 0.14), color);
      beacon(c, loc(fr, 0, h, 0), 5);
      break;
    }
    case "taper": {
      // One World Trade Center / Wilshire Grand: a chamfered shaft tapering to a slim top, spire.
      const w = Math.max(80, h * 0.18);
      shell(c, fr, 0, 0, G, top(0.78), chamferPlan(w, w, w * 0.08), chamferPlan(w * 0.6, w * 0.6, w * 0.3 * 0.6), color, glass, k);
      prism(c, fr, 0, 0, top(0.78), top(0.8), chamferPlan(w * 0.56, w * 0.56, w * 0.17), mix(color, "#e9edf0", 0.3), CITY_STYLE.ribbon, k + 3);
      mast(c, fr, 0, 0, top(0.8), H * 0.2, 3, "#e3e6e8");
      crownBand(c, fr, 0, 0, top(0.79), 5, chamferPlan(w * 0.56, w * 0.56, w * 0.17));
      break;
    }
    case "bullet": {
      // Salesforce Tower / Great American Tower: rounded corners, a slight taper and a crown
      // that narrows to an open lantern, lit at night.
      const w = Math.max(80, h * 0.16);
      const p0 = chamferPlan(w, w, w * 0.28);
      const p1 = chamferPlan(w * 0.86, w * 0.86, w * 0.86 * 0.28);
      shell(c, fr, 0, 0, G, top(0.88), p0, p1, color, glass, k, false);
      shell(c, fr, 0, 0, top(0.88), top(1), p1, scalePlan(p1, 0.55), mix(color, "#d7dde2", 0.3), CITY_STYLE.ribbon, k + 1);
      crownBand(c, fr, 0, 0, top(0.9), H * 0.08, scalePlan(p1, 0.8), [0.95, 0.97, 1]);
      beacon(c, loc(fr, 0, h, 0), 5);
      break;
    }
    case "deco": {
      // Empire State / Terminal Tower / Carew / Penobscot: limestone setbacks and a mast.
      const w = Math.max(80, h * 0.24);
      const tiers: Array<[number, number, number]> = [
        [0, 0.12, 1.25],
        [0.12, 0.62, 1],
        [0.62, 0.76, 0.74],
        [0.76, 0.84, 0.52],
        [0.84, 0.88, 0.34],
      ];
      for (const [a, b, s] of tiers) prism(c, fr, 0, 0, top(a), top(b), rectPlan(w * s, w * s * 0.8), color, stone, k + a * 50);
      crownBand(c, fr, 0, 0, top(0.76) - 2, H * 0.08, rectPlan(w * 0.52, w * 0.42));
      const p = loc(fr, 0, top(0.88), 0);
      c.st.cyl(p[0], p[1], p[2], w * 0.09, w * 0.05, H * 0.05, base, 8);
      mast(c, fr, 0, 0, top(0.93), H * 0.07, 2.4, "#c9ccd0");
      break;
    }
    case "bundled": {
      // Willis Tower: nine black tubes stopping at different heights, two antennas.
      const t = Math.max(30, h * 0.075);
      const heights = [
        [0.62, 0.9, 0.62],
        [0.48, 1, 0.9],
        [0.48, 0.76, 0.76],
      ];
      for (let i = 0; i < 3; i += 1) {
        for (let j = 0; j < 3; j += 1) prism(c, fr, (i - 1) * t, (j - 1) * t, G, top(heights[j][i] * 0.8), rectPlan(t, t), color, glass, k + i * 3 + j);
      }
      mast(c, fr, -t * 0.3, 0, top(0.8), H * 0.2, 3.2, "#c9ccd0");
      mast(c, fr, t * 0.5, 0, top(0.8), H * 0.17, 3.2, "#c9ccd0");
      break;
    }
    case "hancock": {
      // John Hancock Center: a tapering black box with X-braced faces and twin antennas.
      const w = Math.max(70, h * 0.21);
      const d = w * 0.62;
      const t = 0.62;
      shell(c, fr, 0, 0, G, top(0.82), rectPlan(w, d), rectPlan(w * t, d * t), color, glass, k);
      const steel = c.lit ? "#1c1f24" : "#24272c";
      for (let s = 0; s < 5; s += 1) {
        const a = (s / 5) * 0.82;
        const b = ((s + 1) / 5) * 0.82;
        const wa = (w * (1 - (1 - t) * (a / 0.82))) / 2;
        const wb = (w * (1 - (1 - t) * (b / 0.82))) / 2;
        const za = (d * (1 - (1 - t) * (a / 0.82))) / 2 + 0.8;
        const zb = (d * (1 - (1 - t) * (b / 0.82))) / 2 + 0.8;
        c.st.beam(loc(fr, -wa, top(a), za), loc(fr, wb, top(b), zb), 3, steel);
        c.st.beam(loc(fr, wa, top(a), za), loc(fr, -wb, top(b), zb), 3, steel);
      }
      mast(c, fr, -w * t * 0.25, 0, top(0.82), H * 0.18, 2.6, "#d9dbde");
      mast(c, fr, w * t * 0.25, 0, top(0.82), H * 0.18, 2.6, "#d9dbde");
      break;
    }
    case "cylinder": {
      // U.S. Bank Tower / Miami Tower: a glass drum with a stepped, lit crown.
      const r = Math.max(42, h * 0.09);
      prism(c, fr, 0, 0, G, top(0.86), circlePlan(r, 14), color, glass, k);
      prism(c, fr, 0, 0, top(0.86), top(0.93), circlePlan(r * 0.8, 14), color, glass, k + 1);
      prism(c, fr, 0, 0, top(0.93), top(1), circlePlan(r * 0.58, 14), color, glass, k + 2);
      crownBand(c, fr, 0, 0, top(0.93) - 4, 4, circlePlan(r * 0.8, 14));
      crownBand(c, fr, 0, 0, top(1) - 4, 4, circlePlan(r * 0.58, 14));
      beacon(c, loc(fr, 0, h, 0), 5);
      break;
    }
    case "rencen": {
      // Renaissance Center: a tall glass drum ringed by four shorter ones on a podium.
      const r = Math.max(40, h * 0.085);
      prism(c, fr, 0, 0, G, G + 70, chamferPlan(r * 5.4, r * 5.4, r * 1.6), tone(c, "#9aa1a6", 0.04, k), CITY_STYLE.ribbon, k + 7);
      for (let i = 0; i < 4; i += 1) {
        const a = Math.PI / 4 + (i * Math.PI) / 2;
        prism(c, fr, Math.cos(a) * r * 1.9, Math.sin(a) * r * 1.9, G, top(0.66), circlePlan(r * 0.62, 10), color, glass, k + i);
      }
      prism(c, fr, 0, 0, G, top(0.93), circlePlan(r, 14), color, glass, k + 5);
      prism(c, fr, 0, 0, top(0.93), top(1), circlePlan(r * 0.92, 14), mix(color, "#3a4048", 0.4), CITY_STYLE.ribbon, k + 6);
      crownBand(c, fr, 0, 0, top(0.96), 6, circlePlan(r * 0.95, 14), [0.62, 0.8, 1]);
      beacon(c, loc(fr, 0, h, 0), 5);
      break;
    }
    case "gothic": {
      // PPG Place: dark mirror glass, crenellated with a forest of glass spires.
      const w = Math.max(80, h * 0.22);
      const plan = rectPlan(w, w * 0.8);
      prism(c, fr, 0, 0, G, top(0.86), plan, color, glass, k);
      for (let i = 0; i < 4; i += 1) {
        for (let j = 0; j < 4; j += 1) {
          if (i > 0 && i < 3 && j > 0 && j < 3) continue;
          const sx = -w / 2 + ((i + 0.5) * w) / 4;
          const sz = -w * 0.4 + ((j + 0.5) * w * 0.8) / 4;
          pyramid(c, fr, sx, sz, top(0.86), H * 0.06, rectPlan(w / 6, w / 6), color);
        }
      }
      pyramid(c, fr, 0, 0, top(0.86), H * 0.14, rectPlan(w * 0.36, w * 0.3), color);
      break;
    }
    case "gable": {
      // One Liberty Place / 1201 Third Avenue: setbacks rising to a steep pointed crown and spire.
      const w = Math.max(70, h * 0.17);
      prism(c, fr, 0, 0, G, top(0.66), chamferPlan(w, w, w * 0.12), color, glass, k);
      prism(c, fr, 0, 0, top(0.66), top(0.78), chamferPlan(w * 0.8, w * 0.8, w * 0.14), color, glass, k + 1);
      const cp = chamferPlan(w * 0.62, w * 0.62, w * 0.14);
      prism(c, fr, 0, 0, top(0.78), top(0.84), cp, color, glass, k + 2);
      pyramid(c, fr, 0, 0, top(0.84), H * 0.11, cp, c.lit ? color : mix(color, "#c9d3dc", 0.3));
      crownBand(c, fr, 0, 0, top(0.84) - 4, 4, cp);
      mast(c, fr, 0, 0, top(0.94), H * 0.06, 1.6, "#d9d6cc");
      break;
    }
    default: {
      // A plain landmark slab: setback top, rooftop plant and an antenna.
      const w = Math.max(80, h * 0.2);
      const plan = rectPlan(w, w * 0.7);
      prism(c, fr, 0, 0, G, top(0.9), plan, color, glass, k);
      prism(c, fr, 0, 0, top(0.9), top(1), scalePlan(plan, 0.82), color, glass, k + 1);
      plant(c, fr, 0, 0, top(1), w * 0.82, w * 0.57, color, k);
      if (hash(k * 2.1) < 0.6) mast(c, fr, w * 0.15, 0, top(1) + 20, H * 0.12, 2.4);
      else beacon(c, loc(fr, 0, top(1) + 26, 0));
    }
  }
}

/** Generic skyline: far towers in haze, a core rising toward the named towers, nearer mid-rise. */
export function skyline(c: SkyCtx, f: Extract<Feature, { k: "skyline" }>, fi: number): void {
  const span = f.to - f.from;
  const talls = f.tall ?? [];
  const centre = talls.length ? talls.reduce((s, t) => s + t[0], 0) / talls.length : (f.from + f.to) / 2;
  const sigma = Math.max(7, span * 0.34);
  const env = (deg: number) => 0.32 + 0.68 * Math.exp(-(((deg - centre) / sigma) ** 2));
  const pick = (k: number, styles: CityStyle[]): CityStyle => styles[Math.floor(hash(k * 6.3) * styles.length)];
  const layers: Array<{ n: number; dist: [number, number]; h: (t: number, e: number) => number; w: [number, number]; haze: number; styles: CityStyle[]; rich: boolean }> = [
    // Far: low-contrast towers deep in the haze.
    { n: Math.ceil(f.n * 0.7), dist: [1.62, 1.85], h: (t, e) => f.h * 0.55 * (0.35 + 0.65 * t) * e, w: [70, 130], haze: 0.4, styles: [CITY_STYLE.glass, CITY_STYLE.stone, CITY_STYLE.ribbon], rich: false },
    // Core: the towers, tallest near the landmarks.
    { n: f.n, dist: [1.12, 1.4], h: (t, e) => f.h * (0.28 + 0.72 * t ** 1.5) * e, w: [64, 140], haze: 0.12, styles: [CITY_STYLE.glass, CITY_STYLE.glass, CITY_STYLE.stone, CITY_STYLE.ribbon, CITY_STYLE.glass], rich: true },
    // Near: mid-rise blocks in front.
    { n: Math.ceil(f.n * 0.55), dist: [0.9, 1.02], h: (t) => Math.max(40, f.h * 0.26 * (0.4 + 0.6 * t)), w: [110, 220], haze: 0.04, styles: [CITY_STYLE.brick, CITY_STYLE.stone, CITY_STYLE.ribbon, CITY_STYLE.brick, CITY_STYLE.glass], rich: false },
  ];
  layers.forEach((L, li) => {
    for (let i = 0; i < L.n; i += 1) {
      const k = fi * 997 + li * 400 + i;
      const deg = f.from + (span * (i + 0.15 + 0.7 * hash(k * 5.1))) / L.n;
      const t = hash(k * 13.7 + fi);
      const h = L.h(t, env(deg));
      const dist = f.dist * (L.dist[0] + (L.dist[1] - L.dist[0]) * hash(k * 1.9 + 2));
      const fr = far(deg, dist);
      // Turn each block a little off square so faces catch the light differently.
      const turned = frameYaw(fr.x, fr.z, fr.yaw + (hash(k * 2.6) - 0.5) * 0.5);
      const style = pick(k, L.styles);
      const pal = PALETTE[style];
      const w = L.w[0] + hash(k * 2.3) * (L.w[1] - L.w[0]);
      const d = (li === 2 ? 70 : 55) + hash(k * 4.1) * 45;
      building(c, turned, { h, w, d, style, color: tone(c, pal[Math.floor(hash(k * 7.7) * pal.length)], L.haze, k), rich: L.rich, rank: h / f.h }, k);
    }
  });
  talls.forEach(([deg, h, style, dist, color], i) => {
    const d = dist ?? f.dist * 1.25;
    tower(c, far(deg, d), style ?? "slab", dist ? h : h * 0.85, fi * 991 + 3000 + i * 37, color);
  });
}

/**
 * A lone volcano on the horizon (Mount Rainier): a broad snow-capped cone with a rounded
 * summit and a shoulder, drawn as a curved backdrop at `dist`, lit side brighter.
 */
export function peak(st: GeoBuilder, f: Extract<Feature, { k: "peak" }>): void {
  const n = 56;
  const snow = f.snow ?? 0.42;
  const prof = (x: number) => {
    const ax = Math.abs(x);
    let y = Math.exp(-((ax * 2.3) ** 1.55));
    // Little Tahoma on the right shoulder, Liberty Cap rounding the left.
    y += 0.06 * Math.exp(-(((x - 0.3) / 0.07) ** 2)) + 0.025 * Math.exp(-(((x + 0.12) / 0.05) ** 2));
    y += 0.012 * Math.sin(x * 37) * (1 - ax);
    return Math.max(0, y - 0.035) / 0.965;
  };
  const pts: Array<{ p: [number, number]; y: number; line: number; x: number }> = [];
  for (let i = 0; i <= n; i += 1) {
    const x = -1 + (2 * i) / n;
    const [dx, dz] = dirXZ(f.deg + (x * f.w) / 2);
    const y = f.h * prof(x);
    // Ragged snow line: lower down the gullies, higher on the ribs.
    const line = f.h * (1 - snow + 0.06 * Math.sin(x * 29 + 1.3) + 0.04 * (hash(i * 3.7) - 0.5)) * (0.9 + 0.1 * Math.abs(x));
    pts.push({ p: [dx * f.dist, dz * f.dist], y, line: Math.min(y, line), x });
  }
  const rock = f.color;
  for (let i = 0; i < n; i += 1) {
    const a = pts[i];
    const b = pts[i + 1];
    // The western (left) face takes the light, turning smoothly past the summit.
    const xm = (a.x + b.x) / 2;
    const turn = Math.min(1, Math.max(0, (xm + 0.25) / 0.5));
    const s = (1.06 - 0.2 * turn * turn * (3 - 2 * turn)) * (0.95 + 0.07 * hash(i * 5.3));
    const P = (q: typeof a, y: number): P3 => [q.p[0], GROUND_Y + y, q.p[1]];
    st.quad(P(a, 0), P(b, 0), P(b, b.line), P(a, a.line), rock, s);
    // Snowfield, with the odd darker rock rib running down it.
    if (a.y > a.line + 0.5 || b.y > b.line + 0.5) st.quad(P(a, a.line), P(b, b.line), P(b, b.y), P(a, a.y), mix("#f4f7fa", "#cdd8e6", turn), s * (hash(i * 9.1) < 0.18 ? 0.9 : 1));
  }
}

/** Four-sided tapered block between two horizontal outlines (world points, same order). */
function taper(b: GeoBuilder, lo: P3[], hi: P3[], color: string | RGB, shade = 1): void {
  const m = lo.length;
  for (let i = 0; i < m; i += 1) b.quad(lo[i], lo[(i + 1) % m], hi[(i + 1) % m], hi[i], color, shade * (i % 2 ? 0.86 : 1));
}

/** Floodlit white landmarks glow softly at night; by day they are ordinary lit structure. */
const flood = (c: SkyCtx): GeoBuilder => (c.lit ? c.glow : c.st);
const FLOOD: RGB = [0.5, 0.5, 0.52];

/**
 * Space Needle: three pairs of curved legs pinched at the waist around a central core,
 * the SkyLine ring low down, and the halo saucer (sloped underside, rim, glass deck, roof)
 * under the spire. `h` is the height to the tip.
 */
export function spaceNeedle(c: SkyCtx, x: number, z: number, h: number): void {
  const G = GROUND_Y;
  const H = h;
  const b = flood(c);
  const white = c.lit ? FLOOD : rgb("#f1f0ea");
  const r = (t: number) => (t < 0.36 ? 0.028 + 0.122 * (1 - t / 0.36) ** 2 : 0.028 + 0.03 * ((t - 0.36) / 0.4) ** 1.3) * H;
  const lw = Math.max(1.6, H * 0.013);
  const seg = 10;
  for (let k = 0; k < 3; k += 1) {
    const th = (k * Math.PI * 2) / 3 + Math.PI / 2;
    const ux = Math.cos(th);
    const uz = Math.sin(th);
    for (const side of [-1, 1]) {
      const pt = (t: number): P3 => {
        const rr = r(t);
        const off = side * (0.006 + 0.012 * (1 - Math.min(1, t / 0.36))) * H;
        return [x + ux * rr - uz * off, G + 0.76 * H * t, z + uz * rr + ux * off];
      };
      for (let i = 0; i < seg; i += 1) b.beam(pt(i / seg), pt((i + 1) / seg), lw, white);
    }
  }
  b.cyl(x, G, z, H * 0.02, H * 0.016, 0.76 * H, white, 8, false);
  // SkyLine banquet level.
  b.cyl(x, G + 0.16 * H, z, r(0.17) * 0.9, r(0.17) * 0.9, H * 0.014, white, 12);
  const y0 = G + 0.755 * H;
  c.st.cyl(x, y0, z, H * 0.05, H * 0.112, H * 0.045, c.lit ? "#2b3038" : "#d9d7d0", 16, false);
  b.cyl(x, y0 + H * 0.045, z, H * 0.118, H * 0.118, H * 0.012, c.lit ? rgb("#ffffff", 0.75) : rgb("#e9e6dc"), 18);
  (c.lit ? c.glow : c.st).cyl(x, y0 + H * 0.057, z, H * 0.108, H * 0.102, H * 0.028, c.lit ? rgb("#ffe2b0", 0.9) : rgb("#56646f"), 16, false);
  c.st.cyl(x, y0 + H * 0.085, z, H * 0.104, H * 0.028, H * 0.034, c.lit ? "#3a3f48" : "#d6d2c6", 16);
  c.st.cyl(x, y0 + H * 0.119, z, H * 0.012, H * 0.003, H - (0.755 + 0.119) * H, "#d9d9d6", 6, false);
  beacon(c, [x, G + H, z], 5);
}

/**
 * CN Tower: a Y-section concrete shaft of three tapering wings, the main pod with its
 * glass band, the SkyPod higher up, and the red-and-white antenna mast.
 */
export function cnTower(c: SkyCtx, x: number, z: number, h: number): void {
  const G = GROUND_Y;
  const H = h;
  const conc = c.lit ? "#5d6068" : "#c9c7c1";
  const wing = (t: number) => (0.045 - 0.032 * Math.min(1, t / 0.8)) * H;
  const thick = (t: number) => (0.013 - 0.004 * Math.min(1, t / 0.8)) * H;
  const lv = [0, 0.3, 0.6, 0.8];
  for (let k = 0; k < 3; k += 1) {
    const th = (k * Math.PI * 2) / 3 - Math.PI / 2;
    const ux = Math.cos(th);
    const uz = Math.sin(th);
    const ring = (t: number): P3[] => {
      const L = wing(t);
      const T = thick(t) / 2;
      const y = G + H * t;
      return [
        [x - uz * T, y, z + ux * T],
        [x + ux * L - uz * T, y, z + uz * L + ux * T],
        [x + ux * L + uz * T, y, z + uz * L - ux * T],
        [x + uz * T, y, z - ux * T],
      ];
    };
    for (let i = 0; i < lv.length - 1; i += 1) taper(c.st, ring(lv[i]), ring(lv[i + 1]), conc);
  }
  c.st.cyl(x, G, z, H * 0.016, H * 0.009, H * 0.82, conc, 8, false);
  // Main pod: flared underside, glass band, upper ring and roof.
  const P = (t: number) => G + H * t;
  c.st.cyl(x, P(0.592), z, H * 0.016, H * 0.037, H * 0.024, conc, 18, false);
  (c.lit ? c.glow : c.st).cyl(x, P(0.616), z, H * 0.038, H * 0.038, H * 0.013, c.lit ? rgb("#ffd9a8", 0.85) : rgb("#3f4a57"), 18, false);
  c.st.cyl(x, P(0.629), z, H * 0.038, H * 0.031, H * 0.012, conc, 18, false);
  c.st.cyl(x, P(0.641), z, H * 0.031, H * 0.014, H * 0.01, conc, 18);
  // SkyPod.
  c.st.cyl(x, P(0.8), z, H * 0.01, H * 0.016, H * 0.008, conc, 12, false);
  (c.lit ? c.glow : c.st).cyl(x, P(0.808), z, H * 0.016, H * 0.016, H * 0.007, c.lit ? rgb("#ffd9a8", 0.8) : rgb("#3f4a57"), 12, false);
  c.st.cyl(x, P(0.815), z, H * 0.016, H * 0.008, H * 0.008, conc, 12);
  // Antenna mast in red and white bands.
  for (let i = 0; i < 6; i += 1) {
    const t0 = 0.823 + (i * 0.177) / 6;
    const r0 = H * (0.0075 - 0.005 * (i / 6));
    c.st.cyl(x, P(t0), z, r0, r0 * 0.88, (H * 0.177) / 6, i % 2 ? "#e9e7e2" : "#c4342d", 6, false);
  }
  beacon(c, [x, G + H, z], 8);
}

/** Washington Monument: a tapering marble shaft and its pyramidion, floodlit at night. */
export function obelisk(c: SkyCtx, x: number, z: number, h: number): void {
  const G = GROUND_Y;
  const b = flood(c);
  const col = c.lit ? FLOOD : rgb("#e9e4d7");
  const sq = (w: number, y: number): P3[] => [
    [x - w / 2, y, z - w / 2],
    [x + w / 2, y, z - w / 2],
    [x + w / 2, y, z + w / 2],
    [x - w / 2, y, z + w / 2],
  ];
  const lo = sq(h * 0.1, G);
  const hi = sq(h * 0.062, G + h * 0.9);
  taper(b, lo, hi, col);
  for (let i = 0; i < 4; i += 1) b.tri(hi[i], hi[(i + 1) % 4], [x, G + h, z], col, i % 2 ? 0.86 : 1);
  beacon(c, [x, G + h * 0.9, z], 4);
}
