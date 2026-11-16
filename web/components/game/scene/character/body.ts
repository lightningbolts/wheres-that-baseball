/**
 * The ballplayer mesh, built procedurally in the skeleton's rest pose (standing at the
 * origin facing +Z, arms and legs hanging straight down) and skinned to its 17 bones.
 *
 * One mesh per outfit (cap or helmet, glove side, catcher's gear, ...) and level of
 * detail is shared by everybody who wears it; who they are — uniform colours, name
 * and number, face — is all in the texture (atlas.ts / paint.ts).
 *
 * The trunk, elbows and knees are smooth-skinned; shoulders, hips, wrists and ankles
 * are ball joints (a rounded limb end turning inside the part it attaches to).
 */
import type { ActorKind } from "@/components/game/scene/rig";
import { PANEL, panelUV, sw, type Rect } from "@/components/game/scene/character/atlas";
import { MeshBuilder, blob, loft, smoothstep, tube, type MeshData, type Ring, type SkinFn, type UVFn, type V3, type VOut } from "@/components/game/scene/character/mesh";
import { BONE, DIM, HELPER } from "@/components/game/scene/character/skeleton";

export interface Outfit {
  /** cap · helmet (no flap: base coaches) · flap (batting helmet) · catcher (helmet + cage) · umpire (cap + mask). */
  head: "cap" | "helmet" | "flap" | "catcher" | "umpire";
  /** Side of the batting helmet's ear flap (+1 = the wearer's left). */
  flap: 1 | -1;
  /** Side of the glove hand (+1 = left), or 0 for none. */
  glove: 1 | -1 | 0;
  mitt: boolean;
  /** Hands closed (around a bat, or running). */
  fists: boolean;
  /** Catcher's chest protector and shin guards. */
  gear: boolean;
}

export function outfitFor(kind: ActorKind, hand: "L" | "R"): Outfit {
  const side = hand === "R" ? 1 : -1;
  switch (kind) {
    case "catcher":
      return { head: "catcher", flap: 1, glove: side, mitt: true, fists: false, gear: true };
    case "fielder":
    case "pitcher":
      return { head: "cap", flap: 1, glove: side, mitt: false, fists: false, gear: false };
    case "batter":
    case "runner":
      // The flap covers the ear that faces the pitcher.
      return { head: "flap", flap: side, glove: 0, mitt: false, fists: true, gear: false };
    case "umpire":
      return { head: "umpire", flap: 1, glove: 0, mitt: false, fists: false, gear: false };
    default:
      return { head: "helmet", flap: 1, glove: 0, mitt: false, fists: false, gear: false };
  }
}

export const outfitKey = (o: Outfit) => `${o.head}${o.flap}${o.glove}${o.mitt ? "m" : ""}${o.fists ? "f" : ""}${o.gear ? "g" : ""}`;

/** Where the textures are mapped (paint.ts draws to the same numbers). */
export const JERSEY_TOP = 2.07;
export const JERSEY_HEM = 0.4;
/** Face panel: width and height (ft) of the area projected on the front of the head. */
export const FACE_W = 0.578;
export const FACE_H = 0.856;
/** Lower-leg panel: runs from the knee to the ankle; the pants end this far down it (0..1). */
export const CUFF_AT = 0.4 / DIM.shin;

const Y0 = DIM.hip;
const PI = Math.PI;
const HEAD: V3 = [0, Y0 + DIM.headCY, DIM.headCZ];
const HEAD_R: V3 = [0.25, 0.37, 0.31];

const gauss = (a: number, s: number) => Math.exp(-(a * a) / (s * s));

const U = {
  skin: sw("skin"),
  jersey: sw("jersey"),
  pants: sw("pants"),
  belt: sw("belt"),
  shoe: sw("shoe"),
  sole: sw("sole"),
  hair: sw("hair"),
  cap: sw("cap"),
  brim: sw("brim"),
  helmet: sw("helmet"),
  glove: sw("glove"),
  gloveDark: sw("gloveDark"),
  sleeve: sw("sleeve"),
  wrist: sw("wrist"),
  hand: sw("hand"),
  trim: sw("trim"),
  gear: sw("gear"),
  gearDark: sw("gearDark"),
  metal: sw("metal"),
  buckle: sw("buckle"),
  collar: sw("collar"),
} satisfies Record<string, UVFn>;

const rigid =
  (bone: number): SkinFn =>
  (o) => {
    o.b0 = bone;
    o.w = 0;
  };

export type Lod = 0 | 1 | 2;
/** A value per level of detail: close-up, mid-field, far. */
const pick = <T>(lod: Lod, a: T, b: T, c: T): T => (lod === 0 ? a : lod === 1 ? b : c);

/** Trunk: the pelvis hands over to the lumbar spine, and that to the chest. */
const torsoSkin: SkinFn = (o) => {
  const y = o.y - Y0;
  if (y < 0.575) {
    o.b0 = BONE.pelvis;
    o.b1 = BONE.spine;
    o.w = smoothstep(0.05, 0.55, y);
  } else {
    o.b0 = BONE.spine;
    o.b1 = BONE.chest;
    o.w = smoothstep(0.6, 1.25, y);
  }
};
const neckSkin: SkinFn = (o) => {
  const y = o.y - Y0;
  if (y < 2.11) {
    o.b0 = BONE.chest;
    o.b1 = BONE.neck;
    o.w = smoothstep(1.98, 2.1, y);
  } else {
    o.b0 = BONE.neck;
    o.b1 = BONE.head;
    o.w = smoothstep(2.12, 2.26, y);
  }
};
/** The head is modelled life-size and then enlarged a touch about the top of the neck: it reads better at a distance. */
const HEAD_K = 1.07;
const HEAD_PIVOT = Y0 + 2.27;
const HEAD_CY = HEAD_PIVOT + (HEAD[1] - HEAD_PIVOT) * HEAD_K;
const headSkin: SkinFn = (o) => {
  o.x *= HEAD_K;
  o.y = HEAD_PIVOT + (o.y - HEAD_PIVOT) * HEAD_K;
  o.z *= HEAD_K;
  o.b0 = BONE.head;
  o.w = 0;
};

