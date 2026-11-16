/**
 * The ballplayer mesh, built procedurally in the skeleton's rest pose (standing at the
 * origin facing +Z, arms and legs hanging straight down) and skinned to its bones.
 *
 * One mesh per outfit (cap or helmet, glove side, trouser style, catcher's gear, ...) and
 * level of detail is shared by everybody who wears it; who they are — uniform colours,
 * name and number, face — is all in the texture (atlas.ts / paint.ts).
 *
 * Proportions are those of a 5'11" athlete, eight heads tall (Person scales the figure to
 * each player's real height): the trunk is a column with the arms hanging outside it,
 * the deltoids and the sleeve heads ride a shoulder helper joint, elbows, hips and knees
 * bend through helpers of their own, wrists and ankles are ball joints.
 */
import type { ActorKind } from "@/components/game/scene/rig";
import { PANEL, hash01, panelUV, sw, type Rect } from "@/components/game/scene/character/atlas";
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
  /** Trousers worn long to the shoe tops (otherwise pulled up to the knee over high socks). */
  long: boolean;
  /** Jaw guard on the batting helmet. */
  cflap: boolean;
  /** Hitter's protection on the side facing the pitcher: elbow guard, shin and foot guard. */
  guards: boolean;
}

/** How a particular player wears the uniform. */
export interface Style {
  long: boolean;
  cflap: boolean;
  /** High socks: 0 plain, 1 striped, 2 stirrups. */
  sock: 0 | 1 | 2;
}

/** The player's habits, from his id (the texture painter and the mesh picker must agree). */
export function styleOf(seed: number): Style {
  const r = hash01(seed, 7);
  return { long: r >= 0.4, cflap: hash01(seed, 12) < 0.6, sock: r < 0.2 ? 0 : r < 0.32 ? 1 : 2 };
}

export function outfitFor(kind: ActorKind, hand: "L" | "R", style?: Partial<Style>): Outfit {
  const side = hand === "R" ? 1 : -1;
  const long = style?.long ?? true;
  const base = { flap: 1 as 1 | -1, glove: 0 as 1 | -1 | 0, mitt: false, fists: false, gear: false, long, cflap: false, guards: false };
  switch (kind) {
    case "catcher":
      return { ...base, head: "catcher", glove: side, mitt: true, gear: true };
    case "fielder":
    case "pitcher":
      return { ...base, head: "cap", glove: side };
    case "batter":
    case "runner":
      // The flap covers the ear that faces the pitcher.
      return { ...base, head: "flap", flap: side, fists: true, cflap: style?.cflap ?? false, guards: true };
    case "umpire":
      return { ...base, head: "umpire", long: true };
    default:
      return { ...base, head: "helmet", long: true };
  }
}

export const outfitKey = (o: Outfit) =>
  `${o.head}${o.flap}${o.glove}${o.mitt ? "m" : ""}${o.fists ? "f" : ""}${o.gear ? "g" : ""}${o.long ? "l" : "h"}${o.cflap ? "c" : ""}${o.guards ? "p" : ""}`;

/** Where the textures are mapped (paint.ts draws to the same numbers). */
export const JERSEY_TOP = 2.07;
export const JERSEY_HEM = 0.4;
/** How far the neckline drops in front of the collar's back edge (ft). */
export const NECK_DIP = 0.17;
/** Face panel: width and height (ft) of the area projected on the front of the head. */
export const FACE_W = 0.578;
export const FACE_H = 0.856;
/** Landmarks of the face (ft from the centre of the head), shared with the painter. */
export const FACE = { eyeX: 0.105, eyeY: 0.0, browY: 0.058, noseY: -0.158, mouthY: -0.238, chinY: -0.37, halfW: 0.25 } as const;
/** Lower-leg panel: runs from the knee to the ankle; knee-high trousers end this far down it (0..1). */
export const CUFF_AT = 0.34 / DIM.shin;

const Y0 = DIM.hip;
const PI = Math.PI;
const HEAD: V3 = [0, Y0 + DIM.headCY, DIM.headCZ];
const HEAD_R: V3 = [0.258, 0.382, 0.33];

const gauss = (a: number, s: number) => Math.exp(-(a * a) / (s * s));
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

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

/** How much of a point near a shoulder joint follows the shoulder helper (0 = stays with the chest). */
function shoulderPull(x: number, y: number, z: number): number {
  const dx = Math.abs(x) - DIM.shoulderX;
  const dy = y - DIM.shoulderY;
  return 0.72 * smoothstep(0.56, 0.1, Math.hypot(dx, dy * 0.9, z * 0.6));
}

/** Trunk: the pelvis hands over to the lumbar spine, and that to the chest; the shoulders lean toward the arms. */
const torsoSkin: SkinFn = (o) => {
  const y = o.y - Y0;
  if (y < 0.575) {
    o.b0 = BONE.pelvis;
    o.b1 = BONE.spine;
    o.w = smoothstep(0.05, 0.55, y);
  } else if (y < 1.3) {
    o.b0 = BONE.spine;
    o.b1 = BONE.chest;
    o.w = smoothstep(0.6, 1.25, y);
  } else {
    o.b0 = BONE.chest;
    o.b1 = o.x > 0 ? HELPER.shoulderL : HELPER.shoulderR;
    o.w = shoulderPull(o.x, y, o.z);
  }
};
const neckSkin: SkinFn = (o) => {
  const y = o.y - Y0;
  if (y < 2.11) {
    o.b0 = BONE.chest;
    o.b1 = BONE.neck;
    o.w = smoothstep(1.96, 2.1, y);
  } else {
    o.b0 = BONE.neck;
    o.b1 = BONE.head;
    o.w = smoothstep(2.12, 2.26, y);
  }
};
const headSkin: SkinFn = rigid(BONE.head);

/** [y (pelvis-relative), half-width, half-depth, centre z, keep at the distant level of detail]. */
type Row = [number, number, number, number?];
const rings = (rows: Row[], uv: UVFn, grow = 0): Ring[] =>
  rows.map((r, i) => ({ y: Y0 + r[0], rx: r[1] + grow, rz: r[2] + grow, cz: r[3] ?? 0, uv: i === 0 ? uv : undefined }));

/**
 * The jersey over the trunk: a collar round the base of the neck, the trapezius sloping
 * out to the point of the shoulder, a deep chest, and a long taper to the belt. The arms
 * hang outside this column (the joint is at x = 0.66), so the shoulders are the widest
 * thing on the figure and the waist is not pinched.
 */
const JERSEY: Row[] = [
  [JERSEY_TOP, 0.228, 0.214, -0.02],
  [2.048, 0.33, 0.228, -0.024],
  [2.018, 0.44, 0.246, -0.03],
  [1.982, 0.535, 0.268, -0.03],
  [1.94, 0.602, 0.292, -0.026],
  [1.875, 0.642, 0.318, -0.016],
  [1.79, 0.652, 0.342, -0.006],
  [1.66, 0.634, 0.366, 0.006],
  [1.52, 0.604, 0.38, 0.016],
  [1.4, 0.588, 0.384, 0.022],
  [1.26, 0.572, 0.374, 0.024],
  [1.1, 0.554, 0.356, 0.022],
  [0.94, 0.54, 0.342, 0.018],
  [0.78, 0.53, 0.332, 0.012],
  [0.64, 0.53, 0.332, 0.006],
  // Cloth bloused over the belt.
  [0.52, 0.538, 0.338, 0.002],
  [0.44, 0.532, 0.332, 0],
  [JERSEY_HEM, 0.502, 0.314],
];
/** How far each of the top rings drops in front to make the neckline. */
const DIP = [NECK_DIP, 0.158, 0.143, 0.127, 0.11, 0.075, 0.04];
const dipOf = (i: number, s: number) => (i < DIP.length && s > 0 ? DIP[i] * Math.pow(s, 1.5) : 0);

/** Outline of the seat of the trousers, from under the belt down past the crotch. */
const SEAT: Row[] = [
  [0.285, 0.49, 0.31, 0],
  [0.18, 0.522, 0.332, -0.008],
  [0.0, 0.558, 0.372, -0.03],
  [-0.2, 0.578, 0.39, -0.05],
  [-0.4, 0.584, 0.366, -0.04],
  [-0.7, 0.57, 0.32, -0.02],
];
const SEAT_N = 2.5;

