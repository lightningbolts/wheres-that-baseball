/**
 * Everything around the seating bowl: foul poles, dugouts, bullpens, batter's eye, light
 * banks, scoreboard housing, retractable roofs and each park's landmarks and backdrop.
 * All of it is appended to two shared builders — lit structure and self-lit "glow".
 */
import * as THREE from "three";
import type { Park } from "@/lib/game/physics/park";
import type { Feature, ParkLayout } from "@/lib/game/data/parkLayouts";
import { dirXZ, GROUND_Y, type WallLoop } from "@/components/game/scene/fieldGeometry";
import { GeoBuilder, hash, mix, rgb, type P3, type RGB } from "@/components/game/scene/parks/geo";
import type { StandReach } from "@/components/game/scene/parks/stands";
import { LED_ROW, type DecalAtlas } from "@/components/game/scene/parks/textures";
import { cnTower, far, frameYaw, loc, obelisk, peak, skyline, spaceNeedle, type Frame } from "@/components/game/scene/parks/skyline";

export interface PropCtx {
  park: Park;
  layout: ParkLayout;
  loop: WallLoop;
  /** Lit, vertex-colored structure. */
  st: GeoBuilder;
  /** Unlit emissive surfaces (light banks, lit windows). */
  glow: GeoBuilder;
  /** Self-lit textured signage and lamp racks (see `ledAtlas`). */
  led: GeoBuilder;
  /** Distant buildings with window-grid facades (see `cityTexture`). */
  city: GeoBuilder;
  /** Floodlight glare sprites: x, y, z, size quadruples (night only). */
  flares: number[];
  reach(beta: number): StandReach;
  homeColor: string;
  /** Stadium lights and windows on (dusk and night games). */
  lit: boolean;
  /** Translucent fabric (Tropicana Field's roof); casts no shadow. */
  veil?: GeoBuilder;
}

const clampDeg = (b: number) => Math.min(45, Math.max(-45, b));

/** Frame `back` feet behind the wall at a bearing, facing the field. */
function behind(c: PropCtx, beta: number, back: number): Frame & { h: number } {
  const w = c.loop.atBeta(beta);
  if (Math.abs(beta) <= 45) {
    const [dx, dz] = dirXZ(beta);
    const r = c.park.fence(beta) + back;
    return { ...frameYaw(dx * r, dz * r, Math.atan2(-dx, -dz)), h: w.h };
  }
  return { ...frameYaw(w.x + w.nx * back, w.z + w.nz * back, Math.atan2(-w.nx, -w.nz)), h: w.h };
}


function fbox(b: GeoBuilder, f: Frame, lx: number, y: number, lz: number, sx: number, sy: number, sz: number, color: string | RGB, shade = 1): void {
  const p = loc(f, lx, y, lz);
  b.box(p[0], p[1], p[2], sx, sy, sz, f.yaw, color, shade);
}

/** Vertical panel facing home, centered at local (lx, y, lz). */
function panel(b: GeoBuilder, f: Frame, lx: number, y: number, lz: number, w: number, h: number, color: string | RGB, shade = 1): void {
  b.quad(loc(f, lx - w / 2, y - h / 2, lz), loc(f, lx + w / 2, y - h / 2, lz), loc(f, lx + w / 2, y + h / 2, lz), loc(f, lx - w / 2, y + h / 2, lz), color, shade);
}

const LAMP_ON: RGB = [1, 0.98, 0.9];
const WINDOW: RGB = [1, 0.82, 0.48];

export function foulPoles(c: PropCtx): void {
  const color = c.layout.pole ?? "#f2d23a";
  for (const a of [-45, 45]) {
    const [dx, dz] = dirXZ(a);
    const f = c.park.fence(a);
    const h = c.park.wallHeight(a) + 68;
    c.st.cyl(dx * f, 0, dz * f, 0.55, 0.45, h, color, 6);
    // Screen on the fair side.
    const [ix, iz] = dirXZ(a - Math.sign(a) * 90);
    const yaw = Math.atan2(ix, iz);
    c.st.box(dx * f + ix * 2.2, h - 24, dz * f + iz * 2.2, 0.2, 44, 4, yaw, color, 0.86);
    for (let k = 0; k <= 4; k += 1) c.st.box(dx * f + ix * 2.2, h - 46 + k * 11, dz * f + iz * 2.2, 0.32, 0.5, 4.3, yaw, color, 0.7);
    c.st.box(dx * f + ix * 4.3, h - 24, dz * f + iz * 4.3, 0.34, 44.5, 0.4, yaw, color, 0.74);
  }
}

/** Bearings the two dugouts span (each side), and how deep they cut into the stands. */
export const DUGOUT = { from: 78, to: 112, depth: 12 };

export function dugouts(c: PropCtx): void {
  const D = DUGOUT.depth;
  for (const sigma of [-1, 1]) {
    const s0 = c.loop.sOf(sigma > 0 ? DUGOUT.from : -DUGOUT.to);
    const s1 = c.loop.sOf(sigma > 0 ? DUGOUT.to : -DUGOUT.from);
    const n = Math.max(2, Math.round((s1 - s0) / 9));
    const team = sigma > 0 ? c.homeColor : mix(c.layout.trim, "#8a9099", 0.35);
    for (let i = 0; i < n; i += 1) {
      const p = c.loop.at(s0 + ((s1 - s0) * i) / n);
      const q = c.loop.at(s0 + ((s1 - s0) * (i + 1)) / n);
      const at = (w: typeof p, o: number, y: number): P3 => [w.x + w.nx * o, y, w.z + w.nz * o];
      const top = p.h + 4.8;
      const floor = p.h - 3;
      // A real recess: sunken floor, padded back wall, bench, and a roof slab whose
      // fascia carries the team color. Nothing in here is pure black.
      c.st.quad(at(p, 0.3, floor), at(q, 0.3, floor), at(q, D - 1, floor), at(p, D - 1, floor), "#6a5f52");
      c.st.quadG(at(p, D - 1, floor), at(q, D - 1, floor), at(q, D - 1, top), at(p, D - 1, top), mix(team, "#3a3f47", 0.5), 1, 0.62);
      c.st.quad(at(p, 0.3, floor), at(q, 0.3, floor), at(q, 0.3, p.h), at(p, 0.3, p.h), "#4f463c", 0.9);
      c.st.quad(at(p, D - 1.1, floor + 3.6), at(q, D - 1.1, floor + 3.6), at(q, D - 1.1, floor + 5.2), at(p, D - 1.1, floor + 5.2), mix(team, "#ffffff", 0.1));
      c.st.quad(at(p, D - 3.6, floor + 1.5), at(q, D - 3.6, floor + 1.5), at(q, D - 1.2, floor + 1.5), at(p, D - 1.2, floor + 1.5), "#8a6a48");
      c.st.quad(at(p, D - 3.6, floor), at(q, D - 3.6, floor), at(q, D - 3.6, floor + 1.5), at(p, D - 3.6, floor + 1.5), "#5d4733");
      c.st.quad(at(p, -1.5, top + 0.9), at(q, -1.5, top + 0.9), at(q, D, top + 0.9), at(p, D, top + 0.9), mix(c.layout.concrete, "#55595f", 0.5));
      c.st.quad(at(p, -1.5, top), at(q, -1.5, top), at(q, D - 1, top), at(p, D - 1, top), "#3a3d42", 0.9);
      c.st.quad(at(p, -1.5, top - 0.4), at(q, -1.5, top - 0.4), at(q, -1.5, top + 0.9), at(p, -1.5, top + 0.9), team);
      c.st.quad(at(p, -1.55, top + 0.15), at(q, -1.55, top + 0.15), at(q, -1.55, top + 0.4), at(p, -1.55, top + 0.4), "#f1f1ee");
      c.st.beam(at(p, -0.3, p.h + 1), at(q, -0.3, q.h + 1), 0.18, "#c9ccd0");
      c.st.beam(at(p, -0.3, p.h - 0.2), at(p, -0.3, p.h + 1), 0.18, "#c9ccd0");
      if (i % 3 === 0) c.st.beam(at(p, -1.2, p.h), at(p, -1.2, top), 0.35, "#3b3f45");
      if (i === 0 || i === n - 1) {
        const w = i === 0 ? p : q;
        c.st.quad(at(w, 0.3, floor), at(w, D, floor), at(w, D, top + 0.9), at(w, 0.3, top + 0.9), mix(team, "#1c2026", 0.55), 0.9);
        // Camera well beside the dugout: a low padded pit with a rail.
        const o = c.loop.at(w.s + (i === 0 ? -9 : 9));
        c.st.quad(at(w, 0.3, w.h - 2.2), at(o, 0.3, o.h - 2.2), at(o, 7, o.h - 2.2), at(w, 7, w.h - 2.2), "#55524c");
        c.st.quad(at(w, 7, w.h - 2.2), at(o, 7, o.h - 2.2), at(o, 7, o.h + 2.4), at(w, 7, w.h + 2.4), mix(c.layout.wall, "#22262b", 0.3), 0.85);
        c.st.beam(at(w, 0.2, w.h + 1.1), at(o, 0.2, o.h + 1.1), 0.18, "#c9ccd0");
      }
    }
  }
}

/** LED ad boards across the backstop and a padded rail cap, so the wall behind the plate reads. */
export function backstop(c: PropCtx): void {
  const r = LED_ROW.backstop;
  // Signed distance from dead behind the plate, so the lockup panel is centred there.
  // The board keeps its artwork's proportions (2048 × 320 px) whatever the wall height.
  const ft = Math.max(8, (c.loop.at(0).h - 1.6) * 6.4);
  const u = (d: number) => (d > c.loop.length / 2 ? d - c.loop.length : d) / ft + r.center;
  const spans: Array<[number, number]> = [
    [0, c.loop.sOf(-156)],
    [c.loop.sOf(156), c.loop.length],
  ];
  for (const [s0, s1] of spans) {
    const n = Math.max(2, Math.round((s1 - s0) / 9));
    for (let i = 0; i < n; i += 1) {
      const p = c.loop.at(s0 + ((s1 - s0) * i) / n);
      const q = c.loop.at(s0 + ((s1 - s0) * (i + 1)) / n);
      const at = (w: typeof p, y: number): P3 => [w.x - w.nx * 0.14, y, w.z - w.nz * 0.14];
      c.led.quadUv(at(p, 0.9), at(q, 0.9), at(q, q.h - 0.7), at(p, p.h - 0.7), [u(p.s), r.v[0]], [u(q.s), r.v[0]], [u(q.s), r.v[1]], [u(p.s), r.v[1]], "#ffffff");
    }
  }
}

