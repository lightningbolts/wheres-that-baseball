/**
 * The crowd's design atlas: every shirt and cap one game's crowd wears (see fans.ts
 * `lineup`), painted as front-view panels the crowd shader wraps onto each fan through the
 * Blender-rendered garment map (assets3d/blender/assets/crowd.py). Replica jerseys are cut
 * from a player's own painted uniform, so a fan's home white is the same shirt as the one
 * on the field: lettering, numbers, piping, pinstripes and all. Browser only.
 *
 * Layout (1024², canvas y down, sampled with flipY off): shirts in 128² slots, 8 a row,
 * rows 0–5; caps in 64² slots, 16 a row, from y = 768. A slot's texel (u, v) ∈ [0, 0.94]²
 * is the garment map's RG, v up; the column at u = 0.97 is the slot's swatch (collar and
 * cuff braid for a shirt, the bill for a cap).
 */
import { ATLAS, PANEL } from "@/components/game/scene/character/atlas";
import { paintLook } from "@/components/game/scene/character/paint";
import { chestLogo, chestWordmark, type Mark } from "@/components/game/scene/character/uniforms";
import type { CapDesign, GarmentDesign, Lineup } from "@/components/game/scene/parks/fans";

export const MERCH_SIZE = 1024;
export const SHIRT_PX = 128;
export const CAP_PX = 64;
export const CAP_TOP = 768;
const SPAN = 0.94;

/** Shirt panel: world feet on the fan model (crowd.py: box x ∈ [−1.2, 1.2], z ∈ [−0.7, 1.7]) → slot texels. */
const sx = (x: number) => ((x + 1.2) / 2.4) * SPAN * SHIRT_PX;
const sy = (z: number) => (1 - ((z + 0.7) / 2.4) * SPAN) * SHIRT_PX;

const hex = (c: number) => `#${(c & 0xffffff).toString(16).padStart(6, "0")}`;
const luma = (c: number) => (0.299 * ((c >> 16) & 255) + 0.587 * ((c >> 8) & 255) + 0.114 * (c & 255)) / 255;

export function shirtOrigin(i: number): [number, number] {
  return [(i % 8) * SHIRT_PX, Math.floor(i / 8) * SHIRT_PX];
}
export function capOrigin(i: number): [number, number] {
  return [(i % 16) * CAP_PX, CAP_TOP + Math.floor(i / 16) * CAP_PX];
}

type Ctx = CanvasRenderingContext2D;

/** Draw a mark centred at (cx, cy), fitted inside w × h. */
function fit(ctx: Ctx, m: Mark | null, cx: number, cy: number, w: number, h: number): boolean {
  if (!m) return false;
  const k = Math.min(w / m.w, h / m.h);
  ctx.drawImage(m.src, cx - (m.w * k) / 2, cy - (m.h * k) / 2, m.w * k, m.h * k);
  return true;
}

