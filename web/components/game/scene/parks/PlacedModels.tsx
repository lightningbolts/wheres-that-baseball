"use client";
/**
 * Draws the park's placed Blender models (parks/placements.ts) as one InstancedMesh per
 * model, or each model's procedural proxy until its GLB has loaded.
 */
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useModel, modelLod } from "@/components/game/scene/assets/models";
import { PLACED_MODELS, type PlacedModel, type PlacedSet } from "@/components/game/scene/parks/placements";

/** Models drawn double-sided (single-surface fronds and screens). */
const DOUBLE: ReadonlySet<PlacedModel> = new Set(["tree_palm", "foul_pole"]);
const NO_SHADOW: ReadonlySet<PlacedModel> = new Set(["luminaire"]);

export function PlacedModels({ sets, structure, led, lit, lod }: { sets: Partial<Record<PlacedModel, PlacedSet>>; structure: THREE.Material; led: THREE.Material; lit: boolean; lod: number }) {
  return (
    <>
      {PLACED_MODELS.map((name) => {
        const set = sets[name];
        return set ? <Placed key={name} name={name} set={set} structure={structure} led={led} lit={lit} lod={lod} /> : null;
      })}
    </>
  );
}

function Placed({ name, set, structure, led, lit, lod }: { name: PlacedModel; set: PlacedSet; structure: THREE.Material; led: THREE.Material; lit: boolean; lod: number }) {
  const model = useModel(name);
  const mesh = useMemo(() => {
    if (!model || !set.count) return null;
    // Luminaires come by the hundred and sit a long way off: the light LOD unless few.
    const pick = modelLod(model, name === "luminaire" && set.count > 160 ? Math.max(lod, 1) : lod);
    const material = pick.material.clone();
    material.vertexColors = true;
    if (DOUBLE.has(name)) material.side = THREE.DoubleSide;
    if (name === "luminaire") {
      // Lenses are vertex-coloured pure white: light them at night.
      const glow = lit ? 4.5 : 0;
      material.onBeforeCompile = (sh) => {
        sh.fragmentShader = sh.fragmentShader.replace(
          "#include <emissivemap_fragment>",
          `#include <emissivemap_fragment>\nfloat lens = step(0.95, vColor.g);\ntotalEmissiveRadiance += lens * ${glow.toFixed(2)} * vec3(1.0, 0.96, 0.86);\ndiffuseColor.rgb *= 1.0 - lens * ${lit ? "0.0" : "0.35"};`,
        );
      };
      material.customProgramCacheKey = () => `luminaire:${lit ? 1 : 0}`;
    }
    const m = new THREE.InstancedMesh(pick.geometry, material, set.count);
    m.instanceMatrix.set(set.matrices);
    m.instanceMatrix.needsUpdate = true;
    m.instanceColor = new THREE.InstancedBufferAttribute(set.colors, 3);
    m.computeBoundingSphere();
    m.computeBoundingBox();
    m.castShadow = !NO_SHADOW.has(name);
    m.receiveShadow = true;
    m.name = `placed:${name}`;
    return m;
  }, [model, set, lod, lit, name]);
  useEffect(
    () => () => {
      if (!mesh) return;
      (mesh.material as THREE.Material).dispose();
      mesh.dispose();
    },
    [mesh],
  );
  if (mesh) return <primitive object={mesh} />;
  return (
    <>
      {set.proxy && <mesh geometry={set.proxy} material={structure} castShadow />}
      {set.proxyLed && <mesh geometry={set.proxyLed} material={led} />}
    </>
  );
}
