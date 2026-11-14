/**
 * Layout of the per-person texture atlas (512 × 512, canvas pixels, origin top-left).
 * The body mesh is shared by everyone wearing the same outfit; all that differs from
 * one person to the next is this texture: uniform colours, the name and number on the
 * back, the face, sock style and so on.
 *
 *   back panel   | front panel        (jersey, wrapped half-way round the torso each)
 *   face | pants strip / lower-leg panel   (legs unwrap by angle; the outseam is u = 0.5)
 *   swatches: flat colour cells, sampled at their centres
 */
import type { VOut } from "@/components/game/scene/character/mesh";

export const ATLAS = 512;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const PANEL = {
  back: { x: 0, y: 0, w: 256, h: 256 },
  front: { x: 256, y: 0, w: 256, h: 256 },
  face: { x: 0, y: 256, w: 128, h: 128 },
  pants: { x: 128, y: 256, w: 384, h: 32 },
  lower: { x: 128, y: 288, w: 384, h: 96 },
} satisfies Record<string, Rect>;

export const SWATCHES = [
  "skin",
  "jersey",
  "pants",
  "accent",
  "belt",
  "shoe",
  "sole",
  "hair",
  "cap",
  "brim",
  "helmet",
  "glove",
  "gloveDark",
  "sleeve",
  "wrist",
  "hand",
  "trim",
  "gear",
  "gearDark",
  "metal",
  "buckle",
  "collar",
] as const;
export type Swatch = (typeof SWATCHES)[number];

const CELL = 32;
const SWATCH_Y = 384;
const PER_ROW = ATLAS / CELL;

export function swatchRect(name: Swatch): Rect {
  const i = SWATCHES.indexOf(name);
  return { x: (i % PER_ROW) * CELL, y: SWATCH_Y + Math.floor(i / PER_ROW) * CELL, w: CELL, h: CELL };
}

/** Surface finish per swatch: [roughness, metalness]. */
export const FINISH: Record<Swatch, [number, number]> = {
  skin: [0.62, 0],
  jersey: [0.92, 0],
  pants: [0.9, 0],
  accent: [0.9, 0],
  belt: [0.5, 0],
  shoe: [0.45, 0],
  sole: [0.8, 0],
  hair: [0.7, 0],
  cap: [0.88, 0],
  brim: [0.8, 0],
  helmet: [0.2, 0.05],
  glove: [0.6, 0],
  gloveDark: [0.65, 0],
  sleeve: [0.75, 0],
  wrist: [0.9, 0],
  hand: [0.7, 0],
  trim: [0.9, 0],
  gear: [0.5, 0],
  gearDark: [0.6, 0],
  metal: [0.35, 0.6],
  buckle: [0.3, 0.7],
  collar: [0.9, 0],
};
export const PANEL_FINISH: Record<keyof typeof PANEL, [number, number]> = {
  back: [0.92, 0],
  front: [0.92, 0],
  face: [0.62, 0],
  pants: [0.9, 0],
  lower: [0.88, 0],
};

/** UV writer for a flat-colour swatch. */
export function sw(name: Swatch): (o: VOut) => void {
  const r = swatchRect(name);
  const u = (r.x + r.w / 2) / ATLAS;
  const v = 1 - (r.y + r.h / 2) / ATLAS;
  return (o) => {
    o.u = u;
    o.v = v;
  };
}

/** Write the UV of a point in a panel: s runs left → right, t top → bottom (both 0..1). */
export function panelUV(o: VOut, r: Rect, s: number, t: number): void {
  // Stay half a texel inside the panel so neighbours never bleed in.
  const px = r.x + 0.75 + Math.min(1, Math.max(0, s)) * (r.w - 1.5);
  const py = r.y + 0.75 + Math.min(1, Math.max(0, t)) * (r.h - 1.5);
  o.u = px / ATLAS;
  o.v = 1 - py / ATLAS;
}
