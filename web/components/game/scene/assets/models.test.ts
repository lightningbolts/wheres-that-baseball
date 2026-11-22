import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import { MODELS } from "@/components/game/scene/assets/manifest.generated";
import { extractLods } from "@/components/game/scene/assets/models";

const WEB = path.resolve(__dirname, "../../../..");

describe("built 3D models", () => {
  for (const [name, info] of Object.entries(MODELS)) {
    describe(name, () => {
      const file = path.join(WEB, "public", info.url);

      it("is on disk under a content-hashed name, at the size the manifest records", () => {
        expect(info.url).toMatch(new RegExp(`^/models/${name}\\.[0-9a-f]{10}\\.glb$`));
        expect(existsSync(file)).toBe(true);
        expect(readFileSync(file).length).toBe(info.bytes);
      });

      it("holds one mesh per LOD, finest first, meshopt-compressed", async () => {
        await MeshoptDecoder.ready;
        const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
        const doc = await io.read(file);
        const used = doc.getRoot().listExtensionsUsed().map((e) => e.extensionName);
        expect(used).toContain("EXT_meshopt_compression");
        const meshes = doc.getRoot().listMeshes().map((m) => m.getName());
        expect(meshes.sort()).toEqual(info.lods.map((l) => l.name).sort());
        for (let i = 1; i < info.lods.length; i += 1) expect(info.lods[i].triangles).toBeLessThan(info.lods[i - 1].triangles);
      });
    });
  }

  it("bat keeps the procedural bat's contract: handle at the origin, barrel up +Y", () => {
    const b = MODELS.bat.lods[0].bounds;
    expect(b.min[1]).toBeCloseTo(-0.2, 2);
    expect(b.max[1]).toBeCloseTo(2.62, 2);
    expect(Math.abs(b.min[0] + b.max[0])).toBeLessThan(1e-3);
  });

  it("baseball is BALL_R in radius, centred", () => {
    for (const l of MODELS.baseball.lods) {
      expect(l.bounds.max[1]).toBeCloseTo(0.121, 3);
      expect(l.bounds.min[1]).toBeCloseTo(-0.121, 3);
    }
  });
});

describe("extractLods", () => {
  it("orders LODs and bakes a quantised node transform into float positions", () => {
    const root = new THREE.Group();
    const make = (lod: number, scale: number, offset: number) => {
      const g = new THREE.BufferGeometry();
      // Normalised int16 positions, as meshopt quantisation writes them.
      g.setAttribute("position", new THREE.BufferAttribute(new Int16Array([0, 0, 0, 32767, 0, 0, 0, 32767, 0]), 3, true));
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial());
      m.name = `thing_LOD${lod}`;
      m.scale.setScalar(scale);
      m.position.set(offset, 0, 0);
      return m;
    };
    root.add(make(1, 1, 0), make(0, 3, 1));
    const lods = extractLods("thing", root);
    expect(lods).toHaveLength(2);
    const p = lods[0].geometry.getAttribute("position");
    expect(p.array).toBeInstanceOf(Float32Array);
    expect(p.getX(0)).toBeCloseTo(1, 5);
    expect(p.getX(1)).toBeCloseTo(4, 3);
    expect(p.getY(2)).toBeCloseTo(3, 3);
    // An identity-transform LOD is passed through as is.
    expect(lods[1].geometry.getAttribute("position").getX(1)).toBeCloseTo(1, 3);
  });
});