/** Muscle and bone under the cloth of the trunk: how far the surface stands out (ft) at a point on it. */
function torsoRelief(x: number, y: number, front: number, back: number): number {
  const ax = Math.abs(x);
  let d = 0;
  // Pectorals either side of the sternum; the belly flat below them.
  d += front * 0.03 * gauss(ax - 0.27, 0.19) * gauss(y - 1.5, 0.2);
  d -= front * 0.012 * gauss(ax, 0.045) * gauss(y - 1.5, 0.28);
  d -= front * 0.012 * gauss(y - 1.24, 0.1) * smoothstep(0.5, 0.2, ax);
  // Spine furrow between the erectors, shoulder blades, the trapezius between them.
  d -= back * 0.02 * gauss(ax, 0.06) * smoothstep(0.5, 0.8, y) * smoothstep(1.98, 1.6, y);
  d += back * 0.022 * gauss(ax - 0.31, 0.17) * gauss(y - 1.56, 0.2);
  d += back * 0.012 * gauss(ax - 0.14, 0.09) * gauss(y - 0.95, 0.3);
  return d;
}

function trunk(b: MeshBuilder, o: Outfit, lod: Lod) {
  const seg = pick(lod, 48, 22, 12);
  const half = seg / 2;
  const span = JERSEY_TOP - JERSEY_HEM;
  // The umpire wears a chest protector under his shirt.
  const bulk = o.head === "umpire" ? 1 : 0;
  // Baked shade in the armpits and down the flanks, and under the chest.
  const shade = (th: number, y: number) =>
    1 - 0.26 * smoothstep(0.75, 1, Math.abs(Math.cos(th))) * gauss(y - Y0 - 1.42, 0.36) - 0.07 * gauss(y - Y0 - 0.5, 0.1) - 0.05 * Math.max(0, Math.sin(th)) * gauss(y - Y0 - 1.26, 0.1);
  const panel =
    (r: (typeof PANEL)[keyof typeof PANEL]): UVFn =>
    (v, t) =>
      panelUV(v, r, 1 - t, (JERSEY_TOP - (v.y - Y0)) / span);
  const rowsAll = JERSEY.map((r, i) => ({ r, i }));
  const rows = lod === 2 ? rowsAll.filter(({ i }) => i < 2 || i % 2 === 0 || i === JERSEY.length - 1) : rowsAll;
  const ringsOf = (uv: UVFn): Array<Ring & { i: number }> =>
    rows.map(({ r, i }, k) => {
      const g = bulk * 0.04 * smoothstep(0.5, 0.9, r[0]) * smoothstep(2.0, 1.8, r[0]);
      return { y: Y0 + r[0], rx: r[1] + g * 0.6, rz: r[2] + g, cz: (r[3] ?? 0) + g * 0.5, uv: k === 0 ? uv : undefined, i };
    });
  const shape = (v: VOut, ring: Ring, th: number) => {
    const s = Math.sin(th);
    const y = ring.y - Y0;
    const d = torsoRelief(v.x, y, Math.max(0, s), Math.max(0, -s));
    v.z += d * (s >= 0 ? 1 : -1);
    v.y -= dipOf((ring as Ring & { i: number }).i, s);
  };
  // The jersey is two half-wraps, so the front and the back each get a panel of their own.
  loft(b, ringsOf(panel(PANEL.front)), { seg: half, skin: torsoSkin, theta0: 0, arc: PI, n: 2.3, shade, shape });
  loft(b, ringsOf(panel(PANEL.back)), { seg: half, skin: torsoSkin, theta0: PI, arc: PI, n: 2.3, shade, shape });
  // Undershirt: a crew neck standing inside the open collar.
  const dip = (k: number) => (v: VOut, _r: Ring, th: number) => {
    v.y -= k * Math.pow(Math.max(0, Math.sin(th)), 1.5);
  };
  loft(
    b,
    [
      { y: Y0 + 2.088, rx: 0.202, rz: 0.196, cz: -0.022, uv: U.collar },
      { y: Y0 + 2.088, rx: 0.214, rz: 0.205, cz: -0.022 },
      { y: Y0 + 1.99, rx: 0.25, rz: 0.235, cz: -0.022, ao: 0.8 },
    ],
    { seg: Math.max(10, half), skin: torsoSkin, shape: dip(0.158) },
  );
  // The neck: a thick column leaning forward, the sternomastoids running down to the notch
  // of the collarbones and the trapezius flaring into the shoulders behind.
  loft(
    b,
    [
      { y: Y0 + 2.4, rx: 0.186, rz: 0.2, cz: 0.03, uv: U.skin, ao: 0.66 },
      { y: Y0 + 2.31, rx: 0.19, rz: 0.2, cz: 0.018, ao: 0.74 },
      { y: Y0 + 2.2, rx: 0.197, rz: 0.2, cz: 0.002, ao: 0.84 },
      { y: Y0 + 2.1, rx: 0.2, rz: 0.196, cz: -0.012, ao: 0.92 },
      { y: Y0 + 2.0, rx: 0.2, rz: 0.19, cz: -0.02 },
      { y: Y0 + 1.86, rx: 0.2, rz: 0.184, cz: -0.024, ao: 0.85 },
    ],
    {
      seg: pick(lod, 20, 12, 8),
      skin: neckSkin,
      post: (v, th) => {
        const y = v.y - Y0;
        const s = Math.sin(th);
        const c = Math.cos(th);
        const scm = 0.014 * gauss(Math.abs(c) - 0.5, 0.22) * Math.max(0, s) * smoothstep(2.38, 2.1, y);
        const apple = 0.012 * gauss(c, 0.2) * Math.max(0, s) * gauss(y - 2.2, 0.07);
        const trap = 0.04 * Math.max(0, -s) * (0.35 + 0.65 * c * c) * smoothstep(2.3, 2.0, y);
        v.x += c * (scm + trap * 0.7);
        v.z += s * (scm + apple) - Math.max(0, -s) * trap * 0.2;
      },
    },
  );
  // Belt, a touch proud of the trousers, with its loops and buckle.
  loft(
    b,
    [
      { y: Y0 + JERSEY_HEM, rx: 0.49, rz: 0.305, uv: U.belt },
      { y: Y0 + JERSEY_HEM, rx: 0.512, rz: 0.327 },
      { y: Y0 + 0.285, rx: 0.512, rz: 0.327 },
      { y: Y0 + 0.285, rx: 0.488, rz: 0.308 },
    ],
    { seg: Math.max(12, half), skin: torsoSkin, n: 2.5 },
  );
  if (lod < 2) blob(b, { c: [0, Y0 + 0.342, 0.327], r: [0.062, 0.05, 0.018], seg: 6, rows: 4, uv: U.buckle, skin: torsoSkin });
  if (lod === 0) {
    for (const [x, z] of [
      [0.2, 0.319],
      [-0.2, 0.319],
      [0.472, 0.12],
      [-0.472, 0.12],
      [0.3, -0.272],
      [-0.3, -0.272],
      [0, -0.327],
    ]) {
      blob(b, { c: [x, Y0 + 0.342, z], r: [Math.abs(z) > 0.2 ? 0.024 : 0.014, 0.07, Math.abs(z) > 0.2 ? 0.014 : 0.024], seg: 4, rows: 3, uv: U.pants, skin: torsoSkin, deform: (v) => void (v.ao = 0.9) });
    }
  }
  if (bulk && lod < 2) {
    // Ball bag on the umpire's hip.
    blob(b, { c: [-0.5, Y0 + 0.16, 0.16], r: [0.07, 0.17, 0.15], seg: 8, rows: 6, uv: U.gearDark, skin: torsoSkin });
  }
}

/** How far down the upper arm the sleeve reaches. */
const SLEEVE = 0.68;

