"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { Park } from "@/lib/game/physics/park";
import { layoutFor } from "@/lib/game/data/parkLayouts";
import { buildWallLoop, fieldGrass, fieldMarks, GROUND_Y, wallCaps, wallGeometry } from "@/components/game/scene/fieldGeometry";
import { GeoBuilder } from "@/components/game/scene/parks/geo";
import { buildStands } from "@/components/game/scene/parks/stands";
import {
  battersEye,
  bullpens,
  decalGeometry,
  DUGOUT,
  dugouts,
  features,
  foulPoles,
  lightBanks,
  netGeometry,
  roof,
  scoreboard,
  type BoardPlacement,
  type PropCtx,
} from "@/components/game/scene/parks/props";
import { applyWorldDetail, decalAtlas, detailTexture, mowTexture, netTexture, seatTexture, wallAtlas } from "@/components/game/scene/parks/textures";
import { timeOfDay } from "@/components/game/scene/parks/tod";

/** Shared excitement level (0..1) the crowd reacts to; set by the game view. */
export const crowdState = { excite: 0 };

/** Most fans drawn at once (one instanced draw call). */
const MAX_FANS = 26000;

/**
 * The whole ballpark for one venue: real wall outline, park-specific stands, landmarks and
 * backdrop. Static geometry is merged into a handful of meshes (field, markings, wall,
 * structure, seating, lights, net, decals) so a park costs about a dozen draw calls.
 */
export function Ballpark({ park, homeColor }: { park: Park; homeColor: string }) {
  const tod = useMemo(() => timeOfDay(park.venueId), [park.venueId]);
  const lit = tod !== "day";

  const built = useMemo(() => {
    const layout = layoutFor(park.venueId);
    const loop = buildWallLoop(park);
    const st = new GeoBuilder();
    const glow = new GeoBuilder();
    const seats = new GeoBuilder(true);
    const stands = buildStands(layout, loop, st, seats, {
      homeColor,
      skip: (beta, off) => Math.abs(beta) > DUGOUT.from - 1.5 && Math.abs(beta) < DUGOUT.to + 1.5 && off < DUGOUT.depth + 1,
    });
    const ctx: PropCtx = { park, layout, loop, st, glow, reach: stands.reach, homeColor, lit };
    wallCaps(loop, st, layout.trim);
    foulPoles(ctx);
    dugouts(ctx);
    battersEye(ctx);
    bullpens(ctx);
    lightBanks(ctx);
    const board = scoreboard(ctx);
    roof(ctx);
    features(ctx);
    const net = netGeometry(ctx);
    return {
      ctx,
      layout,
      board,
      slots: stands.slots,
      yaws: stands.yaws,
      geo: {
        grass: fieldGrass(loop),
        marks: fieldMarks(park, loop),
        wall: wallGeometry(loop, layout),
        structure: st.build(),
        seats: seats.build(),
        glow: glow.build(),
        net,
      },
    };
  }, [park, homeColor, lit]);
  useEffect(() => () => Object.values(built.geo).forEach((g) => g.dispose()), [built]);

  const mats = useMemo(() => {
    if (typeof document === "undefined") return null;
    const detail = detailTexture();
    const mow = mowTexture(built.layout.mow, park.turf);
    const atlas = wallAtlas();
    const seatTex = seatTexture();
    const netTex = netTexture();
    const decals = decalAtlas(
      park.fenceMarkers.map((m) => m.ft),
      built.layout.skins.some((s) => s[1] === "monster") || built.layout.wall === "#1c2f55" ? "#f4f1e6" : "#f1d44a",
    );
    const grass = new THREE.MeshStandardMaterial({ map: mow, roughness: 0.95 });
    applyWorldDetail(grass, detail, 0.33);
    const marks = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    applyWorldDetail(marks, detail, 0.21);
    const textures = [detail, mow, atlas, seatTex, netTex, decals.texture];
    const materials = {
      grass,
      marks,
      wall: new THREE.MeshStandardMaterial({ map: atlas, vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }),
      structure: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
      seats: new THREE.MeshLambertMaterial({ map: seatTex, vertexColors: true, side: THREE.DoubleSide }),
      glow: new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, toneMapped: false }),
      net: new THREE.MeshBasicMaterial({ map: netTex, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide }),
      decal: new THREE.MeshLambertMaterial({ map: decals.texture, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
      outside: new THREE.MeshLambertMaterial({ color: "#5d625c" }),
    };
    return { materials, textures, decalGeo: decalGeometry(built.ctx, decals) };
  }, [built, park]);
  useEffect(
    () => () => {
      if (!mats) return;
      Object.values(mats.materials).forEach((m) => m.dispose());
      mats.textures.forEach((t) => t.dispose());
      mats.decalGeo.dispose();
    },
    [mats],
  );

  if (!mats) return null;
  const { geo } = built;
  const m = mats.materials;
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[0, GROUND_Y, 200]} material={m.outside}>
        <planeGeometry args={[12000, 12000]} />
      </mesh>
      <mesh geometry={geo.grass} material={m.grass} receiveShadow />
      <mesh geometry={geo.marks} material={m.marks} receiveShadow />
      <mesh geometry={geo.wall} material={m.wall} castShadow receiveShadow />
      <mesh geometry={mats.decalGeo} material={m.decal} />
      <mesh geometry={geo.structure} material={m.structure} castShadow />
      <mesh geometry={geo.seats} material={m.seats} />
      <mesh geometry={geo.glow} material={m.glow} />
      <Crowd seats={built.slots} yaws={built.yaws} accent={homeColor} capacity={park.capacity} />
      <mesh geometry={geo.net} material={m.net} renderOrder={2} />
      <Scoreboard at={built.board} />
    </group>
  );
}

