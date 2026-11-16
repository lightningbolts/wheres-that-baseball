/**
 * Paints a person's texture atlas (see atlas.ts) on a 2D canvas: uniform colours and
 * trim, the name and number, buttons and piping, socks, and a face. Browser only.
 */
import type { ActorKind } from "@/components/game/scene/rig";
import { ATLAS, FINISH, PANEL, PANEL_FINISH, SWATCHES, hash01, swatchRect, type Rect, type Swatch } from "@/components/game/scene/character/atlas";
import { CUFF_AT, FACE, FACE_H, FACE_W, JERSEY_HEM, JERSEY_TOP, NECK_DIP, styleOf } from "@/components/game/scene/character/body";
import { capLogo, chestLogo, chestWordmark, plainKit, scriptFont, type Kit } from "@/components/game/scene/character/uniforms";

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
  /** The club's set for this game (null: derive a plain one from the colours above). */
  kit: Kit | null;
}

type RGB = [number, number, number];
const rgb = (hex: number): RGB => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const css = (c: RGB, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
const lum = (c: RGB) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const BLACK: RGB = [0, 0, 0];
const WHITE: RGB = [255, 255, 255];

export { hash01 };

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

const SERIF_FONT = 'Rockwell, "Rockwell Nova", Georgia, "Times New Roman", serif';
/** System scripts, used until (or unless) the bundled face arrives; none of them is required. */
const SCRIPT_FALLBACK = '"Snell Roundhand", "Segoe Script", "Lucida Handwriting", "Apple Chancery", cursive';

/**
 * Capitals across the chest, set straight or on a shallow arch (ends lower, as sewn). A long
 * city name is set smaller rather than squeezed out of shape.
 */
function capitals(ctx: Ctx, text: string, cx: number, cy: number, maxW: number, fill: string, outline: string | null, arch: boolean, serif: boolean) {
  let px = serif ? 40 : 38;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const chars = [...text];
  const measure = () => {
    ctx.font = serif ? `bold ${px}px ${SERIF_FONT}` : `${px}px ${NUM_FONT}`;
    const gap = px * 0.05;
    let w = 0;
    for (const ch of chars) w += ctx.measureText(ch).width + gap;
    return w - gap;
  };
  let w = measure();
  // Up to a fifth narrower, then smaller.
  const squeeze = Math.max(0.8, Math.min(1, maxW / w));
  if (w * squeeze > maxW) {
    px = Math.max(16, (px * maxW) / (w * squeeze));
    w = measure();
  }
  const gap = px * 0.05;
  const R = arch ? 210 : 0;
  const x = (-w * squeeze) / 2;
  const edge = Math.max(2.4, px * 0.1);
  for (const pass of outline ? [0, 1] : [1]) {
    let at = x;
    for (const ch of chars) {
      const cw = ctx.measureText(ch).width * squeeze;
      const mid = at + cw / 2;
      ctx.save();
      if (R) {
        const a = mid / R;
        ctx.translate(cx + R * Math.sin(a), cy + R * (1 - Math.cos(a)) - 5);
        ctx.rotate(a);
      } else ctx.translate(cx + mid, cy);
      ctx.scale(squeeze, 1);
      if (pass === 0 && outline) {
        ctx.lineJoin = "round";
        ctx.lineWidth = edge / squeeze;
        ctx.strokeStyle = outline;
        ctx.strokeText(ch, 0, 0);
      } else {
        ctx.fillStyle = fill;
        ctx.fillText(ch, 0, 0);
      }
      ctx.restore();
      at += cw + gap * squeeze;
    }
  }
}

/** The club's name in script across the chest, climbing a little, optionally with a tail swept back under it. */
function wordmark(ctx: Ctx, text: string, cx: number, cy: number, maxW: number, fill: string, outline: string | null, tailed = true) {
  const web = scriptFont();
  // The bundled face is already heavy; the system fallbacks need emboldening to read from the stands.
  const face = (px: number) => (web ? `${px}px ${web}, ${SCRIPT_FALLBACK}` : `italic bold ${px}px ${SCRIPT_FALLBACK}`);
  let px = web ? 50 : 58;
  ctx.font = face(px);
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  let w = ctx.measureText(text).width;
  if (w > maxW) {
    px = Math.max(24, (px * maxW) / w);
    ctx.font = face(px);
    w = Math.min(maxW, ctx.measureText(text).width);
  }
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.12);
  if (web) ctx.transform(1, 0, -0.14, 1, 0, 0);
  const tail = () => {
    ctx.beginPath();
    ctx.moveTo(w / 2 + 2, px * 0.12);
    ctx.quadraticCurveTo(w * 0.1, px * 0.46, -w * 0.42, px * 0.22);
    ctx.quadraticCurveTo(w * 0.05, px * 0.32, w / 2 + 2, px * 0.12);
    ctx.closePath();
  };
  ctx.lineJoin = "round";
  if (outline) {
    ctx.lineWidth = Math.max(3, px * 0.11);
    ctx.strokeStyle = outline;
    ctx.strokeText(text, 0, 0, maxW);
    if (tailed) {
      tail();
      ctx.stroke();
    }
  }
  ctx.fillStyle = fill;
  ctx.strokeStyle = fill;
  // A hairline stroke fattens thin script faces so the word still reads from the stands.
  ctx.lineWidth = px * (web ? 0.012 : 0.035);
  ctx.strokeText(text, 0, 0, maxW);
  ctx.fillText(text, 0, 0, maxW);
  if (tailed) {
    tail();
    ctx.fill();
  }
  ctx.restore();
}