function arm(b: MeshBuilder, side: number, o: Outfit, lod: Lod) {
  const seg = pick(lod, 18, 10, 6);
  const x0 = side * DIM.shoulderX;
  const ys = Y0 + DIM.shoulderY;
  const bone = side > 0 ? BONE.armL : BONE.armR;
  const elbow = side > 0 ? HELPER.elbowL : HELPER.elbowR;
  const shoulder = side > 0 ? HELPER.shoulderL : HELPER.shoulderR;
  const E = DIM.upperArm;
  const W = E + DIM.wrist;
  const skin: SkinFn = (v) => {
    const d = ys - v.y;
    if (d < 0.36) {
      // The sleeve head turns half as far as the arm, so a raised arm does not tear out of the shoulder.
      v.b0 = shoulder;
      v.b1 = bone;
      v.w = smoothstep(-0.22, 0.36, d);
    } else if (d < E) {
      v.b0 = bone;
      v.b1 = elbow;
      v.w = smoothstep(E - 0.3, E, d);
    } else {
      v.b0 = elbow;
      v.b1 = bone + 1;
      v.w = smoothstep(E, E + 0.3, d);
    }
  };
  const CAP = 0.125;
  // The sleeve unwraps from the armpit, so the outside of the arm is the middle of its panel.
  const sleeve: UVFn = (v, t) => panelUV(v, PANEL.sleeve, t, (ys - v.y + CAP) / (SLEEVE + CAP));
  // rx across the arm, rz front-to-back (k = rz / rx): the arm is not a cylinder.
  const r = (d: number, rad: number, uv?: UVFn, ao?: number, cz = 0, keep = true, k = 1.05, dx = 0): Ring & { keep: boolean } => ({ y: ys - d, rx: rad, rz: rad * k, cx: x0 + side * dx, cz, uv, ao, keep });
  const all = [
    // Deltoid: a low dome over the joint, its crown tucked in toward the neck under the shoulder seam.
    r(-CAP, 0, sleeve, undefined, 0, true, 1, -0.06),
    r(-0.118, 0.06, undefined, undefined, 0, true, 1.1, -0.05),
    r(-0.098, 0.11, undefined, undefined, 0, false, 1.1, -0.036),
    r(-0.064, 0.152, undefined, undefined, 0, true, 1.1, -0.02),
    r(-0.015, 0.182, undefined, undefined, 0, false, 1.1, -0.008),
    r(0.05, 0.198, undefined, undefined, 0.002, true, 1.1, 0),
    r(0.14, 0.203, undefined, undefined, 0.004, true, 1.1, 0.004),
    r(0.27, 0.196, undefined, undefined, 0.004, false, 1.09, 0.002),
    r(0.41, 0.189, undefined, undefined, 0.006, true, 1.08, 0),
    r(0.55, 0.187, undefined, undefined, 0.008, false, 1.07, 0),
    // Sleeve hem, then the arm (or undershirt) coming out of it: biceps in front, triceps behind.
    r(SLEEVE, 0.192, U.sleeve, undefined, 0.008, true, 1.06),
    r(SLEEVE, 0.174, undefined, 0.5, 0.012, true, 1.1),
    r(0.78, 0.174, undefined, 0.84, 0.016, false, 1.12),
    r(0.88, 0.166, undefined, 1, 0.014, true, 1.1),
    r(0.99, 0.15, undefined, 1, 0.004, false, 1.06),
    // Elbow: narrow across, the point of the olecranon behind.
    r(E, 0.142, undefined, 1, -0.012, true, 1.08),
    // Forearm: the muscle belly just below the elbow, tapering to a flat wrist.
    r(E + 0.11, 0.158, undefined, 1, 0.006, false, 1.0),
    r(E + 0.23, 0.162, undefined, 1, 0.008, true, 0.95),
    r(E + 0.38, 0.15, undefined, 1, 0.005, false, 0.9),
    r(E + 0.54, 0.13, undefined, 1, 0.002, true, 0.86),
    r(E + 0.68, 0.112, undefined, 1, 0, true, 0.8),
    r(W - 0.09, 0.106, U.wrist, undefined, 0, true, 0.76),
    r(W, 0.104, U.hand, undefined, 0, true, 0.74),
    r(W + 0.05, 0.098, undefined, undefined, 0, true, 0.7),
    r(W + 0.07, 0, undefined, undefined, 0, true, 0.7),
  ];
  loft(b, lod > 0 ? all.filter((x) => x.keep) : all, { seg, skin, theta0: side > 0 ? PI : 0 });
  if (o.guards && o.flap === side && lod < 2) {
    // Elbow guard: a hard shell strapped over the back and outside of the leading elbow.
    const g = (d: number, rad: number, uv?: UVFn): Ring => ({ y: ys - d, rx: rad, rz: rad * 1.08, cx: x0, cz: -0.006, uv });
    loft(b, [g(E - 0.25, 0.16, U.helmet), g(E - 0.23, 0.178), g(E - 0.08, 0.176), g(E, 0.172), g(E + 0.1, 0.182), g(E + 0.24, 0.176), g(E + 0.27, 0.158)], {
      seg: pick(lod, 12, 8, 6),
      skin,
      // Wraps the back and the outside of the joint.
      theta0: side > 0 ? -PI * 0.75 : PI * 0.75,
      arc: PI,
      shade: (_th, y) => 0.9 + 0.1 * Math.abs(Math.sin((ys - y) * 14)),
    });
  }
}

/** Depth of the crotch below the hip joints. */
const CROTCH = 0.43;

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
 * below, a round thigh. Hips and knees bend through their helper joints. Worn long, the
 * cloth runs to a break over the shoe; worn high, it ends under the knee and the sock
 * shows the calf.
 */