/**
 * Instanced crowd: one draw call for up to ~26k fans. A vertex-shader bob driven by
 * `crowdState.excite` makes them stand and bounce on big moments.
 */
function Crowd({ seats, yaws, accent, capacity }: { seats: Float32Array; yaws: Float32Array; accent: string; capacity: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const total = seats.length / 3;
  // Attendance follows the park's capacity; big bowls are thinned to the instance budget.
  const fill = Math.min(0.94, Math.max(0.6, 0.62 + capacity / 150000));
  const keep = Math.min(fill, MAX_FANS / Math.max(1, total));
  const count = Math.max(1, Math.min(total, Math.ceil(total * keep) + 64));
  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uExcite: { value: 0 } }), []);
  const material = useMemo(() => {
    const m = new THREE.MeshLambertMaterial({ vertexColors: false });
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = uniforms.uTime;
      shader.uniforms.uExcite = uniforms.uExcite;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float uTime;\nuniform float uExcite;\nvarying vec2 vSil;\nvarying float vSkin;")
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
          float seed = float(gl_InstanceID) * 0.6180339;
          vSil = uv;
          vSkin = fract(seed * 7.13);
          float idle = sin(uTime * 1.3 + seed * 40.0) * 0.08;
          float jump = max(0.0, sin(uTime * 9.0 + seed * 17.0)) * 1.1 * uExcite;
          transformed.y += idle + jump + uExcite * 0.6;`,
        );
      // Cut the quad into a head-and-shoulders silhouette; the head gets a skin tone.
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec2 vSil;\nvarying float vSkin;")
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
          vec2 hp = (vSil - vec2(0.5, 0.8)) * vec2(1.5 / 2.3, 1.0);
          bool head = dot(hp, hp) < 0.026;
          vec2 bp = vec2(abs(vSil.x - 0.5), vSil.y);
          bool body = bp.y < 0.66 && bp.x < 0.44 - max(0.0, bp.y - 0.48) * 1.3;
          if (!head && !body) discard;
          if (head) diffuseColor.rgb = mix(vec3(0.95, 0.76, 0.6), vec3(0.36, 0.23, 0.15), vSkin);`,
        );
    };
    return m;
  }, [uniforms]);
  const geom = useMemo(() => {
    // A fan = one quad facing the field (2 triangles), shoulders-and-head height.
    const g = new THREE.PlaneGeometry(1.7, 2.7);
    g.translate(0, 1.15, 0);
    return g;
  }, []);
  useEffect(
    () => () => {
      geom.dispose();
      material.dispose();
    },
    [geom, material],
  );

  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const mat = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const c = new THREE.Color();
    const acc = new THREE.Color(accent);
    const palette = ["#d9d4c7", "#2b2f3a", "#7a2230", "#1f4f8a", "#e2e2e2", "#3a5a3a", "#b4552f", "#c9b26b"].map((x) => new THREE.Color(x));
    let s = 12345;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    let n = 0;
    for (let i = 0; i < total && n < count; i += 1) {
      if (rnd() > keep) continue;
      q.setFromAxisAngle(up, yaws[i] + (rnd() - 0.5) * 0.3);
      const sc = 0.85 + rnd() * 0.3;
      pos.set(seats[i * 3] + (rnd() - 0.5) * 0.8, seats[i * 3 + 1], seats[i * 3 + 2] + (rnd() - 0.5) * 0.8);
      mesh.setMatrixAt(n, mat.compose(pos, q, scl.set(sc, sc, sc)));
      // A third of the crowd wears the home team's color.
      if (rnd() < 0.33) c.copy(acc).multiplyScalar(0.75 + rnd() * 0.4);
      else c.copy(palette[Math.floor(rnd() * palette.length)]).multiplyScalar(0.7 + rnd() * 0.4);
      mesh.setColorAt(n, c);
      n += 1;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [count, total, keep, seats, yaws, accent]);

  useFrame((state, dt) => {
    uniforms.uTime.value = state.clock.elapsedTime;
    const target = crowdState.excite;
    uniforms.uExcite.value += (target - uniforms.uExcite.value) * Math.min(1, dt * 3);
    crowdState.excite = Math.max(0, crowdState.excite - dt * 0.12);
  });

  return <instancedMesh key={count} ref={ref} args={[geom, material, count]} frustumCulled={false} />;
}

/** Scoreboard face: a canvas the game controller draws into. */
export const scoreboardCanvas: { canvas: HTMLCanvasElement | null; texture: THREE.CanvasTexture | null } = {
  canvas: null,
  texture: null,
};

function Scoreboard({ at }: { at: BoardPlacement }) {
  const tex = useMemo(() => {
    if (typeof document === "undefined") return null;
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 192;
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }, []);
  // Published from an effect (not the memo) so it survives React's dev double-mount.
  useEffect(() => {
    if (!tex) return undefined;
    scoreboardCanvas.canvas = tex.image as HTMLCanvasElement;
    scoreboardCanvas.texture = tex;
    return () => {
      tex.dispose();
      scoreboardCanvas.canvas = null;
      scoreboardCanvas.texture = null;
    };
  }, [tex]);
  return (
    <mesh position={at.position} rotation-y={at.yaw}>
      <planeGeometry args={[at.w, at.h]} />
      <meshBasicMaterial map={tex} toneMapped={false} />
    </mesh>
  );
}
