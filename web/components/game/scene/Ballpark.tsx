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
  FAN_STYLE,
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
import { AWAY_FAN_SHARE } from "@/lib/game/crowd/reaction";
import { CLUBS } from "@/components/game/scene/character/uniforms";
import { dressFan, type FanColors } from "@/components/game/scene/parks/fans";
import { useQuality } from "@/components/game/scene/quality";
import { applySurface, useSurfaceSet } from "@/components/game/scene/parks/surfaces";
import { ModelPlacer } from "@/components/game/scene/parks/placements";
import { PlacedModels } from "@/components/game/scene/parks/PlacedModels";

/**
 * Shared excitement (0..1) the crowd reacts to; set by the game view. `excite` is the home
 * crowd, `away` the pocket of visiting fans (who only get up for their own team).
 */
export const crowdState = { excite: 0, away: 0 };

/** Most fans drawn at once (one instanced draw call of camera-facing sprites). */
const MAX_FANS = 44000;
/** Fan sprite size in feet (waist-up, seated). */
const FAN_W = 2.3;
const FAN_H = 3.05;

/**
 * Structure finish: `uv.x` of each triangle picks painted metal (0), jointed concrete (1),
 * foliage (2), an arcaded facade (3: arches at street level, window bays above, up to the
 * cornice height in `uv.y`), a glass curtain wall (4), seamed roof metal (5) or water (6).
 * World-space noise keeps big flat faces from reading as plain blocks.
 */
