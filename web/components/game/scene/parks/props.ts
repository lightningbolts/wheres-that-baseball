/**
 * Everything around the seating bowl: foul poles, dugouts, bullpens, batter's eye, light
 * banks, scoreboard housing, retractable roofs and each park's landmarks and backdrop.
 * All of it is appended to two shared builders — lit structure and self-lit "glow".
 */
import * as THREE from "three";
import type { Park } from "@/lib/game/physics/park";
import type { Feature, ParkLayout } from "@/lib/game/data/parkLayouts";
import { dirXZ, GROUND_Y, type WallLoop } from "@/components/game/scene/fieldGeometry";
import { GeoBuilder, hash, mix, type P3, type RGB } from "@/components/game/scene/parks/geo";
import type { StandReach } from "@/components/game/scene/parks/stands";
import type { DecalAtlas } from "@/components/game/scene/parks/textures";

export interface PropCtx {
  park: Park;
  layout: ParkLayout;
  loop: WallLoop;
  /** Lit, vertex-colored structure. */
  st: GeoBuilder;
  /** Unlit emissive surfaces (light banks, lit windows). */
  glow: GeoBuilder;
  reach(beta: number): StandReach;
  homeColor: string;
  /** Stadium lights and windows on (dusk and night games). */
  lit: boolean;
}

/** A local frame on the ground: +lx to the viewer's right seen from home, +lz toward home. */
interface Frame {
  x: number;
  z: number;
  yaw: number;
  rx: number;
  rz: number;
  fx: number;
  fz: number;
}

function frameYaw(x: number, z: number, yaw: number): Frame {
  return { x, z, yaw, rx: Math.cos(yaw), rz: -Math.sin(yaw), fx: Math.sin(yaw), fz: Math.cos(yaw) };
}
const loc = (f: Frame, lx: number, y: number, lz: number): P3 => [f.x + f.rx * lx + f.fx * lz, y, f.z + f.rz * lx + f.fz * lz];
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

/** Frame at a bearing and distance from home, facing home. */
function far(beta: number, dist: number): Frame {
  const [dx, dz] = dirXZ(beta);
  return frameYaw(dx * dist, dz * dist, Math.atan2(-dx, -dz));
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
const LAMP_OFF: RGB = [0.72, 0.73, 0.72];
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
    c.st.box(dx * f + ix * 1.6, h - 22, dz * f + iz * 1.6, 0.25, 40, 3, yaw, color, 0.86);
  }
}

/** Bearings the two dugouts span (each side), and how deep they cut into the stands. */
export const DUGOUT = { from: 78, to: 112, depth: 12 };

