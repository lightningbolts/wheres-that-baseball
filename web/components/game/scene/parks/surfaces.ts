/**
 * Ground shading from the Blender-baked surface sets (assets3d/blender/assets/turf.py,
 * dirt.py): tileable albedo-variation, normal and roughness maps baked from modelled grass
 * blades and groomed clay, sampled in world space (XZ, feet) at two scales — the second
 * rotated and larger so the tile never reads as a grid.
 *
 * The albedo maps are brightness variation around 0.5 (linear), so the material's own
 * colour (mow stripes, the park's dirt shade) survives: the shader multiplies by 2 × map.
 * Until a set loads, or if it fails, the ground keeps the procedural detail noise
 * (applyWorldDetail in textures.ts) — the same large-scale term is kept here too.
 */
import * as THREE from "three";
import type { MODELS } from "@/components/game/scene/assets/manifest.generated";
import { useModel } from "@/components/game/scene/assets/models";

export interface SurfaceSet {
  albedo: THREE.Texture;
  normal: THREE.Texture;
  /** glTF metallic-roughness map: G = roughness. */
  orm: THREE.Texture | null;
  /** Tile edge, feet. */
  tile: number;
}

/** Tile edge (feet) each set was baked at — keep in step with TILE in its .py. */
const TILE: Record<SurfaceName, number> = { turf: 3, dirt: 6 };
export type SurfaceName = Extract<keyof typeof MODELS, "turf" | "dirt">;

/** A baked surface set once its GLB has loaded (null until then, or if it failed). */
export function useSurfaceSet(name: SurfaceName): SurfaceSet | null {
  const model = useModel(name);
  if (!model) return null;
  const m = model.lods[0].material;
  if (!m.map || !m.normalMap) return null;
  for (const t of [m.map, m.normalMap, m.roughnessMap]) {
    if (!t) continue;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
  }
  return { albedo: m.map, normal: m.normalMap, orm: m.roughnessMap, tile: TILE[name] };
}

export interface SurfaceOptions {
  /** The procedural detail noise and its scale (as applyWorldDetail), kept for macro variation. */
  detail: THREE.Texture;
  detailScale: number;
  /** How strongly the baked albedo variation shows (0..1). */
  albedo: number;
  /** Normal perturbation strength. */
  normal: number;
  /** How far roughness moves toward the baked map (0..1). */
  roughness: number;
  /** Only where the vertex colour is warm (dirt, not chalk or rubber): marks layer. */
  warmMask?: boolean;
}

/**
 * Shade a ground material with a baked surface set (or, with `set` null, the procedural
 * detail alone — exactly what applyWorldDetail does).
 */
export function applySurface(m: THREE.MeshStandardMaterial, set: SurfaceSet | null, o: SurfaceOptions): void {
  const s = o.detailScale;
  const macro = `diffuseColor.rgb *= 0.78 + 0.27 * texture2D(uDetail, vWxz * ${s.toFixed(4)}).r + 0.17 * texture2D(uDetail, vWxz * ${(s * 0.11).toFixed(4)}).r;`;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uDetail = { value: o.detail };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vWxz;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWxz = (modelMatrix * vec4(transformed, 1.0)).xz;");
    let pars = "varying vec2 vWxz;\nuniform sampler2D uDetail;";
    let color = macro;
    let rough = "";
    let normal = "";
    if (set) {
      shader.uniforms.uSurfA = { value: set.albedo };
      shader.uniforms.uSurfN = { value: set.normal };
      shader.uniforms.uSurfR = { value: set.orm ?? set.albedo };
      pars += `
uniform sampler2D uSurfA, uSurfN, uSurfR;
float surfMask;
vec2 surfUv1, surfUv2;
// Second scale: 2.7× larger, rotated ~37°, offset — breaks the tile's repeat.
const mat2 SURF_ROT = mat2(0.7986, 0.6018, -0.6018, 0.7986);`;
      const k = (1 / set.tile).toFixed(5);
      const k2 = (1 / (set.tile * 2.7)).toFixed(5);
      const mask = o.warmMask ? "smoothstep(0.03, 0.12, vColor.r - vColor.b)" : "1.0";
      color = `
surfUv1 = vWxz * ${k};
surfUv2 = SURF_ROT * vWxz * ${k2} + vec2(0.37, 0.71);
surfMask = ${mask};
${macro}
{
  vec3 a = texture2D(uSurfA, surfUv1).rgb * texture2D(uSurfA, surfUv2).rgb * 4.0;
  diffuseColor.rgb *= mix(vec3(1.0), a, ${o.albedo.toFixed(3)} * surfMask);
}`;
      rough = `roughnessFactor = mix(roughnessFactor, 0.5 * (texture2D(uSurfR, surfUv1).g + texture2D(uSurfR, surfUv2).g), ${o.roughness.toFixed(3)} * surfMask);`;
      // Flat ground: the map's tangent X is world +X and its Y is world −Z (Blender +Y),
      // so the perturbation is a horizontal tilt added to the view-space normal.
      normal = `{
  vec2 t1 = texture2D(uSurfN, surfUv1).xy * 2.0 - 1.0;
  vec2 t2 = texture2D(uSurfN, surfUv2).xy * 2.0 - 1.0;
  t2 = t2 * SURF_ROT; // back from the rotated frame to world (Rᵀ·t)
  vec2 t = (t1 + 0.6 * t2) * ${o.normal.toFixed(3)} * surfMask;
  normal = normalize(normal + (viewMatrix * vec4(t.x, 0.0, -t.y, 0.0)).xyz);
}`;
    }
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${pars}`)
      .replace("#include <color_fragment>", `#include <color_fragment>\n${color}`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>\n${rough}`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>\n${normal}`);
  };
  m.customProgramCacheKey = () => `surface:${set ? set.tile : 0}:${o.warmMask ? 1 : 0}:${s}`;
  m.needsUpdate = true;
}
