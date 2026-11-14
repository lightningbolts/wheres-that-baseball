"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { Park } from "@/lib/game/physics/park";
import { BASES, MOUND } from "@/lib/game/physics/park";
import {
  bowlGeometry,
  chalkStrip,
  dirXZ,
  dirtCircle,
  dirtTexture,
  grassTexture,
  infieldDirt,
  moundGeometry,
  wallGeometry,
  wallPath,
  warningTrack,
} from "@/components/game/scene/fieldGeometry";

const S2 = Math.SQRT1_2;

/** Shared excitement level (0..1) the crowd reacts to; set by the game view. */
export const crowdState = { excite: 0 };

function useDispose<T extends { dispose(): void }>(items: T[]) {
  useEffect(() => () => items.forEach((i) => i.dispose()), [items]);
}

export function Ballpark({ park, homeColor }: { park: Park; homeColor: string }) {
  const geo = useMemo(() => {
    const path = wallPath(park);
    const walls = wallGeometry(path);
    const bowl = bowlGeometry(path);
    const lf = park.fence(-45);
    const rf = park.fence(45);
    const lines = [
      chalkStrip(0, 0, rf * -S2, rf * S2, 0.3),
      chalkStrip(0, 0, lf * S2, lf * S2, 0.3),
      // Batter's boxes (4 × 6 ft, 6 in off the plate) and catcher's box lines.
      ...[1, -1].flatMap((sx) => {
        const x0 = sx * 0.71;
        const x1 = sx * 4.71;
        return [
          chalkStrip(x0, -2.3, x0, 3.7, 0.25),
          chalkStrip(x1, -2.3, x1, 3.7, 0.25),
          chalkStrip(x0, 3.7, x1, 3.7, 0.25),
          chalkStrip(x0, -2.3, x1, -2.3, 0.25),
        ];
      }),
    ];
    return {
      path,
      walls,
      bowl,
      dirt: infieldDirt(),
      home: dirtCircle(0, 0, 13, 0.04),
      cutouts: [1, 2, 3].map((b) => {
        const p = b === 1 ? BASES.first : b === 2 ? BASES.second : BASES.third;
        return dirtCircle(p.x, p.z, 9, 0.035);
      }),
      mound: moundGeometry(),
      track: warningTrack(park),
      lines,
    };
  }, [park]);
  useDispose(
    useMemo(
      () => [geo.walls.wall, geo.walls.cap, geo.bowl.bowl, geo.dirt, geo.home, geo.mound, geo.track, ...geo.cutouts, ...geo.lines],
      [geo],
    ),
  );

  const tex = useMemo(() => {
    const grass = grassTexture();
    if (grass) {
      grass.repeat.set(1600 / 36, 1600 / 36);
      grass.rotation = Math.PI / 4;
      grass.center.set(0.5, 0.5);
    }
    const dirt = dirtTexture();
    dirt?.repeat.set(0.08, 0.08);
    return { grass, dirt };
  }, []);
  useEffect(() => () => {
    tex.grass?.dispose();
    tex.dirt?.dispose();
  }, [tex]);

  const turf = park.turf;
  const dirtMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: turf ? "#7d6a5a" : "#c08a5e", map: tex.dirt, roughness: 1 }),
    [tex, turf],
  );
  // World-space dirt UVs: ShapeGeometry UVs are in feet already, so a small repeat tiles nicely.
  useEffect(() => () => dirtMat.dispose(), [dirtMat]);

  const poles = useMemo(
    () =>
      [-45, 45].map((a) => {
        const [dx, dz] = dirXZ(a);
        const f = park.fence(a);
        return { x: dx * f, z: dz * f, h: park.wallHeight(a) + 75 };
      }),
    [park],
  );

  return (
    <group>
      {/* Grass to the horizon (also the foul territory). */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0, 200]} receiveShadow>
        <planeGeometry args={[1600, 1600]} />
        <meshStandardMaterial color={turf ? "#3b7a3a" : "#ffffff"} map={tex.grass} roughness={0.95} />
      </mesh>
      <mesh geometry={geo.dirt} material={dirtMat} receiveShadow />
      <mesh geometry={geo.home} material={dirtMat} receiveShadow />
      {geo.cutouts.map((g, i) => (
        <mesh key={i} geometry={g} material={dirtMat} receiveShadow />
      ))}
      <mesh geometry={geo.mound} material={dirtMat} receiveShadow />
      <mesh geometry={geo.track} receiveShadow>
        <meshStandardMaterial color="#8e6447" roughness={1} />
      </mesh>
      {geo.lines.map((g, i) => (
        <mesh key={i} geometry={g}>
          <meshBasicMaterial color="#f4f1ea" />
        </mesh>
      ))}
      <Bases />
      {/* Outfield + foul walls */}
      <mesh geometry={geo.walls.wall} receiveShadow>
        <meshStandardMaterial color="#2f5a44" emissive="#0e2018" roughness={0.9} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={geo.walls.cap}>
        <meshStandardMaterial color="#e7c23b" side={THREE.DoubleSide} roughness={0.6} />
      </mesh>
      <mesh geometry={geo.bowl.bowl}>
        <meshLambertMaterial vertexColors side={THREE.DoubleSide} />
      </mesh>
      <Crowd seats={geo.bowl.seats} yaws={geo.bowl.seatYaw} accent={homeColor} />
      {poles.map((p, i) => (
        <mesh key={i} position={[p.x, p.h / 2, p.z]}>
          <cylinderGeometry args={[0.6, 0.6, p.h, 8]} />
          <meshStandardMaterial color="#f2d23a" emissive="#5a4a00" />
        </mesh>
      ))}
      <LightTowers path={geo.path} />
      <Scoreboard park={park} />
    </group>
  );
}