export function dugouts(c: PropCtx): void {
  for (const sigma of [-1, 1]) {
    const s0 = c.loop.sOf(sigma > 0 ? DUGOUT.from : -DUGOUT.to);
    const s1 = c.loop.sOf(sigma > 0 ? DUGOUT.to : -DUGOUT.from);
    const n = Math.max(2, Math.round((s1 - s0) / 9));
    const roof = sigma > 0 ? c.homeColor : c.layout.trim;
    for (let i = 0; i < n; i += 1) {
      const p = c.loop.at(s0 + ((s1 - s0) * i) / n);
      const q = c.loop.at(s0 + ((s1 - s0) * (i + 1)) / n);
      const at = (w: typeof p, o: number, y: number): P3 => [w.x + w.nx * o, y, w.z + w.nz * o];
      const top = p.h + 4.8;
      // Shadowed opening, bench, roof slab with a colored fascia, and a rail to lean on.
      c.st.quad(at(p, 0.5, p.h - 3), at(q, 0.5, q.h - 3), at(q, 0.5, top), at(p, 0.5, top), "#0a0c0f");
      c.st.quad(at(p, 0.4, p.h), at(q, 0.4, q.h), at(q, 0.4, p.h + 1.3), at(p, 0.4, p.h + 1.3), "#3a2f26");
      c.st.quad(at(p, -1.5, top + 0.7), at(q, -1.5, top + 0.7), at(q, DUGOUT.depth, top + 0.7), at(p, DUGOUT.depth, top + 0.7), mix(c.layout.concrete, "#3b3e44", 0.5));
      c.st.quad(at(p, -1.5, top - 0.3), at(q, -1.5, top - 0.3), at(q, -1.5, top + 0.7), at(p, -1.5, top + 0.7), roof);
      c.st.beam(at(p, -0.3, p.h + 1), at(q, -0.3, q.h + 1), 0.18, "#c9ccd0");
      c.st.beam(at(p, -0.3, p.h - 0.2), at(p, -0.3, p.h + 1), 0.18, "#c9ccd0");
      if (i % 3 === 0) c.st.beam(at(p, -1.2, p.h), at(p, -1.2, top), 0.35, "#2b2e33");
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
      b.quadUv([p.x, p.h, p.z], [q.x, q.h, q.z], [q.x, top, q.z], [p.x, top, p.z], [p.s / 2.5, p.h / 2.5], [q.s / 2.5, q.h / 2.5], [q.s / 2.5, top / 2.5], [p.s / 2.5, top / 2.5], "#ffffff");
      c.st.beam([p.x, top, p.z], [q.x, top, q.z], 0.2, "#2a2c30");
      if (i % 4 === 0) c.st.beam([p.x, p.h, p.z], [p.x, top, p.z], 0.3, "#2a2c30");
    }
  }
  return b.build();
}

