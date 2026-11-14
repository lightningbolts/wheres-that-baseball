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
import { PANEL, panelUV, sw } from "@/components/game/scene/character/atlas";
import { MeshBuilder, blob, loft, smoothstep, tube, type MeshData, type Ring, type SkinFn, type UVFn, type V3, type VOut } from "@/components/game/scene/character/mesh";
import { BONE, DIM } from "@/components/game/scene/character/skeleton";

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
export const FACE_W = 0.54;
export const FACE_H = 0.8;
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
const headSkin = rigid(BONE.head);

/** [y (pelvis-relative), half-width, half-depth, centre z]. */
type Row = [number, number, number, number?];
const rings = (rows: Row[], uv: UVFn, grow = 0): Ring[] =>
  rows.map((r, i) => ({ y: Y0 + r[0], rx: r[1] + grow, rz: r[2] + grow, cz: r[3] ?? 0, uv: i === 0 ? uv : undefined }));

const JERSEY: Row[] = [
  [JERSEY_TOP, 0.2, 0.19, -0.01],
  [2.02, 0.4, 0.22, -0.01],
  [1.95, 0.64, 0.265, -0.01],
  [1.87, 0.76, 0.3, -0.005],
  [1.75, 0.79, 0.325],
  [1.6, 0.72, 0.36, 0.01],
  [1.3, 0.63, 0.37, 0.02],
  [0.95, 0.55, 0.33, 0.01],
  [0.62, 0.505, 0.315],
  [0.44, 0.51, 0.32],
  [JERSEY_HEM, 0.495, 0.31],
];
const HIPS: Row[] = [
  [0.285, 0.49, 0.31],
  [0.18, 0.51, 0.32],
  [0.0, 0.53, 0.34, -0.01],
  [-0.2, 0.5, 0.33, -0.02],
  [-0.36, 0.36, 0.26, -0.01],
  [-0.47, 0.1, 0.1],
  [-0.49, 0, 0],
];

function trunk(b: MeshBuilder, seg: number) {
  const half = seg / 2;
  const span = JERSEY_TOP - JERSEY_HEM;
  // Baked shade in the armpits and down the flanks.
  const shade = (th: number, y: number) => 1 - 0.22 * smoothstep(0.7, 1, Math.abs(Math.cos(th))) * gauss(y - Y0 - 1.35, 0.4);
  const panel =
    (r: (typeof PANEL)[keyof typeof PANEL]): UVFn =>
    (o, t) =>
      panelUV(o, r, 1 - t, (JERSEY_TOP - (o.y - Y0)) / span);
  // The jersey is two half-wraps, so the front and the back each get a panel of their own.
  loft(b, rings(JERSEY, panel(PANEL.front)), { seg: half, skin: torsoSkin, theta0: 0, arc: PI, n: 2.5, shade });
  loft(b, rings(JERSEY, panel(PANEL.back)), { seg: half, skin: torsoSkin, theta0: PI, arc: PI, n: 2.5, shade });
  // Collar band and neck.
  loft(
    b,
    [
      { y: Y0 + 2.115, rx: 0.2, rz: 0.19, cz: -0.01, uv: U.collar },
      { y: Y0 + 2.115, rx: 0.215, rz: 0.205, cz: -0.01 },
      { y: Y0 + 2.05, rx: 0.225, rz: 0.215, cz: -0.01 },
    ],
    { seg, skin: torsoSkin },
  );
  loft(
    b,
    [
      { y: Y0 + 2.36, rx: 0.165, rz: 0.175, cz: 0.02, uv: U.skin, ao: 0.72 },
      { y: Y0 + 2.2, rx: 0.165, rz: 0.17, cz: 0.0, ao: 0.8 },
      { y: Y0 + 2.08, rx: 0.175, rz: 0.175, cz: -0.02, ao: 0.9 },
      { y: Y0 + 1.98, rx: 0.19, rz: 0.18, cz: -0.02 },
    ],
    { seg: Math.max(6, half), skin: neckSkin },
  );
  // Belt (a touch proud of the trousers) and the hips.
  loft(
    b,
    [
      { y: Y0 + JERSEY_HEM, rx: 0.49, rz: 0.305, uv: U.belt },
      { y: Y0 + JERSEY_HEM, rx: 0.507, rz: 0.322 },
      { y: Y0 + 0.285, rx: 0.507, rz: 0.322 },
      { y: Y0 + 0.285, rx: 0.49, rz: 0.31 },
    ],
    { seg, skin: torsoSkin, n: 2.5 },
  );
  blob(b, { c: [0, Y0 + 0.342, 0.322], r: [0.055, 0.045, 0.018], seg: 6, rows: 4, uv: U.buckle, skin: torsoSkin });
  loft(b, rings(HIPS, U.pants), { seg, skin: torsoSkin, n: 2.4, shade: (_th, y) => 1 - 0.3 * smoothstep(-0.3, -0.48, y - Y0) });
}