/** [y (pelvis-relative), half-width, half-depth, centre z]. */
type Row = [number, number, number, number?];
const rings = (rows: Row[], uv: UVFn, grow = 0): Ring[] =>
  rows.map((r, i) => ({ y: Y0 + r[0], rx: r[1] + grow, rz: r[2] + grow, cz: r[3] ?? 0, uv: i === 0 ? uv : undefined }));

const JERSEY: Row[] = [
  // Open collar, then the trapezius sloping out to the shoulders.
  [JERSEY_TOP, 0.22, 0.205, -0.03],
  [2.035, 0.36, 0.238, -0.035],
  [1.985, 0.5, 0.27, -0.035],
  [1.925, 0.63, 0.303, -0.03],
  [1.85, 0.735, 0.334, -0.018],
  [1.76, 0.79, 0.36, -0.004],
  [1.68, 0.795, 0.38, 0.008],
  // Chest standing proud in front, shoulder blades behind.
  [1.6, 0.77, 0.4, 0.018],
  [1.44, 0.715, 0.418, 0.03],
  [1.26, 0.655, 0.402, 0.032],
  // Ribs narrowing into the waist; the small of the back curves in.
  [1.06, 0.592, 0.37, 0.028],
  [0.86, 0.55, 0.345, 0.022],
  [0.68, 0.527, 0.334, 0.014],
  [0.54, 0.524, 0.332, 0.006],
  [0.45, 0.52, 0.326, 0.002],
  [JERSEY_HEM, 0.498, 0.312],
];
/** Outline of the seat of the trousers, from under the belt down past the crotch. */
const SEAT: Row[] = [
  [0.285, 0.49, 0.31, 0],
  [0.18, 0.51, 0.326, -0.008],
  [0.0, 0.53, 0.362, -0.03],
  [-0.2, 0.532, 0.372, -0.048],
  [-0.4, 0.522, 0.345, -0.04],
  [-0.7, 0.5, 0.3, -0.02],
];
const SEAT_N = 2.5;

function trunk(b: MeshBuilder, lod: Lod) {
  const seg = pick(lod, 32, 20, 12);
  const half = seg / 2;
  const span = JERSEY_TOP - JERSEY_HEM;
  // Baked shade in the armpits and down the flanks, and under the chest.
  const shade = (th: number, y: number) =>
    1 - 0.24 * smoothstep(0.7, 1, Math.abs(Math.cos(th))) * gauss(y - Y0 - 1.35, 0.4) - 0.06 * gauss(y - Y0 - 0.5, 0.12);
  const panel =
    (r: (typeof PANEL)[keyof typeof PANEL]): UVFn =>
    (o, t) =>
      panelUV(o, r, 1 - t, (JERSEY_TOP - (o.y - Y0)) / span);
  const rows = lod === 2 ? JERSEY.filter((_, i) => i % 2 === 0 || i === JERSEY.length - 1) : JERSEY;
  // The jersey is two half-wraps, so the front and the back each get a panel of their own.
  loft(b, rings(rows, panel(PANEL.front)), { seg: half, skin: torsoSkin, theta0: 0, arc: PI, n: 2.25, shade });
  loft(b, rings(rows, panel(PANEL.back)), { seg: half, skin: torsoSkin, theta0: PI, arc: PI, n: 2.25, shade });
  // Undershirt collar (a low crew neck) and the neck: thick, with the trapezius running into the shoulders.
  loft(
    b,
    [
      { y: Y0 + 2.085, rx: 0.218, rz: 0.205, cz: -0.025, uv: U.collar },
      { y: Y0 + 2.085, rx: 0.236, rz: 0.222, cz: -0.025 },
      { y: Y0 + 2.03, rx: 0.25, rz: 0.234, cz: -0.03 },
    ],
    { seg, skin: torsoSkin },
  );
  loft(
    b,
    [
      { y: Y0 + 2.4, rx: 0.19, rz: 0.2, cz: 0.02, uv: U.skin, ao: 0.7 },
      { y: Y0 + 2.29, rx: 0.192, rz: 0.198, cz: 0.006, ao: 0.78 },
      { y: Y0 + 2.18, rx: 0.2, rz: 0.2, cz: -0.012, ao: 0.86 },
      { y: Y0 + 2.09, rx: 0.214, rz: 0.205, cz: -0.024, ao: 0.92 },
      { y: Y0 + 1.98, rx: 0.235, rz: 0.215, cz: -0.03 },
    ],
    {
      seg: Math.max(8, half),
      skin: neckSkin,
      // Sternocleidomastoids in front, the trapezius flaring behind as the neck meets the back.
      post: (o, th) => {
        const y = o.y - Y0;
        const s = Math.sin(th);
        const c = Math.cos(th);
        const scm = 0.012 * gauss(Math.abs(c) - 0.55, 0.25) * Math.max(0, s) * smoothstep(2.35, 2.12, y);
        const trap = 0.03 * Math.max(0, -s) * (0.4 + 0.6 * c * c) * smoothstep(2.25, 2.02, y);
        o.x += c * (scm + trap * 0.6);
        o.z += s * scm - Math.max(0, -s) * trap * 0.25;
      },
    },
  );
  // Belt, a touch proud of the trousers, with its loops and buckle.
  loft(
    b,
    [
      { y: Y0 + JERSEY_HEM, rx: 0.49, rz: 0.305, uv: U.belt },
      { y: Y0 + JERSEY_HEM, rx: 0.51, rz: 0.325 },
      { y: Y0 + 0.285, rx: 0.51, rz: 0.325 },
      { y: Y0 + 0.285, rx: 0.488, rz: 0.308 },
    ],
    { seg, skin: torsoSkin, n: 2.5 },
  );
  if (lod < 2) blob(b, { c: [0, Y0 + 0.342, 0.325], r: [0.058, 0.047, 0.018], seg: 6, rows: 4, uv: U.buckle, skin: torsoSkin });
  if (lod === 0) {
    for (const [x, z] of [
      [0.2, 0.317],
      [-0.2, 0.317],
      [0.47, 0.12],
      [-0.47, 0.12],
      [0.3, -0.27],
      [-0.3, -0.27],
      [0, -0.325],
    ]) {
      blob(b, { c: [x, Y0 + 0.342, z], r: [Math.abs(z) > 0.2 ? 0.024 : 0.014, 0.07, Math.abs(z) > 0.2 ? 0.014 : 0.024], seg: 4, rows: 3, uv: U.pants, skin: torsoSkin, deform: (v) => void (v.ao = 0.9) });
    }
  }
}