function leg(b: MeshBuilder, side: number, o: Outfit, lod: Lod) {
  const seg = pick(lod, 22, 10, 8);
  const x0 = side * DIM.hipX;
  const yh = Y0 + DIM.hipY;
  const thigh = side > 0 ? BONE.thighL : BONE.thighR;
  const hip = side > 0 ? HELPER.hipL : HELPER.hipR;
  const knee = side > 0 ? HELPER.kneeL : HELPER.kneeR;
  const T = DIM.thigh;
  const TOP = -0.335;
  const skin: SkinFn = (v) => {
    const d = yh - v.y;
    if (d < 0.95) {
      // Seat → hip helper → thigh; the midline (fly and seam) stays with the pelvis.
      const g = Math.max(smoothstep(0.02, 0.26, Math.abs(v.x)), smoothstep(CROTCH - 0.04, CROTCH + 0.14, d));
      const q = (smoothstep(-0.1, 0.22, d) + smoothstep(0.22, 0.68, d)) * g;
      if (q <= 0) torsoSkin(v);
      else if (q <= 1) {
        v.b0 = BONE.pelvis;
        v.b1 = hip;
        v.w = q;
      } else {
        v.b0 = hip;
        v.b1 = thigh;
        v.w = q - 1;
      }
    } else if (d < T) {
      v.b0 = thigh;
      v.b1 = knee;
      v.w = smoothstep(T - 0.32, T, d);
    } else {
      v.b0 = knee;
      v.b1 = thigh + 1;
      v.w = smoothstep(T, T + 0.32, d);
    }
  };
  const upper: UVFn = (v, t) => panelUV(v, PANEL.pants, t, (yh - v.y - TOP) / (T - TOP));
  const lower: UVFn = (v, t) => panelUV(v, PANEL.lower, t, (yh - v.y - T) / DIM.shin);
  // k = rz / rx: thighs deeper than wide, the calf a deep oval behind a flat shin.
  const r = (d: number, rad: number, cz = 0, keep = true, uv?: UVFn, ao?: number, k = 1.06): Ring & { keep: boolean } => ({ y: yh - d, rx: rad, rz: rad * k, cx: x0, cz, uv, ao, keep });
  const cuff = T + CUFF_AT * DIM.shin;
  const END = T + DIM.shin;
  const all = [
    r(TOP, 0.29, 0, true, upper),
    r(-0.22, 0.29, 0, false),
    r(-0.08, 0.29),
    r(0.06, 0.29, 0, false),
    r(0.2, 0.29),
    r(0.33, 0.29, -0.005, false),
    r(CROTCH, 0.292, -0.004, true, undefined, undefined, 1.12),
    // Quadriceps filling the front of the trousers, the hamstrings behind, tapering to the knee.
    r(0.6, 0.288, 0.012, false, undefined, undefined, 1.15),
    r(0.8, 0.274, 0.02, true, undefined, undefined, 1.15),
    r(1.0, 0.252, 0.024, false, undefined, undefined, 1.12),
    r(1.16, 0.232, 0.024, true, undefined, undefined, 1.08),
    r(1.3, 0.216, 0.026, false, undefined, undefined, 1.05),
    // Knee: the kneecap in front.
    r(1.4, 0.207, 0.032, true, undefined, undefined, 1.05),
    r(T, 0.206, 0.032, true, lower, undefined, 1.05),
    ...(o.long
      ? [
          // Straight-cut cloth hanging off the calf to a break over the laces.
          r(T + 0.12, 0.202, 0.02),
          r(T + 0.3, 0.197, 0.002, false, undefined, undefined, 1.08),
          r(T + 0.5, 0.194, -0.014, true, undefined, undefined, 1.1),
          r(T + 0.72, 0.188, -0.018, false, undefined, undefined, 1.1),
          r(T + 0.94, 0.178, -0.012, true, undefined, undefined, 1.08),
          r(T + 1.14, 0.168, 0, false, undefined, undefined, 1.08),
          r(T + 1.3, 0.164, 0.016, true, undefined, undefined, 1.12),
          r(T + 1.4, 0.168, 0.034, true, undefined, undefined, 1.2),
          r(END, 0.172, 0.04, true, undefined, undefined, 1.24),
          r(END, 0.11, 0.01, true, undefined, 0.5, 1.1),
        ]
      : [
          r(T + 0.1, 0.2, 0.02),
          r(T + 0.2, 0.198, 0.008, false),
          r(T + 0.28, 0.2, -0.002),
          // Trousers bloused over the top of the calf, then the sock over the calf muscle.
          r(cuff, 0.203, -0.01),
          r(cuff, 0.168, -0.02, true, undefined, 0.55, 1.12),
          r(T + 0.5, 0.176, -0.04, false, undefined, undefined, 1.2),
          r(T + 0.64, 0.18, -0.046, true, undefined, undefined, 1.22),
          r(T + 0.82, 0.168, -0.04, false, undefined, undefined, 1.2),
          r(T + 1.02, 0.142, -0.022, true, undefined, undefined, 1.12),
          r(T + 1.22, 0.122, -0.008, false, undefined, undefined, 1.06),
          r(T + 1.37, 0.114, 0, true, undefined, undefined, 1.1),
          r(END, 0.112, 0, true, undefined, undefined, 1.1),
        ]),
  ];
  const dth = (2 * PI) / seg;
  const inner = side > 0 ? PI : 0;
  loft(b, lod > 0 ? all.filter((x) => x.keep) : all, {
    seg,
    skin,
    // The unwrap starts on the inseam, so the outseam (the piping) is the middle of the strip.
    theta0: side > 0 ? -PI : 0,
    shade: (th, y) => 1 - 0.3 * Math.pow(Math.max(0, Math.cos(th - inner)), 2) * smoothstep(1.3, 0.3, yh - y),
    shape: (v, ring, th0) => {
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
      v.x = x0 + R * c;
      v.z = (ring.cz ?? 0) * (1 - k) + R * s * (1 + 0.06 * (1 - k));
      if (Math.abs(v.x) < 2e-4) v.x = 0;
    },
  });
  if (o.guards && o.flap === side && lod < 2) {
    // Shin guard on the leading leg, with a flap over the instep.
    const shin = rigid(thigh + 1);
    const g = (d: number, rad: number, uv?: UVFn): Ring => ({ y: yh - d, rx: rad, rz: rad * 1.12, cx: x0, cz: 0.012, uv });
    const big = o.long ? 0.035 : 0;
    loft(b, [g(T + 0.52, 0.185 + big, U.helmet), g(T + 0.56, 0.2 + big), g(T + 0.8, 0.198 + big), g(T + 1.0, 0.182 + big * 0.8), g(T + 1.25, 0.16 + big * 0.6), g(T + 1.33, 0.14 + big * 0.5)], {
      seg: pick(lod, 10, 6, 4),
      skin: shin,
      theta0: PI / 2 - 0.85,
      arc: 1.7,
      shade: (_th, y) => 0.8 + 0.2 * Math.abs(Math.sin((yh - y) * 9)),
    });
    blob(b, { c: [x0, yh - END + 0.07, 0.2], r: [0.15, 0.11, 0.2], seg: pick(lod, 8, 6, 4), rows: pick(lod, 5, 4, 3), uv: U.helmet, skin: rigid(thigh + 2) });
  }
}

/** A cleat: low-cut upper over a moulded plate with studs. */
function shoe(b: MeshBuilder, side: number, lod: Lod) {
  const bone = side > 0 ? BONE.footL : BONE.footR;
  const skin = rigid(bone);
  const x0 = side * DIM.hipX;
  const ya = Y0 + DIM.hipY - DIM.thigh - DIM.shin;
  const c: V3 = [x0, ya - 0.005, 0.21];
  const r: V3 = [0.172, 0.16, 0.47];
  const top = ya + 0.165;
  const bottom = ya - DIM.ankle;
  const plate = bottom + 0.03;
  const uv: UVFn = (v) => panelUV(v, PANEL.shoe, (c[2] + r[2] - v.z) / (2 * r[2]), (top - v.y) / (top - bottom));
  const seg = pick(lod, 18, 10, 6);
  blob(b, {
    c,
    r,
    seg,
    rows: pick(lod, 12, 7, 4),
    uv,
    skin,
    deform: (v, dx, dy, dz) => {
      // Low toe box, a collar round the ankle, a narrower heel; flat where it meets the sole.
      if (dy > 0) v.y = c[1] + r[1] * dy * (dz > 0 ? 1 - 0.6 * dz * dz : 1 + 0.25 * dz * dz);
      if (dz < 0) v.x = c[0] + r[0] * dx * (1 + 0.22 * dz);
      else v.x = c[0] + r[0] * dx * (1 - 0.14 * dz * dz) + side * 0.02 * dz * dz;
      v.y = Math.max(v.y, ya - 0.085);
      v.ao = 0.78 + 0.22 * smoothstep(-0.6, 0.3, dy);
    },
  });
  loft(
    b,
    [
      { y: ya - 0.078, rx: 0.18, rz: 0.48, cx: x0, cz: 0.21, uv: U.sole },
      { y: plate, rx: 0.172, rz: 0.47, cx: x0, cz: 0.21 },
      { y: plate, rx: 0, rz: 0, cx: x0, cz: 0.21, ao: 0.6 },
    ],
    { seg, skin, n: 2.4 },
  );
  // Studs: three under the ball of the foot, two at the toe, two under the heel.
  const studs: Array<[number, number]> =
    lod === 0
      ? [
          [0.09, 0.5],
          [-0.09, 0.5],
          [0.1, 0.3],
          [-0.1, 0.3],
          [0, 0.4],
          [0.08, -0.14],
          [-0.08, -0.14],
        ]
      : [
          [0, 0.4],
          [0, -0.12],
        ];
  for (const [sx, sz] of studs) {
    const big = lod === 0 ? 1 : 2.2;
    loft(
      b,
      [
        { y: plate, rx: 0.034 * big, rz: 0.04 * big, cx: x0 + sx, cz: sz, uv: U.metal, ao: 0.7 },
        { y: bottom, rx: 0.022 * big, rz: 0.028 * big, cx: x0 + sx, cz: sz, ao: 0.7 },
        { y: bottom, rx: 0, rz: 0, cx: x0 + sx, cz: sz, ao: 0.7 },
      ],
      { seg: lod === 0 ? 5 : 4, skin },
    );
  }
}

/**
 * Shape of the head (and of everything worn on it), applied to a point of the ellipsoid:
 * a wide cranium, the face flatter across than the skull, the jaw swung forward under the
 * face (so the chin sits below the mouth, not below the ears) and narrowing to the chin.
 */
