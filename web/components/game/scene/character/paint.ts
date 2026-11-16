/**
 * Paints a person's texture atlas (see atlas.ts) on a 2D canvas: uniform colours and
 * trim, the name and number, buttons and piping, socks, and a face. Browser only.
 */
import type { ActorKind } from "@/components/game/scene/rig";
import { ATLAS, FINISH, PANEL, PANEL_FINISH, SWATCHES, swatchRect, type Rect, type Swatch } from "@/components/game/scene/character/atlas";
import { CUFF_AT } from "@/components/game/scene/character/body";
import { capLogo } from "@/components/game/scene/character/uniforms";

export interface Look {
  kind: ActorKind;
  /** Player id (0 for umpires and coaches): seeds hair, beard, glove leather, sock style... */
  id: number;
  /** Seed for people without an id. */
  seed: number;
  /** Colours as 0xRRGGBB. */
  jersey: number;
  accent: number;
  skin: number;
  name: string;
  num: string;
  /** Club nickname for the chest wordmark, or "". */
  team: string;
  /** MLB team id for the cap mark (0 = none). */
  teamId: number;
  /** Cap colour, lettering colour and pinstripe colour as 0xRRGGBB (-1 = derive from accent / none). */
  cap: number;
  letter: number;
  stripe: number;
}

type RGB = [number, number, number];
const rgb = (hex: number): RGB => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const css = (c: RGB, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
const lum = (c: RGB) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const BLACK: RGB = [0, 0, 0];
const WHITE: RGB = [255, 255, 255];

/** Deterministic 0..1 from an id and a salt. */
export function hash01(id: number, salt: number): number {
  let h = (Math.imul(id | 0, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b)) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39) >>> 0;
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

const HAIR_DARK: RGB[] = [
  [20, 18, 17],
  [30, 24, 20],
  [44, 31, 22],
];
const HAIR_LIGHT: RGB[] = [
  [26, 22, 20],
  [52, 36, 24],
  [84, 58, 36],
  [118, 86, 50],
  [168, 134, 82],
  [122, 62, 34],
];
const LEATHER: RGB[] = [
  [128, 78, 38],
  [96, 54, 26],
  [30, 28, 28],
  [156, 104, 54],
  [124, 44, 32],
  [70, 44, 30],
];

type Ctx = CanvasRenderingContext2D;

function inPanel(ctx: Ctx, r: Rect, draw: () => void) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  ctx.translate(r.x, r.y);
  draw();
  ctx.restore();
}

const NUM_FONT = 'Impact, "Arial Narrow Bold", "Haettenschweiler", "Helvetica Neue", Arial, sans-serif';
const NAME_FONT = '"Arial Narrow", "Helvetica Neue", Arial, sans-serif';

function label(ctx: Ctx, text: string, x: number, y: number, px: number, maxW: number, fill: string, outline: string | null) {
  ctx.font = `${px}px ${NUM_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const w = ctx.measureText(text).width;
  ctx.save();
  ctx.translate(x, y);
  if (w > maxW) ctx.scale(maxW / w, 1);
  if (outline) {
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(3, px * 0.09);
    ctx.strokeStyle = outline;
    ctx.strokeText(text, 0, 0);
  }
  ctx.fillStyle = fill;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

const SCRIPT_FONT = '"Snell Roundhand", "Brush Script MT", "Segoe Script", "Lucida Handwriting", "Apple Chancery", cursive';

/** The club's name in script across the chest, climbing a little, with a tail swept back under it. */
function wordmark(ctx: Ctx, text: string, cx: number, cy: number, maxW: number, fill: string, outline: string | null) {
  let px = 58;
  ctx.font = `italic bold ${px}px ${SCRIPT_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  let w = ctx.measureText(text).width;
  if (w > maxW) {
    px = Math.max(26, (px * maxW) / w);
    ctx.font = `italic bold ${px}px ${SCRIPT_FONT}`;
    w = Math.min(maxW, ctx.measureText(text).width);
  }
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.1);
  const tail = () => {
    ctx.beginPath();
    ctx.moveTo(w / 2 + 2, px * 0.1);
    ctx.quadraticCurveTo(w * 0.1, px * 0.44, -w * 0.42, px * 0.2);
    ctx.quadraticCurveTo(w * 0.05, px * 0.3, w / 2 + 2, px * 0.1);
    ctx.closePath();
  };
  ctx.lineJoin = "round";
  if (outline) {
    ctx.lineWidth = Math.max(3, px * 0.1);
    ctx.strokeStyle = outline;
    ctx.strokeText(text, 0, 0, maxW);
    tail();
    ctx.stroke();
  }
  ctx.fillStyle = fill;
  ctx.strokeStyle = fill;
  // A hairline stroke fattens thin script faces so the word still reads from the stands.
  ctx.lineWidth = px * 0.035;
  ctx.strokeText(text, 0, 0, maxW);
  ctx.fillText(text, 0, 0, maxW);
  tail();
  ctx.fill();
  ctx.restore();
}

