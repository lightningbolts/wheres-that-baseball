"use client";

import { useEffect, useLayoutEffect, useMemo } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import type { Park } from "@/lib/game/physics/park";
import { timeOfDay, type TimeOfDay } from "@/components/game/scene/parks/tod";
import { useQuality } from "@/components/game/scene/quality";

interface Preset {
  /** Direction toward the key light (sun, or the light ring at night). */
  key: [number, number, number];
  keyColor: string;
  keyPower: number;
  sky: string;
  ground: string;
  hemi: number;
  /** Shadowless fill from the opposite side, so faces turned from the key never go black. */
  fill: number;
  top: string;
  horizon: string;
  fog: [string, number, number];
  /** Sun or moon disc in the sky. */
  disc: [number, number, number];
  discColor: string;
  cloud: number;
  cloudColor: string;
  stars: number;
}

const PRESETS: Record<TimeOfDay, Preset> = {
  day: {
    key: [170, 320, -90],
    keyColor: "#fff4e0",
    keyPower: 2.1,
    sky: "#d6e6ff",
    ground: "#5d7350",
    hemi: 1.4,
    fill: 0.42,
    top: "#2f6fc4",
    horizon: "#cfe2f3",
    fog: ["#cfe2f3", 1500, 5400],
    disc: [170, 320, -90],
    discColor: "#fff3cf",
    cloud: 0.9,
    cloudColor: "#ffffff",
    stars: 0,
  },
  dusk: {
    key: [250, 175, -150],
    keyColor: "#ffc38c",
    keyPower: 1.4,
    sky: "#f0d3c6",
    ground: "#6e7462",
    hemi: 1.55,
    fill: 0.8,
    top: "#2c3f86",
    horizon: "#f2ae82",
    fog: ["#deb09a", 1300, 4800],
    disc: [250, 120, -150],
    discColor: "#ffd9a0",
    cloud: 1,
    cloudColor: "#ffc7a2",
    stars: 0.2,
  },
  night: {
    key: [60, 340, -200],
    keyColor: "#eef3ff",
    keyPower: 1.5,
    sky: "#c3d0ea",
    ground: "#5a6a58",
    hemi: 1.45,
    fill: 0.85,
    top: "#03050c",
    horizon: "#17233f",
    fog: ["#111a2d", 1000, 4000],
    disc: [-240, 300, 520],
    discColor: "#d4dcec",
    cloud: 0.55,
    cloudColor: "#27304b",
    stars: 1,
  },
};