function skullShape(v: VOut, _dx: number, dy: number, dz: number) {
  const f = Math.max(0, dz);
  const back = Math.max(0, -dz);
  const j = smoothstep(0, 1, -dy);
  const chin = smoothstep(0.5, 1, -dy);
  v.z += 0.16 * j * j + 0.1 * back * j;
  v.x *= 1 - 0.17 * j - 0.26 * chin * (0.35 + 0.65 * f);
  // The back of the skull bulges over the nape; the brow is squarer than an ellipsoid.
  v.z -= 0.03 * back * gauss(dy - 0.1, 0.45);
  v.x *= 1 - 0.05 * f * f * smoothstep(-0.5, 0.3, dy);
  v.z += 0.012 * f * gauss(dy - 0.35, 0.25);
  // The crown is fuller than an ellipsoid.
  const top = 1 + 0.1 * gauss(dy - 0.7, 0.28);
  v.x *= top;
  v.z = HEAD[2] + (v.z - HEAD[2]) * top;
  // Flat under the jaw.
  const floor = HEAD[1] - HEAD_R[1] * 0.985;
  if (v.y < floor) v.y = floor + (v.y - floor) * 0.4;
}

/** Relief of the face (ft, out of the face) at a point of the face plane; `fine` adds the small forms. */
function faceRelief(x: number, y: number, fine: boolean): number {
  const ax = Math.abs(x);
  let z = 0;
  // Nose: a narrow bridge from between the brows, widening to the tip and the wings, cut off underneath.
  if (y < 0.1 && y > -0.21) {
    const u = clamp01((0.075 - y) / 0.22);
    const under = smoothstep(-0.132, -0.176, y);
    const h = (0.012 + 0.082 * Math.pow(u, 1.25)) * (1 - under) * smoothstep(0.1, 0.05, y);
    z += h * gauss(x, (fine ? 0.019 : 0.03) + 0.019 * u * u);
    if (fine) z += 0.017 * gauss(ax - 0.04, 0.02) * gauss(y + 0.136, 0.022);
  }
  if (!fine) return z;
  // Brow ridge (dipping at the glabella), the sockets under it and the lids over the eyeballs.
  z += 0.02 * gauss(y - 0.066, 0.036) * smoothstep(0.25, 0.1, ax) * (1 - 0.3 * gauss(x, 0.03));
  z -= 0.036 * gauss(ax - FACE.eyeX, 0.062) * gauss(y - 0.004, 0.042);
  z += 0.015 * gauss(ax - FACE.eyeX, 0.04) * gauss(y + 0.002, 0.026);
  // Cheekbones, the muzzle the lips sit on, the groove under the lower lip, the chin.
  z += 0.014 * gauss(ax - 0.17, 0.07) * gauss(y + 0.055, 0.06);
  z += 0.02 * gauss(x, 0.1) * gauss(y + 0.236, 0.055);
  z += 0.006 * gauss(x, 0.06) * gauss(y + 0.252, 0.02);
  z -= 0.012 * gauss(x, 0.075) * gauss(y + 0.296, 0.022);
  z += 0.022 * gauss(x, 0.078) * gauss(y + 0.338, 0.036);
  // Hollow of the temples and under the cheekbones.
  z -= 0.008 * gauss(ax - 0.15, 0.06) * gauss(y + 0.19, 0.06);
  return z;
}

const scaled = (k: number): V3 => [HEAD_R[0] * k, HEAD_R[1] * k, HEAD_R[2] * k];
/** Angular distance between two azimuths. */
const dAng = (a: number, c: number) => Math.abs(((((a - c) % (2 * PI)) + 3 * PI) % (2 * PI)) - PI);

/** Rows of the head are packed between the brow and the chin, columns toward the middle of the face. */
const rowWarp = (s: number) => s + (0.42 * (Math.sin(2 * PI * (s - 0.13)) + Math.sin(2 * PI * 0.13))) / (2 * PI);
const colWarp = (t: number) => t + (0.5 * Math.sin(2 * PI * t)) / (2 * PI);

