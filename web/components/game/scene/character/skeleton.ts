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
export const REST = new Float32Array(BONE_COUNT * 3);
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
}

const RIGID_GIRTH = new Set<number>([BONE.head, BONE.neck, BONE.handL, BONE.handR, BONE.footL, BONE.footR]);

/**
 * Bone world matrices → skinning matrices (world · bind⁻¹), written as 16 floats
 * per bone into `out`. `girth` scales each bone's local X/Z (a stockier or leaner
 * build); heads, hands and feet keep their size.
 */
export function writeSkinMatrices(out: Float32Array, bones: ArrayLike<{ elements: ArrayLike<number> }>, girth = 1): void {
  for (let b = 0; b < BONE_COUNT; b += 1) {
    const e = bones[b].elements;
    const o = b * 16;
    const rx = REST[b * 3];
    const ry = REST[b * 3 + 1];
    const rz = REST[b * 3 + 2];
    const g = RIGID_GIRTH.has(b) ? 1 : girth;
    const m0 = e[0] * g;
    const m1 = e[1] * g;
    const m2 = e[2] * g;
    const m8 = e[8] * g;
    const m9 = e[9] * g;
    const m10 = e[10] * g;
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
}