function text(ctx: Ctx, s: string, cx: number, cy: number, maxW: number, px: number, fill: string, font = "bold") {
  if (!s) return;
  ctx.font = `${font} ${px}px "Arial Narrow", "Helvetica Neue", Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const w = ctx.measureText(s).width;
  ctx.save();
  ctx.translate(cx, cy);
  if (w > maxW) ctx.scale(maxW / w, 1);
  ctx.fillStyle = fill;
  ctx.fillText(s, 0, 0);
  ctx.restore();
}

let scratch: HTMLCanvasElement | null = null;

/** A player's painted uniform for this set (reused canvas): its jersey front is the replica. */
function uniformFront(d: GarmentDesign): HTMLCanvasElement | null {
  if (!d.kit) return null;
  scratch ??= document.createElement("canvas");
  scratch.width = scratch.height = ATLAS;
  const g = scratch.getContext("2d");
  if (!g) return null;
  paintLook(g, {
    kind: "fielder",
    id: 0,
    seed: 1,
    jersey: d.kit.jersey,
    accent: d.kit.accent,
    skin: 0xc68e62,
    name: "",
    num: d.number,
    team: d.text,
    teamId: d.teamId,
    cap: d.kit.cap,
    letter: d.kit.ink,
    stripe: d.kit.stripe,
    kit: d.kit,
  });
  return scratch;
}

function paintShirt(ctx: Ctx, d: GarmentDesign, ox: number, oy: number) {
  ctx.save();
  ctx.translate(ox, oy);
  ctx.beginPath();
  ctx.rect(0, 0, SHIRT_PX, SHIRT_PX);
  ctx.clip();
  ctx.fillStyle = hex(d.cloth);
  ctx.fillRect(0, 0, SHIRT_PX, SHIRT_PX);
  const dark = luma(d.cloth) < 0.47;
  const cx = sx(0);
  // The torso front: x ±0.62 ft, from the neck (z 1.6) to the waist (z 0).
  const left = sx(-0.62);
  const right = sx(0.62);
  const top = sy(1.6);
  const bottom = sy(0);
  if (d.kind === "jersey") {
    // Pinstripes on the sleeves and sides too.
    if (d.stripe >= 0) {
      ctx.fillStyle = hex(d.stripe);
      ctx.globalAlpha = 0.7;
      for (let x = 1.7; x < SHIRT_PX; x += 3.4) ctx.fillRect(x, 0, 0.45, SHIRT_PX);
      ctx.globalAlpha = 1;
    }
    const src = uniformFront(d);
    if (src) ctx.drawImage(src, PANEL.front.x, PANEL.front.y, PANEL.front.w, PANEL.front.h, left, top, right - left, bottom - top);
  } else if (d.kind === "tee" || d.kind === "hoodie") {
    const ink = hex(d.ink);
    const hood = d.kind === "hoodie";
    if (d.motif === "logo") {
      // The cap mark: big in the middle of a tee, small on a hoodie's left chest.
      const m = chestLogo(d.teamId, dark);
      if (hood) fit(ctx, m, sx(0.27), sy(1.15), 11, 11) || text(ctx, d.text.slice(0, 1), sx(0.27), sy(1.15), 10, 11, ink);
      else fit(ctx, m, cx, sy(1.0), 30, 26) || text(ctx, d.text, cx, sy(1.0), 44, 13, ink);
    } else {
      const m = chestWordmark(d.teamId, dark);
      const y = d.motif === "number" ? sy(1.18) : sy(hood ? 1.12 : 1.04);
      const h = d.motif === "number" ? 8 : 13;
      if (!fit(ctx, m, cx, y, 46, h)) text(ctx, d.text, cx, y, 46, h + 1, ink, "italic bold");
      if (d.motif === "number") text(ctx, d.number, cx, sy(0.78), 40, 26, ink, "bold");
    }
  } else {
    // Everyday clothes.
    if (d.motif === "stripes" && d.stripe >= 0) {
      ctx.fillStyle = hex(d.stripe);
      for (let z = -0.2; z < 1.7; z += 0.24) ctx.fillRect(0, sy(z + 0.085), SHIRT_PX, sy(z) - sy(z + 0.085));
    } else if (d.motif === "graphic" && d.stripe >= 0) {
      ctx.fillStyle = hex(d.stripe);
      ctx.fillRect(sx(-0.24), sy(1.22), sx(0.24) - sx(-0.24), sy(0.86) - sy(1.22));
      ctx.fillStyle = hex(d.cloth);
      ctx.fillRect(sx(-0.16), sy(1.12), sx(0.16) - sx(-0.16), sy(0.98) - sy(1.12));
    }
  }
  // Swatch column: the collar and cuff braid.
  ctx.fillStyle = hex(d.trim);
  ctx.fillRect(sx(1.2) + 1, 0, SHIRT_PX, SHIRT_PX);
  ctx.restore();
}

function paintCap(ctx: Ctx, d: CapDesign, ox: number, oy: number) {
  const W = CAP_PX;
  ctx.save();
  ctx.translate(ox, oy);
  ctx.beginPath();
  ctx.rect(0, 0, W, W);
  ctx.clip();
  ctx.fillStyle = hex(d.crown);
  ctx.fillRect(0, 0, W, W);
  const cx = 0.47 * W;
  if (d.front !== d.crown) {
    // Two-tone: the front panels in their own colour.
    ctx.fillStyle = hex(d.front);
    ctx.fillRect(cx - 0.17 * W, 0, 0.34 * W, W);
  }
  if (d.logo && d.teamId) {
    // The mark on the front panels, just above the bill (crown v ≈ 0.4 of its height).
    const y = (1 - 0.4 * SPAN) * W;
    fit(ctx, chestLogo(d.teamId, luma(d.front) < 0.5), cx, y, 0.36 * W, 0.4 * W);
  }
  // Swatch column: the bill.
  ctx.fillStyle = hex(d.bill);
  ctx.fillRect(SPAN * W + 1, 0, W, W);
  ctx.restore();
}

/** Paint (or repaint, as marks load) the whole design atlas for a lineup. */
export function paintMerch(canvas: HTMLCanvasElement, l: Lineup): void {
  canvas.width = canvas.height = MERCH_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = "#9a9ea4";
  ctx.fillRect(0, 0, MERCH_SIZE, MERCH_SIZE);
  l.garments.forEach((d, i) => paintShirt(ctx, d, ...shirtOrigin(i)));
  l.caps.forEach((d, i) => paintCap(ctx, d, ...capOrigin(i)));
}