/** A fielder's glove: back (left half) and pocket (right half); fingertips at the top, heel at the bottom. */
function gloveLeather(ctx: Ctx, w: number, h: number, leather: RGB, seed: number) {
  const hw = w / 2;
  const dark = css(mix(leather, BLACK, 0.45));
  const lace = css(mix(leather, [226, 200, 150], hash01(seed, 61) < 0.5 ? 0.75 : 0.1));
  ctx.fillStyle = css(leather);
  ctx.fillRect(0, 0, hw, h);
  ctx.fillStyle = css(mix(leather, BLACK, 0.24));
  ctx.fillRect(hw, 0, hw, h);
  // Back: seams between the finger stalls, welting, the wrist strap and the opening above it.
  ctx.lineCap = "round";
  for (const sx of [0.2, 0.385, 0.575, 0.8]) {
    const x = hw * (0.04 + 0.92 * sx);
    ctx.strokeStyle = dark;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(x, 6);
    ctx.lineTo(x + (sx - 0.5) * 3, h * 0.6);
    ctx.stroke();
    ctx.strokeStyle = css(mix(leather, WHITE, 0.22), 0.7);
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(x + 1.8, 7);
    ctx.lineTo(x + 1.8 + (sx - 0.5) * 3, h * 0.58);
    ctx.stroke();
  }
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.ellipse(hw * 0.5, h * 0.74, hw * 0.3, h * 0.07, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = css(mix(leather, BLACK, 0.2));
  ctx.fillRect(0, h * 0.84, hw, h * 0.1);
  ctx.fillStyle = css(mix(leather, WHITE, 0.5));
  ctx.fillRect(hw * 0.42, h * 0.855, hw * 0.16, h * 0.07);
  ctx.strokeStyle = lace;
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 2.2]);
  ctx.beginPath();
  ctx.moveTo(1, h * 0.83);
  ctx.lineTo(hw - 1, h * 0.83);
  ctx.moveTo(1, h * 0.95);
  ctx.lineTo(hw - 1, h * 0.95);
  ctx.stroke();
  // Pocket: worn hollow, creases from the heel, the laced web by the thumb, lacing round the edge.
  const g = ctx.createRadialGradient(hw * 1.42, h * 0.56, 1, hw * 1.42, h * 0.56, hw * 0.5);
  g.addColorStop(0, "rgba(0,0,0,0.5)");
  g.addColorStop(0.55, "rgba(0,0,0,0.22)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(hw, 0, hw, h);
  ctx.setLineDash([]);
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 1.2;
  for (const k of [-1, 0, 1]) {
    ctx.beginPath();
    ctx.moveTo(hw * (1.42 + 0.1 * k), h * 0.9);
    ctx.quadraticCurveTo(hw * (1.4 + 0.2 * k), h * 0.6, hw * (1.36 + 0.3 * k), h * 0.26);
    ctx.stroke();
  }
  // Web lattice.
  const wx = hw * 1.62;
  const ww = hw * 0.36;
  ctx.fillStyle = css(mix(leather, BLACK, 0.12));
  ctx.fillRect(wx, 2, ww, h * 0.46);
  ctx.strokeStyle = dark;
  ctx.lineWidth = 1.6;
  for (let k = 1; k < 4; k++) {
    ctx.beginPath();
    ctx.moveTo(wx + (ww * k) / 4, 2);
    ctx.lineTo(wx + (ww * k) / 4, h * 0.48);
    ctx.stroke();
  }
  ctx.strokeStyle = lace;
  ctx.lineWidth = 1.3;
  for (let k = 0; k < 5; k++) {
    const y = 5 + k * h * 0.09;
    ctx.beginPath();
    ctx.moveTo(wx, y);
    ctx.lineTo(wx + ww, y + (k % 2 ? -2.5 : 2.5));
    ctx.stroke();
  }
  ctx.setLineDash([2.4, 2.4]);
  ctx.lineWidth = 1.1;
  ctx.strokeRect(hw + 2.5, 2.5, hw - 5, h - 5);
  ctx.setLineDash([]);
  // Leather grain.
  for (let k = 0; k < 70; k++) {
    ctx.fillStyle = hash01(seed, 200 + k) < 0.5 ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.05)";
    ctx.fillRect(hash01(seed, 300 + k) * w, hash01(seed, 400 + k) * h, 2.5, 1.2);
  }
}