/** Backstop netting (its own transparent draw call) plus its poles and cable. */
export function netGeometry(c: PropCtx): THREE.BufferGeometry {
  const b = new GeoBuilder(true);
  const top = 34;
  const spans: Array<[number, number]> = [
    [0, c.loop.sOf(-118)],
    [c.loop.sOf(118), c.loop.length],
  ];
  for (const [s0, s1] of spans) {
    const n = Math.max(2, Math.round((s1 - s0) / 8));
    for (let i = 0; i < n; i += 1) {
      const p = c.loop.at(s0 + ((s1 - s0) * i) / n);
      const q = c.loop.at(s0 + ((s1 - s0) * (i + 1)) / n);
      b.quadUv([p.x, p.h, p.z], [q.x, q.h, q.z], [q.x, top, q.z], [p.x, top, p.z], [p.s / 1.5, p.h / 1.5], [q.s / 1.5, q.h / 1.5], [q.s / 1.5, top / 1.5], [p.s / 1.5, top / 1.5], "#ffffff");
      c.st.beam([p.x, top, p.z], [q.x, top, q.z], 0.2, "#3a3d42");
      if (i % 6 === 0) c.st.beam([p.x, p.h, p.z], [p.x, top, p.z], 0.3, "#3a3d42");
    }
  }
  return b.build();
}

/**
 * Batter's eye: a planted bank rising from the wall to a tall dark screen with a capped
 * top, side returns and a back wall — a structure, not a box. Grass eyes are one long lawn;
 * tree eyes keep the screen low so the park's trees stand over it.
 */
export function battersEye(c: PropCtx): void {
  const e = c.layout.eye;
  const s0 = c.loop.sOf(e.from);
  const s1 = c.loop.sOf(e.to);
  const n = Math.max(2, Math.round((s1 - s0) / 12));
  const grass = e.style === "grass";
  const screen = e.style === "ivy" ? "#2f6a35" : e.style === "black" ? "#16181b" : "#1f4a35";
  const h = e.style === "trees" ? e.h * 0.55 : e.h;
  const bank = grass ? 58 : 16;
  const yBank = grass ? h : Math.min(h * 0.3, 9);
  const depth = grass ? 6 : 14;
  const st = c.st;
  for (let i = 0; i < n; i += 1) {
    const p = c.loop.at(s0 + ((s1 - s0) * i) / n);
    const q = c.loop.at(s0 + ((s1 - s0) * (i + 1)) / n);
    const at = (w: typeof p, o: number, y: number): P3 => [w.x + w.nx * o, y, w.z + w.nz * o];
    st.mat = 2;
    if (grass) {
      // Terraced lawn: three mown bands stepped by low retaining walls, with a clipped hedge on top.
      const T = 3;
      for (let k = 0; k < T; k += 1) {
        const o0 = 2.5 + ((bank - 2.5) * k) / T;
        const o1 = 2.5 + ((bank - 2.5) * (k + 1)) / T;
        const yA = (w: typeof p): number => (k === 0 ? w.h * 0.7 : (yBank * k) / T + 1.6);
        const yB = (yBank * (k + 1)) / T;
        st.mat = 2;
        st.quadG(at(p, o0, yA(p)), at(q, o0, yA(q)), at(q, o1, yB), at(p, o1, yB), (i + k) % 2 === 0 ? "#3f7d3c" : "#37733a", 0.84, 1.02);
        st.mat = 1;
        if (k < T - 1) st.quadG(at(p, o1, yB), at(q, o1, yB), at(q, o1, yB + 1.6), at(p, o1, yB + 1.6), "#8b8a7e", 0.7, 0.95);
      }
      st.mat = 2;
      st.quadG(at(p, bank - 5, yBank), at(q, bank - 5, yBank), at(q, bank - 4, yBank + 7), at(p, bank - 4, yBank + 7), "#27592f", 0.7, 1);
      st.quad(at(p, bank - 4, yBank + 7), at(q, bank - 4, yBank + 7), at(q, bank + depth, yBank + 7), at(p, bank + depth, yBank + 7), "#2c6233", 0.95);
    } else {
      st.quadG(at(p, 2.5, p.h * 0.7), at(q, 2.5, q.h * 0.7), at(q, bank, yBank), at(p, bank, yBank), "#2f6a38", 0.9 + 0.06 * hash(i), 0.8);
    }
    if (!grass) {
      st.mat = e.style === "ivy" ? 2 : 0;
      st.quadG(at(p, bank, yBank), at(q, bank, yBank), at(q, bank, h), at(p, bank, h), screen, 0.72, 1.02);
      if (i % 2 === 0 && e.style !== "ivy") st.beam(at(p, bank - 0.3, yBank), at(p, bank - 0.3, h), 0.5, screen, 0.8);
    }
    st.mat = 0;
    // Cap, back wall and the gap behind the wall.
    if (!grass) {
      st.quad(at(p, bank - 1.5, h), at(q, bank - 1.5, h), at(q, bank + depth, h), at(p, bank + depth, h), screen, 0.82);
      st.quad(at(p, bank - 1.5, h - 1.6), at(q, bank - 1.5, h - 1.6), at(q, bank - 1.5, h + 0.2), at(p, bank - 1.5, h + 0.2), mix(screen, "#6f8a78", 0.25));
    }
    const top = grass ? h + 7 : h;
    st.mat = 1;
    st.quadG(at(p, bank + depth, GROUND_Y), at(q, bank + depth, GROUND_Y), at(q, bank + depth, top), at(p, bank + depth, top), mix(c.layout.concrete, "#3a4a40", 0.5), 0.6, 0.85);
    st.quad([p.x, p.h, p.z], [q.x, q.h, q.z], at(q, 2.5, q.h * 0.7), at(p, 2.5, p.h * 0.7), "#3a3d40");
    if (i === 0 || i === n - 1) {
      const w = i === 0 ? p : q;
      st.quadG(at(w, 2.5, GROUND_Y), at(w, bank + depth, GROUND_Y), at(w, bank + depth, h), at(w, 2.5, w.h * 0.7), mix(screen, c.layout.concrete, 0.35), 0.62, 0.86);
      if (!grass) st.quad(at(w, bank, yBank), at(w, bank + depth, yBank), at(w, bank + depth, h), at(w, bank, h), screen, 0.8);
    }
    st.mat = 0;
  }
}

export function bullpens(c: PropCtx): void {
  for (const spec of c.layout.stands) {
    const back = spec.back ?? 0;
    if (!spec.pen || back < 16) continue;
    const s0 = c.loop.sOf(spec.from);
    const s1 = c.loop.sOf(spec.to);
    if (s1 - s0 < 90) continue;
    // Two mounds near the foul-line end throwing toward plates 60 ft along the wall.
    const dir = spec.from < 0 ? 1 : -1;
    const sA = dir > 0 ? s0 + 14 : s1 - 14;
    for (const lane of [0.3, 0.68]) {
      const m = c.loop.at(sA);
      const pl = c.loop.at(sA + dir * 60.5);
      const o = back * lane;
      c.st.cyl(m.x + m.nx * o, 0.05, m.z + m.nz * o, 5, 1.2, 0.8, "#b8845c", 12);
      c.st.disc(pl.x + pl.nx * o, 0.1, pl.z + pl.nz * o, 4, "#b8845c", 12);
    }
    const mid = c.loop.at((s0 + s1) / 2);
    const yaw = Math.atan2(-mid.nx, -mid.nz);
    c.st.box(mid.x + mid.nx * (back - 3), 1, mid.z + mid.nz * (back - 3), 30, 1.6, 2, yaw, "#5b4a3a");
    c.st.box(mid.x + mid.nx * (back - 1.5), 5.6, mid.z + mid.nz * (back - 1.5), 34, 0.5, 6, yaw, c.layout.trim);
  }
}

/** Floodlight rack facing home: a dark frame, a grid of lamps and (at night) a glare sprite. */
function lampRack(c: PropCtx, f: Frame, lx: number, y: number, lz: number, w: number, h: number, rows: number): void {
  fbox(c.st, f, lx, y, lz - 1.3, w + 2.4, h + 2.4, 2, "#2c3035");
  for (let k = 0; k <= 3; k += 1) c.st.beam(loc(f, lx - w / 2 + (w * k) / 3, y - h / 2 - 1.2, lz - 2.6), loc(f, lx - w / 2 + (w * k) / 3, y + h / 2 + 1.2, lz - 2.6), 0.7, "#565b62");
  const rh = h / rows;
  const r = LED_ROW.lamps;
  const lamps = Math.max(1, Math.round(w / rh));
  for (let k = 0; k < rows; k += 1) {
    const y0 = y - h / 2 + k * rh;
    c.led.quadUv(loc(f, lx - w / 2, y0, lz), loc(f, lx + w / 2, y0, lz), loc(f, lx + w / 2, y0 + rh, lz), loc(f, lx - w / 2, y0 + rh, lz), [0, r.v[0]], [lamps / 16, r.v[0]], [lamps / 16, r.v[1]], [0, r.v[1]], "#ffffff");
  }
  if (c.lit) {
    const p = loc(f, lx, y, lz + 1.5);
    c.flares.push(p[0], p[1], p[2], Math.max(w, h) * 2.6);
  }
}