function arm(b: MeshBuilder, side: number, seg: number) {
  const x0 = side * DIM.shoulderX;
  const ys = Y0 + DIM.shoulderY;
  const bone = side > 0 ? BONE.armL : BONE.armR;
  const skin: SkinFn = (o) => {
    o.b0 = bone;
    o.b1 = bone + 1;
    o.w = smoothstep(0.84, 1.16, ys - o.y);
  };
  const r = (d: number, rad: number, uv?: UVFn, ao?: number): Ring => ({ y: ys - d, rx: rad, rz: rad * 1.04, cx: x0, uv, ao });
  loft(
    b,
    [
      r(-0.165, 0, U.jersey),
      r(-0.135, 0.095),
      r(-0.06, 0.165),
      r(0.08, 0.198),
      r(0.3, 0.195),
      r(0.5, 0.186, U.trim),
      // Sleeve hem, then the arm (or undershirt) coming out of it.
      r(0.6, 0.186, U.sleeve),
      r(0.6, 0.152, undefined, 0.5),
      r(0.68, 0.148, undefined, 0.8),
      r(0.84, 0.138),
      r(1.0, 0.128),
      r(1.13, 0.136),
      r(1.4, 0.116),
      r(1.64, 0.094, U.wrist),
      r(DIM.upperArm + DIM.wrist, 0.09, U.hand),
      r(DIM.upperArm + DIM.wrist + 0.04, 0),
    ],
    { seg, skin },
  );
}

function leg(b: MeshBuilder, side: number, seg: number) {
  const x0 = side * DIM.hipX;
  const yh = Y0 + DIM.hipY;
  const bone = side > 0 ? BONE.thighL : BONE.thighR;
  const skin: SkinFn = (o) => {
    o.b0 = bone;
    o.b1 = bone + 1;
    o.w = smoothstep(1.3, 1.66, yh - o.y);
  };
  const strip: UVFn = (o, t) => panelUV(o, PANEL.pants, t, 0.5);
  const lower: UVFn = (o, t) => panelUV(o, PANEL.lower, t, (yh - o.y - DIM.thigh) / DIM.shin);
  const r = (d: number, rad: number, cz = 0, uv?: UVFn, ao?: number): Ring => ({ y: yh - d, rx: rad, rz: rad * 1.06, cx: x0, cz, uv, ao });
  const cuff = DIM.thigh + CUFF_AT * DIM.shin;
  loft(
    b,
    [
      r(-0.3, 0, 0, strip),
      r(-0.23, 0.17),
      r(-0.06, 0.27),
      r(0.15, 0.285, -0.01),
      r(0.5, 0.262, -0.005),
      r(0.9, 0.225),
      r(1.25, 0.195),
      r(DIM.thigh, 0.185, 0.01, lower),
      r(1.7, 0.17),
      // Trousers bloused over the top of the calf, then the sock.
      r(cuff, 0.178),
      r(cuff, 0.152, -0.01, undefined, 0.55),
      r(2.12, 0.158, -0.025),
      r(2.5, 0.118, -0.01),
      r(2.85, 0.095),
      r(DIM.thigh + DIM.shin, 0.09),
    ],
    // The unwrap starts on the inseam, so the outseam (the piping) is the middle of the strip.
    { seg, skin, theta0: side > 0 ? -PI : 0 },
  );
}