/** Lettering on a shallow arc, as sewn across the shoulders. */
function arcName(ctx: Ctx, text: string, cx: number, cy: number, maxW: number, fill: string, outline: string | null) {
  let px = 30;
  const gap = 2.5;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const measure = () => {
    ctx.font = `bold ${px}px ${NAME_FONT}`;
    let w = 0;
    for (const ch of text) w += ctx.measureText(ch).width + gap;
    return w - gap;
  };
  let w = measure();
  if (w > maxW) {
    px = Math.max(13, (px * maxW) / w);
    w = measure();
  }
  const R = 250;
  let x = -w / 2;
  for (const ch of text) {
    const cw = ctx.measureText(ch).width;
    const a = (x + cw / 2) / R;
    ctx.save();
    ctx.translate(cx + R * Math.sin(a), cy + R * (1 - Math.cos(a)));
    ctx.rotate(a);
    if (outline) {
      ctx.lineJoin = "round";
      ctx.lineWidth = 3;
      ctx.strokeStyle = outline;
      ctx.strokeText(ch, 0, 0);
    }
    ctx.fillStyle = fill;
    ctx.fillText(ch, 0, 0);
    ctx.restore();
    x += cw + gap;
  }
}

/** Soft cloth shading so a panel does not read as a flat fill. */
function cloth(ctx: Ctx, w: number, h: number) {
  const g = ctx.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, "rgba(0,0,0,0.10)");
  g.addColorStop(0.18, "rgba(0,0,0,0)");
  g.addColorStop(0.82, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,0.10)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const v = ctx.createLinearGradient(0, h * 0.6, 0, h);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,0.09)");
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);
  // A few folds gathering toward the belt.
  ctx.strokeStyle = "rgba(0,0,0,0.05)";
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  for (const [x0, x1] of [
    [0.2, 0.26],
    [0.37, 0.4],
    [0.63, 0.6],
    [0.8, 0.74],
  ]) {
    ctx.beginPath();
    ctx.moveTo(x0 * w, h * 0.7);
    ctx.quadraticCurveTo(x0 * w, h * 0.9, x1 * w, h);
    ctx.stroke();
  }
}

