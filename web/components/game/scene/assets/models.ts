/**
 * Runtime side of the Blender asset pipeline (assets3d/, scripts/build-assets.mjs).
 *
 * `loadModel(name)` fetches a built GLB once (meshopt-compressed, so the decoder is wired
 * in) and hands back each level of detail as a plain BufferGeometry + material in the
 * scene's units (feet, Y-up) with any node transform (meshopt's quantisation offset and
 * scale) baked in, so callers can drop them into a Mesh or InstancedMesh as they are.
 *
 * Models are an upgrade, never a dependency: until one arrives — or if it fails — the
 * caller keeps its procedural stand-in. `useModel` returns null in the meantime.
 */
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { MODELS, type ModelName } from "@/components/game/scene/assets/manifest.generated";

export interface ModelLod {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
}

export interface Model {
  name: ModelName;
  /** Finest first. */
  lods: ModelLod[];
}

/** Float copies of quantised attributes, so a node transform can be baked into them. */
function dequantise(g: THREE.BufferGeometry): void {
  for (const key of Object.keys(g.attributes)) {
    const a = g.getAttribute(key) as THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
    if (a.array instanceof Float32Array && !(a instanceof THREE.InterleavedBufferAttribute)) continue;
    const out = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i += 1) {
      for (let c = 0; c < a.itemSize; c += 1) out[i * a.itemSize + c] = a.getComponent(i, c);
    }
    g.setAttribute(key, new THREE.BufferAttribute(out, a.itemSize));
  }
}

/** Pull the LOD meshes out of a loaded scene, finest first, in scene units. */
export function extractLods(name: string, root: THREE.Object3D): ModelLod[] {
  root.updateMatrixWorld(true);
  const found: Array<{ lod: number; mesh: THREE.Mesh }> = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const m = /_LOD(\d+)$/.exec(mesh.name) ?? /_LOD(\d+)$/.exec((mesh.geometry.name as string) ?? "");
    if (!m || !mesh.name.startsWith(name)) return;
    found.push({ lod: Number(m[1]), mesh });
  });
  found.sort((a, b) => a.lod - b.lod);
  return found.map(({ mesh }) => {
    const geometry = mesh.geometry.clone();
    if (!mesh.matrixWorld.equals(new THREE.Matrix4())) {
      dequantise(geometry);
      geometry.applyMatrix4(mesh.matrixWorld);
    }
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    const src = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const material = src instanceof THREE.MeshStandardMaterial ? src : new THREE.MeshStandardMaterial();
    return { geometry, material };
  });
}

let loader: GLTFLoader | null = null;
const cache = new Map<ModelName, Promise<Model | null>>();
const loaded = new Map<ModelName, Model>();

export function loadModel(name: ModelName): Promise<Model | null> {
  let p = cache.get(name);
  if (!p) {
    loader ??= new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const url = MODELS[name].url;
    p = loader
      .loadAsync(url)
      .then((gltf) => {
        const lods = extractLods(name, gltf.scene);
        if (!lods.length) throw new Error("no _LOD<n> meshes");
        const model: Model = { name, lods };
        loaded.set(name, model);
        return model;
      })
      .catch((err: unknown) => {
        console.warn(`[models] ${name} (${url}) failed, keeping the procedural stand-in:`, err);
        return null;
      });
    cache.set(name, p);
  }
  return p;
}

/** The model once loaded (null until then, or for good if it failed). */
export function useModel(name: ModelName): Model | null {
  const [model, setModel] = useState<Model | null>(() => loaded.get(name) ?? null);
  useEffect(() => {
    if (model) return;
    let live = true;
    void loadModel(name).then((m) => {
      if (live && m) setModel(m);
    });
    return () => {
      live = false;
    };
  }, [name, model]);
  return model;
}

/** The finest LOD at or below `lod` (clamped to what the model has). */
export function modelLod(model: Model, lod: number): ModelLod {
  return model.lods[Math.min(Math.max(0, Math.round(lod)), model.lods.length - 1)];
}

export interface ModelOnOptions {
  /** Level of detail to use (clamped to what the model has). Default 0. */
  lod?: number;
  /** Make the material to draw with from the model's own (e.g. a clone with a glow). Disposed on swap-back. */
  material?: (m: THREE.MeshStandardMaterial) => THREE.Material;
}

/**
 * Swap a model's geometry and material into an existing mesh (or InstancedMesh) once it
 * loads, and put the procedural ones back on unmount or when the inputs change. `target`
 * is read inside the effect, so a ref's `.current` works.
 */
export function useModelOn(name: ModelName, target: () => THREE.Mesh | null | undefined, opts: ModelOnOptions = {}): void {
  const model = useModel(name);
  const latest = useRef({ target, material: opts.material });
  // Declared before the swap effect, so it runs first and the swap sees this render's values.
  useEffect(() => {
    latest.current = { target, material: opts.material };
  });
  const lod = opts.lod ?? 0;
  useEffect(() => {
    const mesh = latest.current.target();
    if (!mesh || !model) return;
    const pick = modelLod(model, lod);
    const make = latest.current.material;
    const material = make ? make(pick.material) : pick.material;
    const prev = { geometry: mesh.geometry, material: mesh.material };
    mesh.geometry = pick.geometry;
    mesh.material = material;
    return () => {
      mesh.geometry = prev.geometry;
      mesh.material = prev.material;
      if (material !== pick.material) material.dispose();
    };
  }, [model, lod]);
}
