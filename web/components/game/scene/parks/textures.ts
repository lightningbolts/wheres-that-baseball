/**
 * Procedural canvas textures for the ballpark (client only — callers guard for `document`).
 */
import * as THREE from "three";
import type { ParkLayout } from "@/lib/game/data/parkLayouts";
import { infieldOutline, TURF_SPAN, TURF_X0, TURF_Z0 } from "@/components/game/scene/fieldGeometry";
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
 * Seating texture, 64 × 256, four bands (top to bottom): one seat seen from the field (tiles
 * once per seat along a row, tinted by the deck's seat color), the same seat's pan and
 * armrests seen from above, bare concrete for treads and walkways, and aisle steps with a
 * painted safety nosing.
 */
export const SEAT_V = { seat: [0.757, 0.993], pan: [0.508, 0.742], slab: [0.26, 0.49], step: [0.012, 0.238] } as const;

export function seatTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(64, 256);
  // Seat from the front: dark gap, slatted backrest with a top highlight, pan, armrests.
  g.fillStyle = "#15161a";
  g.fillRect(0, 0, 64, 64);
  const back = g.createLinearGradient(0, 2, 0, 44);
  back.addColorStop(0, "#ffffff");
  back.addColorStop(0.1, "#ececec");
  back.addColorStop(0.55, "#c4c4c4");
  back.addColorStop(1, "#9d9d9d");
  g.fillStyle = back;
  g.beginPath();
  g.roundRect(5, 2, 54, 40, [10, 10, 3, 3]);
  g.fill();
  g.fillStyle = "rgba(0,0,0,0.15)";
  for (const y of [12, 20, 28, 36]) g.fillRect(9, y, 46, 1.4);
  g.fillStyle = "rgba(255,255,255,0.35)";
  g.fillRect(12, 4, 40, 1.5);
  const pan = g.createLinearGradient(0, 43, 0, 60);
  pan.addColorStop(0, "#8d8d8d");
  pan.addColorStop(1, "#565656");
  g.fillStyle = pan;
  g.beginPath();
  g.roundRect(7, 43, 50, 16, 3);
  g.fill();
  g.fillStyle = "#3c3d40";
  g.fillRect(0, 30, 5, 16);
  g.fillRect(59, 30, 5, 16);
  g.fillStyle = "#2a2b2d";
  g.fillRect(1, 46, 3, 18);
  g.fillRect(60, 46, 3, 18);
  // Seat from above: the pan (front edge at the bottom of the band), armrests either side.
  g.fillStyle = "#1b1c20";
  g.fillRect(0, 64, 64, 64);
  const top = g.createLinearGradient(0, 66, 0, 126);
  top.addColorStop(0, "#b9b9b9");
  top.addColorStop(0.25, "#e2e2e2");
  top.addColorStop(0.8, "#f6f6f6");
  top.addColorStop(1, "#cfcfcf");
  g.fillStyle = top;
  g.beginPath();
  g.roundRect(7, 68, 50, 56, [4, 4, 12, 12]);
  g.fill();
  g.fillStyle = "rgba(0,0,0,0.1)";
  g.fillRect(12, 84, 40, 1.5);
  g.fillRect(12, 100, 40, 1.5);
  g.fillStyle = "#36373b";
  g.fillRect(0, 70, 4, 44);
  g.fillRect(60, 70, 4, 44);
  // Concrete slab: light nosing at the front edge (top), darker toward the back.
  const slab = g.createLinearGradient(0, 128, 0, 192);
  slab.addColorStop(0, "#f1f1f1");
  slab.addColorStop(0.12, "#cfcfcf");
  slab.addColorStop(0.7, "#b9b9b9");
  slab.addColorStop(1, "#8c8c8c");
  g.fillStyle = slab;
  g.fillRect(0, 128, 64, 64);
  speckle(g, 0, 128, 64, 64, 14, 9);
  // Aisle steps: two risers per row, each with a yellow nosing.
  for (let k = 0; k < 2; k += 1) {
    const y = 192 + k * 32;
    const st = g.createLinearGradient(0, y, 0, y + 32);
    st.addColorStop(0, "#e8c53a");
    st.addColorStop(0.16, "#e0bb30");
    st.addColorStop(0.17, "#b4b4b4");
    st.addColorStop(1, "#7d7d7d");
    g.fillStyle = st;
    g.fillRect(0, y, 64, 32);
  }
  speckle(g, 0, 192, 64, 64, 10, 5);
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

/** Whole-field mowing pattern and grass detail (one 2048² image over the playing surface). */
export function mowTexture(mow: ParkLayout["mow"], turf: boolean): THREE.CanvasTexture {
  const N = 2048;
  const [c, g] = canvas(N, N);
  const k = N / TURF_SPAN;
  const [a, b] = turf ? ["#3a783c", "#3f803e"] : ["#3a7836", "#4c9143"];
  g.fillStyle = a;
  g.fillRect(0, 0, N, N);
  // World (x, z) → canvas: the texture's v axis runs up the canvas.
  g.save();
  g.translate(-TURF_X0 * k, N + TURF_Z0 * k);
  g.scale(k, -k);
  g.fillStyle = b;
  const infield = () => {
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(63.64, 63.64);
    g.lineTo(0, 127.28);
    g.lineTo(-63.64, 63.64);
    g.closePath();
  };
  if (mow === "checker") {
    g.rotate(Math.PI / 4);
    const sz = 30;
    for (let i = -24; i < 24; i += 1) for (let j = -24; j < 24; j += 1) if ((i + j) % 2 === 0) g.fillRect(i * sz, j * sz, sz, sz);
    g.rotate(-Math.PI / 4);
  } else if (mow === "stripes") {
    for (let i = -20; i < 20; i += 2) g.fillRect(i * 18, -200, 18, 900);
    // The infield is cut on the diagonal, in narrower passes.
    g.save();
    infield();
    g.clip();
    g.fillStyle = a;
    g.fillRect(-100, -10, 200, 150);
    g.rotate(Math.PI / 4);
    g.fillStyle = b;
    for (let i = -12; i < 24; i += 2) g.fillRect(i * 9, -200, 9, 500);
    g.restore();
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
  // Uneven growth and wear: soft light and dark patches, worn spots where fielders stand.
  let seed = 77;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 260; i += 1) {
    const x = TURF_X0 + rnd() * TURF_SPAN;
    const z = TURF_Z0 + rnd() * TURF_SPAN;
    const r = 14 + rnd() * 46;
    const gr = g.createRadialGradient(x, z, 0, x, z, r);
    const dark = rnd() < 0.5;
    gr.addColorStop(0, dark ? "rgba(18,52,20,0.10)" : "rgba(190,225,120,0.07)");
    gr.addColorStop(1, dark ? "rgba(18,52,20,0)" : "rgba(190,225,120,0)");
    g.fillStyle = gr;
    g.fillRect(x - r, z - r, r * 2, r * 2);
  }
  if (!turf) {
    for (const [x, z, r] of [[-150, 235, 13], [0, 305, 14], [150, 235, 13], [-38, 148, 9], [38, 148, 9]] as const) {
      const gr = g.createRadialGradient(x, z, 0, x, z, r);
      gr.addColorStop(0, "rgba(150,140,80,0.2)");
      gr.addColorStop(1, "rgba(150,140,80,0)");
      g.fillStyle = gr;
      g.fillRect(x - r, z - r, r * 2, r * 2);
    }
  }
  // Grass lips: a darker, thicker edge wherever turf meets dirt.
  g.lineJoin = "round";
  const lip = (w: number, style: string) => {
    g.strokeStyle = style;
    g.lineWidth = w;
    const out = infieldOutline();
    g.beginPath();
    out.forEach(([x, z], i) => (i ? g.lineTo(x, z) : g.moveTo(x, z)));
    g.closePath();
    g.stroke();
    g.beginPath();
    g.moveTo(0, 4 * Math.SQRT2);
    g.lineTo(41 * Math.SQRT2, 45 * Math.SQRT2);
    g.lineTo(0, 86 * Math.SQRT2);
    g.lineTo(-41 * Math.SQRT2, 45 * Math.SQRT2);
    g.closePath();
    g.stroke();
    for (const [x, z, r] of [[0, 0, 13], [63.64, 63.64, 9], [0, 127.28, 9], [-63.64, 63.64, 9], [0, 60.5, 9]] as const) {
      g.beginPath();
      g.arc(x, z, r, 0, Math.PI * 2);
      g.stroke();
    }
  };
  lip(3.4, "rgba(24,62,24,0.1)");
  lip(2.2, turf ? "rgba(24,62,24,0.3)" : "rgba(22,58,22,0.6)");
  g.restore();
  // Blade grain.
  const img = g.getImageData(0, 0, N, N);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * 16;
    d[i] += n * 0.6;
    d[i + 1] += n;
    d[i + 2] += n * 0.5;
  }
  g.putImageData(img, 0, 0);
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
  /** UV rect of the out-of-town (AL / NL) hand-turned board strip. */
  outOfTown: [number, number, number, number];
}