function applyStructureFinish(m: THREE.Material, detail: THREE.Texture, glass: THREE.Color): void {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uDetail = { value: detail };
    shader.uniforms.uGlass = { value: glass };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWp;\nvarying vec3 vWn;\nvarying vec2 vMat;")
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWn = normalize(mat3(modelMatrix) * normal);\nvMat = uv;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWp;\nvarying vec3 vWn;\nvarying vec2 vMat;\nuniform sampler2D uDetail;\nuniform vec3 uGlass;")
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        {
          vec3 an = abs(vWn);
          vec2 st = an.y > 0.6 ? vWp.xz : (an.x > an.z ? vWp.zy : vWp.xy);
          float n1 = texture2D(uDetail, st * 0.045).r;
          float n2 = texture2D(uDetail, st * 0.31).r;
          vec2 w = fwidth(st);
          float far = clamp(1.6 - max(w.x, w.y) * 1.4, 0.0, 1.0);
          float m = vMat.x;
          if (m > 5.5) {
            diffuseColor.rgb *= 0.9 + 0.2 * texture2D(uDetail, st * 0.012 + n1 * 0.05).r;
          } else if (m > 4.5) {
            float seam = 1.0 - smoothstep(0.1, 0.1 + w.x * 1.5, abs(fract(st.x / 6.0 + 0.5) - 0.5) * 6.0);
            diffuseColor.rgb *= (0.95 + 0.08 * n1) * (1.0 - 0.16 * seam * far);
          } else if (m > 3.5) {
            vec2 cell = vec2(9.0, 13.0);
            vec2 g = abs(fract(st / cell + 0.5) - 0.5) * cell;
            vec2 ln = 1.0 - smoothstep(vec2(0.28), vec2(0.28) + w * 1.4, g);
            float mull = max(ln.x, ln.y) * far;
            float up = clamp(vWp.y / 150.0, 0.0, 1.0);
            vec3 pane = mix(diffuseColor.rgb * 0.62, uGlass, 0.3 + 0.4 * up) * (0.86 + 0.2 * step(0.55, fract(floor(st.x / cell.x) * 0.37 + floor(st.y / cell.y) * 0.61)) * n1);
            diffuseColor.rgb = mix(pane, diffuseColor.rgb * 0.5, mull);
          } else if (m > 2.5) {
            float top = vMat.y;
            float y = vWp.y + 2.0;
            float bay = 24.0;
            float u = (fract(st.x / bay) - 0.5) * bay;
            vec3 base = diffuseColor.rgb * (0.9 + 0.14 * n1 + 0.08 * n2);
            vec3 hole = mix(diffuseColor.rgb * 0.16, uGlass * 0.3, 0.45);
            float aa = max(w.x, 0.04) * 1.3;
            // Street level: one tall arch per bay.
            float archTop = 15.0 + sqrt(max(0.0, 56.0 - u * u));
            float arch = (1.0 - smoothstep(7.4 - aa, 7.4 + aa, abs(u))) * (1.0 - smoothstep(archTop - aa, archTop + aa, y)) * step(0.5, y);
            // Above: paired windows on each floor, between belt courses.
            float fl = 15.0;
            float fy = y - 27.0;
            float fi = floor(fy / fl);
            float v = fract(fy / fl) * fl;
            float u2 = abs(abs(u) - 5.2);
            float win = (1.0 - smoothstep(2.5 - aa, 2.5 + aa, u2)) * smoothstep(3.0 - aa, 3.0 + aa, v) * (1.0 - smoothstep(11.6 - aa, 11.6 + aa, v));
            win *= step(0.0, fy) * step((fi + 1.0) * fl + 27.0, top - 5.0);
            float belt = (1.0 - smoothstep(0.5, 0.5 + aa, abs(y - 25.0))) + (1.0 - smoothstep(0.35, 0.35 + aa, abs(v - 0.2))) * step(0.0, fy) * step(y, top - 6.0);
            float pier = 1.0 - smoothstep(1.3 - aa, 1.3 + aa, abs(abs(u) - 12.0));
            vec3 col = base * (1.0 + 0.1 * pier * far);
            col = mix(col, base * 1.22, clamp(belt, 0.0, 1.0) * 0.5 * far);
            float open = max(arch, win * far);
            col = mix(col, hole, open);
            diffuseColor.rgb = col;
          } else if (m > 1.5) {
            diffuseColor.rgb *= 0.62 + 0.5 * n2 + 0.3 * n1;
          } else if (m > 0.5) {
            vec2 cell = an.y > 0.6 ? vec2(12.0, 12.0) : vec2(16.0, 7.0);
            vec2 d = abs(fract(st / cell + 0.5) - 0.5) * cell;
            vec2 ln = (1.0 - smoothstep(vec2(0.07), vec2(0.07) + w * 1.3, d)) * clamp(1.6 - w * 2.2, 0.0, 1.0);
            diffuseColor.rgb *= (0.88 + 0.16 * n1 + 0.08 * n2) * (1.0 - 0.16 * max(ln.x, ln.y));
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
export function Ballpark({ park, homeColor, awayColor, homeTeam, awayTeam }: { park: Park; homeColor: string; awayColor?: string; homeTeam?: number; awayTeam?: number }) {
  const tod = useMemo(() => timeOfDay(park.venueId), [park.venueId]);
  const lit = tod !== "day";
  // Boot setting: the 3D view is rebuilt when it changes, so it is fixed for this mount.
  const quality = useQuality();
  const mowSize = quality.boot.mow;
  const modelLodLevel = quality.boot.tier === "high" ? 0 : 1;

  const built = useMemo(() => {
    const layout = layoutFor(park.venueId);
    const loop = buildWallLoop(park);
    const st = new GeoBuilder(true);
    const glow = new GeoBuilder();
    const seats = new GeoBuilder(true);
    const led = new GeoBuilder(true);
    const city = new GeoBuilder(true);
    const veil = new GeoBuilder();
    const flares: number[] = [];
    const stands = buildStands(layout, loop, st, seats, {
      homeColor,
      led,
      glow,
      lit,
      skip: (beta, off) => Math.abs(beta) > DUGOUT.from - 1.5 && Math.abs(beta) < DUGOUT.to + 1.5 && off < DUGOUT.depth + 1,
    });
    const models = new ModelPlacer();
    const ctx: PropCtx = { park, layout, loop, st, glow, led, city, flares, reach: stands.reach, homeColor, lit, veil, models };
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
      placed: models.build(),
      slots: stands.slots,
      yaws: stands.yaws,
      meta: stands.meta,
      geo: {
        grass: fieldGrass(loop),
        marks: fieldMarks(park, loop, homeColor),
        wall: wallGeometry(loop, layout),
        structure: st.build(),
        seats: seats.build(),
        glow: glow.build(),
        led: led.build(),
        city: city.build(),
        veil: veil.build(),
        flares: flareGeo,
        net,
      },
    };
  }, [park, homeColor, lit]);
  useEffect(
    () => () => {
      Object.values(built.geo).forEach((g) => g.dispose());
      Object.values(built.placed).forEach((p) => {
        p.proxy?.dispose();
        p.proxyLed?.dispose();
      });
    },
    [built],
  );

  const mats = useMemo(() => {
    if (typeof document === "undefined") return null;
    const detail = detailTexture();
    const mow = mowTexture(built.layout.mow, park.turf, mowSize);
    const atlas = wallAtlas();
    const seatTex = seatTexture();
    const netTex = netTexture();
    const ledTex = ledAtlas(lit);
    const cityTex = cityTexture(lit);
    const flareTex = flareTexture();
    const blocksTex = blocksTexture(tod === "night");
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
    applyStructureFinish(structure, detail, new THREE.Color(tod === "night" ? "#2b3a5c" : tod === "dusk" ? "#d9a98f" : "#bcd6ea"));
    const flareUniforms = { map: { value: flareTex }, uScale: { value: 400 }, uPower: { value: tod === "night" ? 0.85 : 0.5 } };
    const flares = new THREE.ShaderMaterial({
      uniforms: flareUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader:
        "#include <common>\n#include <logdepthbuf_pars_vertex>\nattribute float size; uniform float uScale; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = clamp(size * uScale * projectionMatrix[1][1] / -mv.z, 2.0, 420.0);\n#include <logdepthbuf_vertex>\n}",
      // Depth in the same (logarithmic) space as the rest of the park, or the flares hide behind their own lamp racks.
      fragmentShader:
        "#include <logdepthbuf_pars_fragment>\nuniform sampler2D map; uniform float uPower; void main(){\n#include <logdepthbuf_fragment>\nvec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(t.rgb * t.a * uPower, 1.0); }",
    });
    // The city sinks into the horizon haze toward street level (scene fog adds distance haze).
    const city = new THREE.MeshBasicMaterial({ map: cityTex, vertexColors: true, color: tod === "night" ? "#b4bfdc" : tod === "dusk" ? "#b9a6a6" : "#ffffff" });
    const haze = new THREE.Color(tod === "night" ? "#18233c" : tod === "dusk" ? "#e2a988" : "#cfe2f3");
    city.onBeforeCompile = (sh) => {
      sh.uniforms.uHaze = { value: haze };
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying float vHazeY;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvHazeY = position.y;");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform vec3 uHaze; varying float vHazeY;")
        .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, uHaze, clamp(0.44 - vHazeY / 520.0, 0.04, 0.44));");
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
      // Translucent roof fabric (Tropicana Field): daylight glows through it.
      veil: new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.72, depthWrite: false, side: THREE.DoubleSide, emissive: new THREE.Color(tod === "night" ? "#3a3d44" : "#9a9c9e") }),
      decal: new THREE.MeshLambertMaterial({ map: decals.texture, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
      outside: tod === "night" ? new THREE.MeshBasicMaterial({ map: blocksTex, color: "#8791a8" }) : new THREE.MeshLambertMaterial({ map: blocksTex, color: tod === "dusk" ? "#a89a92" : "#c6cabf" }),
    };
    return { materials, textures, flareUniforms, decalGeo: decalGeometry(built.ctx, decals) };
  }, [built, park, lit, tod, mowSize]);
  useEffect(
    () => () => {
      if (!mats) return;
      Object.values(mats.materials).forEach((m) => m.dispose());
      mats.textures.forEach((t) => t.dispose());
      mats.decalGeo.dispose();
    },
    [mats],
  );
  // Blender-baked grass and clay detail (parks/surfaces.ts) once their sets load; until
  // then the procedural detail noise set up above stays.
  const turf = useSurfaceSet("turf");
  const dirt = useSurfaceSet("dirt");
  useEffect(() => {
    if (!mats) return;
    const detail = mats.textures[0];
    applySurface(mats.materials.grass, turf, { detail, detailScale: 0.33, albedo: 0.85, normal: 0.55, roughness: 0.6 });
    applySurface(mats.materials.marks, dirt, { detail, detailScale: 0.21, albedo: 0.9, normal: 0.8, roughness: 0.7, warmMask: true });
  }, [mats, turf, dirt]);
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
      <PlacedModels sets={built.placed} structure={m.structure} led={m.led} lit={lit} lod={modelLodLevel} />
      <mesh geometry={geo.seats} material={m.seats} />
      <mesh geometry={geo.glow} material={m.glow} />
      <mesh geometry={geo.led} material={m.led} />
      <mesh geometry={geo.city} material={m.city} />
      <Crowd seats={built.slots} yaws={built.yaws} meta={built.meta} accent={homeColor} awayAccent={awayColor} homeTeam={homeTeam} awayTeam={awayTeam} capacity={park.capacity} tod={tod} />
      <mesh geometry={geo.net} material={m.net} renderOrder={2} />
      {geo.veil.getAttribute("position").count > 0 && <mesh geometry={geo.veil} material={m.veil} renderOrder={1} />}
      {lit && <points geometry={geo.flares} material={m.flares} renderOrder={3} frustumCulled={false} />}
      <Scoreboard at={built.board} accent={homeColor} />
    </group>
  );
}