function shoe(b: MeshBuilder, side: number, lod: number) {
  const bone = side > 0 ? BONE.footL : BONE.footR;
  const skin = rigid(bone);
  const x0 = side * DIM.hipX;
  const ya = Y0 + DIM.hipY - DIM.thigh - DIM.shin;
  const c: V3 = [x0, ya - 0.005, 0.19];
  const r: V3 = [0.165, 0.15, 0.42];
  blob(b, {
    c,
    r,
    seg: lod ? 8 : 12,
    rows: lod ? 5 : 8,
    uv: U.shoe,
    skin,
    deform: (o, dx, dy, dz) => {
      // Low toe box, a collar round the ankle, a narrower heel; flat where it meets the sole.
      if (dy > 0) o.y = c[1] + r[1] * dy * (dz > 0 ? 1 - 0.55 * dz * dz : 1 + 0.25 * dz * dz);
      if (dz < 0) o.x = c[0] + r[0] * dx * (1 + 0.2 * dz);
      o.y = Math.max(o.y, ya - 0.095);
      o.ao = 0.75 + 0.25 * smoothstep(-0.6, 0.3, dy);
    },
  });
  loft(
    b,
    [
      { y: ya - 0.088, rx: 0.172, rz: 0.43, cx: x0, cz: 0.19, uv: U.sole },
      { y: ya - DIM.ankle, rx: 0.165, rz: 0.42, cx: x0, cz: 0.19 },
      { y: ya - DIM.ankle, rx: 0, rz: 0, cx: x0, cz: 0.19 },
    ],
    { seg: lod ? 8 : 12, skin },
  );
}

/** Shape of the head (and of everything worn on it): jaw, brow, eye sockets, cheeks. */
function headDeform(o: VOut, dx: number, dy: number, dz: number) {
  const f = Math.max(0, dz);
  const jaw = smoothstep(0.15, 0.95, -dy);
  o.x *= 1 - 0.2 * jaw;
  o.z += 0.045 * jaw * (0.4 + 0.6 * f);
  let z = 0.02 * gauss(dy - 0.22, 0.1);
  z -= 0.024 * gauss(Math.abs(dx) - 0.38, 0.16) * gauss(dy - 0.09, 0.1);
  z += 0.012 * gauss(Math.abs(dx) - 0.45, 0.2) * gauss(dy + 0.15, 0.15);
  z += 0.03 * gauss(dx, 0.14) * gauss(dy + 0.06, 0.15);
  z += 0.016 * gauss(dx, 0.3) * gauss(dy + 0.5, 0.12);
  o.z += z * f;
}

const scaled = (k: number): V3 => [HEAD_R[0] * k, HEAD_R[1] * k, HEAD_R[2] * k];
/** Angular distance between two azimuths. */
const dAng = (a: number, c: number) => Math.abs(((((a - c) % (2 * PI)) + 3 * PI) % (2 * PI)) - PI);

function head(b: MeshBuilder, o: Outfit, lod: number) {
  const covered = o.head !== "cap" && o.head !== "umpire";
  const faceUV: UVFn = (v) => panelUV(v, PANEL.face, 0.5 + v.x / FACE_W, 0.5 - (v.y - HEAD[1]) / FACE_H);
  // The front of the head takes the painted face; the brow is in the cap's shade.
  blob(b, {
    c: HEAD,
    r: HEAD_R,
    seg: lod ? 8 : 16,
    rows: lod ? 8 : 16,
    theta0: 0,
    arc: PI,
    uv: faceUV,
    skin: headSkin,
    deform: (v, dx, dy, dz) => {
      headDeform(v, dx, dy, dz);
      v.ao = 1 - 0.3 * smoothstep(0.1, 0.5, dy) - 0.25 * smoothstep(0.6, 0.95, -dy);
    },
  });
  blob(b, { c: HEAD, r: HEAD_R, seg: lod ? 5 : 8, rows: lod ? 5 : 8, theta0: PI, arc: PI, uv: U.skin, skin: headSkin, deform: headDeform });
  if (!lod) {
    // Nose.
    blob(b, {
      c: [0, HEAD[1] - 0.07, HEAD[2] + 0.315],
      r: [0.043, 0.09, 0.062],
      seg: 6,
      rows: 5,
      uv: U.skin,
      skin: headSkin,
      deform: (v, dx, dy) => {
        if (dy > 0) {
          v.x -= 0.02 * dx * dy;
          v.z -= 0.045 * dy;
        }
        v.ao = 0.97;
      },
    });
  }
  if (!covered) {
    for (const s of [1, -1]) {
      blob(b, { c: [s * 0.25, HEAD[1] - 0.02, HEAD[2] - 0.03], r: [0.035, 0.085, 0.06], seg: lod ? 4 : 6, rows: lod ? 3 : 5, uv: U.skin, skin: headSkin, deform: (v) => void (v.ao = 0.88) });
    }
  }
  // Hair: over the top and down to the nape, with a hairline across the forehead.
  if (o.head !== "catcher") {
    blob(b, {
      c: HEAD,
      r: scaled(1.045),
      seg: lod ? 10 : 20,
      rows: lod ? 5 : 9,
      polar1: (th) => 1.62 - 0.62 * Math.sin(th),
      uv: U.hair,
      skin: headSkin,
      deform: (v, dx, dy, dz) => {
        headDeform(v, dx, dy, dz);
        v.ao = 0.85;
      },
    });
  }

  const seg = lod ? 10 : 20;
  const rows = lod ? 5 : 9;
  const top = HEAD[1];
  if (o.head === "cap" || o.head === "umpire") {
    const k = 1.09;
    blob(b, {
      c: HEAD,
      r: scaled(k),
      seg,
      rows,
      polar1: (th) => 1.3 - 0.22 * Math.sin(th),
      uv: U.cap,
      skin: headSkin,
      deform: (v, dx, dy, dz) => {
        headDeform(v, dx, dy, dz);
        // A structured crown: taller and squarer in front.
        if (dz > 0) v.z += 0.025 * dz * smoothstep(0.2, 0.7, dy);
        v.y += 0.012 * smoothstep(0.3, 0.9, dy);
        v.ao = 0.82 + 0.18 * smoothstep(0.2, 0.8, dy);
      },
    });
    const len = o.head === "umpire" ? 0.13 : 0.2;
    brim(b, top + 0.175, HEAD[2] + 0.24 + len, 0.235, len, U.brim, lod);
  } else {
    const flapAt = o.flap > 0 ? 0 : PI;
    const catcher = o.head === "catcher";
    blob(b, {
      c: HEAD,
      r: scaled(1.14),
      seg,
      rows: rows + 1,
      polar1: (th) => {
        if (catcher) return 1.78 - 0.56 * Math.sin(th);
        const base = 1.5 - 0.34 * Math.sin(th);
        return o.head === "flap" ? base + 0.72 * gauss(dAng(th, flapAt), 0.55) : base;
      },
      uv: U.helmet,
      skin: headSkin,
      deform: (v, dx, dy, dz) => {
        headDeform(v, dx, dy, dz);
        v.y += 0.015 * smoothstep(0.3, 0.9, dy);
        v.ao = 0.85 + 0.15 * smoothstep(-0.2, 0.6, dy);
      },
    });
    if (!catcher) brim(b, top + 0.165, HEAD[2] + 0.4, 0.21, 0.15, U.helmet, lod);
  }
  if (o.head === "catcher" || o.head === "umpire") mask(b, lod);
}