function Bases() {
  return (
    <group>
      {[BASES.first, BASES.second, BASES.third].map((b, i) => (
        <mesh key={i} position={[b.x, 0.12, b.z]} rotation-y={Math.PI / 4} castShadow>
          <boxGeometry args={[1.5, 0.22, 1.5]} />
          <meshStandardMaterial color="#fbfbf8" roughness={0.6} />
        </mesh>
      ))}
      {/* Home plate: 17 in pentagon; the world origin is its back point. */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.07, 0]}>
        <shapeGeometry
          args={[
            new THREE.Shape([
              new THREE.Vector2(0, 0),
              new THREE.Vector2(0.708, -0.708),
              new THREE.Vector2(0.708, -1.417),
              new THREE.Vector2(-0.708, -1.417),
              new THREE.Vector2(-0.708, -0.708),
            ]),
          ]}
        />
        <meshStandardMaterial color="#fbfbf8" />
      </mesh>
      {/* Rubber */}
      <mesh position={[MOUND.x, 0.88, MOUND.z]}>
        <boxGeometry args={[2, 0.1, 0.5]} />
        <meshStandardMaterial color="#fbfbf8" />
      </mesh>
    </group>
  );
}

/**
 * Instanced crowd: one draw call for ~15k fans. A vertex-shader bob driven by
 * `crowdState.excite` makes them stand and bounce on big moments.
 */
