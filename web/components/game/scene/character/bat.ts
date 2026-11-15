/**
 * The bat: knob, handle, taper, barrel and a cupped end, turned on a lathe. The handle is
 * at the origin and the barrel runs along +Y. Vertex colours carry the finish (pine tar on
 * the handle, a maker's ring, a darker end grain) and multiply the per-bat instance colour.
 */
import * as THREE from "three";

/** [radius, height] (ft). A 34-inch bat: 2.82 ft knob to end, 2.6-inch barrel. */
const PROFILE: Array<[number, number]> = [
  [0, -0.2],
  [0.05, -0.2],
  [0.078, -0.192],
  [0.085, -0.175],
  [0.08, -0.158],
  [0.058, -0.14],
  [0.044, -0.115],
  [0.04, -0.05],
  [0.04, 0.3],
  [0.042, 0.6],
  [0.047, 0.9],
  [0.056, 1.15],
  [0.07, 1.4],
  [0.086, 1.65],
  [0.099, 1.9],
  [0.107, 2.15],
  [0.108, 2.4],
  [0.106, 2.52],
  [0.098, 2.585],
  [0.082, 2.615],
  [0.06, 2.62],
  // Cupped end.
  [0.045, 2.6],
  [0, 2.585],
];

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function batGeometry(segments = 16): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(
    PROFILE.map(([x, y]) => new THREE.Vector2(x, y)),
    segments,
  );
  g.computeVertexNormals();
  const pos = g.getAttribute("position");
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i += 1) {
    const y = pos.getY(i);
    const a = Math.atan2(pos.getZ(i), pos.getX(i));
    // Pine tar and grip wear up the handle, heavier on one side.
    let k = 1 - (0.42 + 0.1 * Math.sin(a * 2)) * smooth(0.95, 0.15, y) * smooth(-0.16, -0.08, y);
    // Knob rubbed pale; maker's rings below the barrel; dark cup.
    if (y < -0.15) k = 1.06;
    if ((y > 1.36 && y < 1.44) || (y > 1.6 && y < 1.7)) k *= 0.55;
    if (y > 2.59 && Math.hypot(pos.getX(i), pos.getZ(i)) < 0.07) k *= 0.6;
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k;
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return g;
}

export function batMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ roughness: 0.36, metalness: 0, vertexColors: true });
}

/** Ash, maple, black lacquer, walnut stain, flame-tempered. */
export const BAT_COLORS = ["#d2ae76", "#e0c595", "#1d1c1e", "#6e3d22", "#b98a4e", "#26201c"].map((c) => new THREE.Color(c));