const CROWD_LIGHT: Record<TimeOfDay, number> = { day: 1, dusk: 0.92, night: 0.86 };
const CROWD_SUN: Record<TimeOfDay, [number, number, number]> = { day: [170, 320, -90], dusk: [250, 175, -150], night: [60, 340, -200] };
const SHIRTS = ["#f2f0ea", "#e9e4d6", "#20283a", "#8c9299", "#b32a33", "#1f4f9a", "#2f6a43", "#d9792b", "#c9b26b", "#23252a", "#7fb2d9", "#f2f0ea"];

/**
 * Instanced crowd: one draw call of camera-facing sprites cut from a painted atlas of fans.
 * Clothes in the atlas are grey and take a per-fan tint; team trim (lettering, logos, caps)
 * is painted in a magenta marker and takes a second tint; skin and hair keep their color.
 * Fans wear home merch, a block of visitors wear road merch, and the rest wear their own clothes.
 * `crowdState.excite` gets the home fans out of their seats, arms up, on big moments;
 * `crowdState.away` does the same for the blocks of visiting fans in road colours.
 */
function Crowd({ seats, yaws, meta, accent, awayAccent, homeTeam, awayTeam, capacity, tod }: { seats: Float32Array; yaws: Float32Array; meta: Float32Array; accent: string; awayAccent?: string; homeTeam?: number; awayTeam?: number; capacity: number; tod: TimeOfDay }) {
  const density = useQuality().live.crowd;
  const uniforms = useMemo(
    () => ({ uTime: { value: 0 }, uExcite: { value: 0 }, uAwayExcite: { value: 0 }, uLight: { value: CROWD_LIGHT[tod] }, uSun: { value: new THREE.Vector3(...CROWD_SUN[tod]).normalize() } }),
    [tod],
  );
  const atlas = useMemo(() => (typeof document === "undefined" ? null : crowdAtlas()), []);
  const material = useMemo(() => {
    const m = new THREE.MeshBasicMaterial({ map: atlas });
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = uniforms.uTime;
      shader.uniforms.uExcite = uniforms.uExcite;
      shader.uniforms.uAwayExcite = uniforms.uAwayExcite;
      shader.uniforms.uLight = uniforms.uLight;
      shader.uniforms.uSun = uniforms.uSun;
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nuniform float uTime;\nuniform float uExcite;\nuniform float uAwayExcite;\nuniform vec3 uSun;\nattribute vec3 aPos;\nattribute float aTeam;\nattribute vec3 aTint;\nattribute vec3 aTint2;\nattribute vec4 aInfo;\nattribute vec3 aMove;\nvarying vec3 vTint;\nvarying vec3 vTint2;\nvarying float vShade;\nvarying vec2 vCard;\nvarying vec3 vSun;",
        )
        .replace(
          "#include <project_vertex>",
          `vec3 rgt = normalize(vec3(viewMatrix[0][0], 0.0, viewMatrix[2][0]));
          // Lean the card back toward a high camera so fans never read as upright cut-outs.
          vec3 upv = normalize(mix(vec3(0.0, 1.0, 0.0), vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]), 0.6));
          vec3 fwd = normalize(cross(rgt, vec3(0.0, 1.0, 0.0)));
          float sd = aInfo.z;
          float walker = step(0.0001, aMove.z);
          float ex = mix(uExcite, uAwayExcite, aTeam);
          float cheer = step(1.0 - ex * 1.15, fract(sd * 7.31)) * (1.0 - walker);
          float stand = max(cheer, step(0.965, fract(sd * 11.13)));
          float bob = sin(uTime * 1.3 + sd * 40.0) * 0.04 + cheer * (max(0.0, sin(uTime * 9.0 + sd * 17.0)) * 0.7) + stand * 1.05 + walker * abs(sin(uTime * 5.0 + sd * 9.0)) * 0.12;
          float sway = sin(uTime * (0.45 + fract(sd * 3.1) * 0.5) + sd * 31.0) * 0.07 * position.y;
          vec3 base = aPos + vec3(aMove.x, 0.0, aMove.y) * sin(uTime * aMove.z + sd * 50.0);
          vec3 wp = base + rgt * (position.x * ${FAN_W.toFixed(2)} * aInfo.w + sway) + upv * (position.y * ${FAN_H.toFixed(2)} * aInfo.w) + vec3(0.0, bob, 0.0);
          vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          // Standing up he swaps to a cheering cell of the same outfit style (style = cell mod ${FAN_STYLE.count}).
          float cell = mix(aInfo.x, ${CROWD.seated.toFixed(1)} + mod(aInfo.x, ${FAN_STYLE.count.toFixed(1)}) + ${FAN_STYLE.count.toFixed(1)} * floor(fract(sd * 3.7) * ${((CROWD.cols * CROWD.rows - CROWD.seated) / FAN_STYLE.count).toFixed(1)}), cheer);
          vec2 cr = vec2(mod(cell, ${CROWD.cols.toFixed(1)}), floor(cell / ${CROWD.cols.toFixed(1)}));
          float fu = mix(uv.x, 1.0 - uv.x, step(0.5, fract(sd * 5.37)));
          vMapUv = vec2((cr.x + 0.025 + 0.95 * fu) / ${CROWD.cols.toFixed(1)}, 1.0 - (cr.y * ${CROWD.ch.toFixed(1)} + 2.5 + (1.0 - uv.y) * ${(CROWD.ch - 4).toFixed(1)}) / ${CROWD.size.toFixed(1)});
          vCard = uv;
          vSun = vec3(dot(uSun, rgt), uSun.y, dot(uSun, fwd));
          vTint = aTint;
          vTint2 = aTint2;
          vShade = aInfo.y;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform float uLight;\nvarying vec3 vTint;\nvarying vec3 vTint2;\nvarying float vShade;\nvarying vec2 vCard;\nvarying vec3 vSun;")
        .replace(
          "#include <map_fragment>",
          `vec4 tx = texture2D(map, vMapUv);
          float tpp = max(fwidth(vMapUv.x), fwidth(vMapUv.y)) * ${CROWD.size.toFixed(1)};
          if (tx.a < mix(0.5, 0.2, smoothstep(1.5, 6.0, tpp))) discard;
          float mx = max(tx.r, max(tx.g, tx.b));
          float mn = min(tx.r, min(tx.g, tx.b));
          float cloth = 1.0 - smoothstep(0.07, 0.22, (mx - mn) / max(mx, 0.02));
          // Round the card: a cylinder normal across it, lit by the sun, with the lap in shade.
          float nx = (vCard.x - 0.5) * 1.9;
          float nz = sqrt(max(0.08, 1.0 - nx * nx));
          float lit = clamp(0.66 + 0.4 * (nx * vSun.x + nz * vSun.z * 0.55) + 0.22 * vSun.y * smoothstep(0.5, 0.95, vCard.y), 0.5, 1.22);
          lit *= mix(0.7, 1.0, smoothstep(0.02, 0.4, vCard.y));
          // Magenta marker texels are team trim: shade the fan's second colour by the marker's lightness.
          float mk = clamp((min(tx.r, tx.b) - tx.g) / max(max(tx.r, tx.b), 0.02), 0.0, 1.0) * (1.0 - smoothstep(0.06, 0.2, abs(tx.r - tx.b)));
          float trim = smoothstep(0.45, 0.85, mk);
          vec3 cl = mix(tx.rgb, tx.rgb * vTint, cloth);
          cl = mix(cl, vTint2 * max(tx.r, tx.b) * 1.28, trim);
          diffuseColor.rgb = cl * vShade * uLight * lit;`,
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
    for (let i = 0; i < total; i += 1) expect += meta[i * 2 + 1] >= 100 ? 1 : chance(meta[i * 2 + 1]);
    const thin = Math.min(1, MAX_FANS / Math.max(1, expect));
    const pos: number[] = [];
    const tint: number[] = [];
    const tint2: number[] = [];
    const info: number[] = [];
    const move: number[] = [];
    const team: number[] = [];
    // Each side's merch: its real uniform colours, or its scoreboard colour when the club has no kit.
    const kit = (id: number | undefined, color: string | undefined): FanColors | null => {
      if (!color && id == null) return null;
      const u = id != null ? CLUBS[id] : undefined;
      const c0 = color ? new THREE.Color(color).getHex() : 0x1f2a44;
      return u ? { home: u.home, road: u.road, cap: u.cap, letter: u.letter } : { home: 0xf4f2ec, road: 0x9a9ea4, cap: c0, letter: c0 };
    };
    const homeKit = kit(homeTeam, accent)!;
    const roadKit = awayAccent ? kit(awayTeam, awayAccent) : null;
    const palette = SHIRTS.map((x) => new THREE.Color(x).getHex());
    const c = new THREE.Color();
    let s = 12345;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    // Seats sell in blocks: whole groups of neighbours turn up, or don't.
    const block = (i: number) => {
      const h = Math.sin(Math.floor(i / 17) * 127.1) * 43758.5453;
      return 0.72 + 0.5 * (h - Math.floor(h));
    };
    const awayBlock = (i: number) => {
      const h = Math.sin(Math.floor(i / 23) * 311.7 + 17.3) * 24634.6345;
      return h - Math.floor(h) < AWAY_FAN_SHARE;
    };
    for (let i = 0; i < total && pos.length < MAX_FANS * 3; i += 1) {
      const r = rnd();
      const k = [rnd(), rnd(), rnd(), rnd(), rnd()];
      const rank = meta[i * 2 + 1];
      const walker = rank >= 100;
      if (!walker && r > Math.min(0.985, chance(rank) * block(i)) * thin) continue;
      pos.push(seats[i * 3] + (k[0] - 0.5) * 0.35, seats[i * 3 + 1] + (walker ? 2.9 : 1.25) + (k[1] - 0.5) * 0.2, seats[i * 3 + 2] + (k[0] - 0.5) * 0.35);
      // Visiting fans sit together in a few blocks (about one seat in eight), in road colours.
      const awayFan = !!roadKit && !walker && awayBlock(i);
      team.push(awayFan ? 1 : 0);
      // Most of the building wears home merch, the visiting blocks road merch; the rest their own clothes.
      const fit = dressFan(awayFan ? roadKit! : homeKit, palette, awayFan ? 0.82 : 0.66, k[2], k[3], k[4], k[0]);
      c.setHex(fit.body).multiplyScalar(0.86 + k[3] * 0.24);
      tint.push(c.r, c.g, c.b);
      c.setHex(fit.trim).multiplyScalar(0.9 + k[4] * 0.15);
      tint2.push(c.r, c.g, c.b);
      // A few children, the odd tall fan.
      const size = k[1] < 0.07 ? 0.74 + k[3] * 0.08 : 0.92 + k[3] * 0.17;
      info.push(fit.style + FAN_STYLE.count * (Math.floor(k[1] * 997) % (CROWD.seated / FAN_STYLE.count)), meta[i * 2] * (0.9 + k[1] * 0.2), k[2] * 0.731 + k[0], size);
      if (walker) {
        const yaw = yaws[i];
        const amp = 6 + k[3] * 16;
        move.push(Math.cos(yaw) * amp, -Math.sin(yaw) * amp, 0.12 + k[4] * 0.16);
      } else move.push(0, 0, 0);
    }
    // Shuffle the fans (seeded), so any leading run of them is an even sample of the whole
    // crowd: lower graphics tiers draw fewer simply by drawing fewer instances.
    const n = pos.length / 3;
    const order = new Uint32Array(n);
    for (let i = 0; i < n; i += 1) order[i] = i;
    for (let i = n - 1; i > 0; i -= 1) {
      const j = Math.floor(rnd() * (i + 1));
      const t = order[i];
      order[i] = order[j];
      order[j] = t;
    }
    const shuffled = (src: number[], w: number) => {
      const out = new Float32Array(n * w);
      for (let i = 0; i < n; i += 1) for (let k = 0; k < w; k += 1) out[i * w + k] = src[order[i] * w + k];
      return out;
    };
    const plane = new THREE.PlaneGeometry(1, 1);
    plane.translate(0, 0.5, 0);
    const g = new THREE.InstancedBufferGeometry();
    g.setIndex(plane.getIndex());
    g.setAttribute("position", plane.getAttribute("position"));
    g.setAttribute("uv", plane.getAttribute("uv"));
    g.setAttribute("aPos", new THREE.InstancedBufferAttribute(shuffled(pos, 3), 3));
    g.setAttribute("aTint", new THREE.InstancedBufferAttribute(shuffled(tint, 3), 3));
    g.setAttribute("aTint2", new THREE.InstancedBufferAttribute(shuffled(tint2, 3), 3));
    g.setAttribute("aInfo", new THREE.InstancedBufferAttribute(shuffled(info, 4), 4));
    g.setAttribute("aMove", new THREE.InstancedBufferAttribute(shuffled(move, 3), 3));
    g.setAttribute("aTeam", new THREE.InstancedBufferAttribute(shuffled(team, 1), 1));
    g.instanceCount = n;
    return { g, n };
  }, [seats, yaws, meta, accent, awayAccent, homeTeam, awayTeam, capacity]);
  useEffect(() => () => geom.g.dispose(), [geom]);
  useEffect(() => {
    geom.g.instanceCount = Math.round(geom.n * density);
  }, [geom, density]);
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => () => atlas?.dispose(), [atlas]);

  useFrame((state, dt) => {
    uniforms.uTime.value = state.clock.elapsedTime;
    const target = crowdState.excite;
    uniforms.uExcite.value += (target - uniforms.uExcite.value) * Math.min(1, dt * 3);
    crowdState.excite = Math.max(0, crowdState.excite - dt * 0.12);
    uniforms.uAwayExcite.value += (crowdState.away - uniforms.uAwayExcite.value) * Math.min(1, dt * 3);
    crowdState.away = Math.max(0, crowdState.away - dt * 0.12);
  });

  if (!atlas) return null;
  return <mesh geometry={geom.g} material={material} frustumCulled={false} />;
}

/** Scoreboard face: a canvas the game controller draws into. */
export const scoreboardCanvas: { canvas: HTMLCanvasElement | null; texture: THREE.CanvasTexture | null } = {
  canvas: null,
  texture: null,
};

/** Idle board graphics, shown until the game draws its own (and in the park lab). */
function drawIdleBoard(c: HTMLCanvasElement, accent: string): void {
  const g = c.getContext("2d");
  if (!g) return;
  const { width: w, height: h } = c;
  const bg = g.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "#0b1220");
  bg.addColorStop(1, "#05080f");
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.fillStyle = accent;
  g.fillRect(0, 0, w, 30);
  g.fillStyle = "#f5f3ea";
  g.font = "700 20px system-ui, sans-serif";
  g.textBaseline = "middle";
  g.fillText("WELCOME TO THE BALLPARK", 14, 16);
  g.font = "600 13px system-ui, sans-serif";
  g.fillStyle = "#9fb0c8";
  const x0 = 120;
  const dx = 30;
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "R", "H", "E"].forEach((t, i) => g.fillText(t, x0 + i * dx + (i > 8 ? 14 : 0), 48));
  [["VISITORS", "#c9d3e4"], ["HOME", "#ffffff"]].forEach(([name, col], r) => {
    const y = 78 + r * 34;
    g.fillStyle = r ? accent : "#1a2334";
    g.fillRect(8, y - 14, 100, 28);
    g.fillStyle = col;
    g.font = "700 15px system-ui, sans-serif";
    g.fillText(name, 14, y + 1);
    g.font = "700 19px system-ui, sans-serif";
    g.fillStyle = "#f6d24a";
    for (let i = 0; i < 12; i += 1) g.fillText(i < 9 ? "" : "0", x0 + i * dx + (i > 8 ? 14 : 0), y + 1);
  });
  g.fillStyle = "#121a29";
  g.fillRect(0, 150, w, 42);
  g.font = "700 16px system-ui, sans-serif";
  ["BALL", "STRIKE", "OUT"].forEach((t, i) => {
    g.fillStyle = "#9fb0c8";
    g.fillText(t, 16 + i * 150, 172);
    for (let k = 0; k < (i === 0 ? 3 : 2); k += 1) {
      g.beginPath();
      g.arc(86 + i * 150 + k * 18 + (i === 1 ? 10 : 0), 171, 6, 0, Math.PI * 2);
      g.fillStyle = "#26324a";
      g.fill();
    }
  });
  g.fillStyle = "#f5f3ea";
  g.fillText("PLAY BALL", w - 110, 172);
}

function Scoreboard({ at, accent }: { at: BoardPlacement; accent: string }) {
  const tex = useMemo(() => {
    if (typeof document === "undefined") return null;
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 192;
    drawIdleBoard(c, accent);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }, [accent]);
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