const AL_GAMES: Array<[string, string]> = [["NYY", "BOS"], ["TOR", "BAL"], ["TB", "CLE"], ["DET", "MIN"], ["KC", "CWS"], ["HOU", "TEX"]];
const NL_GAMES: Array<[string, string]> = [["NYM", "PHI"], ["ATL", "MIA"], ["WSH", "PIT"], ["CHC", "STL"], ["MIL", "CIN"], ["LAD", "SF"]];

/**
 * T-Mobile Park's out-of-town board: dark green steel, cream stencil type, a slot for
 * each game's inning and each club's runs, hung by hand from the catwalk behind it.
 */
function drawOutOfTown(g: CanvasRenderingContext2D, y0: number, h: number): void {
  const cream = "#ece6d2";
  g.fillStyle = "#173a2d";
  g.fillRect(0, y0, 1024, h);
  g.strokeStyle = cream;
  g.lineWidth = 2;
  g.strokeRect(4, y0 + 4, 1016, h - 8);
  g.beginPath();
  g.moveTo(512, y0 + 4);
  g.lineTo(512, y0 + h - 4);
  g.stroke();
  g.textAlign = "center";
  g.textBaseline = "middle";
  const leagues: Array<[string, Array<[string, string]>]> = [["AMERICAN LEAGUE", AL_GAMES], ["NATIONAL LEAGUE", NL_GAMES]];
  leagues.forEach(([title, games], li) => {
    const x0 = li * 512;
    g.font = "bold 13px Arial, Helvetica, sans-serif";
    g.fillStyle = cream;
    g.fillText(title, x0 + 256, y0 + 14);
    g.font = "bold 10px Arial, Helvetica, sans-serif";
    for (let col = 0; col < 2; col += 1) {
      const cx = x0 + 14 + col * 249;
      g.fillStyle = "rgba(236,230,210,0.7)";
      g.fillText("INN", cx + 14, y0 + 27);
    }
    g.font = "bold 15px Arial, Helvetica, sans-serif";
    games.forEach(([away, home], gi) => {
      const col = gi % 2;
      const row = Math.floor(gi / 2);
      const cx = x0 + 14 + col * 249;
      const y = y0 + 42 + row * 20;
      const k = li * 31 + gi * 7;
      const inning = 1 + Math.floor(hash(k * 1.7) * 9);
      const done = hash(k * 2.9) > 0.7;
      // Inning slot (F for a final), then each club's name and its run tile.
      g.fillStyle = "#0d2219";
      g.fillRect(cx, y - 9, 28, 18);
      g.fillStyle = "#f2d35b";
      g.fillText(done ? "F" : String(inning), cx + 14, y + 1);
      const club = (name: string, runs: number, x: number) => {
        g.fillStyle = cream;
        g.fillText(name, x + 26, y + 1);
        g.fillStyle = "#0d2219";
        g.fillRect(x + 56, y - 9, 26, 18);
        g.fillStyle = cream;
        g.fillText(String(runs), x + 69, y + 1);
      };
      club(away, Math.floor(hash(k * 4.3) * 8), cx + 34);
      g.fillStyle = "rgba(236,230,210,0.6)";
      g.fillText("@", cx + 128, y + 1);
      club(home, Math.floor(hash(k * 6.1) * 8), cx + 132);
    });
  });
}