function arm(b: MeshBuilder, side: number, lod: Lod) {
  const seg = pick(lod, 14, 8, 6);
  const x0 = side * DIM.shoulderX;
  const ys = Y0 + DIM.shoulderY;
  const bone = side > 0 ? BONE.armL : BONE.armR;
  const elbow = side > 0 ? HELPER.elbowL : HELPER.elbowR;
  const E = DIM.upperArm;
  const skin: SkinFn = (o) => {
    const d = ys - o.y;
    if (d < E) {
      o.b0 = bone;
      o.b1 = elbow;
      o.w = smoothstep(E - 0.26, E, d);
    } else {
      o.b0 = elbow;
      o.b1 = bone + 1;
      o.w = smoothstep(E, E + 0.26, d);
    }
  };
  const HEM = 0.62;
  // The sleeve unwraps from the armpit, so the outside of the arm is the middle of its panel.
  const sleeve: UVFn = (o, t) => panelUV(o, PANEL.sleeve, t, (ys - o.y + 0.17) / (HEM + 0.17));
  // rx across the arm, rz front-to-back (k = rz / rx): the arm is not a cylinder.
  const r = (d: number, rad: number, uv?: UVFn, ao?: number, cz = 0, keep = true, k = 1.05, dx = 0): Ring & { keep: boolean } => ({ y: ys - d, rx: rad, rz: rad * k, cx: x0 + side * dx, cz, uv, ao, keep });
  const all = [
    // Deltoid: a rounded cap that sits low on the shoulder and widens outward.
    r(-0.13, 0, sleeve, undefined, 0, true, 1, -0.02),
    r(-0.115, 0.095, undefined, undefined, 0, true, 1, -0.012),
    r(-0.065, 0.165, undefined, undefined, 0, false, 1.02, 0.004),
    r(0.02, 0.205, undefined, undefined, 0, true, 1.05, 0.016),
    r(0.14, 0.218, undefined, undefined, 0, true, 1.08, 0.02),
    r(0.3, 0.212, undefined, undefined, 0, false, 1.08, 0.012),
    r(0.48, 0.2, undefined, undefined, 0, true, 1.06, 0.004),
    // Sleeve hem, then the arm (or undershirt) coming out of it: biceps in front, triceps behind.
    r(HEM, 0.198, U.sleeve, undefined, 0, true, 1.06),
    r(HEM, 0.16, undefined, 0.5, 0.01, true, 1.12),
    r(0.72, 0.157, undefined, 0.82, 0.016, false, 1.16),
    r(0.82, 0.148, undefined, 1, 0.014, true, 1.14),
    r(0.92, 0.136, undefined, 1, 0.004, false, 1.08),
    // Elbow: narrow across, the point of the olecranon behind.
    r(E, 0.128, undefined, 1, -0.012, true, 1.1),
    // Forearm: the muscle belly just below the elbow, tapering to a flat wrist.
    r(1.1, 0.146, undefined, 1, 0.006, false, 1.0),
    r(1.2, 0.148, undefined, 1, 0.006, true, 0.94),
    r(1.34, 0.132, undefined, 1, 0.003, false, 0.9),
    r(1.48, 0.112, undefined, 1, 0, true, 0.88),
    r(1.6, 0.092, undefined, 1, 0, true, 1.12),
    r(1.68, 0.088, U.wrist, undefined, 0, true, 1.18),
    r(E + DIM.wrist, 0.086, U.hand, undefined, 0, true, 1.2),
    r(E + DIM.wrist + 0.04, 0, undefined, undefined, 0, true, 1.2),
  ];
  loft(b, lod > 0 ? all.filter((x) => x.keep) : all, { seg, skin, theta0: side > 0 ? PI : 0 });
}

/** Depth of the crotch below the hip joints. */
const CROTCH = 0.44;

const _seat: [number, number, number] = [0, 0, 0];
/** Seat outline at height y (pelvis-relative): half-width, half-depth, centre z. */
function seatAt(y: number): [number, number, number] {
  let i = 0;
  while (i < SEAT.length - 2 && y < SEAT[i + 1][0]) i += 1;
  const r0 = SEAT[i];
  const r1 = SEAT[i + 1];
  const f = Math.min(1, Math.max(0, (r0[0] - y) / (r0[0] - r1[0])));
  _seat[0] = r0[1] + (r1[1] - r0[1]) * f;
  _seat[1] = r0[2] + (r1[2] - r0[2]) * f;
  _seat[2] = (r0[3] ?? 0) + ((r1[3] ?? 0) - (r0[3] ?? 0)) * f;
  return _seat;
}

