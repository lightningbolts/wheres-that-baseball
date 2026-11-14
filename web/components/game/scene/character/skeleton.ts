/**
 * The character skeleton: 17 bones whose world matrices are produced by `solveRig`
 * (rig.ts) from a pose. In the rest pose the figure stands at the origin facing +Z
 * (+X is its left) with arms and legs hanging straight down, and every bone frame
 * is axis-aligned, so a bone's bind matrix is just a translation to its joint.
 */
export const BONE = {
  pelvis: 0,
  spine: 1,
  chest: 2,
  neck: 3,
  head: 4,
  armL: 5,
  foreL: 6,
  handL: 7,
  armR: 8,
  foreR: 9,
  handR: 10,
  thighL: 11,
  shinL: 12,
  footL: 13,
  thighR: 14,
  shinR: 15,
  footR: 16,
} as const;
export const BONE_COUNT = 17;

/**
 * Helper joints, derived from the solved bones when the skinning matrices are written:
 * each sits at a hip, knee or elbow and is turned half-way between the two bones that
 * meet there, so a deep bend is shared by two gentle ones and the joint keeps its volume.
 */
export const HELPER = {
  hipL: 17,
  kneeL: 18,
  hipR: 19,
  kneeR: 20,
  elbowL: 21,
  elbowR: 22,
} as const;
/** Bones the mesh is skinned to: the solved skeleton plus the helpers. */
export const SKIN_COUNT = 23;

/** Body dimensions, ft. Heights are relative to the pelvis origin unless noted. */
export const DIM = {
  /** Rest height of the pelvis origin above the ground. */
  hip: 3.0,
  shoulderX: 0.66,
  shoulderY: 1.82,
  hipX: 0.3,
  hipY: -0.05,
  upperArm: 1.0,
  /** Elbow to the centre of the palm. */
  foreArm: 0.98,
  /** Elbow to the wrist (where the forearm mesh ends). */
  wrist: 0.8,
  thigh: 1.48,
  shin: 1.45,
  /** Neck and head pivots. */
  neckY: 2.04,
  neckZ: -0.03,
  headY: 2.24,
  /** Centre of the skull. */
  headCY: 2.47,
  headCZ: 0.035,
  /** Ankle height above the sole. */
  ankle: 0.12,
} as const;

/** Share of the torso's twist / lean taken by the pelvis and the lumbar spine. */
export const PELVIS_TWIST = 0.3;
export const PELVIS_LEAN = 0.2;
export const SPINE_TWIST = 0.65;
export const SPINE_LEAN = 0.6;

/** Rest joint positions (world, ft): xyz per bone. */
export const REST = new Float32Array(SKIN_COUNT * 3);
function rest(b: number, x: number, y: number, z: number) {
  REST[b * 3] = x;
  REST[b * 3 + 1] = y;
  REST[b * 3 + 2] = z;
}
rest(BONE.pelvis, 0, DIM.hip, 0);
rest(BONE.spine, 0, DIM.hip, 0);
rest(BONE.chest, 0, DIM.hip, 0);
rest(BONE.neck, 0, DIM.hip + DIM.neckY, DIM.neckZ);
rest(BONE.head, 0, DIM.hip + DIM.headY, 0);
for (let i = 0; i < 2; i += 1) {
  const s = i === 0 ? 1 : -1;
  const arm = i === 0 ? BONE.armL : BONE.armR;
  const sy = DIM.hip + DIM.shoulderY;
  rest(arm, s * DIM.shoulderX, sy, 0);
  rest(arm + 1, s * DIM.shoulderX, sy - DIM.upperArm, 0);
  rest(arm + 2, s * DIM.shoulderX, sy - DIM.upperArm - DIM.foreArm, 0);
  const leg = i === 0 ? BONE.thighL : BONE.thighR;
  const hy = DIM.hip + DIM.hipY;
  rest(leg, s * DIM.hipX, hy, 0);
  rest(leg + 1, s * DIM.hipX, hy - DIM.thigh, 0);
  rest(leg + 2, s * DIM.hipX, hy - DIM.thigh - DIM.shin, 0);
  rest(i === 0 ? HELPER.hipL : HELPER.hipR, s * DIM.hipX, hy, 0);
  rest(i === 0 ? HELPER.kneeL : HELPER.kneeR, s * DIM.hipX, hy - DIM.thigh, 0);
  rest(i === 0 ? HELPER.elbowL : HELPER.elbowR, s * DIM.shoulderX, sy - DIM.upperArm, 0);
}

const RIGID_GIRTH = new Set<number>([BONE.head, BONE.neck, BONE.handL, BONE.handR, BONE.footL, BONE.footR]);

/** [helper, parent bone, child bone (the helper sits at the child's joint), bulge]. */
const HELPERS: Array<[number, number, number, number]> = [
  [HELPER.hipL, BONE.pelvis, BONE.thighL, 0],
  [HELPER.hipR, BONE.pelvis, BONE.thighR, 0],
  [HELPER.kneeL, BONE.thighL, BONE.shinL, 1],
  [HELPER.kneeR, BONE.thighR, BONE.shinR, 1],
  [HELPER.elbowL, BONE.armL, BONE.foreL, 1],
  [HELPER.elbowR, BONE.armR, BONE.foreR, 1],
];

const qa = [0, 0, 0, 1];
const qb = [0, 0, 0, 1];
const hm = new Float32Array(16);