function face(ctx: Ctx, skin: RGB, hair: RGB, beard: number, shaded: boolean, seed: number) {
  const { w, h } = PANEL.face;
  const cx = w / 2;
  ctx.fillStyle = css(skin);
  ctx.fillRect(0, 0, w, h);
  const shadow = mix(skin, [60, 20, 20], 0.45);
  // Warmth in the cheeks, shade under the brow and the jaw.
  for (const s of [-1, 1]) {
    const g = ctx.createRadialGradient(cx + s * 30, 78, 2, cx + s * 30, 78, 20);
    g.addColorStop(0, css(mix(skin, [205, 90, 80], 0.5), 0.22));
    g.addColorStop(1, css(skin, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 50, w, 60);
  }
  if (shaded) {
    const g = ctx.createLinearGradient(0, 30, 0, 62);
    g.addColorStop(0, css(shadow, 0.5));
    g.addColorStop(1, css(shadow, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, 62);
  }
  const eyeY = 58;
  const eyeX = 24;
  const brow = mix(hair, BLACK, 0.35);
  for (const s of [-1, 1]) {
    const ex = cx + s * eyeX;
    // Socket shade, eye white, iris, pupil, upper lid.
    ctx.fillStyle = css(shadow, 0.28);
    ctx.beginPath();
    ctx.ellipse(ex, eyeY - 1, 11, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgb(236,232,224)";
    ctx.beginPath();
    ctx.ellipse(ex, eyeY, 8.6, 4.7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = css(hash01(seed, 21) < 0.75 ? [58, 38, 24] : [70, 98, 120]);
    ctx.beginPath();
    ctx.arc(ex, eyeY, 4.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgb(12,10,10)";
    ctx.beginPath();
    ctx.arc(ex, eyeY, 2.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.beginPath();
    ctx.arc(ex - 1.5, eyeY - 1.5, 0.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = css(mix(skin, BLACK, 0.7));
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(ex - 9.5, eyeY + 0.5);
    ctx.quadraticCurveTo(ex, eyeY - 7.5, ex + 9.5, eyeY + 0.5);
    ctx.stroke();
    // Eyebrow.
    ctx.strokeStyle = css(brow, 0.96);
    ctx.lineWidth = 4.4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(ex - s * 10, eyeY - 10.5);
    ctx.quadraticCurveTo(ex + s * 2, eyeY - 15, ex + s * 12, eyeY - 10);
    ctx.stroke();
  }
  // Shade beside the nose and under it.
  ctx.fillStyle = css(shadow, 0.3);
  ctx.beginPath();
  ctx.ellipse(cx, 82, 9, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  // Beard (drawn under the mouth): 1 stubble, 2 full, 3 goatee.
  if (beard > 0) {
    const a = beard === 1 ? 0.3 : 0.88;
    ctx.fillStyle = css(mix(hair, skin, 0.1), a);
    ctx.beginPath();
    if (beard === 3) {
      ctx.ellipse(cx, 100, 17, 21, 0, 0, Math.PI * 2);
    } else {
      ctx.moveTo(0, 56);
      ctx.lineTo(9, 60);
      ctx.quadraticCurveTo(20, 86, cx - 16, 86);
      ctx.lineTo(cx + 16, 86);
      ctx.quadraticCurveTo(w - 20, 86, w - 9, 60);
      ctx.lineTo(w, 56);
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
    }
    ctx.fill();
  }
  // Mouth.
  ctx.strokeStyle = css(mix(skin, [90, 30, 30], 0.6));
  ctx.lineWidth = 2.2;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(cx - 12, 93.5);
  ctx.quadraticCurveTo(cx, 95.5, cx + 12, 93.5);
  ctx.stroke();
  ctx.strokeStyle = css(mix(skin, [150, 70, 70], 0.4), 0.7);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx - 8, 97.5);
  ctx.quadraticCurveTo(cx, 99.5, cx + 8, 97.5);
  ctx.stroke();
}

/** Paint the whole atlas for one person. */
export function paintLook(ctx: Ctx, look: Look): void {
  const seed = look.id || look.seed;
  const kind = look.kind;
  const ump = kind === "umpire";
  const player = !ump && kind !== "coach";
  const jersey = rgb(look.jersey);
  const accent = rgb(look.accent);
  const skin = rgb(look.skin);
  const pants: RGB = ump ? [66, 69, 76] : mix(jersey, BLACK, 0.035);
  // Lettering must stand off the cloth: fall back to navy or white when the team colour would not.
  const letter = look.letter >= 0 && !ump ? rgb(look.letter) : accent;
  const ink: RGB = Math.abs(lum(letter) - lum(jersey)) > 55 ? letter : lum(jersey) > 128 ? [22, 30, 54] : WHITE;
  const outline = !ump && lum(jersey) < 215 ? css(lum(ink) > 150 ? [20, 24, 36] : WHITE) : null;
  const hairSet = lum(skin) < 140 ? HAIR_DARK : HAIR_LIGHT;
  const hair = hairSet[Math.floor(hash01(seed, 1) * hairSet.length)];
  const bRoll = hash01(seed, 2);
  const beard = bRoll < 0.34 ? 0 : bRoll < 0.6 ? 1 : bRoll < 0.86 ? 2 : 3;
  const undershirt = player && hash01(seed, 3) < 0.5;
  const sleeve = undershirt ? mix(accent, BLACK, lum(accent) > 150 ? 0.75 : 0.1) : skin;
  const wRoll = hash01(seed, 4);
  const wrist = player && kind !== "pitcher" && wRoll < 0.45 ? (wRoll < 0.25 ? WHITE : accent) : sleeve;
  const gRoll = hash01(seed, 5);
  const battingGlove: RGB = gRoll < 0.4 ? [238, 238, 234] : gRoll < 0.7 ? [26, 26, 30] : accent;
  const handC = kind === "batter" || kind === "runner" ? battingGlove : skin;
  const leather = LEATHER[Math.floor(hash01(seed, 6) * LEATHER.length)];
  const headwear: RGB = ump ? [20, 22, 28] : look.cap >= 0 ? rgb(look.cap) : accent;
  const stripe: RGB | null = !ump && look.stripe >= 0 ? rgb(look.stripe) : null;
  const sockRoll = hash01(seed, 7);
  const sockStyle = !player ? 2 : sockRoll < 0.42 ? 0 : sockRoll < 0.7 ? 1 : 2;
  // Trim follows the team (not the player), so a side looks like one club.
  const piping = !ump && !stripe && hash01(look.accent, 8) < 0.55;
  /** Thin vertical pinstripes across a panel (period in texels). */
  const pinstripes = (w: number, h: number, period: number) => {
    if (!stripe) return;
    ctx.fillStyle = css(stripe, 0.85);
    for (let x = period / 2; x < w; x += period) ctx.fillRect(x - 0.6, 0, 1.2, h);
  };

  const swatches: Record<Swatch, RGB> = {
    skin,
    jersey,
    pants,
    accent,
    belt: ump ? [18, 18, 20] : mix(accent, BLACK, 0.5),
    shoe: [24, 24, 27],
    sole: [214, 212, 204],
    hair,
    cap: headwear,
    brim: mix(headwear, BLACK, 0.22),
    helmet: headwear,
    glove: leather,
    gloveDark: mix(leather, BLACK, 0.3),
    sleeve,
    wrist,
    hand: handC,
    trim: ump ? jersey : accent,
    gear: ump ? [24, 25, 30] : mix(accent, BLACK, 0.2),
    gearDark: [28, 29, 33],
    metal: [52, 54, 60],
    buckle: [196, 184, 150],
    collar: ump ? mix(jersey, WHITE, 0.06) : accent,
  };
  ctx.globalAlpha = 1;
  ctx.fillStyle = css(jersey);
  ctx.fillRect(0, 0, ATLAS, ATLAS);
  for (const name of SWATCHES) {
    const r = swatchRect(name);
    ctx.fillStyle = css(swatches[name]);
    ctx.fillRect(r.x, r.y, r.w, r.h);
  }

  const seam = css(mix(jersey, BLACK, 0.2));
  inPanel(ctx, PANEL.front, () => {
    const { w, h } = PANEL.front;
    const cx = w / 2;
    ctx.fillStyle = css(jersey);
    ctx.fillRect(0, 0, w, h);
    cloth(ctx, w, h);
    pinstripes(w, h, 14);
    if (piping) {
      ctx.fillStyle = css(accent);
      ctx.fillRect(cx - 15, 0, 3, h);
      ctx.fillRect(cx + 12, 0, 3, h);
    }
    // Placket and buttons.
    ctx.strokeStyle = seam;
    ctx.lineWidth = 1.5;
    for (const x of [cx - 9, cx + 9]) {
      ctx.beginPath();
      ctx.moveTo(x, 20);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 62; y < h - 12; y += 42) {
      ctx.fillStyle = css(mix(jersey, BLACK, ump ? -0.4 : 0.3));
      ctx.beginPath();
      ctx.arc(cx, y, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = css(mix(jersey, WHITE, 0.5), 0.8);
      ctx.beginPath();
      ctx.arc(cx - 0.8, y - 0.8, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
    // Open neck: undershirt or skin, edged with the collar trim.
    ctx.fillStyle = css(undershirt ? sleeve : ump ? [16, 16, 18] : skin);
    ctx.beginPath();
    ctx.moveTo(cx - 34, 0);
    ctx.lineTo(cx + 34, 0);
    ctx.lineTo(cx, 36);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = css(swatches.collar);
    ctx.lineWidth = 6;
    ctx.lineJoin = "miter";
    ctx.beginPath();
    ctx.moveTo(cx - 37, -2);
    ctx.lineTo(cx, 38);
    ctx.lineTo(cx + 37, -2);
    ctx.stroke();
    if (ump) {
      // Breast pocket.
      ctx.strokeStyle = css(mix(jersey, WHITE, 0.16));
      ctx.lineWidth = 1.5;
      ctx.strokeRect(162, 78, 34, 36);
    } else if (look.team && player) {
      // Club wordmark across the chest with the number under it on the wearer's left.
      wordmark(ctx, look.team, cx, 104, 168, css(ink), outline);
      if (look.num) label(ctx, look.num, 180, 152, 36, 44, css(ink), outline);
    } else if (look.num) {
      // Number on the wearer's left chest.
      label(ctx, look.num, 178, 98, 40, 46, css(ink), outline);
    }
  });
  inPanel(ctx, PANEL.back, () => {
    const { w, h } = PANEL.back;
    ctx.fillStyle = css(jersey);
    ctx.fillRect(0, 0, w, h);
    cloth(ctx, w, h);
    pinstripes(w, h, 14);
    // Yoke seam across the shoulders.
    ctx.strokeStyle = css(mix(jersey, BLACK, 0.1));
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, 40);
    ctx.quadraticCurveTo(w / 2, 26, w, 40);
    ctx.stroke();
    if (ump) return;
    if (look.name) arcName(ctx, look.name, w / 2, 62, 176, css(ink), outline);
    if (look.num) label(ctx, look.num, w / 2, look.name ? 148 : 132, 104, 150, css(ink), outline);
  });
  inPanel(ctx, PANEL.face, () => face(ctx, skin, hair, beard, kind !== "catcher", seed));

  const pipe = css(accent);
  /** Shade wrapping round a limb: darker toward the inseam at both edges of the unwrap. */
  const wrap = (w: number, h: number, a: number) => {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, `rgba(0,0,0,${a})`);
    g.addColorStop(0.22, "rgba(0,0,0,0)");
    g.addColorStop(0.78, "rgba(0,0,0,0)");
    g.addColorStop(1, `rgba(0,0,0,${a})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  };
  inPanel(ctx, PANEL.pants, () => {
    // v runs from the belt (0) to the knee (1).
    const { w, h } = PANEL.pants;
    ctx.fillStyle = css(pants);
    ctx.fillRect(0, 0, w, h);
    pinstripes(w, h, 16);
    wrap(w, h, 0.13);
    // Shade under the belt and creases gathering at the knee.
    const g = ctx.createLinearGradient(0, 0, 0, h * 0.14);
    g.addColorStop(0, "rgba(0,0,0,0.16)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h * 0.14);
    ctx.strokeStyle = "rgba(0,0,0,0.07)";
    ctx.lineCap = "round";
    ctx.lineWidth = 3;
    for (let k = 0; k < 4; k++) {
      const y = h * (0.8 + 0.055 * k);
      const x = w * (0.12 + 0.2 * hash01(seed, 30 + k));
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + w * 0.2, y + 5, x + w * 0.42, y - 2);
      ctx.stroke();
    }
    // Back pockets either side of the unwrap's ends would split across the seam, so keep to a fly-less front.
    if (piping) {
      ctx.fillStyle = pipe;
      ctx.fillRect(w / 2 - 4, 0, 8, h);
    }
  });
  inPanel(ctx, PANEL.sleeve, () => {
    // u wraps from the armpit, v runs from the shoulder seam (0) to the hem (1).
    const { w, h } = PANEL.sleeve;
    ctx.fillStyle = css(jersey);
    ctx.fillRect(0, 0, w, h);
    pinstripes(w, h, 12);
    wrap(w, h, 0.14);
    ctx.strokeStyle = seam;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(0, h * 0.2);
    ctx.lineTo(w, h * 0.2);
    ctx.stroke();
    if (!ump) {
      ctx.fillStyle = css(accent);
      ctx.fillRect(0, h - 9, w, 6);
      if (piping) ctx.fillRect(0, h - 15, w, 2);
    } else {
      ctx.fillStyle = css(mix(jersey, WHITE, 0.1));
      ctx.fillRect(0, h - 6, w, 3);
    }
  });
  inPanel(ctx, PANEL.glove, () => gloveLeather(ctx, PANEL.glove.w, PANEL.glove.h, leather, seed));
  inPanel(ctx, PANEL.shoe, () => {
    // Side view: u runs from the toe (0) to the heel (1), v from the collar (0) to the sole (1).
    const { w, h } = PANEL.shoe;
    const sRoll = hash01(seed, 9);
    const upper: RGB = ump || !player ? [22, 22, 25] : sRoll < 0.62 ? [24, 24, 28] : sRoll < 0.82 ? [236, 236, 232] : mix(accent, BLACK, 0.15);
    const mark: RGB = lum(upper) > 150 ? (lum(accent) < 150 ? accent : [30, 30, 36]) : lum(accent) > 60 ? mix(accent, WHITE, 0.25) : WHITE;
    ctx.fillStyle = css(upper);
    ctx.fillRect(0, 0, w, h);
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "rgba(255,255,255,0.10)");
    g.addColorStop(0.6, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.2)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // Toe cap seam, side stripes, laces across the instep, midsole.
    ctx.strokeStyle = css(mix(upper, lum(upper) > 150 ? BLACK : WHITE, 0.22));
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(w * 0.2, 0);
    ctx.quadraticCurveTo(w * 0.27, h * 0.5, w * 0.2, h);
    ctx.stroke();
    if (player) {
      ctx.strokeStyle = css(mark);
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      for (const u of [0.5, 0.6, 0.7]) {
        ctx.beginPath();
        ctx.moveTo(w * (u + 0.05), h * 0.3);
        ctx.lineTo(w * (u - 0.07), h * 0.74);
        ctx.stroke();
      }
    }
    ctx.strokeStyle = css(lum(upper) > 150 ? [60, 60, 66] : [226, 226, 222]);
    ctx.lineWidth = 2;
    for (let k = 0; k < 4; k++) {
      const x = w * (0.26 + 0.06 * k);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + 2, h * 0.2);
      ctx.stroke();
    }
    ctx.fillStyle = css(lum(upper) > 150 ? [205, 204, 198] : [222, 220, 212]);
    ctx.fillRect(0, h * 0.8, w, h * 0.2);
  });
  inPanel(ctx, PANEL.chest, () => {
    // Chest protector: padded ribs with a trimmed edge; u wraps round the body, front in the middle.
    const { w, h } = PANEL.chest;
    const base = swatches.gear;
    ctx.fillStyle = css(base);
    ctx.fillRect(0, 0, w, h);
    for (let k = 0; k < 6; k++) {
      const y = (h * (k + 0.5)) / 6;
      const g = ctx.createLinearGradient(0, y - h / 12, 0, y + h / 12);
      g.addColorStop(0, "rgba(0,0,0,0.3)");
      g.addColorStop(0.3, "rgba(255,255,255,0.09)");
      g.addColorStop(1, "rgba(0,0,0,0.3)");
      ctx.fillStyle = g;
      ctx.fillRect(0, y - h / 12, w, h / 6);
    }
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fillRect(w / 2 - 1, 0, 2, h);
    ctx.fillStyle = css(ump ? [60, 62, 70] : lum(accent) > 40 ? mix(accent, WHITE, 0.2) : [200, 200, 200]);
    ctx.fillRect(0, 0, w, 3);
    ctx.fillRect(0, h - 3, w, 3);
  });
  // Cap and helmet fronts: the club's mark, centred over the brim.
  const mark = ump ? null : capLogo(look.teamId);
  for (const [panel, base, gloss] of [
    [PANEL.capFront, headwear, 0],
    [PANEL.helmetFront, headwear, 1],
  ] as const) {
    inPanel(ctx, panel, () => {
      const { w, h } = panel;
      ctx.fillStyle = css(base);
      ctx.fillRect(0, 0, w, h);
      if (gloss) {
        const g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, "rgba(255,255,255,0.10)");
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }
      if (!mark) return;
      // Fit the mark in a box 0.21 ft tall and wide (the panel spans 0.6 × 0.3 ft).
      const box = h * 0.72;
      const ar = mark.naturalWidth / Math.max(1, mark.naturalHeight);
      const mw = ar >= 1 ? box : box * ar;
      const mh = ar >= 1 ? box / ar : box;
      ctx.drawImage(mark, w / 2 - mw / 2, h * 0.52 - mh / 2, mw, mh);
    });
  }
  inPanel(ctx, PANEL.lower, () => {
    const { w, h } = PANEL.lower;
    const cuff = sockStyle === 2 ? h * 0.9 : CUFF_AT * h;
    const sock: RGB = ump ? [20, 20, 22] : accent;
    ctx.fillStyle = css(sock);
    ctx.fillRect(0, 0, w, h);
    if (sockStyle === 1) {
      ctx.fillStyle = css(lum(sock) > 170 ? [30, 34, 48] : WHITE);
      ctx.fillRect(0, cuff + 16, w, 5);
      ctx.fillRect(0, cuff + 26, w, 5);
      ctx.fillRect(0, cuff + 36, w, 5);
    }
    wrap(w, h, 0.12);
    ctx.fillStyle = css(pants);
    ctx.fillRect(0, 0, w, cuff);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, cuff);
    ctx.clip();
    pinstripes(w, h, 16);
    wrap(w, h, 0.13);
    // Cloth bunching above the elastic.
    ctx.strokeStyle = "rgba(0,0,0,0.07)";
    ctx.lineWidth = 2.5;
    for (let k = 0; k < 3; k++) {
      const y = cuff - 8 - k * 9;
      ctx.beginPath();
      ctx.moveTo(w * 0.1, y);
      ctx.quadraticCurveTo(w * 0.4, y + 5, w * 0.9, y - 1);
      ctx.stroke();
    }
    ctx.restore();
    if (piping) {
      ctx.fillStyle = pipe;
      ctx.fillRect(w / 2 - 4, 0, 8, cuff);
    }
    // Elastic at the cuff.
    ctx.fillStyle = css(mix(pants, BLACK, 0.16));
    ctx.fillRect(0, cuff - 3, w, 3);
  });
}

/** The roughness (G) / metalness (B) companion of the atlas; one texture serves everybody. */
export function paintFinish(ctx: Ctx): void {
  const put = (r: Rect, f: [number, number]) => {
    ctx.fillStyle = `rgb(0,${Math.round(f[0] * 255)},${Math.round(f[1] * 255)})`;
    ctx.fillRect(r.x, r.y, r.w, r.h);
  };
  put({ x: 0, y: 0, w: ATLAS, h: ATLAS }, [0.9, 0]);
  for (const k of Object.keys(PANEL) as Array<keyof typeof PANEL>) put(PANEL[k], PANEL_FINISH[k]);
  for (const name of SWATCHES) put(swatchRect(name), FINISH[name]);
}