/** Distance from (x0, 0) along (c, s) to the seat outline at height y, or to the midline if that is nearer. */
function seatReach(y: number, x0: number, c: number, s: number): number {
  const [a, bz, cz] = seatAt(y);
  let lo = 0;
  let hi = 1.6;
  for (let k = 0; k < 26; k += 1) {
    const m = (lo + hi) / 2;
    const x = x0 + m * c;
    const z = m * s - cz;
    if (Math.pow(Math.abs(x / a), SEAT_N) + Math.pow(Math.abs(z / bz), SEAT_N) < 1) lo = m;
    else hi = m;
  }
  // The other leg starts at the midline.
  const wall = x0 * c < 0 ? -x0 / c : Infinity;
  return Math.min(lo, wall);
}

/**
 * Trousers: each leg is one tube from the belt to the ankle. Above the crotch its section
 * is half of the seat (out to the hip, in to the midline, where it meets the other leg);
 * below, a round thigh. Hips and knees bend through their helper joints.
 */
function leg(b: MeshBuilder, side: number, lod: Lod) {
  const seg = pick(lod, 20, 10, 8);
  const x0 = side * DIM.hipX;
  const yh = Y0 + DIM.hipY;
  const thigh = side > 0 ? BONE.thighL : BONE.thighR;
  const hip = side > 0 ? HELPER.hipL : HELPER.hipR;
  const knee = side > 0 ? HELPER.kneeL : HELPER.kneeR;
  const T = DIM.thigh;
  const TOP = -0.335;
  const skin: SkinFn = (o) => {
    const d = yh - o.y;
    if (d < 0.95) {
      // Seat → hip helper → thigh; the midline (fly and seam) stays with the pelvis.
      const g = Math.max(smoothstep(0.02, 0.26, Math.abs(o.x)), smoothstep(CROTCH - 0.04, CROTCH + 0.14, d));
      const q = (smoothstep(-0.1, 0.22, d) + smoothstep(0.22, 0.68, d)) * g;
      if (q <= 0) torsoSkin(o);
      else if (q <= 1) {
        o.b0 = BONE.pelvis;
        o.b1 = hip;
        o.w = q;
      } else {
        o.b0 = hip;
        o.b1 = thigh;
        o.w = q - 1;
      }
    } else if (d < T) {
      o.b0 = thigh;
      o.b1 = knee;
      o.w = smoothstep(T - 0.32, T, d);
    } else {
      o.b0 = knee;
      o.b1 = thigh + 1;
      o.w = smoothstep(T, T + 0.32, d);
    }
  };
  const upper: UVFn = (o, t) => panelUV(o, PANEL.pants, t, (yh - o.y - TOP) / (T - TOP));
  const lower: UVFn = (o, t) => panelUV(o, PANEL.lower, t, (yh - o.y - T) / DIM.shin);
  // k = rz / rx: thighs deeper than wide, the calf a deep oval behind a flat shin.
  const r = (d: number, rad: number, cz = 0, keep = true, uv?: UVFn, ao?: number, k = 1.06): Ring & { keep: boolean } => ({ y: yh - d, rx: rad, rz: rad * k, cx: x0, cz, uv, ao, keep });
  const cuff = T + CUFF_AT * DIM.shin;
  const all = [
    r(TOP, 0.29, 0, true, upper),
    r(-0.22, 0.29, 0, false),
    r(-0.08, 0.29),
    r(0.06, 0.29, 0, false),
    r(0.2, 0.29),
    r(0.33, 0.288, -0.005, false),
    r(CROTCH, 0.282, -0.004, true, undefined, undefined, 1.08),
    // Quadriceps filling the front of the trousers, tapering to the knee.
    r(0.6, 0.268, 0.008, false, undefined, undefined, 1.1),
    r(0.8, 0.246, 0.016, true, undefined, undefined, 1.1),
    r(1.0, 0.222, 0.02, false, undefined, undefined, 1.08),
    r(1.16, 0.205, 0.02, true, undefined, undefined, 1.06),
    r(1.28, 0.194, 0.022, false, undefined, undefined, 1.04),
    // Knee: the kneecap in front.
    r(1.38, 0.19, 0.03, true, undefined, undefined, 1.06),
    r(T, 0.19, 0.03, true, lower, undefined, 1.06),
    r(1.58, 0.184, 0.018),
    r(1.68, 0.178, 0.006, false),
    r(1.78, 0.178, -0.004),
    // Trousers bloused over the top of the calf, then the sock over the calf muscle.
    r(cuff, 0.184, -0.01),
    r(cuff, 0.152, -0.018, true, undefined, 0.55, 1.12),
    r(2.1, 0.158, -0.04, true, undefined, undefined, 1.2),
    r(2.28, 0.148, -0.036, false, undefined, undefined, 1.18),
    r(2.48, 0.122, -0.016, true, undefined, undefined, 1.1),
    r(2.68, 0.1, -0.004, false, undefined, undefined, 1.04),
    r(2.85, 0.094, 0, true, undefined, undefined, 1.1),
    r(T + DIM.shin, 0.092, 0, true, undefined, undefined, 1.1),
  ];
  const dth = (2 * PI) / seg;
  const inner = side > 0 ? PI : 0;
  loft(b, lod > 0 ? all.filter((x) => x.keep) : all, {
    seg,
    skin,
    // The unwrap starts on the inseam, so the outseam (the piping) is the middle of the strip.
    theta0: side > 0 ? -PI : 0,
    shade: (th, y) => 1 - 0.3 * Math.pow(Math.max(0, Math.cos(th - inner)), 2) * smoothstep(1.3, 0.3, yh - y),
    shape: (o, ring, th0) => {
      const d = yh - ring.y;
      if (d > CROTCH - 1e-4) return;
      const k = smoothstep(CROTCH, CROTCH - 0.3, d);
      const y = ring.y - Y0;
      let th = th0;
      // Put a column exactly on the corners where the seat meets the midline, front and back.
      const [, sb, scz] = seatAt(y);
      for (let i = 0; i < 2; i += 1) {
        const ac = Math.atan2(scz + (i === 0 ? sb : -sb), -x0);
        if (dAng(th, ac) < dth / 2 + 1e-6) th = ac;
      }
      const c = Math.cos(th);
      const s = Math.sin(th);
      const rt = ring.rx;
      const reach = seatReach(y, x0, c, s);
      const R = rt + (reach - rt) * k;
      o.x = x0 + R * c;
      o.z = (ring.cz ?? 0) * (1 - k) + R * s * (1 + 0.06 * (1 - k));
      if (Math.abs(o.x) < 2e-4) o.x = 0;
    },
  });
}