export function lightBanks(c: PropCtx): void {
  const mode = c.layout.lights;
  const betas = mode === "rim" ? [-160, -138, -114, -90, -66, 66, 90, 114, 138, 160, -30, 30] : [-152, -112, -72, 72, 112, 152, -24, 24];
  const steel = "#737980";
  for (const beta of betas) {
    const r = c.reach(beta);
    const of = Math.abs(beta) <= 45;
    if (mode === "rim" && r.out > 60 && !of) {
      // Light bank along the roofline, on a pair of raking struts.
      const f = behind(c, beta, r.out - 3);
      for (const lx of [-16, 16]) {
        c.st.beam(loc(f, lx, r.top - 2, -4), loc(f, lx, r.top + 9, 0), 1.2, steel);
        c.st.beam(loc(f, lx, r.top - 2, 6), loc(f, lx, r.top + 9, 0), 0.8, steel);
      }
      lampRack(c, f, 0, r.top + 14, 0.2, 46, 9, 3);
      continue;
    }
    const f = behind(c, beta, Math.max(40, r.out + 16));
    const h = Math.max(mode === "brush" ? 185 : 150, r.top + 62);
    if (mode === "brush") {
      // Progressive/PNC-style "toothbrush": a slim mast with a tall vertical bank.
      const base = loc(f, 0, GROUND_Y, 0);
      c.st.cyl(base[0], base[1], base[2], 2.6, 1.7, h - GROUND_Y, "#dfe2e5", 10);
      for (const y of [h - 50, h - 26, h - 3]) c.st.beam(loc(f, 0, y, 0), loc(f, 0, y, 2.4), 1, "#aeb3b8");
      lampRack(c, f, 0, h - 26, 3.6, 12, 50, 12);
    } else {
      // Lattice mast: four tapering legs with cross-bracing, a service platform and the rack.
      const legs: Array<[number, number]> = [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ];
      const leg = (k: number, t: number): P3 => {
        const w = 8 - 5.6 * t;
        return loc(f, legs[k][0] * w, GROUND_Y + (h - GROUND_Y) * t, -4 + legs[k][1] * w * 0.7);
      };
      const levels = 6;
      for (let k = 0; k < 4; k += 1) {
        c.st.beam(leg(k, 0), leg(k, 1), 1.3, steel);
        for (let j = 0; j < levels; j += 1) {
          const t0 = j / levels;
          const t1 = (j + 1) / levels;
          c.st.beam(leg(k, t0), leg((k + 1) % 4, t1), 0.55, steel, 0.9);
          c.st.beam(leg(k, t1), leg((k + 1) % 4, t1), 0.55, steel, 0.85);
        }
      }
      fbox(c.st, f, 0, h - 9, -3, 26, 0.8, 9, "#4a4f55");
      lampRack(c, f, 0, h + 5, 0.6, 40, 17, 5);
    }
  }
}

export interface BoardPlacement {
  position: [number, number, number];
  yaw: number;
  w: number;
  h: number;
}

/** Scoreboard housing; returns where the live canvas face goes. */
export function scoreboard(c: PropCtx): BoardPlacement {
  const s = c.layout.board;
  const f = behind(c, clampDeg(s.deg), s.back);
  const w = s.w;
  const h = (w * 3) / 8;
  const frame = s.style === "green" ? "#1d4a35" : "#14161a";
  fbox(c.st, f, 0, s.y, -3, w + 8, h + 8, 6, frame);
  // Carried on a braced steel frame (or sitting on the stand below it), not on sticks.
  const under = c.reach(clampDeg(s.deg));
  const foot = under.out > s.back - 6 ? Math.min(s.y - h / 2 - 8, under.top - 6) : GROUND_Y;
  const bottom = s.y - h / 2 - 4;
  const steel = "#4a4f56";
  const cols = Math.max(3, Math.round(w / 34));
  for (let k = 0; k <= cols; k += 1) {
    const lx = -w / 2 + (w * k) / cols;
    c.st.beam(loc(f, lx, foot, -5), loc(f, lx, s.y + h / 2, -5), 2.6, steel, 0.9);
    c.st.beam(loc(f, lx, foot, -15), loc(f, lx, s.y + h * 0.2, -5.5), 1.8, steel, 0.8);
    if (k < cols) {
      const nx = -w / 2 + (w * (k + 1)) / cols;
      for (let y = foot + 16; y < bottom - 6; y += 30) {
        c.st.beam(loc(f, lx, y, -5), loc(f, nx, y + 15, -5), 1.1, steel, 0.8);
        c.st.beam(loc(f, lx, y + 15, -5), loc(f, nx, y, -5), 1.1, steel, 0.8);
      }
      c.st.beam(loc(f, lx, bottom - 3, -5), loc(f, nx, bottom - 3, -5), 2, steel, 0.85);
    }
  }
  fbox(c.st, f, 0, s.y, -7.5, w + 6, h + 6, 3, "#23262b", 0.8);
  if (s.style === "green") {
    // Wrigley: pitched cap and a clock.
    c.st.tri(loc(f, -w / 2 - 4, s.y + h / 2 + 4, 0), loc(f, w / 2 + 4, s.y + h / 2 + 4, 0), loc(f, 0, s.y + h / 2 + 16, 0), frame);
    c.st.sphere(...loc(f, 0, s.y + h / 2 + 7, 0.8), 3.4, "#f4f1e6", 8, 1);
  } else if (s.style === "hex") {
    // Dodger Stadium: hexagonal housing.
    for (const sx of [-1, 1]) c.st.tri(loc(f, sx * (w / 2 + 4), s.y - h / 2 - 4, 0), loc(f, sx * (w / 2 + 4), s.y + h / 2 + 4, 0), loc(f, sx * (w / 2 + 22), s.y, 0), "#1b3e7c");
  } else {
    fbox(c.st, f, 0, s.y + h / 2 + 8.5, -3, w + 8, 9, 5, c.homeColor);
    fbox(c.st, f, 0, s.y - h / 2 - 7.5, -3, w + 8, 7, 5, mix(c.homeColor, "#101214", 0.6));
    // Sponsor boards under and beside the main screen.
    const r = LED_ROW.backstop;
    const ad = (lx: number, y: number, bw: number, bh: number, u0: number, u1: number) => {
      c.led.quadUv(loc(f, lx - bw / 2, y - bh / 2, 0.3), loc(f, lx + bw / 2, y - bh / 2, 0.3), loc(f, lx + bw / 2, y + bh / 2, 0.3), loc(f, lx - bw / 2, y + bh / 2, 0.3), [u0, r.v[0]], [u1, r.v[0]], [u1, r.v[1]], [u0, r.v[1]], "#ffffff");
    };
    // Under the screen: whole tiles of the board, centred on its lockup panel.
    const reps = Math.max(1, Math.round((w + 4) / 5.4 / 6.4));
    ad(0, s.y - h / 2 - 7.5, w + 4, 5.4, r.center - reps / 2, r.center + reps / 2);
    const sw = Math.max(16, w * 0.16);
    for (const sx of [-1, 1]) {
      fbox(c.st, f, sx * (w / 2 + 6 + sw / 2), s.y, -3, sw + 4, h + 8, 5, frame);
      for (let k = 0; k < 3; k += 1) {
        const pn = r.panels[[0, 3, 2][k]];
        ad(sx * (w / 2 + 6 + sw / 2), s.y + (k - 1) * (h / 3), sw, h / 3 - 1.5, pn[0], pn[1]);
      }
    }
  }
  const p = loc(f, 0, s.y, 0.25);
  return { position: [p[0], p[1], p[2]], yaw: f.yaw, w, h };
}

/**
 * Fixed cable dome (Tropicana Field): translucent fabric stepping down in concentric bands
 * from a peak over second base to a rim on the top of the stands, the whole roof tilted
 * about 6.5° down toward center field. Catwalk rings A–D hang under the ridges (A over the
 * infield at ~194 ft above home and ~181 ft above center, D at ~121 / ~59 ft), tied by
 * radial ridge cables.
 */
function cableDome(c: PropCtx, peak: number, color: string): void {
  const st = c.st;
  const veil = c.veil;
  const C = { x: 0, z: 170 };
  const tilt = Math.tan((6.5 * Math.PI) / 180);
  const n = 72;
  // Ridge rings as fractions of the centre-to-rim run (catwalks A–D sit just under them).
  const ridges = [0, 0.19, 0.45, 0.69, 0.9, 1];
  const rim: Array<{ x: number; z: number; y: number }> = [];
  for (let i = 0; i < n; i += 1) {
    const beta = -180 + (360 * i) / n;
    const w = c.loop.atBeta(beta);
    const rr = c.reach(beta);
    const out = rr.out + 8;
    rim.push({ x: w.x + w.nx * out, z: w.z + w.nz * out, y: Math.max(rr.top + 10, 34) });
  }
  const top = (z: number) => peak - tilt * (z - C.z);
  const pt = (i: number, t: number, sag: number): P3 => {
    const e = rim[((i % n) + n) % n];
    const x = C.x + (e.x - C.x) * t;
    const z = C.z + (e.z - C.z) * t;
    return [x, e.y + (top(z) - e.y) * (1 - t ** 1.35) - sag, z];
  };
  if (veil) {
    for (let b = 0; b < ridges.length - 1; b += 1) {
      const t0 = ridges[b];
      const t1 = ridges[b + 1];
      const steps = b === 0 ? 2 : 3;
      for (let k = 0; k < steps; k += 1) {
        const u0 = k / steps;
        const u1 = (k + 1) / steps;
        const ta = t0 + (t1 - t0) * u0;
        const tb = t0 + (t1 - t0) * u1;
        // Fabric sags between the ridge cables.
        const sa = 7 * Math.sin(Math.PI * u0) * (t1 - t0) * 4;
        const sb = 7 * Math.sin(Math.PI * u1) * (t1 - t0) * 4;
        for (let i = 0; i < n; i += 1) {
          const shade = 0.9 + 0.1 * Math.cos(Math.PI * (u0 + u1)) + 0.04 * (i % 2);
          veil.quad(pt(i, ta, sa), pt(i + 1, ta, sa), pt(i + 1, tb, sb), pt(i, tb, sb), color, shade);
        }
      }
    }
  }
  const steel = "#9aa1a8";
  // Radial ridge cables and the ridge rings.
  for (let i = 0; i < n; i += 3) for (let b = 0; b < ridges.length - 1; b += 1) st.beam(pt(i, ridges[b], 0), pt(i, ridges[b + 1], 0), 0.8, steel, 0.9);
  for (let b = 1; b < ridges.length; b += 1) {
    for (let i = 0; i < n; i += 1) {
      st.beam(pt(i, ridges[b], 0), pt(i + 1, ridges[b], 0), b === ridges.length - 1 ? 9 : 1.2, b === ridges.length - 1 ? "#e4e2dc" : steel, 0.92);
    }
  }
  // Catwalks A–D: walkway trusses hung below the ridge rings, lights along A and B.
  for (let b = 1; b <= 4; b += 1) {
    for (let i = 0; i < n; i += 1) {
      const a = pt(i, ridges[b], 14);
      const q = pt(i + 1, ridges[b], 14);
      st.beam(a, q, 5, "#7d848b", 0.85);
      st.beam([a[0], a[1] + 6, a[2]], pt(i, ridges[b], 0), 0.6, steel, 0.8);
      if (b <= 2 && i % 2 === 0) (c.lit ? c.glow : st).box(a[0], a[1] - 3, a[2], 4, 2, 4, 0, c.lit ? "#fff6dc" : "#c9ccd0");
    }
  }
}