function Crowd({ seats, yaws, accent }: { seats: Float32Array; yaws: Float32Array; accent: string }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const count = seats.length / 3;
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
    const g = new THREE.PlaneGeometry(1.6, 2.6);
    g.translate(0, 1.15, 0);
    return g;
  }, []);
  useEffect(() => () => {
    geom.dispose();
    material.dispose();
  }, [geom, material]);

  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const c = new THREE.Color();
    const acc = new THREE.Color(accent);
    const palette = ["#d9d4c7", "#2b2f3a", "#7a2230", "#1f4f8a", "#e2e2e2", "#3a5a3a", "#b4552f", "#c9b26b"].map((x) => new THREE.Color(x));
    let s = 12345;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < count; i += 1) {
      q.setFromAxisAngle(up, yaws[i] + (rnd() - 0.5) * 0.3);
      const sc = 0.85 + rnd() * 0.3;
      m.compose(new THREE.Vector3(seats[i * 3] + (rnd() - 0.5), seats[i * 3 + 1], seats[i * 3 + 2] + (rnd() - 0.5)), q, new THREE.Vector3(sc, sc, sc));
      mesh.setMatrixAt(i, m);
      // A third of the crowd wears the home team's color.
      if (rnd() < 0.33) c.copy(acc).multiplyScalar(0.75 + rnd() * 0.4);
      else c.copy(palette[Math.floor(rnd() * palette.length)]).multiplyScalar(0.7 + rnd() * 0.4);
      // Empty seats.
      if (rnd() < 0.18) {
        m.makeScale(0, 0, 0);
        mesh.setMatrixAt(i, m);
      }
      mesh.setColorAt(i, c);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [count, seats, yaws, accent]);

  useFrame((state, dt) => {
    uniforms.uTime.value = state.clock.elapsedTime;
    const target = crowdState.excite;
    uniforms.uExcite.value += (target - uniforms.uExcite.value) * Math.min(1, dt * 3);
    crowdState.excite = Math.max(0, crowdState.excite - dt * 0.12);
  });

  return <instancedMesh ref={ref} args={[geom, material, count]} frustumCulled={false} />;
}

function LightTowers({ path }: { path: Array<{ x: number; z: number; h: number; nx: number; nz: number }> }) {
  const towers = useMemo(() => {
    const picks = [0.2, 0.36, 0.5, 0.64, 0.8].map((f) => path[Math.floor(f * (path.length - 1))]);
    return picks.map((p) => ({ x: p.x + p.nx * 150, z: p.z + p.nz * 150, yaw: Math.atan2(-p.nx, -p.nz) }));
  }, [path]);
  return (
    <group>
      {towers.map((t, i) => (
        <group key={i} position={[t.x, 0, t.z]} rotation-y={t.yaw}>
          <mesh position={[0, 75, 0]}>
            <boxGeometry args={[2.5, 150, 2.5]} />
            <meshLambertMaterial color="#5d6168" />
          </mesh>
          <mesh position={[0, 152, 0]}>
            <boxGeometry args={[34, 12, 2]} />
            <meshBasicMaterial color="#fffbe8" />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** Center-field scoreboard; its face is a canvas the game view draws into. */
export const scoreboardCanvas: { canvas: HTMLCanvasElement | null; texture: THREE.CanvasTexture | null } = {
  canvas: null,
  texture: null,
};

function Scoreboard({ park }: { park: Park }) {
  const tex = useMemo(() => {
    if (typeof document === "undefined") return null;
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 192;
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    scoreboardCanvas.canvas = c;
    scoreboardCanvas.texture = t;
    return t;
  }, []);
  useEffect(() => () => {
    tex?.dispose();
    scoreboardCanvas.canvas = null;
    scoreboardCanvas.texture = null;
  }, [tex]);
  const f = park.fence(-8);
  const [dx, dz] = dirXZ(-8);
  const d = f + 130;
  return (
    <group position={[dx * d, 0, dz * d]} rotation-y={Math.atan2(-dx, -dz)}>
      <mesh position={[0, 60, 0]}>
        <boxGeometry args={[4, 120, 4]} />
        <meshLambertMaterial color="#333" />
      </mesh>
      <mesh position={[0, 100, 1.5]}>
        <boxGeometry args={[92, 36, 2]} />
        <meshLambertMaterial color="#111" />
      </mesh>
      <mesh position={[0, 100, 2.6]}>
        <planeGeometry args={[88, 33]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
    </group>
  );
}
