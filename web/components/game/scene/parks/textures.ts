/**
 * Procedural canvas textures for the ballpark (client only — callers guard for `document`).
 */
import * as THREE from "three";
import type { ParkLayout } from "@/lib/game/data/parkLayouts";
import { TURF_SPAN, TURF_X0, TURF_Z0 } from "@/components/game/scene/fieldGeometry";
import { hash } from "@/components/game/scene/parks/geo";

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!];
}

function finish(c: HTMLCanvasElement, repeat = true, aniso = 4): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}

function speckle(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, amp: number, seed: number): void {
  const img = g.getImageData(x, y, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (hash(i * 0.25 + seed) - 0.5) * amp;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  g.putImageData(img, x, y);
}

/**
 * Wall atlas: 8 rows of 512 × 64 (pad, brick, ivy, monster, board, chain, stone, spare).
 * Tiles horizontally; one tile spans 64 ft of wall.
 */
export function wallAtlas(): THREE.CanvasTexture {
  const [c, g] = canvas(512, 512);
  const row = (i: number) => i * 64;
  // 0 — padding: light panels (tinted by vertex color) with seams every 8 ft.
  g.fillStyle = "#d9d9d9";
  g.fillRect(0, row(0), 512, 64);
  for (let x = 0; x < 512; x += 64) {
    const grad = g.createLinearGradient(x, 0, x + 64, 0);
    grad.addColorStop(0, "rgba(0,0,0,0.28)");
    grad.addColorStop(0.06, "rgba(255,255,255,0.10)");
    grad.addColorStop(0.5, "rgba(255,255,255,0)");
    grad.addColorStop(0.94, "rgba(0,0,0,0.06)");
    grad.addColorStop(1, "rgba(0,0,0,0.28)");
    g.fillStyle = grad;
    g.fillRect(x, row(0), 64, 64);
  }
  // 1 — brick.
  g.fillStyle = "#9c8f84";
  g.fillRect(0, row(1), 512, 64);
  for (let r = 0; r < 8; r += 1) {
    for (let k = -1; k < 32; k += 1) {
      const x = k * 16 + (r % 2 ? 8 : 0);
      const t = hash(r * 40 + k);
      g.fillStyle = `rgb(${132 + t * 34},${62 + t * 22},${46 + t * 16})`;
      g.fillRect(x + 1, row(1) + r * 8 + 1, 14, 6);
    }
  }
  // 2 — ivy.
  g.fillStyle = "#234f24";
  g.fillRect(0, row(2), 512, 64);
  for (let i = 0; i < 2600; i += 1) {
    const t = hash(i * 3.1);
    g.fillStyle = `rgb(${28 + t * 46},${78 + hash(i * 1.7) * 70},${26 + t * 30})`;
    const x = hash(i * 5.3) * 512;
    const y = row(2) + hash(i * 7.9) * 64;
    g.beginPath();
    g.ellipse(x, y, 2.6, 1.8, hash(i) * 3, 0, Math.PI * 2);
    g.fill();
  }
  // 3 — Green Monster: big riveted steel sheets.
  g.fillStyle = "#cfd6cf";
  g.fillRect(0, row(3), 512, 64);
  g.fillStyle = "rgba(0,0,0,0.16)";
  for (let x = 0; x < 512; x += 128) g.fillRect(x, row(3), 2, 64);
  g.fillRect(0, row(3) + 31, 512, 1);
  // 4 — out-of-town scoreboard: dark board with rows of lit cells.
  g.fillStyle = "#0f1a16";
  g.fillRect(0, row(4), 512, 64);
  for (let x = 4; x < 512; x += 64) {
    g.fillStyle = "#16261f";
    g.fillRect(x, row(4) + 6, 56, 52);
    for (let r = 0; r < 2; r += 1) {
      for (let k = 0; k < 6; k += 1) {
        const lit = hash(x * 3 + r * 17 + k) > 0.35;
        g.fillStyle = lit ? (k === 5 ? "#ffd75a" : "#e9efe6") : "#24382f";
        g.fillRect(x + 5 + k * 8, row(4) + 14 + r * 20, 5, 12);
      }
    }
  }
  // 5 — chain link.
  g.fillStyle = "#3a4a40";
  g.fillRect(0, row(5), 512, 64);
  g.strokeStyle = "rgba(200,210,205,0.5)";
  g.lineWidth = 1;
  for (let x = -64; x < 512; x += 8) {
    g.beginPath();
    g.moveTo(x, row(5));
    g.lineTo(x + 64, row(5) + 64);
    g.moveTo(x + 64, row(5));
    g.lineTo(x, row(5) + 64);
    g.stroke();
  }
  // 6 — limestone blocks.
  g.fillStyle = "#b3a78c";
  g.fillRect(0, row(6), 512, 64);
  for (let r = 0; r < 4; r += 1) {
    for (let k = -1; k < 16; k += 1) {
      const x = k * 32 + (r % 2 ? 16 : 0);
      const t = hash(r * 23 + k * 3);
      g.fillStyle = `rgb(${196 + t * 30},${182 + t * 28},${150 + t * 26})`;
      g.fillRect(x + 1, row(6) + r * 16 + 1, 30, 14);
    }
  }
  g.fillStyle = "#808080";
  g.fillRect(0, row(7), 512, 64);
  speckle(g, 0, 0, 512, 448, 16, 3);
  return finish(c, true, 4);
}

/**
 * Seating texture, 64 × 128: the top half is one seat seen from the field (tiles once per
 * seat along a row, tinted by the deck's seat color), the bottom half is bare concrete for
 * treads, aisle steps and walkways.
 */
export const SEAT_V = { seat: [0.515, 0.985], slab: [0.02, 0.48] } as const;

export function seatTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(64, 128);
  // Seat: dark gap, backrest with a top highlight, folded-up seat pan, armrests.
  g.fillStyle = "#17181a";
  g.fillRect(0, 0, 64, 64);
  const back = g.createLinearGradient(0, 3, 0, 40);
  back.addColorStop(0, "#ffffff");
  back.addColorStop(0.12, "#e6e6e6");
  back.addColorStop(1, "#a9a9a9");
  g.fillStyle = back;
  g.beginPath();
  g.roundRect(5, 3, 54, 37, [9, 9, 3, 3]);
  g.fill();
  g.fillStyle = "rgba(0,0,0,0.16)";
  for (const y of [14, 22, 30]) g.fillRect(9, y, 46, 1.5);
  const pan = g.createLinearGradient(0, 41, 0, 58);
  pan.addColorStop(0, "#8d8d8d");
  pan.addColorStop(1, "#5c5c5c");
  g.fillStyle = pan;
  g.beginPath();
  g.roundRect(7, 41, 50, 17, 3);
  g.fill();
  g.fillStyle = "#3c3d40";
  g.fillRect(0, 30, 5, 16);
  g.fillRect(59, 30, 5, 16);
  g.fillStyle = "#2a2b2d";
  g.fillRect(1, 46, 3, 18);
  g.fillRect(60, 46, 3, 18);
  // Concrete slab: light nosing at the front edge (top), darker toward the back.
  const slab = g.createLinearGradient(0, 64, 0, 128);
  slab.addColorStop(0, "#f1f1f1");
  slab.addColorStop(0.12, "#d0d0d0");
  slab.addColorStop(0.7, "#bdbdbd");
  slab.addColorStop(1, "#8f8f8f");
  g.fillStyle = slab;
  g.fillRect(0, 64, 64, 64);
  speckle(g, 0, 64, 64, 64, 14, 9);
  const t = finish(c, true, 8);
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Fine grayscale noise, sampled in world space to break up flat ground colors. */
export function detailTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  const img = g.createImageData(128, 128);
  for (let i = 0; i < 128 * 128; i += 1) {
    const v = 70 + hash(i * 1.37) * 120 + hash(Math.floor(i / 3) * 0.71) * 50;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = Math.min(255, v);
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = finish(c, true, 2);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

/** Whole-field mowing pattern (one 1024² image over the playing surface). */
export function mowTexture(mow: ParkLayout["mow"], turf: boolean): THREE.CanvasTexture {
  const N = 1024;
  const [c, g] = canvas(N, N);
  const k = N / TURF_SPAN;
  const [a, b] = turf ? ["#3b7a3d", "#40823f"] : ["#3d7c38", "#4b8f42"];
  g.fillStyle = a;
  g.fillRect(0, 0, N, N);
  // World (x, z) → canvas: the texture's v axis runs up the canvas.
  g.save();
  g.translate(-TURF_X0 * k, N + TURF_Z0 * k);
  g.scale(k, -k);
  g.fillStyle = b;
  if (mow === "checker") {
    g.rotate(Math.PI / 4);
    const sz = 30;
    for (let i = -24; i < 24; i += 1) for (let j = -24; j < 24; j += 1) if ((i + j) % 2 === 0) g.fillRect(i * sz, j * sz, sz, sz);
  } else if (mow === "stripes") {
    for (let i = -20; i < 20; i += 2) g.fillRect(i * 18, -200, 18, 900);
  } else if (mow === "arcs") {
    for (let r = 720; r > 0; r -= 18) {
      g.fillStyle = Math.round(r / 18) % 2 ? b : a;
      g.beginPath();
      g.arc(0, 0, r, 0, Math.PI * 2);
      g.fill();
    }
  } else {
    // Turf: faint seams between rolls.
    g.fillStyle = "rgba(255,255,255,0.035)";
    for (let i = -20; i < 20; i += 2) g.fillRect(i * 15, -200, 15, 900);
  }
  g.restore();
  const t = finish(c, false, 8);
  return t;
}

/** Backstop netting: a fine, faint mesh with alpha (one tile ≈ 1 ft). */
export function netTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(64, 64);
  g.clearRect(0, 0, 64, 64);
  g.strokeStyle = "rgba(24,26,30,0.95)";
  g.lineWidth = 2.5;
  g.strokeRect(0, 0, 32, 32);
  g.strokeRect(32, 0, 32, 32);
  g.strokeRect(0, 32, 32, 32);
  g.strokeRect(32, 32, 32, 32);
  return finish(c, true, 8);
}

export interface DecalAtlas {
  texture: THREE.CanvasTexture;
  /** UV rect [u0, v0, u1, v1] of numbered cell i. */
  cell(i: number): [number, number, number, number];
  /** UV rect of the manual scoreboard strip. */
  board: [number, number, number, number];
}

/** Painted distance markers plus a hand-operated scoreboard strip. */
export function decalAtlas(numbers: number[], color: string): DecalAtlas {
  const [c, g] = canvas(1024, 256);
  g.clearRect(0, 0, 1024, 256);
  g.font = "bold 54px Arial, Helvetica, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  numbers.slice(0, 8).forEach((n, i) => {
    g.fillStyle = "rgba(0,0,0,0.35)";
    g.fillText(String(Math.round(n)), i * 128 + 66, 34);
    g.fillStyle = color;
    g.fillText(String(Math.round(n)), i * 128 + 64, 32);
  });
  // Manual scoreboard: 1024 × 128.
  const y0 = 96;
  g.fillStyle = "#1c4634";
  g.fillRect(0, y0, 1024, 128);
  g.strokeStyle = "#e9eee6";
  g.lineWidth = 2;
  g.strokeRect(6, y0 + 6, 1012, 116);
  g.font = "bold 20px Arial, Helvetica, sans-serif";
  g.fillStyle = "#e9eee6";
  for (let p = 0; p < 2; p += 1) {
    const x0 = 20 + p * 500;
    for (let r = 0; r < 3; r += 1) {
      const y = y0 + 28 + r * 34;
      g.fillStyle = "#e9eee6";
      if (r > 0) g.fillRect(x0, y - 11, 84, 22);
      for (let k = 0; k < 13; k += 1) {
        const x = x0 + 110 + k * 28;
        if (r === 0) {
          g.fillStyle = "#e9eee6";
          g.fillText(k < 10 ? String(k + 1) : "RHE"[k - 10], x, y);
        } else {
          g.fillStyle = "#10261c";
          g.fillRect(x - 11, y - 12, 22, 24);
          g.fillStyle = k >= 10 ? "#ffd75a" : "#e9eee6";
          const v = Math.floor(hash(p * 91 + r * 13 + k * 7) * (k === 10 ? 9 : k === 11 ? 12 : 3));
          if (hash(k * 3 + r + p) > 0.25 || k >= 10) g.fillText(String(v), x, y + 1);
        }
      }
    }
  }
  const t = finish(c, false, 8);
  return {
    texture: t,
    cell: (i) => [(i * 128) / 1024, 1 - 64 / 256, ((i + 1) * 128) / 1024, 1],
    board: [0, 1 - (y0 + 128) / 256, 1, 1 - y0 / 256],
  };
}