/**
 * Retractable roof, parked open. Four kinds: panels that slide along rails to one end
 * (Houston, Seattle, Miami, Arlington), split to both ends (Phoenix), fan open about a pivot
 * behind the plate (Milwaukee), or nest as a dome over center field (Toronto).
 */
export function roof(c: PropCtx): void {
  const r = c.layout.roof;
  if (!r) return;
  const st = c.st;
  const C = { x: 0, z: 185 };
  const half = 480;
  const [ax, az] = dirXZ(r.axis);
  const lx = az;
  const lz = -ax;
  const at = (t: number, l: number, y: number): P3 => [C.x + ax * t + lx * l, y, C.z + az * t + lz * l];
  const steel = "#8d939a";
  const kind = r.kind ?? "slide";
  /** A curved roof skin over a grid of points, seamed metal on top and ribbed underneath. */
  const skin = (pt: (u: number, v: number) => P3, nu: number, nv: number, shade: number): void => {
    for (let i = 0; i < nu; i += 1) {
      for (let j = 0; j < nv; j += 1) {
        const a = pt(i / nu, j / nv);
        const b = pt((i + 1) / nu, j / nv);
        const d = pt(i / nu, (j + 1) / nv);
        const e = pt((i + 1) / nu, (j + 1) / nv);
        const top = (a[1] + e[1]) / 2;
        st.mat = 5;
        st.quad(a, b, e, d, r.color, shade * (0.84 + 0.16 * Math.min(1, (top - r.h + 20) / 80)));
      }
    }
    st.mat = 0;
  };
  if (kind === "cable") {
    cableDome(c, r.h, r.color);
    return;
  }
  if (kind === "dome") {
    // Nested shells stacked over center field, the largest outermost.
    for (let k = 0; k < 3; k += 1) {
      const R = half + 22 - k * 20;
      const wide = (78 - k * 14) * (Math.PI / 180);
      const H = r.h + 70 - k * 14;
      const el1 = (62 + k * 9) * (Math.PI / 180);
      const pt = (u: number, v: number): P3 => {
        const a = (r.axis * Math.PI) / 180 + (u * 2 - 1) * wide;
        const el = 0.2 + v * (el1 - 0.2);
        const rr = R * Math.cos(el);
        return [C.x - Math.sin(a) * rr, GROUND_Y + H * Math.sin(el) * 1.02, C.z + Math.cos(a) * rr];
      };
      skin(pt, 14, 6, 1 - k * 0.05);
      // Leading-edge arch truss.
      for (let i = 0; i < 14; i += 1) {
        const a = pt(i / 14, 1);
        const b = pt((i + 1) / 14, 1);
        st.quad([a[0], a[1] - 14, a[2]], [b[0], b[1] - 14, b[2]], b, a, steel, 0.8);
      }
    }
    // The fixed ring the shells ride on.
    for (let i = 0; i < 40; i += 1) {
      const a0 = (i / 40) * Math.PI * 2;
      const a1 = ((i + 1) / 40) * Math.PI * 2;
      const R = half + 26;
      st.beam([C.x + Math.cos(a0) * R, r.h * 0.42, C.z + Math.sin(a0) * R], [C.x + Math.cos(a1) * R, r.h * 0.42, C.z + Math.sin(a1) * R], 12, steel, 0.9);
    }
    return;
  }
  if (kind === "fan") {
    // Wedge panels pivoting behind the plate, stacked over each baseline; a fixed spine
    // of arched ribs frames the opening.
    const P = { x: C.x - ax * (half + 40), z: C.z - az * (half + 40) };
    const R = 2 * half + 60;
    const base = (r.axis * Math.PI) / 180;
    const pp = (ang: number, t: number, lift: number): P3 => {
      const rr = 80 + (R - 80) * t;
      return [P.x - Math.sin(base + ang) * rr, r.h + lift + 110 * Math.sin(Math.PI * Math.min(1, t * 1.04)) - 40 * t, P.z + Math.cos(base + ang) * rr];
    };
    for (const side of [-1, 1]) {
      for (let k = 0; k < 3; k += 1) {
        const a0 = side * (0.56 - k * 0.03);
        const a1 = side * (0.56 + r.cover * 1.5 - k * 0.1);
        skin((u, v) => pp(a0 + (a1 - a0) * u, v, (2 - k) * 14), 4, 10, 1 - k * 0.05);
      }
      for (let j = 0; j < 12; j += 1) st.beam(pp(side * 0.54, j / 12, 30), pp(side * 0.54, (j + 1) / 12, 30), 9, steel, 0.9);
      const foot = pp(side * 0.54, 1, 30);
      st.beam([foot[0], GROUND_Y, foot[2]], foot, 12, steel, 0.85);
    }
    return;
  }
  // Rails on trussed legs down both sides.
  for (const side of [-1, 1]) {
    const l = side * half;
    st.beam(at(-half - 30, l, r.h - 6), at(half + 150, l, r.h - 6), 14, steel);
    for (let t = -half; t <= half + 150; t += 157.5) {
      st.beam(at(t, l, GROUND_Y), at(t, l, r.h - 12), 11, steel, 0.85);
      st.beam(at(t, l, r.h * 0.45), at(t + 78, l, r.h - 12), 5, steel, 0.8);
      st.beam(at(t, l, r.h * 0.45), at(t - 78, l, r.h - 12), 5, steel, 0.8);
    }
  }
  const span = 2 * half;
  const stacks: Array<[number, number, number]> = kind === "split" ? [[half - (r.cover / 2) * span, half + 140, 1], [-half + (r.cover / 2) * span, -half - 140, 1]] : [[half - r.cover * span, half + 140, 1]];
  const panels = kind === "split" ? 2 : 3;
  for (const [t0, t1] of stacks) {
    for (let k = 0; k < panels; k += 1) {
      const a = t0 + ((t1 - t0) * k) / panels - (k ? Math.sign(t1 - t0) * 26 : 0);
      const b = t0 + ((t1 - t0) * (k + 1)) / panels;
      const lift = (panels - 1 - k) * 15;
      const y = (u: number) => r.h + lift + 62 * Math.cos((u * Math.PI) / 2);
      skin((u, v) => at(a + (b - a) * u, (v * 2 - 1) * half, y(v * 2 - 1)), 2, 14, 1 - k * 0.04);
      // Each panel is carried by open arched trusses at both ends: a curved top chord under
      // the skin, a flatter bottom chord and Warren webbing between them.
      const seg = 16;
      const depth = (u: number) => 26 - 12 * Math.abs(u);
      for (const t of [a, b]) {
        const top = (u: number): P3 => at(t, u * half, y(u) - 2);
        const bot = (u: number): P3 => at(t, u * half, y(u) - 2 - depth(u));
        for (let i = 0; i < seg; i += 1) {
          const u0 = -1 + (2 * i) / seg;
          const u1 = -1 + (2 * (i + 1)) / seg;
          st.beam(top(u0), top(u1), 4.5, steel, 0.95);
          st.beam(bot(u0), bot(u1), 3.5, steel, 0.8);
          st.beam(i % 2 ? top(u0) : bot(u0), i % 2 ? bot(u1) : top(u1), 1.8, steel, 0.75);
        }
        st.beam(top(-1), bot(-1), 2.4, steel, 0.8);
        st.beam(top(1), bot(1), 2.4, steel, 0.8);
      }
      // A lighter rib truss at mid-panel.
      const m = (a + b) / 2;
      for (let i = 0; i < seg; i += 2) {
        const u0 = -1 + (2 * i) / seg;
        const u1 = -1 + (2 * (i + 2)) / seg;
        st.quad(at(m, u0 * half, y(u0) - 10), at(m, u1 * half, y(u1) - 10), at(m, u1 * half, y(u1)), at(m, u0 * half, y(u0)), steel, 0.62);
      }
      // Wheeled trucks under each corner ride the rails; stacked panels sit on taller frames.
      const rail = r.h + 1;
      for (const side of [-1, 1]) {
        for (const t of [a + Math.sign(b - a) * 14, b - Math.sign(b - a) * 14]) {
          const p = at(t, side * half, rail + 4);
          const yaw = Math.atan2(ax, az);
          st.box(p[0], p[1], p[2], 13, 7, 34, yaw, "#3d4247", 0.9);
          for (const o of [-11, 0, 11]) {
            const w = at(t + o, side * half, rail + 1.6);
            st.box(w[0], w[1], w[2], 15, 4.4, 4.4, yaw, "#1f2226", 0.8);
          }
          const top = y(side) - 2;
          if (top - (rail + 7.5) > 2) {
            for (const o of [-10, 10]) st.beam(at(t + o, side * half, rail + 7.5), at(t, side * half, top), 3, steel, 0.85);
          }
        }
      }
    }
  }
}