/** Painted distance markers plus a hand-operated scoreboard strip. */
export function decalAtlas(numbers: number[], color: string): DecalAtlas {
  const H = 512;
  const [c, g] = canvas(1024, H);
  g.clearRect(0, 0, 1024, H);
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
  // Out-of-town board: 1024 × 96.
  const o0 = 256;
  drawOutOfTown(g, o0, 96);
  const t = finish(c, false, 8);
  return {
    texture: t,
    cell: (i) => [(i * 128) / 1024, 1 - 64 / H, ((i + 1) * 128) / 1024, 1],
    board: [0, 1 - (y0 + 128) / H, 1, 1 - y0 / H],
    outOfTown: [0, 1 - (o0 + 96) / H, 1, 1 - o0 / H],
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

/**
 * LED atlas rows (v range inside the 2048 × 512 texture, and feet of wall per horizontal
 * tile). The backstop row is the tall one: `center` is the u of the middle of its lockup panel
 * and `panels` are the u spans of its four panels (side mark, lockup, side mark, monogram).
 */
export const LED_ROW = {
  ribbon: { v: [0.883, 0.992], ft: 110 },
  suites: { v: [0.758, 0.867], ft: 96 },
  lamps: { v: [0.633, 0.742], ft: 32 },
  backstop: {
    v: [0.006, 0.619],
    ft: 44,
    center: 0.375,
    panels: [
      [0, 0.1875],
      [0.1875, 0.5625],
      [0.5625, 0.75],
      [0.75, 1],
    ],
  },
} as const;

/** Where's That Baseball brand palette (see scripts/generate-wtbb-logo.mjs and globals.css). */
const BRAND = { ink: "#1c2b2a", field: "#1b4332", cream: "#ede6d6", ball: "#f4f1ea", stitch: "#c41e3a", sage: "#9cc79c" } as const;

interface BrandArt {
  lockup: HTMLCanvasElement | null;
  monogram: HTMLCanvasElement | null;
  mark: HTMLImageElement | null;
  serif: string;
  sans: string;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (typeof Image === "undefined") return resolve(null);
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * Reverse a brand graphic for a dark board: its paper background drops out, ink becomes
 * `light` and the green parts become `accent`.
 */
function knockout(img: HTMLImageElement, sx: number, sy: number, sw: number, sh: number, dw: number, dh: number, light: string, accent: string): HTMLCanvasElement | null {
  try {
    const [c, g] = canvas(dw, dh);
    g.imageSmoothingQuality = "high";
    g.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);
    const d = g.getImageData(0, 0, dw, dh);
    const px = d.data;
    const paper = px[3] > 10 ? [px[0], px[1], px[2]] : null;
    const L = new THREE.Color(light);
    const A = new THREE.Color(accent);
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i];
      const gr = px[i + 1];
      const b = px[i + 2];
      let alpha = px[i + 3] / 255;
      if (paper) alpha *= Math.min(1, (Math.max(Math.abs(r - paper[0]), Math.abs(gr - paper[1]), Math.abs(b - paper[2])) / 255) * 3.4);
      const k = gr > r + 12 && gr > b + 8 ? A : L;
      px[i] = k.r * 255;
      px[i + 1] = k.g * 255;
      px[i + 2] = k.b * 255;
      px[i + 3] = alpha * 255;
    }
    g.putImageData(d, 0, 0);
    return c;
  } catch {
    return null;
  }
}