/**
 * Multiply a lit material's color by world-space noise so large flat surfaces (grass,
 * dirt) keep some grain up close without needing tiled UVs.
 */
export function applyWorldDetail(m: THREE.Material, detail: THREE.Texture, scale: number): void {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uDetail = { value: detail };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vWxz;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWxz = (modelMatrix * vec4(transformed, 1.0)).xz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vWxz;\nuniform sampler2D uDetail;")
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        diffuseColor.rgb *= 0.78 + 0.27 * texture2D(uDetail, vWxz * ${scale.toFixed(4)}).r + 0.17 * texture2D(uDetail, vWxz * ${(scale * 0.11).toFixed(4)}).r;`,
      );
  };
}

/** RGBA canvas pixels → mipmapped texture, keeping color under transparent pixels. */
function dataTexture(c: HTMLCanvasElement, img: ImageData, aniso = 4): THREE.DataTexture {
  const { width: w, height: h } = c;
  const out = new Uint8Array(w * h * 4);
  // Canvas rows run top-down, texture rows bottom-up.
  for (let y = 0; y < h; y += 1) out.set(img.data.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
  const t = new THREE.DataTexture(out, w, h, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

/** Crowd sprite atlas layout: 8 × 6 cells; the last row holds the cheering poses. */
export const CROWD = { cols: 8, rows: 6, seated: 40, cw: 128, ch: 170, size: 1024 } as const;

const SKINS: Array<[string, string]> = [
  ["#f3cfb0", "#cf9f7c"],
  ["#eac09a", "#c08f68"],
  ["#d9a77c", "#ab7a52"],
  ["#bd8558", "#8c5c38"],
  ["#93613d", "#6b4226"],
  ["#6e4529", "#4c2d19"],
];
const HAIRS = ["#231a14", "#2e2019", "#4a3222", "#6f4b2c", "#a37a44", "#d2b06a", "#8a4a2b", "#c9bfae", "#3a2a22"];

/** One fan, waist-up, in a 128 × 170 cell. Clothes are pure greys: the shader tints them. */
function drawFan(g: CanvasRenderingContext2D, rnd: () => number, cheer: boolean): void {
  const cx = 64 + (rnd() - 0.5) * 6;
  const [skin, skinDark] = SKINS[Math.floor(rnd() * SKINS.length)];
  const hair = HAIRS[Math.floor(rnd() * HAIRS.length)];
  const light = rnd() < 0.62;
  const L = light ? 0.74 + rnd() * 0.22 : 0.3 + rnd() * 0.26;
  const grey = (k: number) => {
    const v = Math.max(0, Math.min(255, Math.round(L * k * 255)));
    return `rgb(${v},${v},${v})`;
  };
  const female = rnd() < 0.42;
  const sw = (female ? 33 : 38) + rnd() * 7;
  const hr = 15 + rnd() * 2.5;
  const hry = hr * 1.2;
  const headY = 60 + rnd() * 5;
  const shY = headY + hry + 8;
  const longSleeve = rnd() < 0.3;
  const outline = "rgba(8,10,14,0.6)";
  g.lineJoin = "round";
  g.lineCap = "round";

  const hairStyle = rnd();
  const cap = rnd() < 0.38;
  // Long hair falls behind the shoulders.
  if (female && hairStyle < 0.7) {
    g.fillStyle = hair;
    g.beginPath();
    g.ellipse(cx, headY + 8, hr + 6, hry + 16, 0, 0, Math.PI * 2);
    g.fill();
  }

  const arm = (side: number) => {
    const sx = cx + side * (sw - 7);
    if (cheer) {
      const ex = cx + side * (sw + 10 + rnd() * 6);
      const ey = shY - 22 - rnd() * 8;
      const hx = cx + side * (sw - 4 + rnd() * 18);
      const hy = 15 + rnd() * 14;
      g.strokeStyle = outline;
      g.lineWidth = 17;
      g.beginPath();
      g.moveTo(sx, shY + 8);
      g.lineTo(ex, ey);
      g.lineTo(hx, hy);
      g.stroke();
      g.strokeStyle = longSleeve ? grey(0.86) : skin;
      g.lineWidth = 13;
      g.beginPath();
      g.moveTo(ex, ey);
      g.lineTo(hx, hy);
      g.stroke();
      g.strokeStyle = grey(0.86);
      g.lineWidth = 14;
      g.beginPath();
      g.moveTo(sx, shY + 8);
      g.lineTo(ex, ey);
      g.stroke();
      g.fillStyle = skin;
      g.beginPath();
      g.arc(hx, hy - 2, 7.5, 0, Math.PI * 2);
      g.fill();
    } else {
      const x = cx + side * (sw - 6);
      g.strokeStyle = outline;
      g.lineWidth = 17;
      g.beginPath();
      g.moveTo(x, shY + 12);
      g.lineTo(x + side * 3, 176);
      g.stroke();
      g.strokeStyle = longSleeve ? grey(0.8) : skinDark;
      g.lineWidth = 13;
      g.beginPath();
      g.moveTo(x + side * 1.5, shY + 40);
      g.lineTo(x + side * 3, 176);
      g.stroke();
      g.strokeStyle = grey(0.8);
      g.lineWidth = 14;
      g.beginPath();
      g.moveTo(x, shY + 12);
      g.lineTo(x + side * 1.5, shY + 40);
      g.stroke();
    }
  };
  if (cheer) {
    arm(-1);
    arm(1);
  }

  // Torso.
  const torso = new Path2D();
  torso.moveTo(cx - sw + 5, 174);
  torso.lineTo(cx - sw, shY + 14);
  torso.quadraticCurveTo(cx - sw + 1, shY + 1, cx - sw + 14, shY - 2);
  torso.lineTo(cx - 9, shY - 7);
  torso.lineTo(cx + 9, shY - 7);
  torso.lineTo(cx + sw - 14, shY - 2);
  torso.quadraticCurveTo(cx + sw - 1, shY + 1, cx + sw, shY + 14);
  torso.lineTo(cx + sw - 5, 174);
  torso.closePath();
  const body = g.createLinearGradient(0, shY - 6, 0, 172);
  body.addColorStop(0, grey(1.06));
  body.addColorStop(0.25, grey(0.96));
  body.addColorStop(1, grey(0.68));
  g.fillStyle = body;
  g.fill(torso);
  g.save();
  g.clip(torso);
  const side = g.createLinearGradient(cx - sw, 0, cx + sw, 0);
  side.addColorStop(0, "rgba(0,0,0,0.26)");
  side.addColorStop(0.3, "rgba(0,0,0,0)");
  side.addColorStop(0.8, "rgba(255,255,255,0.06)");
  side.addColorStop(1, "rgba(0,0,0,0.14)");
  g.fillStyle = side;
  g.fillRect(0, 0, 128, 176);
  const style = rnd();
  if (style < 0.22) {
    // Jersey: placket and a chest wordmark band.
    g.fillStyle = light ? "rgba(0,0,0,0.3)" : "rgba(255,255,255,0.5)";
    g.fillRect(cx - 1, shY, 2, 90);
    g.fillRect(cx - sw * 0.55, shY + 22, sw * 1.1, 7);
  } else if (style < 0.36) {
    // Hoodie / jacket: zipper and a darker hem.
    g.fillStyle = "rgba(0,0,0,0.34)";
    g.fillRect(cx - 1.5, shY + 4, 3, 90);
    g.fillRect(cx - sw, shY + 58, sw * 2, 30);
  } else if (style < 0.5) {
    // Horizontal stripes.
    g.fillStyle = light ? "rgba(0,0,0,0.22)" : "rgba(255,255,255,0.25)";
    for (let y = shY + 10; y < 176; y += 14) g.fillRect(cx - sw, y, sw * 2, 5);
  } else if (style < 0.62) {
    // Big chest graphic.
    g.fillStyle = light ? "rgba(0,0,0,0.3)" : "rgba(255,255,255,0.55)";
    g.beginPath();
    g.ellipse(cx, shY + 34, sw * 0.42, 12, 0, 0, Math.PI * 2);
    g.fill();
  }
  // Shadow under the chin.
  const chin = g.createRadialGradient(cx, shY - 4, 2, cx, shY - 2, 24);
  chin.addColorStop(0, "rgba(0,0,0,0.36)");
  chin.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = chin;
  g.fillRect(cx - 30, shY - 10, 60, 36);
  g.restore();
  g.strokeStyle = outline;
  g.lineWidth = 2.2;
  g.stroke(torso);

  if (!cheer) {
    arm(-1);
    arm(1);
    if (rnd() < 0.16) {
      // A drink held at the chest.
      const dx = cx + (rnd() < 0.5 ? -1 : 1) * (sw * 0.42);
      g.fillStyle = skin;
      g.beginPath();
      g.arc(dx, shY + 50, 8, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = rnd() < 0.5 ? "#c93a34" : "#e9e2cf";
      g.strokeStyle = outline;
      g.lineWidth = 1.5;
      g.beginPath();
      g.roundRect(dx - 6.5, shY + 28, 13, 22, 2);
      g.fill();
      g.stroke();
    }
  }

  // Neck and collar.
  g.fillStyle = skinDark;
  g.fillRect(cx - 7.5, headY + hry - 6, 15, shY - headY - hry + 4);
  if (style > 0.62 && style < 0.82) {
    g.fillStyle = skin;
    g.beginPath();
    g.moveTo(cx - 8, shY - 6);
    g.lineTo(cx + 8, shY - 6);
    g.lineTo(cx, shY + 11);
    g.closePath();
    g.fill();
  } else {
    g.strokeStyle = grey(0.72);
    g.lineWidth = 3;
    g.beginPath();
    g.arc(cx, shY - 9, 10, 0.25, Math.PI - 0.25);
    g.stroke();
  }

  // Head.
  g.fillStyle = skinDark;
  g.beginPath();
  g.ellipse(cx - hr, headY + 2, 3.2, 5, 0, 0, Math.PI * 2);
  g.ellipse(cx + hr, headY + 2, 3.2, 5, 0, 0, Math.PI * 2);
  g.fill();
  const face = g.createRadialGradient(cx + 4, headY - 6, 3, cx, headY, hry * 1.15);
  face.addColorStop(0, skin);
  face.addColorStop(0.7, skin);
  face.addColorStop(1, skinDark);
  g.fillStyle = face;
  g.strokeStyle = outline;
  g.lineWidth = 2;
  g.beginPath();
  g.ellipse(cx, headY, hr, hry, 0, 0, Math.PI * 2);
  g.fill();
  g.stroke();

  // Hair or cap.
  if (cap) {
    const capL = rnd() < 0.5 ? 1.1 : 0.62;
    g.fillStyle = grey(capL);
    g.strokeStyle = outline;
    g.beginPath();
    g.ellipse(cx, headY - hry * 0.36, hr + 1.5, hry * 0.74, 0, Math.PI, Math.PI * 2);
    g.closePath();
    g.fill();
    g.stroke();
    g.fillStyle = grey(capL * 0.74);
    g.beginPath();
    g.ellipse(cx, headY - hry * 0.34, hr + 5, 5.2, 0, 0, Math.PI);
    g.closePath();
    g.fill();
    g.stroke();
  } else if (hairStyle < 0.9 || female) {
    g.fillStyle = hair;
    g.beginPath();
    g.ellipse(cx, headY - hry * 0.3, hr + 1.2, hry * 0.82, 0, Math.PI * 1.02, Math.PI * 1.98);
    g.quadraticCurveTo(cx + hr * 0.3, headY - hry * 0.42, cx, headY - hry * 0.5);
    g.quadraticCurveTo(cx - hr * 0.5, headY - hry * 0.36, cx - hr - 1, headY - hry * 0.2);
    g.closePath();
    g.fill();
  }

  // Face: eyes or sunglasses, mouth.
  const eyeY = headY + 1;
  if (rnd() < 0.3) {
    g.fillStyle = "#15171b";
    g.beginPath();
    g.roundRect(cx - hr * 0.72, eyeY - 3.6, hr * 0.62, 6.4, 2);
    g.roundRect(cx + hr * 0.1, eyeY - 3.6, hr * 0.62, 6.4, 2);
    g.fill();
    g.fillRect(cx - hr * 0.72, eyeY - 2.4, hr * 1.44, 1.6);
  } else {
    g.fillStyle = "#1c1612";
    g.beginPath();
    g.arc(cx - hr * 0.4, eyeY, 1.9, 0, Math.PI * 2);
    g.arc(cx + hr * 0.4, eyeY, 1.9, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = "rgba(70,28,22,0.75)";
  g.lineWidth = 1.8;
  g.beginPath();
  if (cheer) {
    g.fillStyle = "#5a1f1c";
    g.ellipse(cx, headY + hry * 0.52, 4.4, 3.6, 0, 0, Math.PI * 2);
    g.fill();
  } else {
    g.arc(cx, headY + hry * 0.36, 5.5, 0.25 * Math.PI, 0.75 * Math.PI);
    g.stroke();
  }
}

/**
 * Sprite atlas of fans for the instanced crowd. Transparent texels carry the cell's mean
 * color so distant (mipmapped) fans blur into soft blobs instead of dark-fringed confetti.
 */
export function crowdAtlas(): THREE.DataTexture {
  const { cols, rows, cw, ch, size, seated } = CROWD;
  const [c, g] = canvas(size, size);
  let seed = 20251;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < cols * rows; i += 1) {
    g.save();
    g.translate((i % cols) * cw, Math.floor(i / cols) * ch);
    g.beginPath();
    g.rect(2, 2, cw - 4, ch - 3);
    g.clip();
    drawFan(g, rnd, i >= seated);
    g.restore();
  }
  const img = g.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < cols * rows; i += 1) {
    const x0 = (i % cols) * cw;
    const y0 = Math.floor(i / cols) * ch;
    let r = 0;
    let gg = 0;
    let b = 0;
    let n = 0;
    for (let y = y0; y < y0 + ch; y += 1) {
      for (let x = x0; x < x0 + cw; x += 1) {
        const k = (y * size + x) * 4;
        if (d[k + 3] > 200) {
          r += d[k];
          gg += d[k + 1];
          b += d[k + 2];
          n += 1;
        }
      }
    }
    n = Math.max(1, n);
    for (let y = y0; y < y0 + ch; y += 1) {
      for (let x = x0; x < x0 + cw; x += 1) {
        const k = (y * size + x) * 4;
        if (d[k + 3] < 10) {
          d[k] = r / n;
          d[k + 1] = gg / n;
          d[k + 2] = b / n;
          d[k + 3] = 0;
        }
      }
    }
  }
  return dataTexture(c, img, 4);
}

/** Rows of the signage atlas (1024 × 256, four 64 px rows): [v0, v1] and feet per tile. */
export const LED_ROW = {
  ribbon: { v: [0.765, 0.985], ft: 110 },
  backstop: { v: [0.515, 0.735], ft: 72 },
  suites: { v: [0.265, 0.485], ft: 96 },
  lamps: { v: [0.015, 0.235], ft: 32 },
} as const;

/** Self-lit signage: ribbon boards, the backstop ad board, suite windows and lamp racks. */
export function ledAtlas(lit: boolean): THREE.CanvasTexture {
  const [c, g] = canvas(1024, 256);
  g.textBaseline = "middle";
  g.textAlign = "center";
  // Ribbon board (tinted by the home color): messages between block graphics.
  g.fillStyle = "#070b14";
  g.fillRect(0, 0, 1024, 64);
  const words = ["PLAY BALL", "MAKE SOME NOISE", "WHERE'S THAT BASEBALL", "LET'S GO"];
  let x = 0;
  words.forEach((w, i) => {
    const span = i === 2 ? 330 : i === 1 ? 262 : 216;
    g.fillStyle = i % 2 ? "#ffffff" : "#0d1526";
    g.fillRect(x + 4, 8, span - 8, 48);
    g.fillStyle = i % 2 ? "#0a0f1c" : "#ffffff";
    g.font = "bold 34px Arial, Helvetica, sans-serif";
    g.save();
    g.translate(x + span / 2, 34);
    g.scale(Math.min(0.62, (span - 30) / g.measureText(w).width), 1);
    g.fillText(w, 0, 0);
    g.restore();
    g.fillStyle = "#ffd75a";
    g.fillRect(x, 8, 3, 48);
    x += span;
  });
  g.fillStyle = "rgba(0,0,0,0.22)";
  for (let y = 1; y < 64; y += 3) g.fillRect(0, y, 1024, 1);
  // Backstop board: dark green with quiet white wordmarks (easy on the hitter's eye).
  g.fillStyle = "#0f3526";
  g.fillRect(0, 64, 1024, 64);
  g.strokeStyle = "rgba(255,255,255,0.5)";
  g.lineWidth = 2;
  for (let i = 0; i < 4; i += 1) {
    g.strokeRect(i * 256 + 6, 72, 244, 48);
    g.fillStyle = i % 2 ? "#f2f4ee" : "#ffd75a";
    g.font = "bold 30px Arial, Helvetica, sans-serif";
    g.save();
    g.translate(i * 256 + 128, 97);
    g.scale(0.58, 1);
    g.fillText(i % 2 ? "WHERE'S THAT BASEBALL" : "PLAY BALL", 0, 0);
    g.restore();
  }
  // Suite level: glazed bays, most with warm interior light.
  g.fillStyle = "#1a2029";
  g.fillRect(0, 128, 1024, 64);
  for (let i = 0; i < 16; i += 1) {
    const on = hash(i * 3.7 + 1) > (lit ? 0.22 : 0.5);
    const grad = g.createLinearGradient(0, 138, 0, 184);
    if (on) {
      grad.addColorStop(0, lit ? "#ffe2ae" : "#b9a888");
      grad.addColorStop(1, lit ? "#b98447" : "#6f6250");
    } else {
      grad.addColorStop(0, "#5b7187");
      grad.addColorStop(1, "#2c3a49");
    }
    g.fillStyle = grad;
    g.fillRect(i * 64 + 3, 138, 58, 46);
    g.fillStyle = "rgba(10,14,20,0.8)";
    g.fillRect(i * 64 + 31, 138, 2, 46);
    if (on) {
      // People at the rail.
      g.fillStyle = "rgba(30,24,20,0.6)";
      for (let k = 0; k < 3; k += 1) {
        if (hash(i * 9.1 + k) < 0.4) continue;
        const px = i * 64 + 12 + k * 18;
        g.beginPath();
        g.arc(px, 168, 4, 0, Math.PI * 2);
        g.fill();
        g.fillRect(px - 5, 172, 10, 12);
      }
    }
  }
  // Floodlight rack: a row of four lamps per tile, each a reflector with a hot centre.
  g.fillStyle = "#1b1e23";
  g.fillRect(0, 192, 1024, 64);
  for (let i = 0; i < 16; i += 1) {
    const cx = i * 64 + 32;
    const lamp = g.createRadialGradient(cx, 224, 2, cx, 224, 27);
    if (lit) {
      lamp.addColorStop(0, "#ffffff");
      lamp.addColorStop(0.55, "#fffbe8");
      lamp.addColorStop(0.8, "#e8dcae");
      lamp.addColorStop(1, "#4a4638");
    } else {
      lamp.addColorStop(0, "#e9edf0");
      lamp.addColorStop(0.5, "#b9c0c6");
      lamp.addColorStop(0.85, "#7d858c");
      lamp.addColorStop(1, "#2c3035");
    }
    g.fillStyle = lamp;
    g.beginPath();
    g.arc(cx, 224, 27, 0, Math.PI * 2);
    g.fill();
  }
  const t = finish(c, true, 8);
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Feet per window column / floor in the city texture (32 × 32 windows per tile). */
export const CITY_CELL = { w: 11, h: 12.5, n: 32 } as const;

/**
 * Building facades: a grid of windows on a pale wall, multiplied by each building's color.
 * At night the wall goes dark and a scattering of windows is lit.
 */
export function cityTexture(lit: boolean): THREE.CanvasTexture {
  const n = CITY_CELL.n;
  const px = 8;
  const [c, g] = canvas(n * px, n * px);
  g.fillStyle = lit ? "#2a2f3a" : "#ffffff";
  g.fillRect(0, 0, n * px, n * px);
  for (let j = 0; j < n; j += 1) {
    // Whole floors are sometimes dark or fully lit, like real offices.
    const floor = hash(j * 13.7 + 3);
    for (let i = 0; i < n; i += 1) {
      const r = hash(i * 7.31 + j * 3.17 + 11);
      if (lit) {
        const on = r < (floor > 0.93 ? 0.45 : floor < 0.3 ? 0.02 : 0.1);
        const warm = hash(i * 1.7 + j * 9.3) < 0.7;
        g.fillStyle = on ? (warm ? "#e8bf86" : "#b9cbe6") : "#222733";
        g.globalAlpha = on ? 0.3 + 0.5 * hash(i + j * 31.1) : 1;
      } else {
        const v = 150 + Math.round(r * 50);
        g.fillStyle = `rgb(${v - 30},${v - 8},${v + 14})`;
      }
      g.fillRect(i * px + 2, j * px + 2, px - 3, px - 4);
      g.globalAlpha = 1;
    }
  }
  return finish(c, true, 8);
}

/** Soft radial glare for floodlight banks (additive). */
export function flareTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,250,235,1)");
  grad.addColorStop(0.12, "rgba(255,246,222,0.55)");
  grad.addColorStop(0.4, "rgba(255,240,205,0.14)");
  grad.addColorStop(1, "rgba(255,236,200,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return finish(c, false, 1);
}

/** Feet of world one tile of the surroundings texture covers. */
export const BLOCKS_FT = 1280;

/** City blocks seen from the upper deck: streets, roofs, lots and a few green squares. */
export function blocksTexture(lit = false): THREE.CanvasTexture {
  const n = 8;
  const px = 32;
  const [c, g] = canvas(n * px, n * px);
  g.fillStyle = "#70736f";
  g.fillRect(0, 0, n * px, n * px);
  const roofs = ["#9a968c", "#8b8f93", "#a59c8e", "#7f858a", "#93897d", "#888c84"];
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const r = hash(i * 5.3 + j * 11.9 + 2);
      const x = i * px + 3;
      const y = j * px + 3;
      const w = px - 6;
      if (r < 0.2) {
        // Park: lawn with tree blobs.
        g.fillStyle = "#5f8556";
        g.fillRect(x, y, w, w);
        g.fillStyle = "#44703f";
        for (let k = 0; k < 7; k += 1) {
          g.beginPath();
          g.arc(x + 3 + hash(k * 3.1 + r * 40) * (w - 6), y + 3 + hash(k * 7.7 + r * 90) * (w - 6), 2.6, 0, Math.PI * 2);
          g.fill();
        }
      } else if (r < 0.38) {
        // Parking lot: rows of cars.
        g.fillStyle = "#62666a";
        g.fillRect(x, y, w, w);
        for (let row = 0; row < 4; row += 1) {
          for (let k = 0; k < 11; k += 1) {
            const v = hash(k * 1.9 + row * 5.7 + r * 60);
            if (v < 0.25) continue;
            g.fillStyle = v < 0.5 ? "#c9ccd0" : v < 0.7 ? "#3b3f46" : v < 0.85 ? "#8d2f2f" : "#35518a";
            g.fillRect(x + 1.5 + k * 2.2, y + 2 + row * 6.3, 1.3, 2.6);
          }
        }
      } else {
        // Buildings: two or three roofs per block.
        const split = 0.35 + 0.3 * hash(r * 77);
        const parts: Array<[number, number, number, number]> = hash(r * 31) < 0.5 ? [[0, 0, split, 1], [split, 0, 1 - split, 1]] : [[0, 0, 1, split], [0, split, 0.5, 1 - split], [0.5, split, 0.5, 1 - split]];
        parts.forEach(([a, b, cw, ch], k) => {
          g.fillStyle = roofs[Math.floor(hash(r * 13 + k * 3.7) * roofs.length)];
          g.fillRect(x + a * w + 0.5, y + b * w + 0.5, cw * w - 1, ch * w - 1);
          g.fillStyle = "rgba(0,0,0,0.16)";
          g.fillRect(x + a * w + 0.5, y + (b + ch) * w - 2, cw * w - 1, 1.5);
        });
      }
    }
  }
  if (lit) {
    // Night: the blocks sink into the dark, streets and lots glow with lamps, some roofs
    // carry lit skylights.
    g.fillStyle = "rgba(8,12,24,0.66)";
    g.fillRect(0, 0, n * px, n * px);
    for (let j = 0; j < n; j += 1) {
      for (let i = 0; i < n; i += 1) {
        const r = hash(i * 5.3 + j * 11.9 + 2);
        for (let k = 0; k < 4; k += 1) {
          for (const [x, y] of [[i * px + k * 8 + 4, j * px + 1.5], [i * px + 1.5, j * px + k * 8 + 4]]) {
            const glow = g.createRadialGradient(x, y, 0, x, y, 3.2);
            glow.addColorStop(0, "rgba(255,214,150,0.95)");
            glow.addColorStop(1, "rgba(255,190,110,0)");
            g.fillStyle = glow;
            g.fillRect(x - 3.2, y - 3.2, 6.4, 6.4);
          }
        }
        if (r >= 0.2 && r < 0.38) {
          g.fillStyle = "rgba(255,236,200,0.2)";
          g.fillRect(i * px + 3, j * px + 3, px - 6, px - 6);
        } else if (r >= 0.38) {
          for (let k = 0; k < 5; k += 1) {
            if (hash(r * 91 + k * 7.7) < 0.5) continue;
            g.fillStyle = hash(k + r * 13) < 0.5 ? "rgba(255,221,160,0.9)" : "rgba(190,215,255,0.8)";
            g.fillRect(i * px + 5 + hash(k * 3.3 + r * 50) * (px - 12), j * px + 5 + hash(k * 5.9 + r * 70) * (px - 12), 1.6, 1.2);
          }
        }
      }
    }
  }
  return finish(c, true, 8);
}
