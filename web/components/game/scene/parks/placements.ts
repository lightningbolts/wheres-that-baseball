/**
 * Blender-built models placed around the park (light masts and luminaires, foul poles,
 * trees): the prop builders record an instance transform and colour for each, and draw
 * their old procedural version into a per-model *proxy* builder instead of the shared
 * structure. The scene shows the proxy until that model's GLB loads (or for good if it
 * fails) and an InstancedMesh of the model after — so nothing pops out or goes missing.
 */
import * as THREE from "three";
import { GeoBuilder, rgb, type RGB } from "@/components/game/scene/parks/geo";

export const PLACED_MODELS = ["foul_pole", "light_mast", "luminaire", "tree_round", "tree_pine", "tree_palm"] as const;
export type PlacedModel = (typeof PLACED_MODELS)[number];

export interface PlacedSet {
  /** 16 floats (column-major matrix) per instance. */
  matrices: Float32Array;
  /** Linear RGB per instance (multiplied into the model's vertex colours). */
  colors: Float32Array;
  count: number;
  /** The procedural stand-in, in the structure (lit) and LED (self-lit) materials. */
  proxy: THREE.BufferGeometry | null;
  proxyLed: THREE.BufferGeometry | null;
}

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const up = new THREE.Vector3(0, 1, 0);
const pos = new THREE.Vector3();
const scl = new THREE.Vector3();

export class ModelPlacer {
  private readonly mats = new Map<PlacedModel, number[]>();
  private readonly cols = new Map<PlacedModel, number[]>();
  private readonly st = new Map<PlacedModel, GeoBuilder>();
  private readonly led = new Map<PlacedModel, GeoBuilder>();

  /** Where to draw `name`'s procedural stand-in (lit structure, with the material-index UVs). */
  proxy(name: PlacedModel): GeoBuilder {
    let b = this.st.get(name);
    if (!b) this.st.set(name, (b = new GeoBuilder(true)));
    return b;
  }

  /** Where to draw `name`'s self-lit (LED-atlas) stand-in. */
  proxyLed(name: PlacedModel): GeoBuilder {
    let b = this.led.get(name);
    if (!b) this.led.set(name, (b = new GeoBuilder(true)));
    return b;
  }

  /** One instance: base at (x, y, z), turned `yaw` about +Y (the Frame convention), scaled. */
  place(name: PlacedModel, x: number, y: number, z: number, yaw: number, sx: number, sy = sx, sz = sx, color: string | RGB = [1, 1, 1]): void {
    q.setFromAxisAngle(up, yaw);
    m4.compose(pos.set(x, y, z), q, scl.set(sx, sy, sz));
    let list = this.mats.get(name);
    if (!list) {
      this.mats.set(name, (list = []));
      this.cols.set(name, []);
    }
    list.push(...m4.elements);
    const c = rgb(color); // linear, like the vertex colours it multiplies
    this.cols.get(name)!.push(c[0], c[1], c[2]);
  }

  build(): Partial<Record<PlacedModel, PlacedSet>> {
    const out: Partial<Record<PlacedModel, PlacedSet>> = {};
    for (const name of PLACED_MODELS) {
      const mats = this.mats.get(name);
      const st = this.st.get(name);
      const led = this.led.get(name);
      if (!mats && !st && !led) continue;
      out[name] = {
        matrices: new Float32Array(mats ?? []),
        colors: new Float32Array(this.cols.get(name) ?? []),
        count: (mats?.length ?? 0) / 16,
        proxy: st ? st.build() : null,
        proxyLed: led ? led.build() : null,
      };
    }
    return out;
  }
}