function shoe(b: MeshBuilder, side: number, lod: Lod) {
  const bone = side > 0 ? BONE.footL : BONE.footR;
  const skin = rigid(bone);
  const x0 = side * DIM.hipX;
  const ya = Y0 + DIM.hipY - DIM.thigh - DIM.shin;
  const c: V3 = [x0, ya - 0.005, 0.2];
  const r: V3 = [0.17, 0.155, 0.45];
  const top = ya + 0.16;
  const bottom = ya - DIM.ankle;
  const uv: UVFn = (o) => panelUV(o, PANEL.shoe, (c[2] + r[2] - o.z) / (2 * r[2]), (top - o.y) / (top - bottom));
  const seg = pick(lod, 16, 10, 6);
  blob(b, {
    c,
    r,
    seg,
    rows: pick(lod, 10, 7, 4),
    uv,
    skin,
    deform: (o, dx, dy, dz) => {
      // Low toe box, a collar round the ankle, a narrower heel; flat where it meets the sole.
      if (dy > 0) o.y = c[1] + r[1] * dy * (dz > 0 ? 1 - 0.58 * dz * dz : 1 + 0.25 * dz * dz);
      if (dz < 0) o.x = c[0] + r[0] * dx * (1 + 0.22 * dz);
      else o.x = c[0] + r[0] * dx * (1 - 0.12 * dz * dz);
      o.y = Math.max(o.y, ya - 0.095);
      o.ao = 0.78 + 0.22 * smoothstep(-0.6, 0.3, dy);
    },
  });
  loft(
    b,
    [
      { y: ya - 0.086, rx: 0.178, rz: 0.46, cx: x0, cz: 0.2, uv: U.sole },
      { y: bottom, rx: 0.17, rz: 0.45, cx: x0, cz: 0.2 },
      { y: bottom, rx: 0, rz: 0, cx: x0, cz: 0.2 },
    ],
    { seg, skin, n: 2.4 },
  );
}

/** Shape of the head (and of everything worn on it): jaw, brow, eye sockets, cheeks. */
function headDeform(o: VOut, dx: number, dy: number, dz: number) {
  const f = Math.max(0, dz);
  const back = Math.max(0, -dz);
  // Jaw: the skull narrows to the angle of the jaw, then the jawline runs in to the chin.
  const jaw = smoothstep(0.15, 0.95, -dy);
  const chin = smoothstep(0.55, 1, -dy) * smoothstep(-0.2, 0.7, dz);
  o.x *= 1 - 0.12 * jaw - 0.22 * chin;
  o.z += 0.05 * jaw * (0.3 + 0.7 * f);
  // The back of the skull bulges over the nape; the face is flatter across than the cranium.
  o.z -= 0.035 * back * gauss(dy - 0.05, 0.4);
  o.z += 0.04 * back * smoothstep(0.1, 0.8, -dy) * 0.6;
  o.x *= 1 - 0.06 * f * f * smoothstep(-0.4, 0.3, dy);
  let z = 0.026 * gauss(dy - 0.22, 0.09) * gauss(dx, 0.5); // brow ridge
  z -= 0.03 * gauss(Math.abs(dx) - 0.36, 0.14) * gauss(dy - 0.1, 0.09); // eye sockets
  z += 0.02 * gauss(Math.abs(dx) - 0.5, 0.16) * gauss(dy + 0.06, 0.12); // cheekbones
  z += 0.012 * gauss(dx, 0.22) * gauss(dy + 0.32, 0.08); // upper lip
  z += 0.03 * gauss(dx, 0.22) * gauss(dy + 0.72, 0.12); // chin
  z -= 0.012 * gauss(dx, 0.3) * gauss(dy + 0.55, 0.06); // under the lip
  o.z += z * f;
}

const scaled = (k: number): V3 => [HEAD_R[0] * k, HEAD_R[1] * k, HEAD_R[2] * k];
/** Angular distance between two azimuths. */
const dAng = (a: number, c: number) => Math.abs(((((a - c) % (2 * PI)) + 3 * PI) % (2 * PI)) - PI);