function head(b: MeshBuilder, o: Outfit, lod: Lod) {
  const covered = o.head !== "cap" && o.head !== "umpire";
  const hatted = o.head !== "catcher";
  const faceUV: UVFn = (v) => panelUV(v, PANEL.face, 0.5 + v.x / FACE_W, 0.5 - (v.y - HEAD[1]) / FACE_H);
  const rows = pick(lod, 48, 16, 8);
  const half = (seg: number, theta0: number, front: boolean) =>
    b.grid(
      rows,
      seg,
      (s, t, v) => {
        const ph = PI * (lod === 0 ? rowWarp(s) : s);
        const th = theta0 + PI * (front && lod === 0 ? colWarp(t) : t);
        const sp = Math.sin(ph);
        const dx = sp * Math.cos(th);
        const dy = Math.cos(ph);
        const dz = sp * Math.sin(th);
        v.x = HEAD[0] + HEAD_R[0] * dx;
        v.y = HEAD[1] + HEAD_R[1] * dy;
        v.z = HEAD[2] + HEAD_R[2] * dz;
        skullShape(v, dx, dy, dz);
        if (front) {
          const fx = v.x;
          const fy = v.y - HEAD[1];
          const ax = Math.abs(fx);
          const wf = smoothstep(0.02, 0.4, dz);
          v.z += faceRelief(fx, fy, lod === 0) * wf;
          // Baked shade: the cap's shadow on the brow, the eye sockets, under the nose, the lips' corner, under the jaw.
          let ao = 1 - 0.3 * smoothstep(-0.28, -0.4, fy);
          if (hatted) ao -= 0.3 * smoothstep(0.02, 0.16, fy);
          ao -= 0.2 * gauss(ax - FACE.eyeX, 0.06) * gauss(fy - 0.012, 0.04);
          ao -= 0.3 * gauss(fx, 0.05) * gauss(fy + 0.172, 0.016);
          ao -= 0.1 * gauss(ax - 0.07, 0.03) * gauss(fy + 0.15, 0.04);
          v.ao = Math.max(0.42, ao);
          headSkin(v);
          faceUV(v, t, s);
        } else {
          v.ao = 1 - 0.25 * smoothstep(-0.2, -0.38, v.y - HEAD[1]);
          headSkin(v);
          U.skin(v);
        }
      },
      1,
    );
  half(pick(lod, 40, 12, 8), 0, true);
  half(pick(lod, 14, 8, 5), PI, false);
  if (!covered || o.head === "flap" || o.head === "helmet") {
    for (const s of [1, -1]) {
      // The helmet's flap hides one ear.
      if (o.head === "flap" && s === o.flap) continue;
      if (lod === 2) continue;
      // Ears: level with the brow and the base of the nose, behind the jaw, standing a little off the head.
      blob(b, {
        c: [s * 0.243, HEAD[1] - 0.03, HEAD[2] - 0.04],
        r: [0.03, 0.102, 0.062],
        seg: pick(lod, 10, 6, 4),
        rows: pick(lod, 8, 4, 3),
        uv: U.skin,
        skin: headSkin,
        deform: (v, dx, dy, dz) => {
          const out = dx * s;
          // Tilted back, the rim (helix) standing off the head behind, the lobe tucked in; hollow in the middle.
          v.z -= 0.03 * dy;
          v.x += s * 0.03 * Math.max(0, -dz) * (0.4 + 0.6 * Math.max(0, dy + 0.3));
          if (out > 0.3) v.x -= s * 0.022 * (1 - dz * dz) * (1 - dy * dy) * smoothstep(0.3, 0.9, out);
          if (dy < -0.5) v.x -= s * 0.012 * (-dy - 0.5);
          v.ao = out > 0 ? 0.62 + 0.38 * Math.max(dz * dz, dy * dy) : 0.72;
        },
      });
    }
  }
  // Hair: over the top and down to the nape, with a hairline across the forehead.
  if (o.head !== "catcher") {
    blob(b, {
      c: HEAD,
      r: scaled(1.04),
      seg: pick(lod, 24, 12, 8),
      rows: pick(lod, 10, 6, 4),
      polar1: (th) => 1.6 - 0.62 * Math.sin(th) + 0.1 * gauss(dAng(th, PI * 1.5), 0.7),
      uv: U.hair,
      skin: headSkin,
      deform: (v, dx, dy, dz) => {
        skullShape(v, dx, dy, dz);
        v.ao = 0.85;
      },
    });
  }

  const seg = pick(lod, 24, 10, 8);
  const hrows = pick(lod, 10, 6, 4);
  if (o.head === "cap" || o.head === "umpire") {
    const k = 1.085;
    const crown = {
      c: HEAD,
      r: scaled(k),
      seg: Math.ceil(seg / 2),
      rows: hrows,
      polar1: (th: number) => 1.3 - 0.2 * Math.sin(th),
      skin: headSkin,
      deform: (v: VOut, dx: number, dy: number, dz: number) => {
        skullShape(v, dx, dy, dz);
        // A structured crown: the front panels stand tall and square behind the mark.
        if (dz > 0) {
          v.z += 0.03 * dz * smoothstep(0.15, 0.6, dy) * (1 - 0.5 * dy * dy);
          v.y += 0.03 * dz * gauss(dy - 0.75, 0.3);
        }
        v.y += 0.012 * smoothstep(0.3, 0.9, dy);
        v.ao = 0.8 + 0.2 * smoothstep(0.15, 0.7, dy);
      },
    };
    // Front half carries the club's mark (umpires' caps paint that panel plain); the back is flat colour.
    blob(b, { ...crown, theta0: 0, arc: PI, uv: o.head === "umpire" ? U.cap : frontUV(PANEL.capFront) });
    blob(b, { ...crown, theta0: PI, arc: PI, uv: U.cap });
    // Button on the crown.
    if (lod < 2) blob(b, { c: [0, HEAD[1] + HEAD_R[1] * k + 0.014, HEAD[2]], r: [0.03, 0.014, 0.03], seg: 6, rows: 3, uv: U.brim, skin: headSkin });
    const len = o.head === "umpire" ? 0.15 : 0.25;
    brim(b, HEAD[1] + 0.176, HEAD[2] + 0.3, 0.29, len, 0.012, U.brim, lod);
  } else {
    const flapAt = o.flap > 0 ? 0 : PI;
    const catcher = o.head === "catcher";
    const K = 1.17;
    // How far down the shell reaches at each azimuth (angle from the crown).
    const reach = (th: number) => {
      if (catcher) return 1.8 - 0.5 * Math.sin(th);
      const base = 1.52 - 0.36 * Math.sin(th) + 0.16 * gauss(dAng(th, PI * 1.5), 0.9);
      return o.head === "flap" ? base + 0.74 * gauss(dAng(th, flapAt), 0.5) : base;
    };
    const shell = {
      c: HEAD,
      r: scaled(K),
      seg: Math.ceil(seg / 2) + (lod === 0 ? 4 : 0),
      rows: hrows + 2,
      polar1: reach,
      skin: headSkin,
      deform: (v: VOut, dx: number, dy: number, dz: number) => {
        skullShape(v, dx, dy, dz);
        // A hard shell does not follow the jaw: keep the flap from pinching in.
        if (dy < 0) v.x = HEAD[0] + HEAD_R[0] * K * dx * (1 - 0.06 * dy * dy);
        v.y += 0.02 * smoothstep(0.3, 0.9, dy);
        v.ao = 0.84 + 0.16 * smoothstep(-0.2, 0.6, dy);
      },
    };
    // The catcher's skull cap is worn backwards: no mark in front.
    blob(b, { ...shell, theta0: 0, arc: PI, uv: catcher ? U.helmet : frontUV(PANEL.helmetFront) });
    blob(b, { ...shell, theta0: PI, arc: PI, uv: U.helmet });
    if (!catcher) brim(b, HEAD[1] + 0.17, HEAD[2] + 0.33, 0.3, 0.19, 0.02, U.helmet, lod);
    if (o.head === "flap" && o.cflap && lod < 2) {
      // Jaw guard: a plate bolted to the flap, sweeping forward along the cheek to the corner of the mouth.
      const sgn = o.flap;
      for (const face of [1, -1]) {
        b.grid(
          3,
          pick(lod, 10, 6, 6),
          (s, t, v) => {
            // t: from under the ear forward; s: top edge → bottom edge.
            const th = flapAt + sgn * (0.25 + 1.02 * t);
            const taper = 1 - 0.45 * t;
            const ph = 1.84 + 0.1 * t + (s - 0.5) * 0.36 * taper + 0.1;
            const sp = Math.sin(ph);
            const kk = K + 0.012 + (face > 0 ? 0.012 : -0.004);
            const dx = sp * Math.cos(th);
            const dy = Math.cos(ph);
            const dz = sp * Math.sin(th);
            v.x = HEAD[0] + HEAD_R[0] * kk * dx * (1 - 0.06 * dy * dy);
            v.y = HEAD[1] + HEAD_R[1] * kk * dy;
            v.z = HEAD[2] + HEAD_R[2] * kk * dz + 0.16 * smoothstep(0, 1, -dy) ** 2;
            v.ao = face > 0 ? 0.95 : 0.6;
            headSkin(v);
            U.helmet(v);
          },
          face * sgn,
        );
      }
    }
  }
  if (o.head === "catcher" || o.head === "umpire") mask(b, o.head === "catcher", lod);
}

/** Head-on projection onto a cap/helmet front panel: 0.6 ft across, 0.3 ft tall, centred over the brim. */
function frontUV(panel: Rect): UVFn {
  return (v) => panelUV(v, panel, 0.5 + v.x / 0.6, 0.5 - (v.y - (HEAD[1] + 0.29)) / 0.3);
}

/** A visor: a thin lens of cloth-covered board, bowed down at the sides, its back half buried in the crown. */
function brim(b: MeshBuilder, y: number, z: number, rx: number, rz: number, thick: number, uv: UVFn, lod: Lod) {
  blob(b, {
    c: [0, y, z],
    r: [rx, thick, rz],
    seg: pick(lod, 16, 10, 8),
    rows: pick(lod, 6, 4, 3),
    uv,
    skin: headSkin,
    deform: (v, dx, dy, dz) => {
      v.y -= 0.11 * dx * dx + 0.018 * Math.max(0, dz);
      // Squarer across the front edge than an ellipse.
      if (dz > 0) v.z += rz * 0.06 * dz * (1 - dx * dx);
      v.ao = dy < 0 ? 0.55 : 1;
    },
  });
}

/** Catcher's / umpire's mask: a padded frame and a cage of steel bars in front of the face. */
function mask(b: MeshBuilder, catcher: boolean, lod: Lod) {
  const sides = pick(lod, 5, 4, 3);
  const cy = HEAD[1] - 0.085;
  const zf = HEAD[2] + 0.37;
  const hw = 0.225;
  const hh = 0.31;
  const frame: V3[] = [];
  const n = pick(lod, 16, 10, 8);
  for (let i = 0; i <= n; i += 1) {
    const a = (i / n) * 2 * PI;
    const x = hw * Math.cos(a);
    frame.push([x, cy + hh * Math.sin(a), zf - 2.2 * x * x - 0.05 * Math.max(0, -Math.sin(a))]);
  }
  tube(b, frame, pick(lod, 0.028, 0.03, 0.034), sides, U.gearDark, headSkin);
  const bar = (y: number, w: number) => {
    const pts: V3[] = [];
    const m = pick(lod, 6, 4, 2);
    for (let i = 0; i <= m; i += 1) {
      const x = -w + (2 * w * i) / m;
      pts.push([x, y, zf + 0.085 - 1.9 * x * x - 0.5 * (y - cy) * (y - cy)]);
    }
    tube(b, pts, pick(lod, 0.011, 0.014, 0.018), sides, U.metal, headSkin);
  };
  const upright = (x: number) => {
    const pts: V3[] = [];
    const m = pick(lod, 5, 3, 2);
    const top = hh * Math.sqrt(Math.max(0, 1 - (x * x) / (hw * hw)));
    for (let i = 0; i <= m; i += 1) {
      const y = cy - top + (2 * top * i) / m;
      pts.push([x, y, zf + 0.085 - 1.9 * x * x - 0.5 * (y - cy) * (y - cy)]);
    }
    tube(b, pts, 0.011, sides, U.metal, headSkin);
  };
  if (lod === 0) {
    for (const y of [0.2, 0.105, 0.04, -0.05, -0.14, -0.22]) bar(cy + y, hw * Math.sqrt(1 - (y * y) / (hh * hh)) - 0.01);
    for (const x of [0, 0.095, -0.095]) upright(x);
  } else {
    bar(cy + 0.13, 0.17);
    bar(cy - 0.01, 0.2);
    bar(cy - 0.15, 0.17);
  }
  if (lod < 2) {
    // Padding at the brow and the chin, and a throat guard hanging under it.
    blob(b, { c: [0, cy + hh - 0.035, zf - 0.05], r: [0.15, 0.04, 0.045], seg: 8, rows: 4, uv: catcher ? U.gear : U.gearDark, skin: headSkin });
    blob(b, { c: [0, cy - hh + 0.03, zf - 0.07], r: [0.12, 0.045, 0.05], seg: 8, rows: 4, uv: catcher ? U.gear : U.gearDark, skin: headSkin });
    blob(b, { c: [0, cy - hh - 0.1, zf - 0.11], r: [0.085, 0.1, 0.022], seg: 6, rows: 4, uv: U.gearDark, skin: headSkin });
  }
}

