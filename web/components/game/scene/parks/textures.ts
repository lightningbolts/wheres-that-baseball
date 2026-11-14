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

/** Seat rows: 32 ft × 12 ft tile (16 seats and a stair aisle, 4 rows), tinted by vertex color. */
export function seatTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 96);
  g.fillStyle = "#3c3d40";
  g.fillRect(0, 0, 256, 96);
  for (let r = 0; r < 4; r += 1) {
    for (let k = 0; k < 15; k += 1) {
      const x = 14 + k * 16;
      g.fillStyle = "#b8b8b8";
      g.fillRect(x + 1, r * 24 + 3, 14, 15);
      g.fillStyle = "#f2f2f2";
      g.fillRect(x + 1, r * 24 + 3, 14, 5);
    }
  }
  g.fillStyle = "#8d8f92";
  g.fillRect(0, 0, 12, 96);
  speckle(g, 0, 0, 256, 96, 10, 9);
  return finish(c, true, 8);
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

/** Backstop netting: thin grid with alpha. */
export function netTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(32, 32);
  g.clearRect(0, 0, 32, 32);
  g.strokeStyle = "rgba(20,22,24,0.9)";
  g.lineWidth = 2;
  g.strokeRect(0, 0, 32, 32);
  return finish(c, true, 4);
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