function head(b: MeshBuilder, o: Outfit, lod: Lod) {
  const covered = o.head !== "cap" && o.head !== "umpire";
  const faceUV: UVFn = (v) => panelUV(v, PANEL.face, 0.5 + v.x / FACE_W, 0.5 - (v.y - HEAD_CY) / FACE_H);
  // The front of the head takes the painted face; the brow is in the cap's shade.
  blob(b, {
    c: HEAD,
    r: HEAD_R,
    seg: pick(lod, 24, 12, 8),
    rows: pick(lod, 22, 12, 8),
    theta0: 0,
    arc: PI,
    uv: faceUV,
    skin: headSkin,
    deform: (v, dx, dy, dz) => {
      headDeform(v, dx, dy, dz);
      v.ao = 1 - 0.3 * smoothstep(0.1, 0.5, dy) - 0.25 * smoothstep(0.6, 0.95, -dy);
    },
  });
  blob(b, { c: HEAD, r: HEAD_R, seg: pick(lod, 12, 8, 5), rows: pick(lod, 12, 8, 5), theta0: PI, arc: PI, uv: U.skin, skin: headSkin, deform: headDeform });
  if (lod < 2) {
    // Nose: a narrow bridge from between the eyes, widening and lifting at the tip and wings.
    blob(b, {
      c: [0, HEAD[1] - 0.06, HEAD[2] + 0.285],
      r: [0.04, 0.1, 0.05],
      seg: pick(lod, 10, 6, 6),
      rows: pick(lod, 8, 5, 5),
      uv: U.skin,
      skin: headSkin,
      deform: (v, dx, dy, dz) => {
        const tip = smoothstep(0.2, -0.8, dy);
        v.x = HEAD[0] + 0.04 * dx * (0.45 + 0.75 * tip);
        if (dz > 0) v.z += 0.022 * dz * tip * (1 - 0.5 * Math.abs(dx));
        if (dy < -0.6) v.z -= 0.02 * (-dy - 0.6);
        v.ao = 0.9 + 0.08 * Math.max(0, dz);
      },
    });
  }
  if (!covered) {
    for (const s of [1, -1]) {
      // Ears: level with the eyes and nose, behind the jaw, standing a little off the head.
      blob(b, {
        c: [s * 0.248, HEAD[1] - 0.04, HEAD[2] - 0.05],
        r: [0.03, 0.105, 0.068],
        seg: pick(lod, 8, 6, 4),
        rows: pick(lod, 6, 4, 3),
        uv: U.skin,
        skin: headSkin,
        deform: (v, dx, dy, dz) => {
          v.x += s * 0.018 * Math.max(0, -dz) * (0.5 + 0.5 * dy);
          v.z -= 0.025 * dy;
          v.ao = dx * s > 0 ? 0.8 + 0.12 * Math.abs(dz) : 0.72;
        },
      });
    }
  }
  // Hair: over the top and down to the nape, with a hairline across the forehead.
  if (o.head !== "catcher") {
    blob(b, {
      c: HEAD,
      r: scaled(1.045),
      seg: pick(lod, 20, 12, 8),
      rows: pick(lod, 9, 6, 4),
      polar1: (th) => 1.62 - 0.62 * Math.sin(th),
      uv: U.hair,
      skin: headSkin,
      deform: (v, dx, dy, dz) => {
        headDeform(v, dx, dy, dz);
        v.ao = 0.85;
      },
    });
  }

  const seg = pick(lod, 20, 10, 8);
  const rows = pick(lod, 9, 6, 4);
  const top = HEAD[1];
  if (o.head === "cap" || o.head === "umpire") {
    const k = 1.09;
    const crown = {
      c: HEAD,
      r: scaled(k),
      seg: Math.ceil(seg / 2),
      rows,
      polar1: (th: number) => 1.3 - 0.22 * Math.sin(th),
      skin: headSkin,
      deform: (v: VOut, dx: number, dy: number, dz: number) => {
        headDeform(v, dx, dy, dz);
        // A structured crown: taller and squarer in front.
        if (dz > 0) v.z += 0.025 * dz * smoothstep(0.2, 0.7, dy);
        v.y += 0.012 * smoothstep(0.3, 0.9, dy);
        v.ao = 0.82 + 0.18 * smoothstep(0.2, 0.8, dy);
      },
    };
    // Front half carries the club's mark (umpires' caps paint that panel plain); the back is flat colour.
    blob(b, { ...crown, theta0: 0, arc: PI, uv: o.head === "umpire" ? U.cap : frontUV(PANEL.capFront) });
    blob(b, { ...crown, theta0: PI, arc: PI, uv: U.cap });
    // Button on the crown.
    if (lod < 2) blob(b, { c: [0, HEAD[1] + HEAD_R[1] * k + 0.012, HEAD[2]], r: [0.03, 0.014, 0.03], seg: 6, rows: 3, uv: U.brim, skin: headSkin });
    const len = o.head === "umpire" ? 0.13 : 0.2;
    brim(b, top + 0.175, HEAD[2] + 0.24 + len, 0.235, len, U.brim, lod);
  } else {
    const flapAt = o.flap > 0 ? 0 : PI;
    const catcher = o.head === "catcher";
    const shell = {
      c: HEAD,
      r: scaled(1.14),
      seg: Math.ceil(seg / 2),
      rows: rows + 1,
      polar1: (th: number) => {
        if (catcher) return 1.78 - 0.56 * Math.sin(th);
        const base = 1.5 - 0.34 * Math.sin(th);
        return o.head === "flap" ? base + 0.72 * gauss(dAng(th, flapAt), 0.55) : base;
      },
      skin: headSkin,
      deform: (v: VOut, dx: number, dy: number, dz: number) => {
        headDeform(v, dx, dy, dz);
        v.y += 0.015 * smoothstep(0.3, 0.9, dy);
        v.ao = 0.85 + 0.15 * smoothstep(-0.2, 0.6, dy);
      },
    };
    // The catcher's skull cap is worn backwards: no mark in front.
    blob(b, { ...shell, theta0: 0, arc: PI, uv: catcher ? U.helmet : frontUV(PANEL.helmetFront) });
    blob(b, { ...shell, theta0: PI, arc: PI, uv: U.helmet });
    if (!catcher) brim(b, top + 0.165, HEAD[2] + 0.4, 0.21, 0.15, U.helmet, lod);
  }
  if (o.head === "catcher" || o.head === "umpire") mask(b, lod);
}

/** Head-on projection onto a cap/helmet front panel: 0.6 ft across, 0.3 ft tall, centred over the brim. */
function frontUV(panel: Rect): UVFn {
  return (v) => panelUV(v, panel, 0.5 + v.x / 0.6, 0.5 - (v.y - (HEAD[1] + 0.29)) / 0.3);
}

function brim(b: MeshBuilder, y: number, z: number, rx: number, rz: number, uv: UVFn, lod: Lod) {
  blob(b, {
    c: [0, y, z],
    r: [rx, 0.016, rz],
    seg: pick(lod, 12, 10, 8),
    rows: pick(lod, 5, 4, 3),
    uv,
    skin: headSkin,
    deform: (v, dx, dy) => {
      // Curved down at the sides; the underside is in shade.
      v.y -= 0.07 * dx * dx;
      v.ao = dy < 0 ? 0.6 : 1;
    },
  });
}