function brim(b: MeshBuilder, y: number, z: number, rx: number, rz: number, uv: UVFn, lod: number) {
  blob(b, {
    c: [0, y, z],
    r: [rx, 0.016, rz],
    seg: lod ? 8 : 12,
    rows: lod ? 3 : 5,
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
function mask(b: MeshBuilder, lod: number) {
  const sides = lod ? 3 : 5;
  const cy = HEAD[1] - 0.05;
  const zf = HEAD[2] + 0.35;
  const frame: V3[] = [];
  const n = lod ? 8 : 12;
  for (let i = 0; i <= n; i += 1) {
    const a = (i / n) * 2 * PI;
    const x = 0.21 * Math.cos(a);
    frame.push([x, cy + 0.29 * Math.sin(a), zf - 0.5 * x * x * 4]);
  }
  tube(b, frame, 0.024, sides, U.gearDark, headSkin);
  const bar = (y: number, w: number) => {
    const pts: V3[] = [];
    const m = lod ? 2 : 4;
    for (let i = 0; i <= m; i += 1) {
      const x = -w + (2 * w * i) / m;
      pts.push([x, y, zf + 0.07 - 1.6 * x * x]);
    }
    tube(b, pts, 0.011, sides, U.metal, headSkin);
  };
  bar(cy + 0.12, 0.17);
  bar(cy - 0.02, 0.2);
  bar(cy - 0.16, 0.17);
  if (!lod) {
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

function hand(b: MeshBuilder, side: number, o: Outfit, lod: number) {
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
      seg: lod ? 6 : 10,
      rows: lod ? 4 : 7,
      uv: U.hand,
      skin,
      deform: (v, dx, dy, dz) => {
        // Knuckle ridges across the fingers.
        v.ao = dz > 0.2 ? 0.8 + 0.2 * Math.abs(Math.cos(dy * 5.5)) : 0.95;
      },
    });
    if (!lod) tube(b, [at(side * 0.085, 0.04, 0.05), at(side * 0.02, -0.01, 0.105), at(-side * 0.05, -0.03, 0.098)], 0.026, 5, U.hand, skin);
    return;
  }
  if (lod) {
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

function glove(b: MeshBuilder, side: number, hx: number, hy: number, mitt: boolean, lod: number, skin: SkinFn) {
  // Fingers along −Y, pocket facing +Z, thumb on the `side` edge.
  const c: V3 = [hx, hy - 0.13, 0.03];
  const r: V3 = mitt ? [0.31, 0.33, 0.15] : [0.26, 0.345, 0.12];
  const shape = (v: VOut, dx: number, dy: number, dz: number) => {
    // The pocket is a dish; the thumb is a separate lobe set a little higher; the heel narrows to the wrist.
    if (dz > 0) v.z -= (mitt ? 0.2 : 0.17) * dz * dz;
    const th = smoothstep(0.35, 0.9, dx * side);
    v.x += side * 0.04 * th;
    v.y += 0.09 * th;
    if (dy > 0.3) v.x = c[0] + (v.x - c[0]) * (1 - 0.45 * smoothstep(0.3, 1, dy));
    if (!mitt && dy < -0.2) {
      // Finger stalls.
      const k = Math.abs(Math.cos((dx * side + 0.15) * 5.2));
      v.y += 0.035 * (1 - k) * smoothstep(-0.2, -0.8, dy);
      v.ao = 0.72 + 0.28 * k;
    } else v.ao = 0.9;
  };
  const seg = lod ? 5 : 10;
  const rows = lod ? 5 : 10;
  // Back of the glove, then the pocket side.
  blob(b, { c, r, seg, rows, theta0: PI, arc: PI, uv: U.glove, skin, deform: shape });
  blob(b, {
    c,
    r,
    seg,
    rows,
    theta0: 0,
    arc: PI,
    uv: U.gloveDark,
    skin,
    deform: (v, dx, dy, dz) => {
      shape(v, dx, dy, dz);
      v.ao = 0.6 + 0.4 * (1 - dz * dz);
    },
  });
}

/** Catcher's gear: chest protector and shin guards with knee caps. */
function gear(b: MeshBuilder, seg: number, lod: number) {
  const ribs = (_th: number, y: number) => 0.78 + 0.22 * Math.abs(Math.sin((y - Y0) * 9));
  loft(
    b,
    rings(
      [
        [2.0, 0.36, 0.22],
        [1.84, 0.74, 0.34],
        [1.6, 0.74, 0.39, 0.01],
        [1.3, 0.65, 0.4, 0.02],
        [0.95, 0.57, 0.36, 0.01],
        [0.62, 0.52, 0.34],
        [0.44, 0.44, 0.335],
      ],
      U.gear,
      0.02,
    ),
    { seg: seg / 2, skin: torsoSkin, theta0: PI / 2 - 1.2, arc: 2.4, n: 2.5, shade: ribs },
  );
  for (const side of [1, -1]) {
    const x0 = side * DIM.hipX;
    const yh = Y0 + DIM.hipY;
    const skin = rigid(side > 0 ? BONE.shinL : BONE.shinR);
    const r = (d: number, rad: number, uv?: UVFn): Ring => ({ y: yh - d, rx: rad, rz: rad * 1.06, cx: x0, cz: 0.012, uv });
    loft(b, [r(1.62, 0.2, U.gear), r(1.9, 0.205), r(2.15, 0.2), r(2.5, 0.16), r(2.9, 0.14)], {
      seg: lod ? 4 : 6,
      skin,
      theta0: PI / 2 - 1.0,
      arc: 2.0,
      shade: (_th, y) => 0.8 + 0.2 * Math.abs(Math.sin((yh - y) * 8)),
    });
    blob(b, { c: [x0, yh - 1.47, 0.14], r: [0.17, 0.21, 0.1], seg: lod ? 5 : 8, rows: lod ? 4 : 6, uv: U.gear, skin });
    // Instep flap over the laces.
    blob(b, { c: [x0, yh - 2.93, 0.17], r: [0.13, 0.1, 0.17], seg: lod ? 4 : 6, rows: lod ? 3 : 4, uv: U.gearDark, skin: rigid(side > 0 ? BONE.footL : BONE.footR) });
  }
}

/** Build the mesh for an outfit. `lod` 0 is the close-up model, 1 the distant one. */
export function buildBody(o: Outfit, lod: 0 | 1): MeshData {
  const b = new MeshBuilder();
  const seg = lod ? 12 : 24;
  trunk(b, seg);
  head(b, o, lod);
  for (const side of [1, -1]) {
    arm(b, side, lod ? 6 : 10);
    hand(b, side, o, lod);
    leg(b, side, lod ? 6 : 12);
    shoe(b, side, lod);
  }
  if (o.gear) gear(b, seg, lod);
  return b.build();
}