/** Painted distance markers and (at Fenway) the manual scoreboard — one textured mesh. */
export function decalGeometry(c: PropCtx, atlas: DecalAtlas): THREE.BufferGeometry {
  const b = new GeoBuilder(true);
  c.park.fenceMarkers.slice(0, 8).forEach((m, i) => {
    const deg = Math.min(44, Math.max(-44, m.deg));
    const w = c.loop.atBeta(deg);
    const hN = Math.min(3.6, Math.max(1.6, w.h - 1.6));
    const wN = hN * 2;
    const y0 = Math.max(0.5, Math.min(w.h * 0.5 - hN / 2, 3));
    const rx = -w.nz;
    const rz = w.nx;
    const px = w.x - w.nx * 0.2;
    const pz = w.z - w.nz * 0.2;
    const [u0, v0, u1, v1] = atlas.cell(i);
    b.quadUv([px - (rx * wN) / 2, y0, pz - (rz * wN) / 2], [px + (rx * wN) / 2, y0, pz + (rz * wN) / 2], [px + (rx * wN) / 2, y0 + hN, pz + (rz * wN) / 2], [px - (rx * wN) / 2, y0 + hN, pz - (rz * wN) / 2], [u0, v0], [u1, v0], [u1, v1], [u0, v1], "#ffffff");
  });
  const monster = c.layout.skins.findIndex((s) => s[1] === "monster");
  if (monster >= 0) {
    const from = c.layout.skins[monster][0];
    const to = c.layout.skins[monster + 1]?.[0] ?? 45;
    const sC = c.loop.sOf(from + (to - from) * 0.42);
    const len = 104;
    const n = 8;
    const [u0, v0, u1, v1] = atlas.board;
    for (let i = 0; i < n; i += 1) {
      const p = c.loop.at(sC - len / 2 + (len * i) / n);
      const q = c.loop.at(sC - len / 2 + (len * (i + 1)) / n);
      const ua = u0 + ((u1 - u0) * i) / n;
      const ub = u0 + ((u1 - u0) * (i + 1)) / n;
      const o = 0.2;
      b.quadUv([p.x - p.nx * o, 1.2, p.z - p.nz * o], [q.x - q.nx * o, 1.2, q.z - q.nz * o], [q.x - q.nx * o, 14.2, q.z - q.nz * o], [p.x - p.nx * o, 14.2, p.z - p.nz * o], [ua, v0], [ub, v0], [ub, v1], [ua, v1], "#ffffff");
    }
  }
  return b.build();
}

function tree(b: GeoBuilder, x: number, z: number, kind: "pine" | "palm" | "round" | "cherry", k: number): void {
  const y = GROUND_Y;
  const s = 0.8 + hash(k * 3.3) * 0.5;
  const bark = "#4f3d2e";
  if (kind === "pine") {
    b.cyl(x, y, z, 1.2, 0.7, 12 * s, bark, 6, false);
    b.mat = 2;
    const dark = mix("#173d24", "#24552f", hash(k));
    // Overlapping skirts, each lighter toward the tip, read as one soft conifer.
    for (let t = 0; t < 5; t += 1) {
      const r = (10.5 - t * 1.9) * s;
      const y0 = y + (6 + t * 7.2) * s;
      const hh = (13 - t * 1.1) * s;
      const lo = mix(dark, "#0f2a19", 0.35);
      const hi = mix(dark, "#4d8a4c", 0.18 + t * 0.1);
      const seg = 12;
      for (let i = 0; i < seg; i += 1) {
        const a0 = (i / seg) * Math.PI * 2;
        const a1 = ((i + 1) / seg) * Math.PI * 2;
        const n0: P3 = [Math.cos(a0), 0.7, Math.sin(a0)];
        const n1: P3 = [Math.cos(a1), 0.7, Math.sin(a1)];
        b.triN([x + Math.cos(a0) * r, y0, z + Math.sin(a0) * r], [x + Math.cos(a1) * r, y0, z + Math.sin(a1) * r], [x, y0 + hh, z], n0, n1, [(n0[0] + n1[0]) / 2, 0.7, (n0[2] + n1[2]) / 2], lo, lo, hi);
      }
    }
  } else if (kind === "palm") {
    const h = (38 + hash(k) * 16) * s;
    const lean = (hash(k * 1.3) - 0.5) * 5;
    b.cyl(x, y, z, 1.1, 0.8, h * 0.5, "#8a765e", 6, false);
    b.beam([x, y + h * 0.5, z], [x + lean, y + h, z], 1.3, "#8a765e");
    b.mat = 2;
    const cx = x + lean;
    b.sphere(cx, y + h, z, 2.2, "#4a7a38", 8, 0.8);
    for (let i = 0; i < 11; i += 1) {
      const a = (i / 11) * Math.PI * 2 + k;
      const col = mix("#2c6630", "#5a9a45", hash(k + i));
      // Each frond arcs up, out and droops, in three segments.
      const pt = (t: number, side: number): P3 => {
        const r = 14 * t;
        const wd = 2.3 * Math.sin(Math.PI * Math.min(1, t * 1.1)) * side;
        return [cx + Math.cos(a) * r + Math.sin(a) * wd, y + h + 0.5 + 7 * t - 13 * t * t - hash(i + k) * 2 * t, z + Math.sin(a) * r - Math.cos(a) * wd];
      };
      for (let j = 0; j < 3; j += 1) {
        const t0 = j / 3;
        const t1 = (j + 1) / 3;
        b.quad(pt(t0, -1), pt(t0, 1), pt(t1, 1), pt(t1, -1), col, 1 - j * 0.1);
      }
    }
  } else {
    const cherry = kind === "cherry";
    const r = (cherry ? 8 : 12) * s;
    b.cyl(x, y, z, 1.3, 0.8, r * 1.3 + 4, bark, 6, false);
    b.mat = 2;
    const top = cherry ? mix("#f0b4cb", "#f8d5e2", hash(k)) : mix("#3c7f3a", "#5a9a48", hash(k));
    const bot = cherry ? mix("#b96d8c", "#cf8aa5", hash(k)) : mix("#1c4a26", "#27592d", hash(k));
    const cy = y + r * 1.5 + 3;
    b.sphere(x, cy, z, r, top, 12, 0.88, bot, 0.1);
    // Satellite clumps make the canopy read as foliage rather than a ball.
    for (let i = 0; i < 4; i += 1) {
      const a = (i / 4) * Math.PI * 2 + hash(k * 2.1 + i) * 1.4;
      const rr = r * (0.55 + 0.18 * hash(k + i * 3.7));
      b.sphere(x + Math.cos(a) * r * 0.6, cy - r * 0.2 + (hash(k * 5 + i) - 0.3) * r * 0.45, z + Math.sin(a) * r * 0.6, rr, top, 10, 0.88, bot, 0.08);
    }
  }
  b.mat = 0;
}