/** Catcher's / umpire's mask: a padded frame and a cage of steel bars in front of the face. */
function mask(b: MeshBuilder, lod: Lod) {
  const sides = pick(lod, 5, 4, 3);
  const cy = HEAD[1] - 0.05;
  const zf = HEAD[2] + 0.35;
  const frame: V3[] = [];
  const n = pick(lod, 12, 10, 8);
  for (let i = 0; i <= n; i += 1) {
    const a = (i / n) * 2 * PI;
    const x = 0.21 * Math.cos(a);
    frame.push([x, cy + 0.29 * Math.sin(a), zf - 0.5 * x * x * 4]);
  }
  tube(b, frame, 0.024, sides, U.gearDark, headSkin);
  const bar = (y: number, w: number) => {
    const pts: V3[] = [];
    const m = pick(lod, 4, 4, 2);
    for (let i = 0; i <= m; i += 1) {
      const x = -w + (2 * w * i) / m;
      pts.push([x, y, zf + 0.07 - 1.6 * x * x]);
    }
    tube(b, pts, 0.011, sides, U.metal, headSkin);
  };
  bar(cy + 0.12, 0.17);
  bar(cy - 0.02, 0.2);
  bar(cy - 0.16, 0.17);
  if (lod === 0) {
    tube(
      b,
      [
        [0, cy + 0.27, zf + 0.02],
        [0, cy + 0.12, zf + 0.07],
        [0, cy - 0.16, zf + 0.07],
        [0, cy - 0.28, zf + 0.02],
      ],
      0.011,
      sides,
      U.metal,
      headSkin,
    );
  }
}

function hand(b: MeshBuilder, side: number, o: Outfit, lod: Lod) {
  const bone = side > 0 ? BONE.handL : BONE.handR;
  const skin = rigid(bone);
  const hx = side * DIM.shoulderX;
  const hy = Y0 + DIM.shoulderY - DIM.upperArm - DIM.foreArm;
  const at = (x: number, y: number, z: number): V3 => [hx + x, hy + y, z];
  if (o.glove === side) {
    glove(b, side, hx, hy, o.mitt, lod, skin);
    return;
  }
  if (o.fists) {
    // Closed round a handle that runs across the palm (the hand's X axis).
    blob(b, {
      c: at(0, -0.015, 0.012),
      r: [0.098, 0.108, 0.088],
      seg: pick(lod, 10, 8, 6),
      rows: pick(lod, 7, 6, 4),
      uv: U.hand,
      skin,
      deform: (v, dx, dy, dz) => {
        // Knuckle ridges across the fingers.
        v.ao = dz > 0.2 ? 0.8 + 0.2 * Math.abs(Math.cos(dy * 5.5)) : 0.95;
      },
    });
    if (lod === 0) tube(b, [at(side * 0.085, 0.04, 0.05), at(side * 0.02, -0.01, 0.105), at(-side * 0.05, -0.03, 0.098)], 0.026, 5, U.hand, skin);
    return;
  }
  if (lod > 0) {
    blob(b, { c: at(0, -0.09, 0.02), r: [0.082, 0.21, 0.045], seg: 6, rows: 4, uv: U.hand, skin });
    return;
  }
  // Open hand: palm, four relaxed fingers and the thumb (on the side that faces forward when the arm hangs).
  blob(b, { c: at(0, -0.005, 0), r: [0.088, 0.12, 0.037], seg: 8, rows: 5, uv: U.hand, skin });
  const len = [0.9, 1, 0.95, 0.78];
  for (let i = 0; i < 4; i += 1) {
    const x = side * (0.064 - i * 0.0427);
    const l = len[i];
    tube(b, [at(x, -0.085, 0.004), at(x, -0.085 - 0.1 * l, 0.014), at(x * 0.98, -0.085 - 0.18 * l, 0.042), at(x * 0.95, -0.085 - 0.235 * l, 0.078)], [0.023, 0.022, 0.02, 0.018], 5, U.hand, skin);
  }
  tube(b, [at(side * 0.07, 0.045, 0.012), at(side * 0.125, -0.03, 0.04), at(side * 0.15, -0.115, 0.062)], [0.027, 0.025, 0.021], 5, U.hand, skin);
}