function cssFont(name: string, fallback: string): string {
  try {
    const v = getComputedStyle(document.body).getPropertyValue(name).trim();
    return v ? `${v}, ${fallback}` : fallback;
  } catch {
    return fallback;
  }
}

let brandArt: Promise<BrandArt> | null = null;

/** The brand marks from /public/brand and the site's IBM Plex faces, loaded once. */
function loadBrandArt(): Promise<BrandArt> {
  if (brandArt) return brandArt;
  const serif = cssFont("--font-ibm-plex-serif", '"IBM Plex Serif", Georgia, serif');
  const sans = cssFont("--font-ibm-plex-sans", '"IBM Plex Sans", Helvetica, Arial, sans-serif');
  const fonts =
    typeof document !== "undefined" && document.fonts
      ? Promise.all([document.fonts.load(`600 32px ${sans}`), document.fonts.load(`700 32px ${sans}`), document.fonts.load(`600 32px ${serif}`)]).catch(() => null)
      : Promise.resolve(null);
  brandArt = Promise.all([loadImage("/brand/wtbb-logo-lockup.png"), loadImage("/brand/wtbb-monogram-mark.png"), loadImage("/brand/wtbb-mark.svg"), fonts]).then(([lockup, mono, mark]) => ({
    // The lockup sits in the middle of a 1536 × 1024 sheet of paper; crop to the artwork.
    lockup: lockup ? knockout(lockup, 92, 366, 1368, 268, 684, 134, BRAND.cream, BRAND.sage) : null,
    monogram: mono ? knockout(mono, 30, 130, 452, 252, 290, 162, BRAND.cream, BRAND.sage) : null,
    mark,
    serif,
    sans,
  }));
  return brandArt;
}

