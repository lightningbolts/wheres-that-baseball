"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { Park } from "@/lib/game/physics/park";
import { layoutFor } from "@/lib/game/data/parkLayouts";
import { buildWallLoop, fieldGrass, fieldMarks, GROUND_Y, wallCaps, wallGeometry } from "@/components/game/scene/fieldGeometry";
import { GeoBuilder } from "@/components/game/scene/parks/geo";
import { buildStands } from "@/components/game/scene/parks/stands";
import {
  backstop,
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
import {
  applyWorldDetail,
  cityTexture,
  blocksTexture,
  BLOCKS_FT,
  CROWD,
  crowdAtlas,
  decalAtlas,
  detailTexture,
  flareTexture,
  ledAtlas,
  mowTexture,
  netTexture,
  seatTexture,
  wallAtlas,
} from "@/components/game/scene/parks/textures";
import { timeOfDay, type TimeOfDay } from "@/components/game/scene/parks/tod";

/** Shared excitement level (0..1) the crowd reacts to; set by the game view. */
export const crowdState = { excite: 0 };

/** Most fans drawn at once (one instanced draw call of camera-facing sprites). */
const MAX_FANS = 52000;
/** Fan sprite size in feet (waist-up, seated). */
const FAN_W = 2.3;
const FAN_H = 3.05;

/**
 * Structure finish: `uv.x` of each triangle picks painted metal (0), jointed concrete (1)
 * or foliage (2); world-space noise keeps big flat faces from reading as plain blocks.
 */
function applyStructureFinish(m: THREE.Material, detail: THREE.Texture): void {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uDetail = { value: detail };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWp;\nvarying vec3 vWn;\nvarying float vMat;")
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWn = normalize(mat3(modelMatrix) * normal);\nvMat = uv.x;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWp;\nvarying vec3 vWn;\nvarying float vMat;\nuniform sampler2D uDetail;")
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        {
          vec3 an = abs(vWn);
          vec2 st = an.y > 0.6 ? vWp.xz : (an.x > an.z ? vWp.zy : vWp.xy);
          float n1 = texture2D(uDetail, st * 0.045).r;
          float n2 = texture2D(uDetail, st * 0.31).r;
          if (vMat > 1.5) {
            diffuseColor.rgb *= 0.62 + 0.5 * n2 + 0.3 * n1;
          } else if (vMat > 0.5) {
            vec2 cell = an.y > 0.6 ? vec2(12.0, 12.0) : vec2(16.0, 7.0);
            vec2 d = abs(fract(st / cell + 0.5) - 0.5) * cell;
            vec2 w = fwidth(st);
            vec2 ln = (1.0 - smoothstep(vec2(0.07), vec2(0.07) + w * 1.3, d)) * clamp(1.6 - w * 2.2, 0.0, 1.0);
            diffuseColor.rgb *= (0.84 + 0.22 * n1 + 0.1 * n2) * (1.0 - 0.3 * max(ln.x, ln.y));
          } else {
            diffuseColor.rgb *= 0.93 + 0.14 * n1;
          }
        }`,
      );
  };
}

/**
 * The whole ballpark for one venue: real wall outline, park-specific stands, landmarks and
 * backdrop. Static geometry is merged into a handful of meshes (field, markings, wall,
 * structure, seating, signage, lights, city, net, decals) and the crowd is one instanced
 * draw, so a park costs about fifteen draw calls.
 */
export function Ballpark({ park, homeColor }: { park: Park; homeColor: string }) {
  const tod = useMemo(() => timeOfDay(park.venueId), [park.venueId]);
  const lit = tod !== "day";

  const built = useMemo(() => {
    const layout = layoutFor(park.venueId);
    const loop = buildWallLoop(park);
    const st = new GeoBuilder(true);
    const glow = new GeoBuilder();
    const seats = new GeoBuilder(true);
    const led = new GeoBuilder(true);
    const city = new GeoBuilder(true);
    const flares: number[] = [];
    const stands = buildStands(layout, loop, st, seats, {
      homeColor,
      led,
      glow,
      lit,
      skip: (beta, off) => Math.abs(beta) > DUGOUT.from - 1.5 && Math.abs(beta) < DUGOUT.to + 1.5 && off < DUGOUT.depth + 1,
    });
    const ctx: PropCtx = { park, layout, loop, st, glow, led, city, flares, reach: stands.reach, homeColor, lit };
    wallCaps(loop, st, layout.trim);
    foulPoles(ctx);
    dugouts(ctx);
    backstop(ctx);
    battersEye(ctx);
    bullpens(ctx);
    lightBanks(ctx);
    const board = scoreboard(ctx);
    roof(ctx);
    features(ctx);
    const net = netGeometry(ctx);
    const flareGeo = new THREE.BufferGeometry();
    flareGeo.setAttribute("position", new THREE.Float32BufferAttribute(flares.filter((_, i) => i % 4 !== 3), 3));
    flareGeo.setAttribute("size", new THREE.Float32BufferAttribute(flares.filter((_, i) => i % 4 === 3), 1));
    return {
      ctx,
      layout,
      board,
      slots: stands.slots,
      meta: stands.meta,
      geo: {
        grass: fieldGrass(loop),
        marks: fieldMarks(park, loop),
        wall: wallGeometry(loop, layout),
        structure: st.build(),
        seats: seats.build(),
        glow: glow.build(),
        led: led.build(),
        city: city.build(),
        flares: flareGeo,
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
    const ledTex = ledAtlas(lit);
    const cityTex = cityTexture(lit);
    const flareTex = flareTexture();
    const blocksTex = blocksTexture();
    blocksTex.repeat.set(12000 / BLOCKS_FT, 12000 / BLOCKS_FT);
    const decals = decalAtlas(
      park.fenceMarkers.map((m) => m.ft),
      built.layout.skins.some((s) => s[1] === "monster") || built.layout.wall === "#1c2f55" ? "#f4f1e6" : "#f1d44a",
    );
    const grass = new THREE.MeshStandardMaterial({ map: mow, roughness: 0.95 });
    applyWorldDetail(grass, detail, 0.33);
    const marks = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    applyWorldDetail(marks, detail, 0.21);
    const structure = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    applyStructureFinish(structure, detail);
    const flareUniforms = { map: { value: flareTex }, uScale: { value: 400 }, uPower: { value: tod === "night" ? 0.85 : 0.5 } };
    const flares = new THREE.ShaderMaterial({
      uniforms: flareUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader:
        "attribute float size; uniform float uScale; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = clamp(size * uScale * projectionMatrix[1][1] / -mv.z, 2.0, 420.0); }",
      fragmentShader: "uniform sampler2D map; uniform float uPower; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(t.rgb * t.a * uPower, 1.0); }",
    });
    // The city sinks into the horizon haze toward street level: a silhouette, not a wall.
    const city = new THREE.MeshBasicMaterial({ map: cityTex, vertexColors: true, color: tod === "night" ? "#b4bfdc" : tod === "dusk" ? "#b9a6a6" : "#ffffff" });
    const haze = new THREE.Color(tod === "night" ? "#18233c" : tod === "dusk" ? "#e2a988" : "#cfe2f3");
    city.onBeforeCompile = (sh) => {
      sh.uniforms.uHaze = { value: haze };
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying float vHazeY;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvHazeY = position.y;");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform vec3 uHaze; varying float vHazeY;")
        .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, uHaze, clamp(0.78 - vHazeY / 260.0, 0.22, 0.78));");
    };
    const textures = [detail, mow, atlas, seatTex, netTex, ledTex, cityTex, flareTex, blocksTex, decals.texture];
    const materials = {
      grass,
      marks,
      wall: new THREE.MeshStandardMaterial({ map: atlas, vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }),
      structure,
      seats: new THREE.MeshLambertMaterial({ map: seatTex, vertexColors: true, side: THREE.DoubleSide }),
      glow: new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, toneMapped: false }),
      led: new THREE.MeshBasicMaterial({ map: ledTex, vertexColors: true, side: THREE.DoubleSide, toneMapped: false, color: lit ? "#ffffff" : "#c9c9c9" }),
      city,
      flares,
      net: new THREE.MeshBasicMaterial({ map: netTex, transparent: true, opacity: 0.34, depthWrite: false, side: THREE.DoubleSide }),
      decal: new THREE.MeshLambertMaterial({ map: decals.texture, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
      outside: new THREE.MeshLambertMaterial({ map: blocksTex, color: tod === "night" ? "#3a4252" : tod === "dusk" ? "#a08f88" : "#c6cabf" }),
    };
    return { materials, textures, flareUniforms, decalGeo: decalGeometry(built.ctx, decals) };
  }, [built, park, lit, tod]);
  useEffect(
    () => () => {
      if (!mats) return;
      Object.values(mats.materials).forEach((m) => m.dispose());
      mats.textures.forEach((t) => t.dispose());
      mats.decalGeo.dispose();
    },
    [mats],
  );
  useFrame((state) => {
    if (mats) mats.flareUniforms.uScale.value = state.gl.domElement.height * 0.5;
  });

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
      <mesh geometry={geo.led} material={m.led} />
      <mesh geometry={geo.city} material={m.city} />
      <Crowd seats={built.slots} meta={built.meta} accent={homeColor} capacity={park.capacity} tod={tod} />
      <mesh geometry={geo.net} material={m.net} renderOrder={2} />
      {lit && <points geometry={geo.flares} material={m.flares} renderOrder={3} frustumCulled={false} />}
      <Scoreboard at={built.board} />
    </group>
  );
}

const CROWD_LIGHT: Record<TimeOfDay, number> = { day: 1, dusk: 0.92, night: 0.86 };
const SHIRTS = ["#f2f0ea", "#e9e4d6", "#20283a", "#8c9299", "#b32a33", "#1f4f9a", "#2f6a43", "#d9792b", "#c9b26b", "#23252a", "#7fb2d9", "#f2f0ea"];

/**
 * Instanced crowd: one draw call of camera-facing sprites cut from a painted atlas of fans.
 * Clothes in the atlas are grey and take a per-fan tint; skin and hair keep their color.
 * `crowdState.excite` gets fans out of their seats, arms up, on big moments.
 */
function Crowd({ seats, meta, accent, capacity, tod }: { seats: Float32Array; meta: Float32Array; accent: string; capacity: number; tod: TimeOfDay }) {
  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uExcite: { value: 0 }, uLight: { value: 1 } }), []);
  const atlas = useMemo(() => (typeof document === "undefined" ? null : crowdAtlas()), []);
  const material = useMemo(() => {
    const m = new THREE.MeshBasicMaterial({ map: atlas });
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = uniforms.uTime;
      shader.uniforms.uExcite = uniforms.uExcite;
      shader.uniforms.uLight = uniforms.uLight;
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nuniform float uTime;\nuniform float uExcite;\nattribute vec3 aPos;\nattribute vec3 aTint;\nattribute vec4 aInfo;\nvarying vec3 vTint;\nvarying float vShade;",
        )
        .replace(
          "#include <project_vertex>",
          `vec3 rgt = normalize(vec3(viewMatrix[0][0], 0.0, viewMatrix[2][0]));
          float sd = aInfo.z;
          float cheer = step(1.0 - uExcite * 1.15, fract(sd * 7.31));
          float bob = sin(uTime * 1.3 + sd * 40.0) * 0.04 + cheer * (0.9 + max(0.0, sin(uTime * 9.0 + sd * 17.0)) * 0.7);
          vec3 wp = aPos + rgt * (position.x * ${FAN_W.toFixed(2)} * aInfo.w) + vec3(0.0, position.y * ${FAN_H.toFixed(2)} * aInfo.w + bob, 0.0);
          vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          float cell = mix(aInfo.x, ${CROWD.seated.toFixed(1)} + floor(fract(sd * 3.7) * ${(CROWD.cols * CROWD.rows - CROWD.seated).toFixed(1)}), cheer);
          vec2 cr = vec2(mod(cell, ${CROWD.cols.toFixed(1)}), floor(cell / ${CROWD.cols.toFixed(1)}));
          vMapUv = vec2((cr.x + 0.025 + 0.95 * uv.x) / ${CROWD.cols.toFixed(1)}, 1.0 - (cr.y * ${CROWD.ch.toFixed(1)} + 2.5 + (1.0 - uv.y) * ${(CROWD.ch - 4).toFixed(1)}) / ${CROWD.size.toFixed(1)});
          vTint = aTint;
          vShade = aInfo.y;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform float uLight;\nvarying vec3 vTint;\nvarying float vShade;")
        .replace(
          "#include <map_fragment>",
          `vec4 tx = texture2D(map, vMapUv);
          float tpp = max(fwidth(vMapUv.x), fwidth(vMapUv.y)) * ${CROWD.size.toFixed(1)};
          if (tx.a < mix(0.5, 0.2, smoothstep(1.5, 6.0, tpp))) discard;
          float mx = max(tx.r, max(tx.g, tx.b));
          float mn = min(tx.r, min(tx.g, tx.b));
          float cloth = 1.0 - smoothstep(0.07, 0.22, (mx - mn) / max(mx, 0.02));
          diffuseColor.rgb = mix(tx.rgb, tx.rgb * vTint, cloth) * vShade * uLight;`,
        );
    };
    return m;
  }, [uniforms, atlas]);

  const geom = useMemo(() => {
    const total = seats.length / 3;
    // Attendance follows the park's capacity, the best seats fill first, and big bowls are
    // thinned to the instance budget.
    const fill = Math.min(0.95, Math.max(0.66, 0.68 + capacity / 150000));
    const chance = (rank: number) => Math.min(0.97, fill * (1.14 - 0.1 * rank));
    let expect = 0;
    for (let i = 0; i < total; i += 1) expect += chance(meta[i * 2 + 1]);
    const thin = Math.min(1, MAX_FANS / Math.max(1, expect));
    const pos: number[] = [];
    const tint: number[] = [];
    const info: number[] = [];
    const c = new THREE.Color();
    const acc = new THREE.Color(accent).lerp(new THREE.Color("#ffffff"), 0.12);
    const palette = SHIRTS.map((x) => new THREE.Color(x));
    let s = 12345;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < total && pos.length < MAX_FANS * 3; i += 1) {
      const r = rnd();
      const k = [rnd(), rnd(), rnd(), rnd(), rnd()];
      if (r > chance(meta[i * 2 + 1]) * thin) continue;
      pos.push(seats[i * 3] + (k[0] - 0.5) * 0.35, seats[i * 3 + 1] + 1.25 + (k[1] - 0.5) * 0.2, seats[i * 3 + 2] + (k[0] - 0.5) * 0.35);
      // A third of the crowd wears the home team's color.
      if (k[2] < 0.34) c.copy(acc).multiplyScalar(0.8 + k[3] * 0.4);
      else c.copy(palette[Math.floor(k[3] * palette.length) % palette.length]).multiplyScalar(0.82 + k[4] * 0.3);
      tint.push(c.r, c.g, c.b);
      info.push(Math.floor(k[4] * CROWD.seated) % CROWD.seated, meta[i * 2] * (0.9 + k[1] * 0.2), k[2] * 0.731 + k[0], 0.93 + k[3] * 0.14);
    }
    const plane = new THREE.PlaneGeometry(1, 1);
    plane.translate(0, 0.5, 0);
    const g = new THREE.InstancedBufferGeometry();
    g.setIndex(plane.getIndex());
    g.setAttribute("position", plane.getAttribute("position"));
    g.setAttribute("uv", plane.getAttribute("uv"));
    g.setAttribute("aPos", new THREE.InstancedBufferAttribute(new Float32Array(pos), 3));
    g.setAttribute("aTint", new THREE.InstancedBufferAttribute(new Float32Array(tint), 3));
    g.setAttribute("aInfo", new THREE.InstancedBufferAttribute(new Float32Array(info), 4));
    g.instanceCount = pos.length / 3;
    return g;
  }, [seats, meta, accent, capacity]);
  useEffect(() => () => geom.dispose(), [geom]);
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => () => atlas?.dispose(), [atlas]);

  useFrame((state, dt) => {
    uniforms.uTime.value = state.clock.elapsedTime;
    uniforms.uLight.value = CROWD_LIGHT[tod];
    const target = crowdState.excite;
    uniforms.uExcite.value += (target - uniforms.uExcite.value) * Math.min(1, dt * 3);
    crowdState.excite = Math.max(0, crowdState.excite - dt * 0.12);
  });

  if (!atlas) return null;
  return <mesh geometry={geom} material={material} frustumCulled={false} />;
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