function glove(b: MeshBuilder, side: number, hx: number, hy: number, mitt: boolean, lod: Lod, skin: SkinFn) {
  // Fingers along −Y, pocket facing +Z, thumb on the `side` edge.
  const fingers = !mitt && lod === 0;
  const c: V3 = [hx, hy - (fingers ? 0.1 : 0.13), 0.03];
  const r: V3 = mitt ? [0.31, 0.33, 0.15] : fingers ? [0.25, 0.285, 0.12] : [0.26, 0.345, 0.12];
  const G = PANEL.glove;
  // The leather is painted: the back on the left half of the panel, the pocket on the right;
  // across runs from the little finger to the thumb, down from the fingertips to the heel.
  const paint = (v: VOut, dx: number, dy: number, half: number) => panelUV(v, G, half + 0.02 + 0.46 * (0.5 + 0.5 * dx * side), fingers ? 0.63 - 0.33 * dy : 0.5 - 0.5 * dy);
  const shape = (v: VOut, dx: number, dy: number, dz: number) => {
    // The pocket is a dish; the thumb is a separate lobe set a little higher; the heel narrows to the wrist.
    if (dz > 0) v.z -= (mitt ? 0.2 : 0.17) * dz * dz;
    const th = smoothstep(0.35, 0.9, dx * side);
    v.x += side * 0.04 * th;
    v.y += 0.09 * th;
    if (dy > 0.3) v.x = c[0] + (v.x - c[0]) * (1 - 0.45 * smoothstep(0.3, 1, dy));
    if (!mitt && !fingers && dy < -0.2) {
      // Finger stalls.
      const k = Math.abs(Math.cos((dx * side + 0.15) * 5.2));
      v.y += 0.035 * (1 - k) * smoothstep(-0.2, -0.8, dy);
      v.ao = 0.72 + 0.28 * k;
    } else v.ao = 0.92;
  };
  const seg = pick(lod, 10, 8, 5);
  const rows = pick(lod, 10, 8, 5);
  const none: UVFn = () => {};
  // Back of the glove, then the pocket side.
  blob(b, {
    c,
    r,
    seg,
    rows,
    theta0: PI,
    arc: PI,
    uv: none,
    skin,
    deform: (v, dx, dy, dz) => {
      shape(v, dx, dy, dz);
      paint(v, dx, dy, 0);
    },
  });
  blob(b, {
    c,
    r,
    seg,
    rows,
    theta0: 0,
    arc: PI,
    uv: none,
    skin,
    deform: (v, dx, dy, dz) => {
      shape(v, dx, dy, dz);
      paint(v, dx, dy, 0.5);
      v.ao = 0.72 + 0.28 * (1 - dz * dz);
    },
  });
  if (!fingers) return;
  // Four finger stalls curling round the pocket, the thumb, and the laced web between thumb and forefinger.
  const stall = (t: number): UVFn => (o) => panelUV(o, G, 0.02 + 0.46 * t, 0.06);
  const xs = [0.085, -0.01, -0.105, -0.19];
  const len = [0.94, 1, 0.95, 0.8];
  for (let i = 0; i < 4; i += 1) {
    const x = hx + side * xs[i];
    const l = len[i];
    tube(
      b,
      [
        [x, hy - 0.2, 0.028],
        [x + side * 0.004 * (1.5 - i), hy - 0.2 - 0.17 * l, 0.036],
        [x + side * 0.008 * (1.5 - i), hy - 0.2 - 0.3 * l, 0.066],
      ],
      [0.058, 0.054, 0.044],
      6,
      stall(0.5 + (0.5 * xs[i]) / 0.25),
      skin,
    );
  }
  tube(
    b,
    [
      [hx + side * 0.2, hy - 0.02, 0.03],
      [hx + side * 0.268, hy - 0.16, 0.04],
      [hx + side * 0.278, hy - 0.33, 0.07],
    ],
    [0.066, 0.062, 0.048],
    6,
    stall(0.97),
    skin,
  );
  blob(b, {
    c: [hx + side * 0.2, hy - 0.3, 0.05],
    r: [0.085, 0.13, 0.02],
    seg: 6,
    rows: 4,
    uv: (o, t, sv) => panelUV(o, G, 0.5 + 0.02 + 0.46 * (0.66 + 0.3 * Math.abs(2 * t - 1)), 0.05 + 0.4 * sv),
    skin,
  });
}

/** Catcher's gear: chest protector and shin guards with knee caps. */
function gear(b: MeshBuilder, lod: Lod) {
  const seg = pick(lod, 32, 16, 12);
  const ribs = (_th: number, y: number) => 0.78 + 0.22 * Math.abs(Math.sin((y - Y0) * 9));
  loft(
    b,
    rings(
      [
        [2.0, 0.36, 0.225],
        [1.86, 0.78, 0.335],
        [1.72, 0.8, 0.36],
        [1.58, 0.765, 0.385, 0.012],
        [1.3, 0.67, 0.39, 0.02],
        [0.95, 0.585, 0.35, 0.01],
        [0.62, 0.535, 0.335],
        [0.44, 0.45, 0.33],
      ],
      (o, t) => panelUV(o, PANEL.chest, 1 - t, (2.0 - (o.y - Y0)) / 1.56),
      0.025,
    ),
    { seg: seg / 2, skin: torsoSkin, theta0: PI / 2 - 1.2, arc: 2.4, n: 2.5, shade: ribs },
  );
  for (const side of [1, -1]) {
    const x0 = side * DIM.hipX;
    const yh = Y0 + DIM.hipY;
    const skin = rigid(side > 0 ? BONE.shinL : BONE.shinR);
    const r = (d: number, rad: number, uv?: UVFn): Ring => ({ y: yh - d, rx: rad, rz: rad * 1.06, cx: x0, cz: 0.012, uv });
    loft(b, [r(1.6, 0.21, U.gear), r(1.9, 0.212), r(2.15, 0.205), r(2.5, 0.165), r(2.9, 0.14)], {
      seg: pick(lod, 6, 6, 4),
      skin,
      theta0: PI / 2 - 1.0,
      arc: 2.0,
      shade: (_th, y) => 0.8 + 0.2 * Math.abs(Math.sin((yh - y) * 8)),
    });
    blob(b, { c: [x0, yh - 1.47, 0.155], r: [0.18, 0.22, 0.1], seg: pick(lod, 8, 7, 5), rows: pick(lod, 6, 6, 4), uv: U.gear, skin });
    // Instep flap over the laces.
    blob(b, { c: [x0, yh - 2.93, 0.17], r: [0.13, 0.1, 0.17], seg: pick(lod, 6, 6, 4), rows: pick(lod, 4, 4, 3), uv: U.gearDark, skin: rigid(side > 0 ? BONE.footL : BONE.footR) });
  }
}

/** Build the mesh for an outfit. `lod` 0 is the close-up model, 1 the mid-field one, 2 the distant one. */
export function buildBody(o: Outfit, lod: Lod): MeshData {
  const b = new MeshBuilder();
  trunk(b, lod);
  head(b, o, lod);
  for (const side of [1, -1]) {
    arm(b, side, lod);
    hand(b, side, o, lod);
    leg(b, side, lod);
    shoe(b, side, lod);
  }
  if (o.gear) gear(b, lod);
  return b.build();
}