/** Rotation part of a column-major matrix (orthonormal) → quaternion. */
function quatOf(e: ArrayLike<number>, q: number[]): void {
  const m11 = e[0];
  const m21 = e[1];
  const m31 = e[2];
  const m12 = e[4];
  const m22 = e[5];
  const m32 = e[6];
  const m13 = e[8];
  const m23 = e[9];
  const m33 = e[10];
  const tr = m11 + m22 + m33;
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1);
    q[3] = 0.25 / s;
    q[0] = (m32 - m23) * s;
    q[1] = (m13 - m31) * s;
    q[2] = (m21 - m12) * s;
  } else if (m11 > m22 && m11 > m33) {
    const s = 2 * Math.sqrt(Math.max(1e-12, 1 + m11 - m22 - m33));
    q[3] = (m32 - m23) / s;
    q[0] = 0.25 * s;
    q[1] = (m12 + m21) / s;
    q[2] = (m13 + m31) / s;
  } else if (m22 > m33) {
    const s = 2 * Math.sqrt(Math.max(1e-12, 1 + m22 - m11 - m33));
    q[3] = (m13 - m31) / s;
    q[0] = (m12 + m21) / s;
    q[1] = 0.25 * s;
    q[2] = (m23 + m32) / s;
  } else {
    const s = 2 * Math.sqrt(Math.max(1e-12, 1 + m33 - m11 - m22));
    q[3] = (m21 - m12) / s;
    q[0] = (m13 + m31) / s;
    q[1] = (m23 + m32) / s;
    q[2] = 0.25 * s;
  }
}

/** world · bind⁻¹ for one bone whose bind matrix is a translation to its rest joint. */
function writeSkin(out: Float32Array, b: number, e: ArrayLike<number>, g: number, bulge: number): void {
  const o = b * 16;
  const rx = REST[b * 3];
  const ry = REST[b * 3 + 1];
  const rz = REST[b * 3 + 2];
  const m0 = e[0] * g;
  const m1 = e[1] * g;
  const m2 = e[2] * g;
  const m8 = e[8] * g * bulge;
  const m9 = e[9] * g * bulge;
  const m10 = e[10] * g * bulge;
  out[o] = m0;
  out[o + 1] = m1;
  out[o + 2] = m2;
  out[o + 3] = 0;
  out[o + 4] = e[4];
  out[o + 5] = e[5];
  out[o + 6] = e[6];
  out[o + 7] = 0;
  out[o + 8] = m8;
  out[o + 9] = m9;
  out[o + 10] = m10;
  out[o + 11] = 0;
  out[o + 12] = e[12] - (m0 * rx + e[4] * ry + m8 * rz);
  out[o + 13] = e[13] - (m1 * rx + e[5] * ry + m9 * rz);
  out[o + 14] = e[14] - (m2 * rx + e[6] * ry + m10 * rz);
  out[o + 15] = 1;
}

/**
 * Bone world matrices → skinning matrices (world · bind⁻¹), written as 16 floats
 * per bone into `out` (SKIN_COUNT bones: the 17 solved ones, then the helpers).
 * `girth` scales each bone's local X/Z (a stockier or leaner build); heads, hands and
 * feet keep their size.
 */
export function writeSkinMatrices(out: Float32Array, bones: ArrayLike<{ elements: ArrayLike<number> }>, girth = 1): void {
  for (let b = 0; b < BONE_COUNT; b += 1) writeSkin(out, b, bones[b].elements, RIGID_GIRTH.has(b) ? 1 : girth, 1);
  for (let k = 0; k < HELPERS.length; k += 1) {
    const h = HELPERS[k];
    const pe = bones[h[1]].elements;
    const ce = bones[h[2]].elements;
    quatOf(pe, qa);
    quatOf(ce, qb);
    let d = qa[0] * qb[0] + qa[1] * qb[1] + qa[2] * qb[2] + qa[3] * qb[3];
    const sg = d < 0 ? -1 : 1;
    d = Math.abs(d);
    let x = qa[0] + sg * qb[0];
    let y = qa[1] + sg * qb[1];
    let z = qa[2] + sg * qb[2];
    let w = qa[3] + sg * qb[3];
    const l = Math.hypot(x, y, z, w) || 1;
    x /= l;
    y /= l;
    z /= l;
    w /= l;
    hm[0] = 1 - 2 * (y * y + z * z);
    hm[1] = 2 * (x * y + z * w);
    hm[2] = 2 * (x * z - y * w);
    hm[4] = 2 * (x * y - z * w);
    hm[5] = 1 - 2 * (x * x + z * z);
    hm[6] = 2 * (y * z + x * w);
    hm[8] = 2 * (x * z + y * w);
    hm[9] = 2 * (y * z - x * w);
    hm[10] = 1 - 2 * (x * x + y * y);
    hm[12] = ce[12];
    hm[13] = ce[13];
    hm[14] = ce[14];
    // d = cos(half the bend); skin half-way between a bone and the helper thins by cos(bend / 4).
    const bulge = h[3] ? Math.min(1.3, 1 / Math.sqrt(0.5 + 0.5 * Math.min(1, d))) : 1;
    writeSkin(out, h[0], hm, girth, bulge);
  }
}

/** Enlarge a written set of skinning matrices by `s` about the world point (px, py, pz). */
export function scaleSkinMatrices(out: Float32Array, s: number, px: number, py: number, pz: number): void {
  const kx = px * (1 - s);
  const ky = py * (1 - s);
  const kz = pz * (1 - s);
  for (let b = 0; b < SKIN_COUNT; b += 1) {
    const o = b * 16;
    for (let c = 0; c < 3; c += 1) {
      out[o + c * 4] *= s;
      out[o + c * 4 + 1] *= s;
      out[o + c * 4 + 2] *= s;
    }
    out[o + 12] = out[o + 12] * s + kx;
    out[o + 13] = out[o + 13] * s + ky;
    out[o + 14] = out[o + 14] * s + kz;
  }
}