/** Fingers closed round a handle that runs across the palm (the hand's X axis, through its origin). */
function fist(b: MeshBuilder, side: number, at: (x: number, y: number, z: number) => V3, skin: SkinFn, lod: Lod) {
  if (lod > 0) {
    blob(b, {
      c: at(0, 0.0, -0.012),
      r: [0.155, 0.125, 0.112],
      seg: pick(lod, 10, 8, 6),
      rows: pick(lod, 7, 6, 4),
      uv: U.hand,
      skin,
      deform: (v, _dx, dy, dz) => {
        v.ao = dz > 0.2 ? 0.8 + 0.2 * Math.abs(Math.cos(dy * 5.5)) : 0.95;
      },
    });
    return;
  }
  // Back of the hand, from the wrist down to the knuckles behind the handle.
  blob(b, {
    c: at(0, 0.055, -0.058),
    r: [0.15, 0.135, 0.062],
    seg: 12,
    rows: 8,
    uv: U.hand,
    skin,
    deform: (v, dx, dy) => {
      // Tilt: the wrist end comes forward to meet the forearm, the knuckle end goes back.
      v.z += 0.05 * dy;
      v.x -= side * 0.0 * dx;
      v.ao = 0.94;
    },
  });
  // Heel of the palm under the wrist.
  blob(b, { c: at(0, 0.12, 0.0), r: [0.12, 0.075, 0.07], seg: 8, rows: 5, uv: U.hand, skin });
  const R = 0.078;
  const xs = [0.108, 0.036, -0.036, -0.108];
  const reach = [4.5, 4.75, 4.65, 4.35];
  const rad = [0.037, 0.039, 0.037, 0.033];
  for (let i = 0; i < 4; i += 1) {
    const x = side * xs[i];
    const pts: V3[] = [];
    const rr: number[] = [];
    const n = 8;
    for (let k = 0; k <= n; k += 1) {
      const f = k / n;
      const ph = 0.45 + (reach[i] - 0.45) * f;
      // Closing on itself: the tip tucks in toward the palm.
      const rk = R * (1 - 0.22 * smoothstep(0.7, 1, f));
      pts.push(at(x, -rk * Math.sin(ph), -rk * Math.cos(ph)));
      rr.push(rad[i] * (1 - 0.2 * f));
    }
    tube(b, pts, rr, 6, U.hand, skin);
  }
  // Thumb laid over the top of the fingers.
  tube(b, [at(side * 0.125, 0.09, -0.04), at(side * 0.158, 0.095, 0.025), at(side * 0.11, 0.085, 0.082), at(side * 0.03, 0.06, 0.108), at(-side * 0.03, 0.04, 0.11)], [0.044, 0.043, 0.04, 0.035, 0.03], 6, U.hand, skin);
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
    fist(b, side, at, skin, lod);
    if (lod === 0) {
      // Batting-glove strap round the wrist.
      loft(
        b,
        [
          { y: hy + 0.26, rx: 0.106, rz: 0.08, cx: hx, uv: U.wrist },
          { y: hy + 0.26, rx: 0.116, rz: 0.09, cx: hx },
          { y: hy + 0.17, rx: 0.118, rz: 0.092, cx: hx },
          { y: hy + 0.17, rx: 0.1, rz: 0.076, cx: hx },
        ],
        { seg: 10, skin },
      );
    }
    return;
  }
  if (lod > 0) {
    blob(b, { c: at(0, -0.11, 0.02), r: [0.13, 0.3, 0.055], seg: 6, rows: 4, uv: U.hand, skin });
    return;
  }
  // Open hand: a flat palm widening from the wrist to the knuckles, four relaxed fingers and the thumb
  // (on the side that faces forward when the arm hangs).
  loft(
    b,
    [
      { y: hy + 0.2, rx: 0.098, rz: 0.07, cx: hx, cz: 0, uv: U.hand },
      { y: hy + 0.12, rx: 0.11, rz: 0.06, cx: hx, cz: 0.002 },
      { y: hy + 0.02, rx: 0.136, rz: 0.052, cx: hx, cz: 0.004 },
      { y: hy - 0.08, rx: 0.146, rz: 0.046, cx: hx, cz: 0.004 },
      { y: hy - 0.14, rx: 0.142, rz: 0.04, cx: hx, cz: 0.006 },
      { y: hy - 0.165, rx: 0.12, rz: 0.02, cx: hx, cz: 0.008 },
      { y: hy - 0.168, rx: 0, rz: 0, cx: hx, cz: 0.008 },
    ],
    {
      seg: 14,
      skin,
      n: 2.6,
      post: (v) => {
        // Cupped: the edges of the palm come forward; the heel of the thumb is fleshy.
        const dx = (v.x - hx) / 0.14;
        v.z += 0.018 * dx * dx + (v.z > 0 ? 0.018 * gauss((v.x - hx) * side - 0.07, 0.06) * gauss(v.y - hy - 0.06, 0.08) : 0);
      },
    },
  );
  const xs = [0.105, 0.036, -0.034, -0.1];
  const len = [0.27, 0.3, 0.28, 0.215];
  const rad = [0.035, 0.036, 0.034, 0.03];
  for (let i = 0; i < 4; i += 1) {
    const x = side * xs[i];
    const l = len[i];
    const curl = 0.8 + 0.12 * i;
    tube(
      b,
      [at(x, -0.12, 0.008), at(x, -0.15 - 0.4 * l, 0.014 + 0.02 * curl), at(x * 0.98, -0.15 - 0.72 * l, 0.03 + 0.05 * curl), at(x * 0.95, -0.15 - 0.96 * l, 0.05 + 0.1 * curl)],
      [rad[i], rad[i] * 0.97, rad[i] * 0.9, rad[i] * 0.78],
      6,
      U.hand,
      skin,
    );
  }
  tube(b, [at(side * 0.09, 0.1, 0.02), at(side * 0.155, 0.015, 0.045), at(side * 0.19, -0.075, 0.064), at(side * 0.2, -0.15, 0.08)], [0.046, 0.042, 0.035, 0.028], 6, U.hand, skin);
}