function feature(c: PropCtx, f: Feature, fi: number): void {
  const { st, glow } = c;
  const park = c.park;
  const fenceAt = (beta: number) => park.fence(clampDeg(beta));
  switch (f.k) {
    case "skyline":
      skyline(c, f, fi);
      break;
    case "peak":
      peak(st, f);
      break;
    case "mountains": {
      const n = 40;
      const pts: Array<[P3, number]> = [];
      for (let i = 0; i <= n; i += 1) {
        const u = i / n;
        const deg = f.from + (f.to - f.from) * u;
        const [dx, dz] = dirXZ(deg);
        const ridge = 0.5 + 0.28 * Math.sin(u * 9.4 + fi * 2.1) + 0.16 * Math.sin(u * 23.1 + fi) + 0.12 * (hash(i * 3.3 + fi * 17) - 0.5);
        const edge = Math.min(1, Math.min(u, 1 - u) * 6);
        pts.push([[dx * f.dist, GROUND_Y, dz * f.dist], f.h * Math.max(0.12, ridge) * (0.35 + 0.65 * edge)]);
      }
      for (let i = 0; i < n; i += 1) {
        const [p, hp] = pts[i];
        const [q, hq] = pts[i + 1];
        const shade = 0.86 + 0.24 * hash(i * 7.1 + fi);
        const snowP = f.snow && hp > f.h * 0.42 ? hp * 0.74 : hp;
        const snowQ = f.snow && hq > f.h * 0.42 ? hq * 0.74 : hq;
        st.quad(p, q, [q[0], GROUND_Y + snowQ, q[2]], [p[0], GROUND_Y + snowP, p[2]], f.color, shade);
        if (snowP < hp || snowQ < hq) st.quad([p[0], GROUND_Y + snowP, p[2]], [q[0], GROUND_Y + snowQ, q[2]], [q[0], GROUND_Y + hq, q[2]], [p[0], GROUND_Y + hp, p[2]], "#e9eef3", shade);
      }
      break;
    }
    case "water": {
      const step = 4;
      const y = GROUND_Y + 0.7;
      st.mat = 6;
      for (let deg = f.from; deg < f.to - 0.01; deg += step) {
        const d1 = Math.min(f.to, deg + step);
        const [ax, az] = dirXZ(deg);
        const [bx, bz] = dirXZ(d1);
        const r0a = fenceAt(deg) + f.back;
        const r0b = fenceAt(d1) + f.back;
        const bands: Array<[number, number, string]> = f.w
          ? [[0, f.w, "#3a7395"]]
          : [
              [0, 420, "#2f6e97"],
              [420, 1500, "#3f7fa6"],
              [1500, 3400, "#5a93b6"],
            ];
        for (const [o0, o1, col] of bands) {
          st.quad([ax * (r0a + o0), y, az * (r0a + o0)], [bx * (r0b + o0), y, bz * (r0b + o0)], [bx * (r0b + o1), y, bz * (r0b + o1)], [ax * (r0a + o1), y, az * (r0a + o1)], col);
        }
        if (f.w) {
          // A river's far bank.
          st.mat = 1;
          const e0 = r0a + f.w;
          const e1 = r0b + f.w;
          st.quad([ax * e0, GROUND_Y + 0.2, az * e0], [bx * e1, GROUND_Y + 0.2, bz * e1], [bx * (e1 + 14), GROUND_Y + 0.2, bz * (e1 + 14)], [ax * (e0 + 14), GROUND_Y + 0.2, az * (e0 + 14)], "#b5b1a6");
          st.mat = 6;
        }
        // Quay wall and promenade along the near bank.
        st.mat = 1;
        st.quad([ax * (r0a - 14), GROUND_Y + 0.2, az * (r0a - 14)], [bx * (r0b - 14), GROUND_Y + 0.2, bz * (r0b - 14)], [bx * r0b, GROUND_Y + 0.2, bz * r0b], [ax * r0a, GROUND_Y + 0.2, az * r0a], "#b5b1a6");
        st.mat = 6;
      }
      st.mat = 0;
      break;
    }
    case "bridge": {
      bridge(c, f);
      break;
    }
    case "arch": {
      gatewayArch(st, far(f.deg, f.dist), f.h);
      break;
    }
    case "needle": {
      const [dx, dz] = dirXZ(f.deg);
      if (f.style === "saucer") spaceNeedle(c, dx * f.dist, dz * f.dist, f.h);
      else if (f.h > 700) cnTower(c, dx * f.dist, dz * f.dist, f.h);
      else obelisk(c, dx * f.dist, dz * f.dist, f.h);
      break;
    }
    case "building": {
      const base = behind(c, f.deg, f.back + f.d / 2);
      // A skewed face points at bearing deg + skew instead of straight at the plate.
      const fr = f.skew ? { ...frameYaw(base.x, base.z, base.yaw - (f.skew * Math.PI) / 180), h: base.h } : base;
      st.mat = f.glass ? 4 : 3;
      st.aux = f.h;
      fbox(st, fr, 0, GROUND_Y + (f.h - GROUND_Y) / 2, 0, f.w, f.h - GROUND_Y, f.d, f.color);
      st.mat = 0;
      st.aux = 0;
      if (f.trim) fbox(st, fr, 0, f.h + 1.5, 0, f.w + 3, 3, f.d + 3, f.trim);
      if (c.lit) {
        const cols = Math.max(3, Math.round(f.w / 24));
        const rows = Math.max(1, Math.floor((f.h - 32) / 15));
        for (let r = 0; r < rows; r += 1) for (let k = 0; k < cols; k += 1) if (hash(fi * 31 + r * 7 + k * 3) > 0.6) panel(glow, fr, ((k + 0.5) / cols - 0.5) * f.w, 32 + r * 15, f.d / 2 + 0.3, 9, 7, WINDOW, 0.8);
      }
      break;
    }
    case "rowhouses": {
      for (let deg = f.from + 3, i = 0; deg < f.to; deg += 6.5, i += 1) {
        const h = 36 + hash(i * 3.1 + 5) * 16;
        const fr = behind(c, deg, f.back + 20);
        const col = mix("#8a4b38", "#b9a488", hash(i * 9.7));
        fbox(st, fr, 0, GROUND_Y + (h - GROUND_Y) / 2, 0, 44, h - GROUND_Y, 40, col);
        for (let k = 0; k < 3; k += 1) {
          for (let r = 0; r < 3; r += 1) {
            const on = c.lit && hash(i * 5 + k * 3 + r) > 0.5;
            panel(on ? glow : st, fr, (k - 1) * 13, 8 + r * 10, 20.3, 6, 6, on ? WINDOW : "#222831");
          }
        }
        // Rooftop bleachers looking into the park.
        st.quad(loc(fr, -20, h + 1, 18), loc(fr, 20, h + 1, 18), loc(fr, 20, h + 15, -16), loc(fr, -20, h + 15, -16), "#6f757c");
        st.quad(loc(fr, -20, h, -16), loc(fr, 20, h, -16), loc(fr, 20, h + 15, -16), loc(fr, -20, h + 15, -16), "#4c5157");
      }
      break;
    }
    case "trees": {
      for (let i = 0; i < f.n; i += 1) {
        const deg = f.from + ((f.to - f.from) * (i + 0.5 + (hash(i * 3.7 + fi) - 0.5) * 0.7)) / f.n;
        const r = fenceAt(deg) + f.back + hash(i * 9.1 + fi * 3) * Math.min(40, f.back * 0.4);
        const [dx, dz] = dirXZ(deg);
        tree(st, dx * r, dz * r, f.kind, i + fi * 50);
      }
      break;
    }
    case "rocks": {
      const fr = behind(c, f.deg, f.back);
      for (let i = 0; i < 12; i += 1) {
        const lx = (hash(i * 3.3 + fi) - 0.5) * f.w;
        const lz = -hash(i * 5.7 + fi) * 30;
        const r = 7 + hash(i * 7.9) * 9;
        const p = loc(fr, lx, r * 0.45, lz);
        st.sphere(p[0], p[1], p[2], r, mix("#8a8177", "#b3a996", hash(i * 2.1)), 6, 0.75);
      }
      if (f.water) {
        st.quad(loc(fr, -f.w / 2, 1.2, 8), loc(fr, f.w / 2, 1.2, 8), loc(fr, f.w / 2, 1.2, -6), loc(fr, -f.w / 2, 1.2, -6), "#3d86b8");
        for (let i = 0; i < 5; i += 1) {
          const p = loc(fr, ((i + 0.5) / 5 - 0.5) * f.w * 0.8, 1.2, 0);
          st.cyl(p[0], p[1], p[2], 2.2, 0.2, 6 + hash(i + fi) * 5, "#cfe3ee", 8, false);
        }
      }
      break;
    }
    case "fountain": {
      const step = 2;
      for (let deg = f.from; deg < f.to - 0.01; deg += step) {
        const a = behind(c, deg, f.back);
        const b = behind(c, Math.min(f.to, deg + step), f.back);
        const y = a.h - 1;
        st.quad(loc(a, 0, y, 0), loc(b, 0, y, 0), loc(b, 0, y, -24), loc(a, 0, y, -24), "#3d86b8", 0.95 + 0.1 * hash(deg));
        st.quad(loc(a, 0, 0, 0), loc(b, 0, 0, 0), loc(b, 0, y + 0.6, 0), loc(a, 0, y + 0.6, 0), "#2a3a44");
        for (const lz of [-7, -17]) {
          const p = loc(a, 0, y, lz);
          const jh = 8 + hash(deg * 3 + lz) * 9;
          st.cyl(p[0], p[1], p[2], 2.4, 0.3, jh, "#d3e6f0", 8, false);
          st.sphere(p[0], p[1] + jh * 0.2, p[2], 3.2, "#c2dcea", 8, 0.5);
        }
      }
      break;
    }
    case "glass": {
      const step = 4;
      for (let deg = f.from; deg < f.to - 0.01; deg += step) {
        const a = behind(c, clampDeg(deg), f.back);
        const b = behind(c, clampDeg(Math.min(f.to, deg + step)), f.back);
        const sh = 0.9 + 0.14 * hash(deg * 1.3 + fi);
        st.mat = 4;
        st.quadG(loc(a, 0, GROUND_Y, 0), loc(b, 0, GROUND_Y, 0), loc(b, 0, f.h, 0), loc(a, 0, f.h, 0), "#8fb0c6", sh * 0.8, sh * 1.05);
        st.mat = 0;
        st.beam(loc(a, 0, GROUND_Y, 0.4), loc(a, 0, f.h, 0.4), 1.6, "#59626b");
        st.beam(loc(a, 0, f.h, 0.4), loc(b, 0, f.h, 0.4), 2.4, "#59626b");
        st.beam(loc(a, 0, f.h * 0.5, 0.4), loc(b, 0, f.h * 0.5, 0.4), 1.6, "#59626b");
      }
      break;
    }
    default:
      landmark(c, f, fi);
  }
}

/**
 * A river bridge seen side-on: suspension (cables in parabolas between portal towers, with
 * hangers), cable-stayed (fans off H-pylons), through-arch, vertical lift (two truss towers
 * and a trussed lift span) or plain girder on piers. Deck lights and tower beacons at night.
 */