export function battersEye(c: PropCtx): void {
  const e = c.layout.eye;
  const s0 = c.loop.sOf(e.from);
  const s1 = c.loop.sOf(e.to);
  const n = Math.max(2, Math.round((s1 - s0) / 12));
  const color = e.style === "grass" ? "#2a5a2c" : e.style === "ivy" ? "#1e4a22" : "#11291c";
  const h = e.style === "trees" ? e.h * 0.55 : e.h;
  for (let i = 0; i < n; i += 1) {
    const p = c.loop.at(s0 + ((s1 - s0) * i) / n);
    const q = c.loop.at(s0 + ((s1 - s0) * (i + 1)) / n);
    const at = (w: typeof p, o: number, y: number): P3 => [w.x + w.nx * o, y, w.z + w.nz * o];
    if (e.style === "grass") {
      c.st.quad(at(p, 3, p.h * 0.6), at(q, 3, q.h * 0.6), at(q, 58, h), at(p, 58, h), color, 0.95 + 0.08 * hash(i));
      c.st.quad(at(p, 58, GROUND_Y), at(q, 58, GROUND_Y), at(q, 58, h), at(p, 58, h), "#1c3a22", 0.7);
    } else {
      c.st.quad(at(p, 5, 0), at(q, 5, 0), at(q, 5, h), at(p, 5, h), color, 0.94 + 0.08 * hash(i));
      c.st.quad(at(p, 5, h), at(q, 5, h), at(q, 16, h), at(p, 16, h), color, 0.7);
      c.st.quad(at(p, 16, GROUND_Y), at(q, 16, GROUND_Y), at(q, 16, h), at(p, 16, h), color, 0.6);
    }
    if (i === 0 || i === n - 1) {
      const w = i === 0 ? p : q;
      const o = e.style === "grass" ? 58 : 16;
      c.st.quad(at(w, 4, 0), at(w, o, 0), at(w, o, h), at(w, 4, e.style === "grass" ? w.h * 0.6 : h), color, 0.75);
    }
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

export function lightBanks(c: PropCtx): void {
  const lamp = c.lit ? LAMP_ON : LAMP_OFF;
  const mode = c.layout.lights;
  const betas = mode === "rim" ? [-160, -138, -114, -90, -66, 66, 90, 114, 138, 160, -30, 30] : [-152, -112, -72, 72, 112, 152, -24, 24];
  for (const beta of betas) {
    const r = c.reach(beta);
    const of = Math.abs(beta) <= 45;
    if (mode === "rim" && r.out > 60 && !of) {
      // Light bank along the roofline.
      const f = behind(c, beta, r.out - 2);
      fbox(c.st, f, 0, r.top + 5, 0, 1.2, 10, 1.2, "#555a61");
      fbox(c.st, f, 0, r.top + 14, 0, 46, 9, 2, "#3b3f45");
      panel(c.glow, f, 0, r.top + 14, 1.15, 44, 7.4, lamp);
      continue;
    }
    const f = behind(c, beta, Math.max(40, r.out + 16));
    const h = Math.max(mode === "brush" ? 185 : 150, r.top + 62);
    if (mode === "brush") {
      // Progressive/PNC-style "toothbrush": a slim mast with a tall vertical bank.
      fbox(c.st, f, 0, h / 2, 0, 3.2, h, 3.2, "#d7dadd");
      fbox(c.st, f, 0, h - 26, 2.2, 13, 52, 2, "#3b3f45");
      panel(c.glow, f, 0, h - 26, 3.3, 11, 48, lamp);
    } else {
      c.st.beam(loc(f, -7, GROUND_Y, -5), loc(f, -2, h, 0), 1.6, "#62676e");
      c.st.beam(loc(f, 7, GROUND_Y, -5), loc(f, 2, h, 0), 1.6, "#62676e");
      for (let k = 1; k < 5; k += 1) c.st.beam(loc(f, -7 + k, (h * k) / 5, -5 + k), loc(f, 7 - k, (h * k) / 5, -5 + k), 0.9, "#62676e");
      fbox(c.st, f, 0, h + 6, 0, 40, 16, 2.4, "#3b3f45");
      panel(c.glow, f, 0, h + 6, 1.35, 38, 14, lamp);
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
  const legBottom = GROUND_Y;
  for (const lx of [-w * 0.34, w * 0.34]) fbox(c.st, f, lx, (s.y - h / 2 + legBottom) / 2, -3.5, 5, s.y - h / 2 - legBottom, 5, "#3a3d42");
  if (s.style === "green") {
    // Wrigley: pitched cap and a clock.
    c.st.tri(loc(f, -w / 2 - 4, s.y + h / 2 + 4, 0), loc(f, w / 2 + 4, s.y + h / 2 + 4, 0), loc(f, 0, s.y + h / 2 + 16, 0), frame);
    c.st.sphere(...loc(f, 0, s.y + h / 2 + 7, 0.8), 3.4, "#f4f1e6", 8, 1);
  } else if (s.style === "hex") {
    // Dodger Stadium: hexagonal housing.
    for (const sx of [-1, 1]) c.st.tri(loc(f, sx * (w / 2 + 4), s.y - h / 2 - 4, 0), loc(f, sx * (w / 2 + 4), s.y + h / 2 + 4, 0), loc(f, sx * (w / 2 + 22), s.y, 0), "#1b3e7c");
  } else {
    fbox(c.st, f, 0, s.y + h / 2 + 8.5, -3, w + 8, 9, 5, c.homeColor);
    fbox(c.st, f, 0, s.y - h / 2 - 7, -3, w + 8, 6, 5, mix(c.homeColor, "#101214", 0.6));
  }
  const p = loc(f, 0, s.y, 0.25);
  return { position: [p[0], p[1], p[2]], yaw: f.yaw, w, h };
}

/** Retractable roof, parked open: rails on trusses and the stacked panels at one end. */
export function roof(c: PropCtx): void {
  const r = c.layout.roof;
  if (!r) return;
  const C = { x: 0, z: 185 };
  const half = 480;
  const [ax, az] = dirXZ(r.axis);
  const lx = az;
  const lz = -ax;
  const at = (t: number, l: number, y: number): P3 => [C.x + ax * t + lx * l, y, C.z + az * t + lz * l];
  const steel = "#8d939a";
  for (const side of [-1, 1]) {
    const l = side * half;
    c.st.beam(at(-half - 30, l, r.h - 6), at(half + 150, l, r.h - 6), 14, steel);
    for (let t = -half; t <= half + 150; t += 157.5) {
      c.st.beam(at(t, l, GROUND_Y), at(t, l, r.h - 12), 11, steel, 0.85);
      c.st.beam(at(t, l, r.h * 0.45), at(t + 78, l, r.h - 12), 5, steel, 0.8);
    }
  }
  const span = 2 * half;
  const t1 = half + 140;
  const t0 = half - r.cover * span;
  const panels = 3;
  const seg = 10;
  for (let k = 0; k < panels; k += 1) {
    const a = t0 + ((t1 - t0) * k) / panels - (k ? 26 : 0);
    const b = t0 + ((t1 - t0) * (k + 1)) / panels;
    const lift = (panels - 1 - k) * 15;
    const y = (u: number) => r.h + lift + 62 * Math.cos((u * Math.PI) / 2);
    for (let i = 0; i < seg; i += 1) {
      const u0 = -1 + (2 * i) / seg;
      const u1 = -1 + (2 * (i + 1)) / seg;
      const shade = 0.82 + 0.18 * Math.cos(((u0 + u1) / 2) * 1.3) - k * 0.04;
      c.st.quad(at(a, u0 * half, y(u0)), at(b, u0 * half, y(u0)), at(b, u1 * half, y(u1)), at(a, u1 * half, y(u1)), r.color, shade);
      // Leading-edge truss.
      c.st.quad(at(a, u0 * half, y(u0) - 16), at(a, u1 * half, y(u1) - 16), at(a, u1 * half, y(u1)), at(a, u0 * half, y(u0)), steel, 0.8);
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
  if (kind === "pine") {
    b.cyl(x, y, z, 1.1, 0.8, 8 * s, "#4a382a", 5, false);
    b.cyl(x, y + 6 * s, z, 9 * s, 0, 34 * s, mix("#1c4a2a", "#2c6336", hash(k)), 6, false);
  } else if (kind === "palm") {
    const h = (38 + hash(k) * 16) * s;
    b.cyl(x, y, z, 1, 0.7, h, "#7a6650", 5, false);
    for (let i = 0; i < 7; i += 1) {
      const a = (i / 7) * Math.PI * 2 + k;
      const ex = x + Math.cos(a) * 11;
      const ez = z + Math.sin(a) * 11;
      b.tri([x, y + h + 1.5, z], [ex + Math.sin(a) * 2.2, y + h - 4, ez - Math.cos(a) * 2.2], [ex - Math.sin(a) * 2.2, y + h - 4, ez + Math.cos(a) * 2.2], mix("#2f6b33", "#4c8a3e", hash(k + i)));
    }
  } else {
    const r = (kind === "cherry" ? 8 : 12) * s;
    b.cyl(x, y, z, 1, 0.8, r * 1.2 + 4, "#4a382a", 5, false);
    b.sphere(x, y + r * 1.5 + 3, z, r, kind === "cherry" ? mix("#e9a9c4", "#f3c7d8", hash(k)) : mix("#2d6a30", "#3f8240", hash(k)), 6, 0.85);
  }
}

function feature(c: PropCtx, f: Feature, fi: number): void {
  const { st, glow } = c;
  const park = c.park;
  const fenceAt = (beta: number) => park.fence(clampDeg(beta));
  switch (f.k) {
    case "skyline": {
      const towers: Array<[number, number, number]> = [];
      for (let i = 0; i < f.n; i += 1) {
        const t = hash(fi * 97 + i * 13.7);
        towers.push([f.from + ((f.to - f.from) * (i + hash(i * 5.1 + fi))) / f.n, f.h * (0.28 + 0.72 * t * t), i]);
      }
      for (const [deg, h] of f.tall ?? []) towers.push([deg, h, 1000 + deg]);
      for (const [deg, h, k] of towers) {
        const fr = far(deg, f.dist * (0.88 + 0.3 * hash(k * 1.9 + 2)));
        const w = 60 + hash(k * 2.3) * 80 + (k >= 1000 ? 30 : 0);
        const d = 60 + hash(k * 4.1) * 40;
        const color = mix("#8794a3", "#4f5b6c", hash(k * 7.7));
        fbox(st, fr, 0, GROUND_Y + h / 2, 0, w, h, d, color);
        if (k >= 1000) fbox(st, fr, 0, GROUND_Y + h + h * 0.06, 0, w * 0.45, h * 0.12, d * 0.45, color, 0.9);
        if (c.lit) {
          const rows = Math.max(2, Math.floor(h / 26));
          for (let r = 0; r < rows; r += 1) {
            if (hash(k * 11 + r * 3.7) > 0.62) continue;
            const ww = w * (0.3 + 0.5 * hash(k + r * 9.1));
            panel(glow, fr, (hash(k * 5 + r) - 0.5) * (w - ww), GROUND_Y + ((r + 0.6) * h) / (rows + 0.4), d / 2 + 1, ww, 7, WINDOW, 0.75 + 0.25 * hash(r + k));
          }
        }
      }
      break;
    }
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
      for (let deg = f.from; deg < f.to - 0.01; deg += step) {
        const d1 = Math.min(f.to, deg + step);
        const [ax, az] = dirXZ(deg);
        const [bx, bz] = dirXZ(d1);
        const r0a = fenceAt(deg) + f.back;
        const r0b = fenceAt(d1) + f.back;
        const bands: Array<[number, number, string]> = [
          [0, 420, "#2f6e97"],
          [420, 1500, "#3f7fa6"],
          [1500, 3400, "#5a93b6"],
        ];
        for (const [o0, o1, col] of bands) {
          st.quad([ax * (r0a + o0), y, az * (r0a + o0)], [bx * (r0b + o0), y, bz * (r0b + o0)], [bx * (r0b + o1), y, bz * (r0b + o1)], [ax * (r0a + o1), y, az * (r0a + o1)], col, 0.96 + 0.06 * hash(deg + o0));
        }
      }
      break;
    }
    case "bridge": {
      const fr = far(f.deg, f.dist);
      const deckY = 58;
      fbox(st, fr, 0, deckY, 0, f.len, 7, 34, f.color, 0.9);
      for (let x = -f.len / 2 + 40; x < f.len / 2; x += 130) fbox(st, fr, x, (deckY + GROUND_Y) / 2, 0, 12, deckY - GROUND_Y, 26, "#8b8f94");
      for (let t = 0; t < f.towers; t += 1) {
        const x = f.len * ((t + 1) / (f.towers + 1) - 0.5);
        const top = deckY + 150;
        for (const lz of [-15, 15]) fbox(st, fr, x, (top + GROUND_Y) / 2, lz, 11, top - GROUND_Y, 9, f.color);
        fbox(st, fr, x, top - 12, 0, 11, 9, 34, f.color, 0.9);
        const reach = f.len / (f.towers + 1) / 2;
        for (const dirx of [-1, 1]) {
          for (let k = 1; k <= 3; k += 1) st.beam(loc(fr, x, top - 4, 0), loc(fr, x + (dirx * reach * k) / 3, deckY + 3, 0), 2, f.color, 0.95);
        }
      }
      break;
    }
    case "arch": {
      const fr = far(f.deg, f.dist);
      const n = 26;
      const pt = (i: number): P3 => {
        const t = -1 + (2 * i) / n;
        return loc(fr, (t * f.h) / 2, GROUND_Y + f.h * (1 - Math.abs(t) ** 2.3), 0);
      };
      for (let i = 0; i < n; i += 1) st.beam(pt(i), pt(i + 1), 26 - 12 * (1 - Math.abs(-1 + (2 * i + 1) / n)), "#cfd5db", 0.85 + 0.15 * hash(i));
      break;
    }
    case "needle": {
      const [dx, dz] = dirXZ(f.deg);
      const x = dx * f.dist;
      const z = dz * f.dist;
      if (f.h > 700) {
        st.cyl(x, GROUND_Y, z, 30, 11, f.h * 0.62, "#b9bcc0", 8, false);
        st.cyl(x, GROUND_Y + f.h * 0.62, z, 34, 30, 46, "#8f949b", 10);
        st.cyl(x, GROUND_Y + f.h * 0.62 + 46, z, 9, 2, f.h * 0.38 - 46, "#d5d7da", 6);
      } else {
        st.cyl(x, GROUND_Y, z, 28, 17, f.h * 0.9, "#e6e3d9", 4, false);
        st.cyl(x, GROUND_Y + f.h * 0.9, z, 17, 0, f.h * 0.1, "#e6e3d9", 4, false);
      }
      break;
    }
    case "building": {
      const fr = behind(c, f.deg, f.back + f.d / 2);
      fbox(st, fr, 0, GROUND_Y + (f.h - GROUND_Y) / 2, 0, f.w, f.h - GROUND_Y, f.d, f.color);
      if (f.trim) fbox(st, fr, 0, f.h + 1.5, 0, f.w + 3, 3, f.d + 3, f.trim);
      const cols = Math.max(3, Math.round(f.w / 15));
      const rows = Math.max(2, Math.round(f.h / 13));
      for (let r = 0; r < rows; r += 1) {
        for (let k = 0; k < cols; k += 1) {
          const on = c.lit && hash(fi * 31 + r * 7 + k * 3) > 0.55;
          panel(on ? glow : st, fr, ((k + 0.5) / cols - 0.5) * f.w, 6 + ((r + 0.5) * (f.h - 10)) / rows, f.d / 2 + 0.3, (f.w / cols) * 0.52, ((f.h - 10) / rows) * 0.6, on ? WINDOW : "#232a33", on ? 0.85 : 1);
        }
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
          st.cyl(p[0], p[1], p[2], 1.1, 0.3, 16 + hash(i + fi) * 14, "#eef7ff", 5, false);
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
          st.cyl(p[0], p[1], p[2], 1, 0.25, 10 + hash(deg * 3 + lz) * 16, "#eef7ff", 5, false);
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
        st.quad(loc(a, 0, GROUND_Y, 0), loc(b, 0, GROUND_Y, 0), loc(b, 0, f.h * 0.5, 0), loc(a, 0, f.h * 0.5, 0), "#6f8fa8", sh);
        st.quad(loc(a, 0, f.h * 0.5, 0), loc(b, 0, f.h * 0.5, 0), loc(b, 0, f.h, 0), loc(a, 0, f.h, 0), "#a4c3d6", sh);
        st.beam(loc(a, 0, GROUND_Y, 0.4), loc(a, 0, f.h, 0.4), 1.6, "#59626b");
        st.beam(loc(a, 0, f.h, 0.4), loc(b, 0, f.h, 0.4), 2.4, "#59626b");
        st.beam(loc(a, 0, f.h * 0.5, 0.4), loc(b, 0, f.h * 0.5, 0.4), 1.2, "#59626b");
      }
      break;
    }
    default:
      landmark(c, f, fi);
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
      st.beam(at(-16, -y + GROUND_Y), at(-16, -30), 3, "#4b4f55");
      st.beam(at(16, -y + GROUND_Y), at(16, -30), 3, "#4b4f55");
      const face = c.lit ? glow : st;
      panel(face, fr, 0, y, 0, 62, 62, c.lit ? LAMP_ON : "#f3f3ef", 0.96);
      face.tri(at(-22, -4, 0.6), at(22, -4, 0.6), at(0, 24, 0.6), "#c8242b");
      panel(face, fr, 0, y - 17, 0.6, 46, 8, "#1e3f8f");
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