function glove(b: MeshBuilder, side: number, hx: number, hy: number, mitt: boolean, lod: Lod, skin: SkinFn) {
  // Fingers along −Y, pocket facing +Z, thumb on the `side` edge.
  const fingers = !mitt && lod === 0;
  const c: V3 = [hx, hy - (fingers ? 0.1 : 0.14), 0.03];
  const r: V3 = mitt ? [0.33, 0.35, 0.16] : fingers ? [0.27, 0.3, 0.125] : [0.28, 0.37, 0.125];
  const G = PANEL.glove;
  // The leather is painted: the back on the left half of the panel, the pocket on the right;
  // across runs from the little finger to the thumb, down from the fingertips to the heel.
  const paint = (v: VOut, dx: number, dy: number, half: number) => panelUV(v, G, half + 0.02 + 0.46 * (0.5 + 0.5 * dx * side), fingers ? 0.63 - 0.33 * dy : 0.5 - 0.5 * dy);
  const shape = (v: VOut, dx: number, dy: number, dz: number) => {
    // The pocket is a dish; the thumb is a separate lobe set a little higher; the heel narrows to the wrist.
    if (dz > 0) v.z -= (mitt ? 0.22 : 0.18) * dz * dz;
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
  const seg = pick(lod, 12, 8, 5);
  const rows = pick(lod, 12, 8, 5);
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
      v.ao = 0.7 + 0.3 * (1 - dz * dz);
    },
  });
  if (lod === 0) {
    // Wrist opening: the cuff of the glove round the heel of the hand.
    loft(
      b,
      [
        { y: hy + 0.25, rx: 0.13, rz: 0.1, cx: hx, cz: 0.01, uv: U.gloveDark },
        { y: hy + 0.25, rx: 0.15, rz: 0.118, cx: hx, cz: 0.01 },
        { y: hy + 0.14, rx: 0.17, rz: 0.125, cx: hx, cz: 0.015 },
      ],
      { seg: 10, skin },
    );
  }
  if (!fingers) return;
  // Four finger stalls curling round the pocket, the thumb, and the laced web between thumb and forefinger.
  const stall = (t: number): UVFn => (v) => panelUV(v, G, 0.02 + 0.46 * t, 0.06);
  const xs = [0.092, -0.012, -0.115, -0.205];
  const len = [0.94, 1, 0.95, 0.8];
  for (let i = 0; i < 4; i += 1) {
    const x = hx + side * xs[i];
    const l = len[i];
    tube(
      b,
      [
        [x, hy - 0.2, 0.028],
        [x + side * 0.004 * (1.5 - i), hy - 0.2 - 0.18 * l, 0.036],
        [x + side * 0.008 * (1.5 - i), hy - 0.2 - 0.33 * l, 0.066],
        [x + side * 0.009 * (1.5 - i), hy - 0.2 - 0.4 * l, 0.1],
      ],
      [0.062, 0.06, 0.054, 0.044],
      7,
      stall(0.5 + (0.5 * xs[i]) / 0.27),
      skin,
    );
  }
  tube(
    b,
    [
      [hx + side * 0.21, hy - 0.02, 0.03],
      [hx + side * 0.285, hy - 0.16, 0.04],
      [hx + side * 0.298, hy - 0.34, 0.07],
      [hx + side * 0.29, hy - 0.42, 0.1],
    ],
    [0.07, 0.068, 0.058, 0.046],
    7,
    stall(0.97),
    skin,
  );
  blob(b, {
    c: [hx + side * 0.21, hy - 0.32, 0.055],
    r: [0.09, 0.14, 0.02],
    seg: 6,
    rows: 4,
    uv: (v, t, sv) => panelUV(v, G, 0.5 + 0.02 + 0.46 * (0.66 + 0.3 * Math.abs(2 * t - 1)), 0.05 + 0.4 * sv),
    skin,
  });
}

/** Catcher's gear: chest protector with shoulder caps, and shin guards with knee caps. */
function gear(b: MeshBuilder, o: Outfit, lod: Lod) {
  const seg = pick(lod, 28, 16, 12);
  const TOPY = 1.95;
  const BOT = 0.34;
  const rows = JERSEY.filter((r) => r[0] <= TOPY && r[0] >= 0.5);
  const body: Ring[] = [
    ...rows.map((r, i) => ({ y: Y0 + r[0], rx: r[1] + 0.04, rz: r[2] + 0.045, cz: r[3] ?? 0, uv: i === 0 ? ((v: VOut, t: number) => panelUV(v, PANEL.chest, 1 - t, (TOPY - (v.y - Y0)) / (TOPY - BOT))) : undefined })),
    { y: Y0 + 0.42, rx: 0.5, rz: 0.37, cz: 0 },
    { y: Y0 + BOT, rx: 0.4, rz: 0.36, cz: 0 },
  ];
  const ARC = 2.5;
  loft(b, lod === 2 ? body.filter((_, i) => i % 2 === 0 || i === body.length - 1) : body, {
    seg: seg / 2,
    skin: torsoSkin,
    theta0: PI / 2 - ARC / 2,
    arc: ARC,
    n: 2.3,
    shade: (th, y) => (0.82 + 0.18 * Math.abs(Math.sin((y - Y0) * 9.5))) * (1 - 0.25 * smoothstep(0.85, 1, Math.abs(th - PI / 2) / (ARC / 2))),
    shape: (v, ring, th) => {
      const y = ring.y - Y0;
      const s = Math.sin(th);
      // Follows the chest, scooped under the throat, and narrows to a tail over the belly.
      v.z += torsoRelief(v.x, y, Math.max(0, s), 0) * 0.6;
      if (y > 1.8) v.y -= 0.12 * Math.pow(Math.max(0, s), 1.5) * smoothstep(1.8, 1.95, y);
      if (y < 0.9) v.x *= 1 - 0.35 * smoothstep(0.9, BOT, y);
    },
  });
  if (lod < 2) {
    for (const side of [1, -1]) {
      // Shoulder cap, riding the shoulder.
      blob(b, {
        c: [side * 0.6, Y0 + 1.93, 0.06],
        r: [0.2, 0.09, 0.22],
        seg: pick(lod, 8, 6, 4),
        rows: pick(lod, 5, 4, 3),
        uv: U.gear,
        skin: (v) => {
          v.b0 = BONE.chest;
          v.b1 = side > 0 ? HELPER.shoulderL : HELPER.shoulderR;
          v.w = 0.5;
        },
        deform: (v, dx) => {
          v.y -= 0.08 * dx * side * Math.max(0, dx * side);
        },
      });
    }
  }
  for (const side of [1, -1]) {
    const x0 = side * DIM.hipX;
    const yh = Y0 + DIM.hipY;
    const T = DIM.thigh;
    const skin = rigid(side > 0 ? BONE.shinL : BONE.shinR);
    const big = o.long ? 0.03 : 0.012;
    const r = (d: number, rad: number, uv?: UVFn): Ring => ({ y: yh - d, rx: rad, rz: rad * 1.1, cx: x0, cz: 0.014, uv });
    loft(b, [r(T + 0.1, 0.2 + big, U.gear), r(T + 0.14, 0.222 + big), r(T + 0.45, 0.222 + big), r(T + 0.7, 0.212 + big), r(T + 1.05, 0.178 + big), r(T + 1.36, 0.15 + big), r(T + 1.42, 0.13 + big)], {
      seg: pick(lod, 10, 6, 4),
      skin,
      theta0: PI / 2 - 1.2,
      arc: 2.4,
      shade: (_th, y) => 0.8 + 0.2 * Math.abs(Math.sin((yh - y) * 8)),
    });
    // Knee cap (two plates), riding the knee.
    const kneeSkin: SkinFn = (v) => {
      v.b0 = side > 0 ? HELPER.kneeL : HELPER.kneeR;
      v.w = 0;
    };
    blob(b, { c: [x0, yh - T + 0.02, 0.17], r: [0.19, 0.2, 0.11], seg: pick(lod, 8, 7, 5), rows: pick(lod, 6, 6, 4), uv: U.gear, skin: kneeSkin });
    if (lod === 0) blob(b, { c: [x0, yh - T + 0.26, 0.15], r: [0.16, 0.12, 0.09], seg: 8, rows: 5, uv: U.gear, skin: rigid(side > 0 ? BONE.thighL : BONE.thighR) });
    // Instep flap over the laces.
    blob(b, { c: [x0, yh - T - DIM.shin + 0.06, 0.19], r: [0.145, 0.11, 0.19], seg: pick(lod, 6, 6, 4), rows: pick(lod, 4, 4, 3), uv: U.gearDark, skin: rigid(side > 0 ? BONE.footL : BONE.footR) });
  }
}

/** Build the mesh for an outfit. `lod` 0 is the close-up model, 1 the mid-field one, 2 the distant one. */
export function buildBody(o: Outfit, lod: Lod): MeshData {
  const b = new MeshBuilder();
  trunk(b, o, lod);
  head(b, o, lod);
  for (const side of [1, -1]) {
    arm(b, side, o, lod);
    hand(b, side, o, lod);
    leg(b, side, o, lod);
    shoe(b, side, lod);
  }
  if (o.gear) gear(b, o, lod);
  return b.build();
}