function bridge(c: PropCtx, f: Extract<Feature, { k: "bridge" }>): void {
  const { st, glow, lit } = c;
  const fr = far(f.deg, f.dist);
  const style = f.style ?? (f.towers > 0 ? "suspension" : "girder");
  const L = f.len;
  const deckY = 58;
  const col = f.color;
  const pier = "#8b8f94";
  const P = (x: number, y: number, z = 0): P3 => loc(fr, x, y, z);
  // Deck: a colored fascia girder over a darker roadway slab.
  fbox(st, fr, 0, deckY, 0, L, 7, 34, col, 0.9);
  fbox(st, fr, 0, deckY - 5.5, 0, L, 4, 28, "#5d6166", 0.8);
  const piers = (x0: number, x1: number, step: number) => {
    for (let x = x0; x <= x1 + 0.1; x += step) fbox(st, fr, x, (deckY - 7 + GROUND_Y) / 2, 0, 12, deckY - 7 - GROUND_Y, 26, pier);
  };
  const beacon = (x: number, y: number) => {
    if (lit) glow.box(...P(x, y), 4, 4, 4, fr.yaw, [1, 0.18, 0.12]);
  };
  if (lit) {
    for (let x = -L / 2 + 12; x < L / 2; x += 36) for (const z of [-17.5, 17.5]) glow.box(...P(x, deckY + 7, z), 1.6, 1.6, 1.6, fr.yaw, [1, 0.86, 0.6]);
  }
  /** Cable between two points sagging by `sag` at mid-span (parabolic), optional hangers. */
  const cable = (x0: number, y0: number, x1: number, y1: number, sag: number, z: number, hang: number) => {
    const n = 14;
    const yAt = (u: number) => y0 + (y1 - y0) * u - 4 * sag * u * (1 - u);
    for (let i = 0; i < n; i += 1) st.beam(P(x0 + ((x1 - x0) * i) / n, yAt(i / n), z), P(x0 + ((x1 - x0) * (i + 1)) / n, yAt((i + 1) / n), z), 2.6, col, 0.95);
    if (hang > 0) {
      const k = Math.max(2, Math.round(Math.abs(x1 - x0) / hang));
      for (let i = 1; i < k; i += 1) {
        const u = i / k;
        const y = yAt(u);
        if (y - deckY > 6) st.beam(P(x0 + (x1 - x0) * u, deckY + 3, z), P(x0 + (x1 - x0) * u, y, z), 0.9, col, 0.9);
        if (lit && i % 2 === 0) glow.box(...P(x0 + (x1 - x0) * u, y, z), 2, 2, 2, fr.yaw, [1, 0.94, 0.78]);
      }
    }
  };
  /** Portal tower: two legs and cross struts. */
  const portal = (x: number, top: number, w = 11) => {
    for (const z of [-16, 16]) fbox(st, fr, x, (top + GROUND_Y) / 2, z, w, top - GROUND_Y, 9, col);
    fbox(st, fr, x, top - 6, 0, w, 10, 40, col, 0.9);
    fbox(st, fr, x, deckY + (top - deckY) * 0.55, 0, w * 0.8, 7, 34, col, 0.85);
    beacon(x, top + 3);
  };
  const towerXs = Array.from({ length: Math.max(1, f.towers) }, (_, t) => L * ((t + 1) / (Math.max(1, f.towers) + 1) - 0.5));
  switch (style) {
    case "suspension": {
      const span = L / (towerXs.length + 1);
      const top = deckY + Math.min(170, Math.max(70, span * 0.3));
      towerXs.forEach((x) => portal(x, top));
      for (const z of [-16, 16]) {
        // Side spans down to the anchorages, main spans between towers.
        cable(-L / 2, deckY + 6, towerXs[0], top - 3, (top - deckY) * 0.12, z, 34);
        cable(towerXs[towerXs.length - 1], top - 3, L / 2, deckY + 6, (top - deckY) * 0.12, z, 34);
        for (let i = 0; i + 1 < towerXs.length; i += 1) cable(towerXs[i], top - 3, towerXs[i + 1], top - 3, top - deckY - 9, z, 30);
      }
      for (const x of [-L / 2, L / 2]) fbox(st, fr, x, deckY / 2, 0, 30, deckY + 8, 44, "#9a9690", 0.9);
      break;
    }
    case "stayed": {
      const span = L / (towerXs.length + 1);
      const top = deckY + Math.max(90, span * 0.42);
      piers(-L / 2 + 30, L / 2 - 30, Math.max(150, span));
      towerXs.forEach((x) => {
        for (const z of [-16, 16]) st.beam(P(x, GROUND_Y, z * 1.3), P(x, top, z * 0.4), 9, col);
        fbox(st, fr, x, deckY + 22, 0, 9, 7, 44, col, 0.85);
        beacon(x, top + 3);
        for (const z of [-15, 15]) {
          for (let k = 1; k <= 8; k += 1) {
            for (const d of [-1, 1]) st.beam(P(x, top - 6 - k * 4, z * 0.45), P(x + (d * span * 0.48 * k) / 8, deckY + 3, z), 1.2, "#e4e6e8", 0.95);
          }
        }
      });
      break;
    }
    case "arch": {
      const span = L * 0.42;
      const rise = span * 0.22;
      piers(-L / 2 + 40, L / 2 - 40, 140);
      const n = 18;
      const archY = (u: number) => deckY + 4 + rise * (1 - (2 * u - 1) ** 2);
      for (const z of [-16, 16]) {
        for (let i = 0; i < n; i += 1) st.beam(P(-span / 2 + (span * i) / n, archY(i / n), z), P(-span / 2 + (span * (i + 1)) / n, archY((i + 1) / n), z), 6, col, 0.95);
        for (let i = 1; i < n; i += 1) st.beam(P(-span / 2 + (span * i) / n, deckY + 3, z), P(-span / 2 + (span * i) / n, archY(i / n), z), 1.4, col, 0.85);
      }
      for (let i = 3; i < n - 2; i += 3) st.beam(P(-span / 2 + (span * i) / n, archY(i / n), -16), P(-span / 2 + (span * i) / n, archY(i / n), 16), 2.4, col, 0.8);
      beacon(0, deckY + 8 + rise);
      break;
    }
    case "lift": {
      const span = Math.min(220, L * 0.42);
      const top = deckY + 120;
      piers(-L / 2 + 40, L / 2 - 40, 120);
      for (const x of [-span / 2, span / 2]) {
        for (const dx of [-6, 6]) for (const z of [-16, 16]) st.beam(P(x + dx, GROUND_Y, z), P(x + dx, top, z), 4.5, col, 0.95);
        // Cross-braced faces.
        for (let y = deckY + 10; y < top - 12; y += 24) {
          for (const z of [-16, 16]) {
            st.beam(P(x - 6, y, z), P(x + 6, y + 24, z), 1.4, col, 0.85);
            st.beam(P(x + 6, y, z), P(x - 6, y + 24, z), 1.4, col, 0.85);
          }
        }
        fbox(st, fr, x, top + 7, 0, 22, 14, 44, col, 0.9);
        fbox(st, fr, x, top + 16, 0, 16, 5, 36, col, 1);
        beacon(x, top + 21);
      }
      // Warren truss on the lift span.
      const tt = deckY + 30;
      for (const z of [-16, 16]) {
        st.beam(P(-span / 2 + 6, tt, z), P(span / 2 - 6, tt, z), 3, col, 0.95);
        const k = 8;
        for (let i = 0; i < k; i += 1) {
          const x0 = -span / 2 + 6 + ((span - 12) * i) / k;
          const x1 = -span / 2 + 6 + ((span - 12) * (i + 1)) / k;
          st.beam(P(x0, i % 2 ? tt : deckY + 3, z), P(x1, i % 2 ? deckY + 3 : tt, z), 2, col, 0.85);
        }
      }
      break;
    }
    default:
      piers(-L / 2 + 40, L / 2 - 40, 130);
  }
}

/**
 * The Gateway Arch: Saarinen's weighted catenary, y = fc − A(cosh(Cx/L) − 1), with an
 * equilateral-triangle section tapering from 54 ft at the feet to 17 ft at the crown. One
 * edge points at the viewer, so the two front faces catch the light differently.
 */
function gatewayArch(st: GeoBuilder, fr: Frame, h: number): void {
  const A = 68.7672;
  const C = 3.0022;
  const L = 299.2239;
  const fc = 625.0925;
  const s = h / 630;
  const n = 44;
  const coshC = Math.cosh(C);
  const centroid = (x: number) => fc - A * (Math.cosh((C * x) / L) - 1);
  const ring = (i: number): P3[] => {
    const x = -L + (2 * L * i) / n;
    const y = centroid(x);
    // In-plane normal (perpendicular to the curve within the arch's plane).
    const slope = -A * (C / L) * Math.sinh((C * x) / L);
    const tl = Math.hypot(1, slope);
    const nx = -slope / tl;
    const ny = 1 / tl;
    const side = 17 + (54 - 17) * ((Math.cosh((C * x) / L) - 1) / (coshC - 1));
    const r = side / Math.sqrt(3);
    const at = (a: number, b: number): P3 => loc(fr, (x + nx * a) * s, GROUND_Y + Math.max(0, y + ny * a) * s, b * s);
    return [at(0, r), at(-r * 0.866, -r / 2), at(r * 0.866, -r / 2)];
  };
  let prev = ring(0);
  for (let i = 1; i <= n; i += 1) {
    const cur = ring(i);
    const lean = 0.94 + 0.06 * Math.sin((i / n) * Math.PI);
    st.quad(prev[1], cur[1], cur[0], prev[0], "#d9dee3", 1.04 * lean);
    st.quad(prev[0], cur[0], cur[2], prev[2], "#c9cfd6", 0.86 * lean);
    st.quad(prev[2], cur[2], cur[1], prev[1], "#b8bec5", 0.7);
    prev = cur;
  }
}