function spaced(g: CanvasRenderingContext2D, text: string, x: number, y: number, tracking: number, maxW: number): void {
  const ctx = g as CanvasRenderingContext2D & { letterSpacing?: string };
  const can = "letterSpacing" in ctx;
  if (can) ctx.letterSpacing = `${tracking}px`;
  const w = g.measureText(text).width;
  g.save();
  g.translate(x + (can ? tracking / 2 : 0), y);
  if (w > maxW) g.scale(maxW / w, 1);
  g.fillText(text, 0, 0);
  g.restore();
  if (can) ctx.letterSpacing = "0px";
}

/**
 * The backstop board behind the plate, 2048 × 320 at (0, y0): a padded field-green wall in the
 * Where's That Baseball identity. The reversed lockup sits on the centre panel, flanked by the
 * ball-and-spray mark and the BB monogram, with stitched seams between panels.
 */
function paintBackstop(g: CanvasRenderingContext2D, y0: number, art: BrandArt | null): void {
  const W = 2048;
  const H = 320;
  const serif = art?.serif ?? "Georgia, serif";
  const sans = art?.sans ?? "Helvetica, Arial, sans-serif";
  g.save();
  g.beginPath();
  g.rect(0, y0, W, H);
  g.clip();
  g.textAlign = "center";
  g.textBaseline = "middle";
  const base = g.createLinearGradient(0, y0, 0, y0 + H);
  base.addColorStop(0, "#22543f");
  base.addColorStop(0.45, BRAND.field);
  base.addColorStop(1, "#12301f");
  g.fillStyle = base;
  g.fillRect(0, y0, W, H);
  // Pad seams every 128 px (about 2.75 ft): a shadowed joint with a soft rolled highlight.
  for (let x = 0; x < W; x += 128) {
    const seam = g.createLinearGradient(x, 0, x + 128, 0);
    seam.addColorStop(0, "rgba(0,0,0,0.30)");
    seam.addColorStop(0.035, "rgba(255,255,255,0.07)");
    seam.addColorStop(0.2, "rgba(255,255,255,0)");
    seam.addColorStop(0.9, "rgba(0,0,0,0)");
    seam.addColorStop(1, "rgba(0,0,0,0.26)");
    g.fillStyle = seam;
    g.fillRect(x, y0, 128, H);
  }
  // Cap rail piping and a scuffed kick band.
  g.fillStyle = BRAND.cream;
  g.fillRect(0, y0 + 12, W, 5);
  g.fillStyle = "rgba(237,230,214,0.45)";
  g.fillRect(0, y0 + 22, W, 2);
  g.fillStyle = "rgba(0,0,0,0.30)";
  g.fillRect(0, y0 + H - 20, W, 20);
  g.fillStyle = "rgba(237,230,214,0.5)";
  g.fillRect(0, y0 + H - 22, W, 2);

  const edges = [0, 384, 1152, 1536, 2048];
  // Baseball stitching down each panel joint.
  g.lineCap = "round";
  for (const ex of edges) {
    for (const x of ex === 0 ? [0, W] : [ex]) {
      g.strokeStyle = "rgba(237,230,214,0.55)";
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x, y0 + 40);
      g.lineTo(x, y0 + H - 38);
      g.stroke();
      g.strokeStyle = "#e23a55";
      g.lineWidth = 4;
      for (let y = y0 + 52; y < y0 + H - 44; y += 19) {
        g.beginPath();
        g.moveTo(x - 13, y - 6);
        g.lineTo(x - 3, y + 3);
        g.moveTo(x + 13, y - 6);
        g.lineTo(x + 3, y + 3);
        g.stroke();
      }
    }
  }

  // Side panels: the ball-and-spray mark on its cream plate over PLAY BALL.
  for (const [x0, x1] of [
    [edges[0], edges[1]],
    [edges[2], edges[3]],
  ]) {
    const cx = (x0 + x1) / 2;
    const size = 168;
    const top = y0 + 44;
    g.fillStyle = "rgba(0,0,0,0.28)";
    g.beginPath();
    g.roundRect(cx - size / 2 + 3, top + 5, size, size, 30);
    g.fill();
    if (art?.mark) {
      g.drawImage(art.mark, cx - size / 2, top, size, size);
    } else {
      g.fillStyle = BRAND.cream;
      g.beginPath();
      g.roundRect(cx - size / 2, top, size, size, 30);
      g.fill();
      g.fillStyle = BRAND.ball;
      g.strokeStyle = BRAND.ink;
      g.lineWidth = 7;
      g.beginPath();
      g.arc(cx - 20, top + size / 2 + 6, 44, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    g.fillStyle = BRAND.cream;
    g.font = `700 40px ${sans}`;
    spaced(g, "PLAY BALL", cx, y0 + 252, 9, x1 - x0 - 90);
  }
  // Centre panel: the reversed lockup over a ruled strapline.
  {
    const cx = (edges[1] + edges[2]) / 2;
    if (art?.lockup) {
      g.drawImage(art.lockup, cx - art.lockup.width / 2, y0 + 56);
    } else {
      g.fillStyle = BRAND.cream;
      g.font = `500 96px ${serif}`;
      g.fillText("Where’s That BB", cx, y0 + 124);
    }
    g.fillStyle = "rgba(237,230,214,0.7)";
    g.fillRect(cx - 330, y0 + 246, 150, 2);
    g.fillRect(cx + 180, y0 + 246, 150, 2);
    g.fillStyle = "#e23a55";
    for (const sx of [-1, 1]) {
      g.beginPath();
      g.arc(cx + sx * 166, y0 + 247, 5, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = BRAND.cream;
    g.font = `600 30px ${sans}`;
    spaced(g, "PLAY BALL", cx, y0 + 248, 12, 300);
  }
  // Fourth panel: the BB monogram over the spelled-out name.
  {
    const cx = (edges[3] + edges[4]) / 2;
    if (art?.monogram) {
      g.drawImage(art.monogram, cx - art.monogram.width / 2, y0 + 48);
    } else {
      g.fillStyle = BRAND.cream;
      g.font = `700 150px ${serif}`;
      g.fillText("BB", cx, y0 + 132);
    }
    g.fillStyle = BRAND.cream;
    g.font = `600 27px ${sans}`;
    spaced(g, "WHERE’S THAT BASEBALL", cx, y0 + 252, 6, 420);
  }
  // Gloss off the vinyl and a faint LED line structure.
  const gloss = g.createLinearGradient(0, y0, 0, y0 + H);
  gloss.addColorStop(0, "rgba(255,255,255,0.13)");
  gloss.addColorStop(0.3, "rgba(255,255,255,0.03)");
  gloss.addColorStop(0.55, "rgba(255,255,255,0)");
  gloss.addColorStop(1, "rgba(0,0,0,0.12)");
  g.fillStyle = gloss;
  g.fillRect(0, y0, W, H);
  g.fillStyle = "rgba(0,0,0,0.05)";
  for (let y = y0 + 1; y < y0 + H; y += 4) g.fillRect(0, y, W, 1);
  g.restore();
}

/** Self-lit signage: ribbon boards, the backstop ad board, suite windows and lamp racks. */
export function ledAtlas(lit: boolean): THREE.CanvasTexture {
  const [c, g] = canvas(2048, 512);
  // The three thin rows are laid out on a 1024-wide grid and drawn at double width.
  g.save();
  g.scale(2, 1);
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
  g.translate(0, -64);
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
  g.restore();
  paintBackstop(g, 192, null);
  const t = finish(c, true, 8);
  t.wrapT = THREE.ClampToEdgeWrapping;
  void loadBrandArt().then((art) => {
    paintBackstop(g, 192, art);
    t.needsUpdate = true;
  });
  return t;
}

/**
 * The city texture is a 2 × 2 atlas of facade styles, each an n × n grid of window bays
 * (one bay = `w` feet wide, one floor = `h` feet tall). A building picks a style and a random
 * offset inside that quadrant; walls taller or wider than a quadrant are split into pieces.
 */
export const CITY_CELL = { w: 11, h: 12.5, n: 32 } as const;

/** Facade styles in the city atlas. */
export const CITY_STYLE = { glass: 0, stone: 1, brick: 2, ribbon: 3 } as const;
export type CityStyle = (typeof CITY_STYLE)[keyof typeof CITY_STYLE];

/** UV origin of a style's quadrant (each quadrant spans 0.5 × 0.5). */
export function cityQuadrant(style: CityStyle): [number, number] {
  return [(style % 2) * 0.5, Math.floor(style / 2) * 0.5];
}

/** A texel of plain roof / spandrel color (the mortar corner of a stone-facade bay). */
export const CITY_ROOF: [number, number] = [0.5 + 0.5 / (CITY_CELL.n * 20), 0.5 / (CITY_CELL.n * 20)];

/**
 * Building facades, multiplied by each building's vertex color: a glass curtain wall
 * (mullions, spandrel bands, panes that catch the sky unevenly), punched windows in pale
 * stone, deep-set windows in brick, and mid-century ribbon windows. At night the walls go
 * dark and offices light up a floor or a bay at a time, warm and cool.
 */
export function cityTexture(lit: boolean): THREE.CanvasTexture {
  const n = CITY_CELL.n;
  const px = 10;
  const Q = n * px;
  const [c, g] = canvas(Q * 2, Q * 2);
  const rect = (style: number, i: number, j: number, x: number, y: number, w: number, h: number, fill: string, alpha = 1) => {
    // (x, y) inside the bay, y measured up from the bay's floor line.
    const qx = (style % 2) * Q;
    const qy = Q * 2 - Math.floor(style / 2) * Q;
    g.globalAlpha = alpha;
    g.fillStyle = fill;
    g.fillRect(qx + i * px + x, qy - (j * px + y + h), w, h);
    g.globalAlpha = 1;
  };
  const grey = (v: number, tint = [0, 0, 0]) => `rgb(${Math.round(v + tint[0])},${Math.round(v + tint[1])},${Math.round(v + tint[2])})`;
  // Night office light: whole floors tend to be on or off together, and so do bays.
  const lamp = (style: number, i: number, j: number): string | null => {
    const floor = hash(j * 13.7 + style * 101 + 3);
    const bay = hash(Math.floor(i / 4) * 5.3 + j * 0.7 + style * 17);
    const r = hash(i * 7.31 + j * 3.17 + style * 57 + 11);
    const p = floor > 0.88 ? 0.75 : floor < 0.35 ? 0.03 : bay > 0.7 ? 0.5 : 0.12;
    if (r >= p) return null;
    const k = hash(i * 1.7 + j * 9.3 + style);
    return k < 0.55 ? "#f2cf92" : k < 0.85 ? "#dfe8f6" : "#f5e3b8";
  };
  for (let style = 0; style < 4; style += 1) {
    for (let j = 0; j < n; j += 1) {
      for (let i = 0; i < n; i += 1) {
        const r = hash(i * 7.31 + j * 3.17 + style * 31 + 11);
        const on = lit ? lamp(style, i, j) : null;
        const glow = 0.45 + 0.5 * hash(i + j * 31.1 + style);
        if (style === CITY_STYLE.glass) {
          // Mullion grid with a spandrel band; panes vary in tone by column (reflections).
          const col = hash(Math.floor(i / 3) * 3.7 + style) * 0.5 + 0.5 * Math.sin(i * 0.45 + j * 0.08);
          rect(style, i, j, 0, 0, px, px, lit ? "#1b2029" : grey(196, [-6, 2, 12]));
          rect(style, i, j, 0, 0, px, 2, lit ? "#151920" : grey(170, [-4, 0, 6]));
          const v = 122 + col * 46 + r * 14;
          rect(style, i, j, 1, 2, px - 1, px - 2, lit ? "#121722" : grey(v, [-10, 0, 16]));
          rect(style, i, j, 1, px - 3, px - 1, 1, lit ? "#1a1f2b" : grey(v + 22, [-8, 0, 12]));
          if (on) rect(style, i, j, 1, 2, px - 1, px - 2, on, glow);
        } else if (style === CITY_STYLE.stone) {
          // Pale stone with deep punched windows and a lighter sill.
          rect(style, i, j, 0, 0, px, px, lit ? "#2a2d33" : grey(212 + r * 16, [4, 2, -4]));
          rect(style, i, j, 2, 2, 6, 6, lit ? "#1a1d24" : grey(84 + r * 30, [-6, 0, 12]));
          rect(style, i, j, 2, 2, 6, 1, lit ? "#30333a" : grey(236, [2, 1, -2]));
          if (on) rect(style, i, j, 2, 3, 6, 5, on, glow);
        } else if (style === CITY_STYLE.brick) {
          // Masonry with tall paired windows, piers every bay.
          rect(style, i, j, 0, 0, px, px, lit ? "#2c2726" : grey(196 + r * 18, [6, 0, -8]));
          for (const x of [2, 6]) {
            rect(style, i, j, x, 2, 3, 6, lit ? "#1b1a1d" : grey(70 + r * 26, [-4, 0, 8]));
            if (on && hash(i * 3 + x + j * 5) < 0.85) rect(style, i, j, x, 2, 3, 6, on, glow);
          }
          rect(style, i, j, 0, 9, px, 1, lit ? "#25211f" : grey(222, [4, 1, -6]));
        } else {
          // Ribbon windows: a continuous dark band per floor over a pale spandrel.
          rect(style, i, j, 0, 0, px, px, lit ? "#272a31" : grey(220 + r * 10, [0, 0, 0]));
          rect(style, i, j, 0, 3, px, 6, lit ? "#161a22" : grey(92 + 20 * Math.sin(i * 0.3 + j), [-6, 0, 14]));
          rect(style, i, j, 0, 3, 1, 6, lit ? "#272a31" : grey(150));
          if (on) rect(style, i, j, 0, 3, px, 6, on, glow * 0.9);
        }
      }
    }
  }
  return finish(c, false, 8);
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