/** A perched cardinal about 26 texels tall, facing `dir` (1 = toward +x). */
function cardinal(ctx: Ctx, x: number, y: number, dir: 1 | -1, red: string, dark: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(dir, 1);
  const shape = () => {
    ctx.beginPath();
    // Tail, down and back.
    ctx.moveTo(-5, 2);
    ctx.lineTo(-13, 17);
    ctx.lineTo(-8, 18);
    ctx.lineTo(0, 6);
    // Belly and breast.
    ctx.quadraticCurveTo(9, 6, 9, -4);
    // Face and the crest swept back.
    ctx.lineTo(8, -9);
    ctx.lineTo(3, -19);
    ctx.lineTo(1, -11);
    // Back.
    ctx.quadraticCurveTo(-6, -6, -5, 2);
    ctx.closePath();
  };
  ctx.lineJoin = "round";
  ctx.lineWidth = 3;
  ctx.strokeStyle = dark;
  shape();
  ctx.stroke();
  ctx.fillStyle = red;
  shape();
  ctx.fill();
  // Mask and beak.
  ctx.fillStyle = dark;
  ctx.fillRect(5.5, -10.5, 3.5, 3);
  ctx.fillStyle = "rgb(250,200,40)";
  ctx.beginPath();
  ctx.moveTo(8.5, -9.5);
  ctx.lineTo(13, -7.5);
  ctx.lineTo(8.5, -5.5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

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

/**
 * The face, drawn where the head mesh has its features (FACE, in feet from the centre of
 * the head). The mesh models the brow, sockets, nose, lips and chin, so the paint only adds
 * what has no relief: eyes, brows, lip colour, nostrils, beard and sideburns.
 */
function face(ctx: Ctx, skin: RGB, hair: RGB, beard: number, shaded: boolean, seed: number) {
  const { w, h } = PANEL.face;
  const kx = w / FACE_W;
  const ky = h / FACE_H;
  const X = (x: number) => w / 2 + x * kx;
  const Y = (y: number) => h / 2 - y * ky;
  ctx.fillStyle = css(skin);
  ctx.fillRect(0, 0, w, h);
  const shadow = mix(skin, [56, 22, 20], 0.5);
  const dark = lum(skin) < 120;
  // Warmth in the cheeks and the nose, a paler brow.
  for (const s of [-1, 1]) {
    const g = ctx.createRadialGradient(X(s * 0.14), Y(-0.1), 1, X(s * 0.14), Y(-0.1), 20);
    g.addColorStop(0, css(mix(skin, [200, 84, 76], 0.5), dark ? 0.1 : 0.2));
    g.addColorStop(1, css(skin, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  if (shaded) {
    const g = ctx.createLinearGradient(0, Y(0.2), 0, Y(0.04));
    g.addColorStop(0, css(shadow, 0.34));
    g.addColorStop(1, css(shadow, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, Y(0.04));
  }
  // Sideburns running down in front of the ears, then the beard: 1 stubble, 2 full, 3 goatee.
  const whisker = mix(hair, skin, 0.12);
  for (const s of [-1, 1]) {
    const g = ctx.createLinearGradient(X(s * 0.25), 0, X(s * 0.19), 0);
    g.addColorStop(0, css(whisker, 0.95));
    g.addColorStop(1, css(whisker, 0));
    ctx.fillStyle = g;
    const len = beard === 2 ? -0.4 : -0.06 - 0.06 * hash01(seed, 22);
    ctx.fillRect(Math.min(X(s * 0.3), X(s * 0.19)), 0, Math.abs(X(0.3) - X(0.19)), Y(len));
  }
  if (beard > 0) {
    const a = beard === 1 ? 0.15 : 0.9;
    ctx.fillStyle = css(whisker, a);
    ctx.beginPath();
    if (beard === 3) {
      // Moustache running down round the mouth to the chin.
      ctx.moveTo(X(-0.1), Y(-0.19));
      ctx.quadraticCurveTo(X(0), Y(-0.165), X(0.1), Y(-0.19));
      ctx.quadraticCurveTo(X(0.125), Y(-0.33), X(0.07), Y(-0.43));
      ctx.lineTo(X(-0.07), Y(-0.43));
      ctx.quadraticCurveTo(X(-0.125), Y(-0.33), X(-0.1), Y(-0.19));
    } else {
      // Cheek line from the sideburn down to the corner of the mouth, moustache over the lip.
      ctx.moveTo(0, Y(-0.02));
      ctx.lineTo(X(-0.215), Y(-0.06));
      ctx.quadraticCurveTo(X(-0.19), Y(-0.2), X(-0.095), Y(-0.2));
      ctx.quadraticCurveTo(X(0), Y(-0.168), X(0.095), Y(-0.2));
      ctx.quadraticCurveTo(X(0.19), Y(-0.2), X(0.215), Y(-0.06));
      ctx.lineTo(w, Y(-0.02));
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
    }
    ctx.closePath();
    ctx.fill();
    if (beard !== 1) {
      // The lips show through.
      ctx.fillStyle = css(skin);
      ctx.beginPath();
      ctx.ellipse(X(0), Y(FACE.mouthY - 0.012), 0.07 * kx, 0.028 * ky, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (hash01(seed, 23) < 0.5) {
    // Five-o'clock shadow.
    const g = ctx.createLinearGradient(0, Y(-0.12), 0, Y(-0.3));
    g.addColorStop(0, css(whisker, 0));
    g.addColorStop(1, css(whisker, 0.14));
    ctx.fillStyle = g;
    ctx.fillRect(0, Y(-0.12), w, h);
  }
  const brow = mix(hair, BLACK, 0.4);
  const iris: RGB = hash01(seed, 21) < 0.75 ? [58, 36, 22] : [70, 96, 116];
  for (const s of [-1, 1]) {
    // Drawn in a frame scaled to feet, x toward the temple, y up.
    ctx.save();
    ctx.translate(X(s * FACE.eyeX), Y(FACE.eyeY));
    ctx.scale(s * kx, -ky);
    // Shade in the socket, darker toward the nose.
    const g = ctx.createRadialGradient(-0.015, 0.012, 0.005, -0.015, 0.012, 0.075);
    g.addColorStop(0, css(shadow, 0.34));
    g.addColorStop(1, css(shadow, 0));
    ctx.fillStyle = g;
    ctx.fillRect(-0.1, -0.06, 0.2, 0.13);
    // Almond opening: inner corner a little lower than the outer.
    const almond = () => {
      ctx.beginPath();
      ctx.moveTo(-0.05, -0.006);
      ctx.quadraticCurveTo(-0.008, 0.03, 0.05, 0.004);
      ctx.quadraticCurveTo(0.008, -0.022, -0.05, -0.006);
      ctx.closePath();
    };
    ctx.save();
    almond();
    ctx.clip();
    ctx.fillStyle = "rgb(214,206,198)";
    ctx.fillRect(-0.06, -0.03, 0.12, 0.07);
    ctx.fillStyle = css(iris);
    ctx.beginPath();
    ctx.arc(0, 0.003, 0.021, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgb(10,8,8)";
    ctx.beginPath();
    ctx.arc(0, 0.003, 0.0095, 0, Math.PI * 2);
    ctx.fill();
    // The upper lid shades the top of the eye.
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fillRect(-0.06, 0.012, 0.12, 0.03);
    ctx.restore();
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.beginPath();
    ctx.arc(-0.007 * s, 0.01, 0.004, 0, Math.PI * 2);
    ctx.fill();
    // Lash line, lid crease, and a faint lower lid.
    ctx.lineCap = "round";
    ctx.strokeStyle = css(mix(skin, BLACK, 0.8));
    ctx.lineWidth = 0.0085;
    ctx.beginPath();
    ctx.moveTo(-0.052, -0.006);
    ctx.quadraticCurveTo(-0.008, 0.032, 0.054, 0.005);
    ctx.stroke();
    ctx.strokeStyle = css(mix(skin, BLACK, 0.4), 0.55);
    ctx.lineWidth = 0.005;
    ctx.beginPath();
    ctx.moveTo(-0.044, 0.018);
    ctx.quadraticCurveTo(-0.004, 0.047, 0.05, 0.022);
    ctx.stroke();
    ctx.strokeStyle = css(mix(skin, BLACK, 0.35), 0.4);
    ctx.beginPath();
    ctx.moveTo(-0.04, -0.014);
    ctx.quadraticCurveTo(0.008, -0.026, 0.046, -0.002);
    ctx.stroke();
    // Eyebrow: thick over the inner corner, tapering along the ridge to the temple.
    ctx.fillStyle = css(brow, 0.94);
    ctx.beginPath();
    ctx.moveTo(-0.068, 0.05);
    ctx.quadraticCurveTo(-0.01, 0.086, 0.078, 0.058);
    ctx.quadraticCurveTo(0.0, 0.064, -0.064, 0.03);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.save();
  ctx.translate(X(0), Y(0));
  ctx.scale(kx, -ky);
  // Nostrils and the shade under the tip of the nose; the fold from the wing toward the mouth.
  ctx.fillStyle = css(shadow, 0.28);
  ctx.beginPath();
  ctx.ellipse(0, FACE.noseY - 0.012, 0.045, 0.01, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = css(mix(skin, BLACK, 0.78), 0.9);
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(s * 0.026, FACE.noseY - 0.006, 0.013, 0.007, s * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = css(shadow, 0.09);
  ctx.lineWidth = 0.012;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(s * 0.062, FACE.noseY + 0.012);
    ctx.quadraticCurveTo(s * 0.092, FACE.noseY - 0.03, s * 0.098, FACE.mouthY + 0.03);
    ctx.stroke();
  }
  // Lips: the darker upper lip with its bow, the line between, the fuller lower lip catching light.
  const m = FACE.mouthY;
  const lip = mix(skin, dark ? [112, 52, 54] : [168, 84, 84], 0.55);
  ctx.fillStyle = css(mix(lip, BLACK, 0.16));
  ctx.beginPath();
  ctx.moveTo(-0.076, m);
  ctx.quadraticCurveTo(-0.03, m + 0.026, 0, m + 0.016);
  ctx.quadraticCurveTo(0.03, m + 0.026, 0.076, m);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = css(lip);
  ctx.beginPath();
  ctx.moveTo(-0.074, m);
  ctx.quadraticCurveTo(0, m - 0.05, 0.074, m);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.1)";
  ctx.beginPath();
  ctx.ellipse(0, m - 0.014, 0.03, 0.007, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = css(mix(skin, [60, 18, 20], 0.75));
  ctx.lineWidth = 0.006;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-0.08, m + 0.003);
  ctx.quadraticCurveTo(0, m - 0.008, 0.08, m + 0.003);
  ctx.stroke();
  ctx.restore();
}

/** Paint the whole atlas for one person. */
export function paintLook(ctx: Ctx, look: Look): void {
  const seed = look.id || look.seed;
  const kind = look.kind;
  const ump = kind === "umpire";
  const player = !ump && kind !== "coach";
  const jersey = rgb(look.jersey);
  const skin = rgb(look.skin);
  // A club's own set where there is one; otherwise a plain one in the colours given, with
  // lettering that stands off the cloth (navy or white when the team colour would not).
  const club = !ump && look.kit && look.kit.jersey === look.jersey ? look.kit : null;
  const kit: Kit =
    club ??
    (() => {
      const want = look.letter >= 0 && !ump ? rgb(look.letter) : rgb(look.accent);
      const plain = Math.abs(lum(want) - lum(jersey)) > 55 ? want : lum(jersey) > 128 ? ([22, 30, 54] as RGB) : WHITE;
      const hex = (c: RGB) => (Math.round(c[0]) << 16) | (Math.round(c[1]) << 8) | Math.round(c[2]);
      const k = plainKit(look.jersey, hex(plain), look.cap >= 0 ? look.cap : look.accent, look.accent, look.stripe);
      if (lum(jersey) < 215) k.edge = k.numEdge = k.backEdge = lum(plain) > 150 ? 0x141824 : 0xffffff;
      k.cuff = [look.accent];
      k.text = look.team;
      return k;
    })();
  const hue = (c: number): string | null => (c >= 0 ? css(rgb(c)) : null);
  const accent = rgb(kit.accent);
  const pants: RGB = ump ? [66, 69, 76] : mix(rgb(kit.pants), BLACK, 0.035);
  const ink = rgb(kit.ink);
  const outline = ump ? null : hue(kit.edge);
  const hairSet = lum(skin) < 140 ? HAIR_DARK : HAIR_LIGHT;
  const hair = hairSet[Math.floor(hash01(seed, 1) * hairSet.length)];
  const bRoll = hash01(seed, 2);
  const beard = bRoll < 0.34 ? 0 : bRoll < 0.6 ? 1 : bRoll < 0.86 ? 2 : 3;
  const headwear: RGB = ump ? [20, 22, 28] : rgb(kit.cap);
  const under: RGB = club ? mix(rgb(kit.under), BLACK, 0.08) : mix(headwear, BLACK, lum(headwear) > 150 ? 0.75 : 0.12);
  const undershirt = player && hash01(seed, 3) < 0.5;
  const sleeve = undershirt ? under : skin;
  const wRoll = hash01(seed, 4);
  const wrist = player && kind !== "pitcher" && wRoll < 0.45 ? (wRoll < 0.25 ? WHITE : accent) : sleeve;
  const gRoll = hash01(seed, 5);
  const battingGlove: RGB = gRoll < 0.4 ? [238, 238, 234] : gRoll < 0.7 ? [26, 26, 30] : accent;
  const handC = kind === "batter" || kind === "runner" ? battingGlove : skin;
  const leather = LEATHER[Math.floor(hash01(seed, 6) * LEATHER.length)];
  const stripe: RGB | null = !ump && kit.stripe >= 0 ? rgb(kit.stripe) : null;
  const style = styleOf(seed);
  const long = !look.id || style.long;
  const sockStyle = style.sock;
  // Trim follows the team (not the player), so a side looks like one club.
  const placket = ump ? [] : kit.placket;
  const seamPipe = ump ? [] : kit.pipe;
  /** Parallel stripes of braid, `each` texels wide, laid side by side from x. */
  const braid = (colours: number[], x: number, y: number, each: number, len: number, vertical: boolean) => {
    colours.forEach((c, i) => {
      ctx.fillStyle = css(rgb(c));
      if (vertical) ctx.fillRect(x + i * each, y, each, len);
      else ctx.fillRect(x, y + i * each, len, each);
    });
  };
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
    belt: ump ? [18, 18, 20] : club ? mix(rgb(kit.belt), BLACK, 0.3) : mix(headwear, BLACK, 0.35),
    shoe: [24, 24, 27],
    sole: [214, 212, 204],
    hair,
    cap: headwear,
    brim: !ump && kit.bill !== kit.cap ? rgb(kit.bill) : mix(headwear, BLACK, 0.22),
    helmet: headwear,
    glove: leather,
    gloveDark: mix(leather, BLACK, 0.3),
    sleeve,
    wrist,
    hand: handC,
    trim: ump ? jersey : accent,
    gear: ump ? [24, 25, 30] : mix(club ? headwear : accent, BLACK, 0.2),
    gearDark: [28, 29, 33],
    metal: [52, 54, 60],
    buckle: [196, 184, 150],
    collar: ump ? mix(jersey, WHITE, 0.06) : under,
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
    if (placket.length) {
      const each = placket.length > 1 ? 1.7 : 2.6;
      const wide = each * placket.length;
      braid(placket, cx - 12 - wide, 0, each, h, true);
      braid([...placket].reverse(), cx + 12, 0, each, h, true);
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
    // Collar trim following the neckline (the mesh drops the collar in front by NECK_DIP),
    // closing in a short V where the placket starts.
    const edge = (t: number) => ((NECK_DIP * Math.pow(Math.sin(Math.PI * t), 1.5)) / (JERSEY_TOP - JERSEY_HEM)) * h;
    const band = (from: number, to: number) => {
      ctx.beginPath();
      for (let k = 0; k <= 32; k += 1) {
        const t = k / 32;
        const y = edge(t) + from + (t > 0.44 && t < 0.56 ? (1 - Math.abs(t - 0.5) / 0.06) * 7 : 0);
        if (k === 0) ctx.moveTo(t * w, y);
        else ctx.lineTo(t * w, y);
      }
      for (let k = 32; k >= 0; k -= 1) {
        const t = k / 32;
        ctx.lineTo(t * w, edge(t) + to + (t > 0.44 && t < 0.56 ? (1 - Math.abs(t - 0.5) / 0.06) * 7 : 0));
      }
      ctx.closePath();
      ctx.fill();
    };
    ctx.fillStyle = css(ump ? [16, 16, 18] : under);
    band(-12, 1);
    if (ump) {
      ctx.fillStyle = css([16, 16, 18]);
      band(0.5, 4);
    } else {
      const each = kit.collar.length > 1 ? 1.8 : 3;
      kit.collar.forEach((c, i) => {
        ctx.fillStyle = css(rgb(c));
        band(0.5 + i * each, 0.5 + (i + 1) * each);
      });
    }
    ctx.fillStyle = "rgba(0,0,0,0.12)";
    band(5.5, 7.5);
    const darkJersey = lum(jersey) < 120;
    const numInk = hue(kit.num);
    const numEdge = hue(kit.numEdge);
    // Number under the lettering on the wearer's left (or right, for the clubs that wear a crest on the left).
    const number = (y: number) => {
      if (look.num && numInk) label(ctx, look.num, kit.numSide === 1 ? 182 : 78, y, 36, 44, numInk, numEdge);
    };
    const crest = (x: number, y: number, box: number) => {
      const logo = chestLogo(look.teamId, darkJersey);
      if (!logo) return;
      const k = box / Math.max(logo.w, logo.h);
      ctx.drawImage(logo.src, x - (logo.w * k) / 2, y - (logo.h * k) / 2, logo.w * k, logo.h * k);
    };
    const wide = kit.text.length > 8 ? 152 : 132;
    if (ump) {
      // Breast pocket.
      ctx.strokeStyle = css(mix(jersey, WHITE, 0.16));
      ctx.lineWidth = 1.5;
      ctx.strokeRect(162, 78, 34, 36);
    } else if (!club && !look.team) {
      // Nobody's colours: just a number on the wearer's left chest.
      if (look.num) label(ctx, look.num, 178, 98, 40, 46, css(ink), outline);
    } else if (kit.chest === "logo") {
      // Cap mark on the wearer's left chest, the number (if any) opposite.
      crest(178, 104, 52);
      number(kit.numSide === 1 ? 156 : 118);
    } else if (kit.chest === "reds") {
      // The wishbone C with REDS set in its mouth.
      crest(176, 104, 66);
      ctx.fillStyle = "rgb(255,255,255)";
      ctx.fillRect(166, 97.5, 31, 13);
      label(ctx, "REDS", 181.5, 104.5, 13, 28, css(ink), null);
      number(106);
    } else if (kit.chest === "birds") {
      // Two cardinals perched on a bat, the script running across it.
      const navy = outline ?? "rgb(12,35,64)";
      ctx.save();
      ctx.lineCap = "round";
      ctx.strokeStyle = navy;
      ctx.lineWidth = 8.5;
      ctx.beginPath();
      ctx.moveTo(cx - 62, 97);
      ctx.lineTo(cx + 62, 81);
      ctx.stroke();
      ctx.strokeStyle = "rgb(252,214,40)";
      ctx.lineWidth = 5;
      ctx.stroke();
      ctx.restore();
      cardinal(ctx, cx - 40, 76, 1, css(ink), navy);
      cardinal(ctx, cx + 40, 66, -1, css(ink), navy);
      wordmark(ctx, kit.text, cx, 121, 118, css(ink), outline, false);
      number(160);
    } else {
      const mark = kit.chest === "mark" ? chestWordmark(look.teamId, darkJersey) : null;
      if (mark) {
        const k = Math.min(132 / mark.w, 56 / mark.h);
        // Stitched on: the mark sits on a faint shadow of itself.
        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,0.28)";
        ctx.shadowBlur = 2.5;
        ctx.shadowOffsetY = 1.2;
        ctx.drawImage(mark.src, cx - (mark.w * k) / 2, 104 - (mark.h * k) / 2, mark.w * k, mark.h * k);
        ctx.restore();
      } else if (kit.chest === "block" || kit.chest === "arch" || kit.chest === "serif") capitals(ctx, kit.text, cx, 104, wide, css(ink), outline, kit.chest === "arch", kit.chest === "serif");
      else if (kit.text || look.team) wordmark(ctx, kit.text || look.team, cx, 106, 134, css(ink), outline, kit.chest === "mark" || kit.tail);
      if (kit.badge) crest(178, 152, 40);
      number(156);
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
    // The league's silhouetted-batter tag under the collar.
    ctx.fillStyle = "rgb(244,244,240)";
    ctx.fillRect(w / 2 - 7.5, 3, 15, 8.5);
    ctx.fillStyle = "rgb(20,48,120)";
    ctx.fillRect(w / 2 - 6.5, 4, 6, 6.5);
    ctx.fillStyle = "rgb(196,32,44)";
    ctx.fillRect(w / 2 + 0.5, 4, 6, 6.5);
    ctx.fillStyle = "rgb(244,244,240)";
    ctx.beginPath();
    ctx.ellipse(w / 2 - 0.5, 7.4, 2.4, 2.9, -0.3, 0, Math.PI * 2);
    ctx.fill();
    const nameInk = hue(kit.name);
    const named = look.name && nameInk;
    // Names are a single colour unless the cloth is dark enough to need the outline.
    if (named) arcName(ctx, look.name, w / 2, 62, 176, nameInk, lum(jersey) < 120 ? null : !club ? outline : null);
    if (look.num) label(ctx, look.num, w / 2, named ? 148 : 124, named ? 104 : 116, 150, hue(kit.back) ?? css(ink), hue(kit.backEdge));
  });
  inPanel(ctx, PANEL.face, () => face(ctx, skin, hair, beard, kind !== "catcher", seed));

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
    if (seamPipe.length) braid(seamPipe, w / 2 - 3.5, 0, 7 / seamPipe.length, h, true);
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
      // Braid round the sleeve end, the first colour at the hem.
      const each = kit.cuff.length > 1 ? 3.4 : 5;
      braid([...kit.cuff].reverse(), 0, h - 3 - each * kit.cuff.length, each, w, false);
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
    [PANEL.capFront, !ump && kit.capFront >= 0 ? rgb(kit.capFront) : headwear, 0],
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
    const cuff = long ? h : CUFF_AT * h;
    const sock: RGB = ump ? [20, 20, 22] : rgb(kit.sock);
    ctx.fillStyle = css(sock);
    ctx.fillRect(0, 0, w, h);
    if (!long && sockStyle === 1) {
      ctx.fillStyle = !ump && kit.sockBand >= 0 ? css(rgb(kit.sockBand)) : css(lum(sock) > 170 ? [30, 34, 48] : WHITE);
      ctx.fillRect(0, cuff + 14, w, 4);
      ctx.fillRect(0, cuff + 22, w, 4);
      ctx.fillRect(0, cuff + 30, w, 4);
    }
    if (!long && sockStyle === 2) {
      // Stirrups: the white sanitary sock shows in a tall arch at the front and the back of the ankle.
      ctx.fillStyle = css(lum(sock) > 170 ? [226, 226, 222] : [240, 240, 236]);
      for (const cx of [0.25, 0.75]) {
        ctx.beginPath();
        ctx.ellipse(w * cx, h, w * 0.105, h * 0.47, 0, 0, Math.PI * 2);
        ctx.fill();
      }
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
    for (let k = 0; k < (long ? 4 : 3); k++) {
      const y = cuff - 8 - k * (long ? 6 : 9);
      ctx.beginPath();
      ctx.moveTo(w * 0.1, y);
      ctx.quadraticCurveTo(w * 0.4, y + 5, w * 0.9, y - 1);
      ctx.stroke();
    }
    ctx.restore();
    if (seamPipe.length) braid(seamPipe, w / 2 - 3.5, 0, 7 / seamPipe.length, cuff, true);
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
