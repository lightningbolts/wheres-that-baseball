import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { ModelPlacer } from "@/components/game/scene/parks/placements";

describe("ModelPlacer", () => {
  it("records instance transforms in the Frame convention and keeps proxies per model", () => {
    const p = new ModelPlacer();
    p.place("foul_pole", 10, 0, -5, Math.PI / 2, 1, 2, 1, [0.5, 0.25, 1]);
    p.place("foul_pole", 0, 0, 0, 0, 1);
    p.proxy("foul_pole").box(0, 0, 0, 1, 1, 1, 0, "#ffffff");
    p.proxyLed("luminaire").box(0, 0, 0, 1, 1, 1, 0, "#ffffff");
    const out = p.build();
    expect(out.foul_pole?.count).toBe(2);
    expect(Array.from(out.foul_pole!.colors.slice(0, 3))).toEqual([0.5, 0.25, 1]);
    // Local +X turned by yaw π/2 points along world −Z (Frame: rx = cos, rz = −sin); +Y scaled ×2.
    const m = new THREE.Matrix4().fromArray(out.foul_pole!.matrices, 0);
    const x = new THREE.Vector3(1, 0, 0).applyMatrix4(m);
    expect(x.x).toBeCloseTo(10, 5);
    expect(x.z).toBeCloseTo(-6, 5);
    expect(new THREE.Vector3(0, 1, 0).applyMatrix4(m).y).toBeCloseTo(2, 5);
    expect(out.foul_pole?.proxy).not.toBeNull();
    // A model with only a stand-in and no instances still reports its proxy.
    expect(out.luminaire?.count).toBe(0);
    expect(out.luminaire?.proxyLed).not.toBeNull();
    expect(out.tree_palm).toBeUndefined();
  });
});