const SKY_VERT = "varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }";
const SKY_FRAG = `
uniform vec3 top; uniform vec3 horizon; uniform vec3 discDir; uniform vec3 discCol; uniform vec3 cloudCol;
uniform float cloud; uniform float stars; uniform float uTime;
varying vec3 vP;
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
float fbm(vec2 p){ float a = 0.5; float s = 0.0; for (int i = 0; i < 4; i++) { s += a * vn(p); p = p * 2.03 + 7.1; a *= 0.5; } return s; }
void main(){
  vec3 d = normalize(vP);
  float h = clamp(d.y * 1.6, 0.0, 1.0);
  vec3 col = mix(horizon, top, pow(h, 0.7));
  float sd = max(dot(d, discDir), 0.0);
  col += discCol * (smoothstep(0.9994, 0.9997, sd) * 1.2 + pow(sd, 14.0) * 0.2);
  if (d.y > 0.01) {
    vec2 uv = d.xz / (d.y + 0.2) * 1.3 + vec2(uTime * 0.003, 0.0);
    // The noise is the expensive part of the sky (every sky pixel): skipped when clouds are off.
    float c = cloud > 0.0 ? smoothstep(0.5, 0.78, fbm(uv)) * cloud * smoothstep(0.01, 0.16, d.y) : 0.0;
    vec3 g = floor(d * 240.0);
    float star = step(0.9982, h21(g.xy + g.z * 17.3)) * smoothstep(0.04, 0.3, d.y);
    col += vec3(stars * star) * (1.0 - c);
    col = mix(col, cloudCol * (0.82 + 0.3 * pow(sd, 3.0)), c * 0.86);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

/** Sky, fog and lighting for the park's time of day. */
export function Environment({ park }: { park: Park }) {
  const tod = useMemo(() => timeOfDay(park.venueId), [park.venueId]);
  const p = PRESETS[tod];
  const { scene } = useThree();
  const { live } = useQuality();

  useEffect(() => {
    scene.fog = new THREE.Fog(p.fog[0], p.fog[1], p.fog[2]);
    return () => {
      scene.fog = null;
    };
  }, [scene, p]);

  const sky = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
        fog: false,
        uniforms: {
          top: { value: new THREE.Color(p.top) },
          horizon: { value: new THREE.Color(p.horizon) },
          discDir: { value: new THREE.Vector3(...p.disc).normalize() },
          discCol: { value: new THREE.Color(p.discColor) },
          cloudCol: { value: new THREE.Color(p.cloudColor) },
          cloud: { value: p.cloud },
          stars: { value: p.stars },
          uTime: { value: 0 },
        },
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
      }),
    [p],
  );
  useEffect(() => () => sky.dispose(), [sky]);
  useEffect(() => {
    sky.uniforms.cloud.value = live.clouds ? p.cloud : 0;
  }, [sky, live.clouds, p]);

  const light = useMemo(() => {
    const l = new THREE.DirectionalLight(p.keyColor, p.keyPower);
    const dir = new THREE.Vector3(...p.key).normalize();
    l.target.position.set(0, 0, 170);
    l.position.copy(l.target.position).addScaledVector(dir, 800);
    l.castShadow = true;
    const c = l.shadow.camera;
    c.left = -340;
    c.right = 340;
    c.top = 340;
    c.bottom = -340;
    c.near = 80;
    c.far = 1700;
    l.shadow.bias = -0.0004;
    // Softer, lighter shadows away from midday.
    l.shadow.radius = tod === "day" ? 1.5 : 3;
    l.shadow.intensity = tod === "day" ? 0.85 : 0.7;
    return l;
  }, [p, tod]);
  useEffect(() => () => light.dispose(), [light]);

  // Shadow map size follows the graphics tier (halved on small windows); a new size needs a new map.
  const small = typeof window !== "undefined" && window.innerWidth < 900;
  const mapSize = Math.min(live.shadowMap, small ? 2048 : 4096);

  // One shadow map for the whole park is ~2 in per texel: jagged player shadows. Instead
  // fit the shadow camera to the ground the view is looking at (tight at the plate,
  // wider as the camera follows the ball), snapped to texels so it never shimmers.
  const fit = useMemo(() => {
    const dir = new THREE.Vector3(...p.key).normalize();
    const right = new THREE.Vector3().crossVectors(dir, THREE.Object3D.DEFAULT_UP).normalize();
    const up = new THREE.Vector3().crossVectors(right, dir).normalize();
    return { fwd: new THREE.Vector3(), c: new THREE.Vector3(), half: 0, dir, right, up };
  }, [p]);
  // Before the next frame renders, so the first frame never builds a default-size map.
  useLayoutEffect(() => {
    if (light.shadow.mapSize.x === mapSize) return;
    light.shadow.mapSize.set(mapSize, mapSize);
    light.shadow.map?.dispose();
    light.shadow.map = null;
    // Refit (and re-derive the bias) for the new texel size on the next frame.
    fit.half = 0;
  }, [light, mapSize, fit]);
  useFrame((state) => {
    sky.uniforms.uTime.value = state.clock.elapsedTime;
    const cam = state.camera as THREE.PerspectiveCamera;
    cam.getWorldDirection(fit.fwd);
    // Where the view ray meets the field (or a point well out if it looks at the sky).
    const k = fit.fwd.y < -0.02 ? Math.min(420, -cam.position.y / fit.fwd.y) : 220;
    fit.c.copy(cam.position).addScaledVector(fit.fwd, k);
    fit.c.y = 0;
    const visible = 2 * k * Math.tan(((cam.fov ?? 45) * Math.PI) / 360) * Math.max(1, cam.aspect);
    const half = THREE.MathUtils.clamp(visible * 0.75, 45, 300);
    // Quantize the box size so the texel grid only changes on real view changes, with
    // hysteresis: grow as soon as the view needs more ground, but only shrink once it needs
    // clearly less. Without it a view sitting on a step boundary flips the box (and every
    // shadow's resolution and softness) back and forth from frame to frame: a strobe.
    const want = Math.pow(2, Math.ceil(Math.log2(half) * 4) / 4);
    const q = want > fit.half || want < fit.half / Math.pow(2, 0.5) || fit.half === 0 ? want : fit.half;
    const sc = light.shadow.camera;
    if (q !== fit.half) {
      fit.half = q;
      sc.left = -q;
      sc.right = q;
      sc.top = q;
      sc.bottom = -q;
      sc.updateProjectionMatrix();
    }
    const texel = (2 * q) / light.shadow.mapSize.x;
    // Normal offset in shadow texels, not feet: it was 0.6 ft at a 340 ft half-box on a 4096
    // map (3.6 texels), so a 2048 map (small windows, phones) got half the texels' worth and
    // surfaces facing the light shadowed themselves in stripes that crawled as the box moved.
    light.shadow.normalBias = 3.6 * texel;
    // Snap the center along the light's own axes.
    const u = Math.round(fit.c.dot(fit.right) / texel) * texel;
    const v = Math.round(fit.c.dot(fit.up) / texel) * texel;
    const w = fit.c.dot(fit.dir);
    light.target.position.copy(fit.right).multiplyScalar(u).addScaledVector(fit.up, v).addScaledVector(fit.dir, w);
    light.position.copy(light.target.position).addScaledVector(fit.dir, 800);
    light.target.updateMatrixWorld();
  });

  return (
    <>
      {/* Background: drawn first with no depth test, so its depth never meets the park's. */}
      <mesh material={sky} position={[0, 0, 150]} frustumCulled={false} renderOrder={-1000}>
        <sphereGeometry args={[5200, 32, 16]} />
      </mesh>
      <hemisphereLight args={[p.sky, p.ground, p.hemi]} />
      <directionalLight args={[p.keyColor, p.fill]} position={[-p.key[0], p.key[1] * 0.45, -p.key[2]]} />
      <primitive object={light} />
      <primitive object={light.target} />
    </>
  );
}