function landmark(c: PropCtx, f: Extract<Feature, { y?: number }>, fi: number): void {
  const { st, glow } = c;
  const fr = behind(c, f.deg, f.back);
  const y = f.y ?? fr.h;
  const at = (lx: number, ly: number, lz = 0) => loc(fr, lx, y + ly, lz);
  switch (f.k) {
    case "apple": {
      st.cyl(fr.x, 0, fr.z, 13, 15, y + 2, "#22252b", 12);
      const p = at(0, 13);
      st.sphere(p[0], p[1], p[2], 11, "#c5202b", 10, 0.92);
      st.beam(at(0, 22), at(1.5, 27), 0.9, "#4a3526");
      st.tri(at(1, 25), at(8, 28), at(5, 23), "#3f8a3a");
      break;
    }
    case "bell": {
      st.beam(at(-12, -y + GROUND_Y), at(-12, 34), 2.4, "#3a3d42");
      st.beam(at(12, -y + GROUND_Y), at(12, 34), 2.4, "#3a3d42");
      st.beam(at(-14, 34), at(14, 34), 2.6, "#3a3d42");
      const p = at(0, 6);
      st.cyl(p[0], p[1], p[2], 11, 5, 22, "#b9b3a4", 10);
      (c.lit ? glow : st).cyl(p[0], p[1] - 1.2, p[2], 11.6, 11.6, 1.2, c.lit ? WINDOW : "#d8d2c2", 10, false);
      break;
    }
    case "bottle": {
      st.cyl(fr.x, y, fr.z, 7, 7, 34, "#35684b", 10, false);
      st.cyl(fr.x, y + 12, fr.z, 7.2, 7.2, 10, "#b5242b", 10, false);
      st.cyl(fr.x, y + 34, fr.z, 7, 2.6, 14, "#35684b", 10, false);
      st.cyl(fr.x, y + 48, fr.z, 2.6, 2.6, 7, "#c9ccd0", 8);
      break;
    }
    case "glove": {
      const palm = at(0, 11);
      st.sphere(palm[0], palm[1], palm[2], 12, "#8a5a33", 8, 0.9);
      for (let i = 0; i < 4; i += 1) {
        const p = at(-9 + i * 6, 24 + (i === 1 || i === 2 ? 3 : 0));
        st.sphere(p[0], p[1], p[2], 4.4, "#8a5a33", 6, 1.7);
      }
      const th = at(13, 13);
      st.sphere(th[0], th[1], th[2], 4.6, "#7d5230", 6, 1.5);
      break;
    }
    case "stacks": {
      for (const lx of [-9, 9]) {
        const p = at(lx, 0);
        st.cyl(p[0], 0, p[2], 5, 4.4, y + 64, "#f0eee8", 10, false);
        st.cyl(p[0], y + 64, p[2], 5.6, 5.6, 9, "#1d1f23", 10);
        st.cyl(p[0], y + 30, p[2], 5.1, 5, 6, "#b3262c", 10, false);
      }
      break;
    }
    case "bigA": {
      const top = 230;
      st.beam(at(-62, -y + GROUND_Y), at(0, top - y), 10, "#b8262c");
      st.beam(at(62, -y + GROUND_Y), at(0, top - y), 10, "#b8262c");
      st.beam(at(-33, 108 - y), at(33, 108 - y), 9, "#b8262c");
      for (let i = 0; i < 12; i += 1) {
        const a0 = (i / 12) * Math.PI * 2;
        const a1 = ((i + 1) / 12) * Math.PI * 2;
        (c.lit ? glow : st).beam(at(Math.cos(a0) * 26, top - 12 - y, Math.sin(a0) * 26), at(Math.cos(a1) * 26, top - 12 - y, Math.sin(a1) * 26), 3, c.lit ? LAMP_ON : "#e3e3e3");
      }
      break;
    }
    case "train": {
      fbox(st, fr, 0, y - 1.5, 0, 250, 3, 8, "#5a4a3c");
      for (let x = -110; x <= 110; x += 44) fbox(st, fr, x, (y - 3 + GROUND_Y) / 2, 0, 5, y - 3 - GROUND_Y, 5, "#8a6a52");
      fbox(st, fr, -18, y + 6, 0, 26, 9, 7, "#26272b");
      const boiler = at(-28, 12);
      st.cyl(boiler[0], boiler[1], boiler[2], 2, 2.6, 6, "#26272b", 6);
      fbox(st, fr, -2, y + 9, 0, 9, 14, 8, "#b3262c");
      fbox(st, fr, 16, y + 5.5, 0, 20, 8, 7, "#26272b");
      for (let i = 0; i < 5; i += 1) {
        const o = at(9 + i * 3.6, 10.5);
        st.sphere(o[0], o[1], o[2], 2.4, "#e98a2b", 6, 0.9);
      }
      break;
    }
    case "slide": {
      st.cyl(fr.x, GROUND_Y, fr.z, 4, 4, y - GROUND_Y + 6, "#8f949b", 8);
      fbox(st, fr, 0, y + 6, 0, 22, 1.2, 16, "#3b3f45");
      fbox(st, fr, 0, y + 13, -6, 18, 12, 4, "#6b4a2f");
      const n = 16;
      const pt = (i: number): P3 => {
        const a = (i / n) * Math.PI * 3;
        return at(Math.cos(a) * 13, 6 - (i / n) * 44, Math.sin(a) * 13 + 4);
      };
      for (let i = 0; i < n; i += 1) st.beam(pt(i), pt(i + 1), 3.4, "#f0c531");
      break;
    }
    case "pool": {
      fbox(st, fr, 0, y + 1, -14, 62, 2, 34, "#d6cab2");
      st.quad(at(-16, 2.1, -4), at(16, 2.1, -4), at(16, 2.1, -22), at(-16, 2.1, -22), "#3fa7d6");
      fbox(st, fr, 0, y + 4.5, 2.5, 62, 5, 0.6, "#2a3540");
      break;
    }
    case "pinwheels": {
      const cols = ["#d8342f", "#f0c531", "#2f7fd0", "#39a35a", "#e07a2c", "#8a4fc4", "#e6e6e6"];
      for (let i = 0; i < 7; i += 1) {
        const lx = (i - 3) * 20;
        st.beam(at(lx, 0, -2), at(lx, 16, -2), 1.2, "#3a3d42");
        for (let k = 0; k < 4; k += 1) {
          const a = (k / 4) * Math.PI + i * 0.4;
          (c.lit ? glow : st).beam(at(lx - Math.cos(a) * 8, 16 - Math.sin(a) * 8, -1), at(lx + Math.cos(a) * 8, 16 + Math.sin(a) * 8, -1), 1.6, cols[(i + k) % cols.length]);
        }
      }
      break;
    }
    case "crown": {
      const gold = "#d9b24a";
      const w = 88;
      st.quad(at(-w / 2, 0, 1), at(w / 2, 0, 1), at(w / 2, 6, 1), at(-w / 2, 6, 1), gold, 0.9);
      for (let i = 0; i < 5; i += 1) {
        const x0 = -w / 2 + (w * i) / 5;
        st.tri(at(x0, 6, 1), at(x0 + w / 5, 6, 1), at(x0 + w / 10, 22 + (i === 2 ? 8 : 0), 1), gold);
      }
      break;
    }
    case "triSign": {
      // The Citgo sign: a 60 ft square on a steel frame atop a five-storey brick block in
      // Kenmore Square. White by day; dark with neon trimark and letters at night.
      const roofY = y - 40;
      fbox(st, fr, 0, (roofY + GROUND_Y) / 2, -24, 130, roofY - GROUND_Y, 80, "#8e5a44", 0.95);
      fbox(st, fr, 0, roofY + 1.5, -24, 133, 3, 83, "#c9bba0", 0.9);
      for (let fl = 0; fl < 5; fl += 1) {
        for (let k = 0; k < 9; k += 1) {
          const on = c.lit && hash(fi * 13 + fl * 9 + k) > 0.45;
          panel(on ? glow : st, fr, (k - 4) * 13.5, GROUND_Y + 14 + fl * ((roofY - GROUND_Y - 16) / 5), 16.3, 6, 9, on ? WINDOW : "#2a2f36", 0.9);
        }
      }
      for (const lx of [-26, 0, 26]) {
        st.beam(at(lx, roofY - y, -3), at(lx, -31, -3), 2.4, "#4b4f55");
        st.beam(at(lx, roofY - y, -14), at(lx, -31, -3), 1.6, "#4b4f55", 0.85);
      }
      st.beam(at(-30, -31, -3), at(30, -31, -3), 2, "#4b4f55");
      const neon = c.lit;
      panel(st, fr, 0, y, -0.4, 64, 64, neon ? "#16181d" : "#f3f3ef", 0.96);
      const bright = neon ? glow : st;
      const red: RGB | string = neon ? [1, 0.12, 0.1] : "#c8242b";
      const blue: RGB | string = neon ? [0.22, 0.45, 1] : "#1e3f8f";
      const bg: RGB | string = neon ? "#16181d" : "#f3f3ef";
      // Trimark: nested triangles (red, background, red).
      const tri = (r: number, z: number, col: RGB | string, b: GeoBuilder) => b.tri(at(-r, 6 - r * 0.42, z), at(r, 6 - r * 0.42, z), at(0, 6 + r * 1.1, z), col);
      tri(20, 0.3, red, bright);
      tri(12.5, 0.5, bg, st);
      tri(7, 0.7, red, bright);
      // CITGO in block capitals.
      const W = 8;
      const H = 11;
      const sw = 2.2;
      const by = -23;
      const bar = (x0: number, y0: number, x1: number, y1: number) => {
        const cx = (x0 + x1) / 2;
        const cy = (y0 + y1) / 2;
        panel(bright, fr, cx, y + by + cy, 0.5, Math.max(sw, Math.abs(x1 - x0)), Math.max(sw, Math.abs(y1 - y0)), blue);
      };
      const glyph: Record<string, Array<[number, number, number, number]>> = {
        C: [[0, H, W, H], [0, 0, 0, H], [0, 0, W, 0]],
        I: [[W / 2, 0, W / 2, H]],
        T: [[0, H, W, H], [W / 2, 0, W / 2, H]],
        G: [[0, H, W, H], [0, 0, 0, H], [0, 0, W, 0], [W, 0, W, H / 2], [W / 2, H / 2, W, H / 2]],
        O: [[0, H, W, H], [0, 0, 0, H], [0, 0, W, 0], [W, 0, W, H]],
      };
      [..."CITGO"].forEach((ch, i) => {
        const ox = -26 + i * 11;
        for (const [x0, y0, x1, y1] of glyph[ch]) bar(ox + x0 - (x0 === x1 ? sw / 2 : 0), y0 - (y0 === y1 ? sw / 2 : 0), ox + x1 + (x0 === x1 ? sw / 2 : 0), y1 + (y0 === y1 ? sw / 2 : 0));
      });
      break;
    }
    case "boats": {
      for (let i = 0; i < 8; i += 1) {
        const lx = (hash(i * 3.1 + fi) - 0.5) * 420;
        const lz = -hash(i * 7.3 + fi) * 260;
        const p = loc(fr, lx, GROUND_Y + 1.6, lz);
        const yaw = hash(i * 1.7) * 6;
        st.box(p[0], p[1], p[2], 18 + hash(i) * 14, 2.4, 6, yaw, i % 3 ? "#f1f1ee" : "#e9a02c");
        if (i % 2) st.box(p[0], p[1] + 2.6, p[2], 7, 3, 4.4, yaw, "#c9d3db");
      }
      break;
    }
    case "flags": {
      const cols = [c.homeColor, "#f1f1ee", "#b3262c", "#1f4f9a", c.homeColor, "#f0c531", "#f1f1ee"];
      for (let i = 0; i < 7; i += 1) {
        const lx = (i - 3) * 15;
        st.beam(at(lx, 0), at(lx, 24), 0.35, "#d7dadd");
        st.quad(at(lx, 19), at(lx + 7, 18.4), at(lx + 7, 23.4), at(lx, 24), cols[i]);
      }
      break;
    }
    default:
      break;
  }
}

export function features(c: PropCtx): void {
  c.layout.features.forEach((f, i) => feature(c, f, i + 1));
}
