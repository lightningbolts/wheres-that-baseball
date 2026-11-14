"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { PLATE_FRONT_Z } from "@/lib/game/physics/pitch";
import type { Playback } from "@/components/game/scene/playback";

/** Advances playback time and fires cues. Mount first so it runs before readers. */
export function Director({ pb }: { pb: Playback }) {
  useFrame((_, rawDt) => {
    const tl = pb.timeline;
    if (!tl || pb.paused) return;
    const dt = Math.min(rawDt, 0.1);
    let rate = pb.rate;
    if (pb.slow && pb.T >= pb.slow.from && pb.T < pb.slow.to) rate = pb.slow.rate;
    if (pb.turbo) rate *= 4;
    pb.T += dt * rate;
    for (const c of pb.cues) {
      if (!c.done && pb.T >= c.T) {
        c.done = true;
        c.fn();
        if (pb.paused) return;
      }
    }
    if (pb.T >= tl.endT && pb.onEnd) {
      const end = pb.onEnd;
      pb.onEnd = null;
      end();
    }
  });
  return null;
}

const BALL_R = 0.121;

export function Ball({ pb }: { pb: Playback }) {
  const ball = useRef<THREE.Mesh>(null);
  const shadow = useRef<THREE.Mesh>(null);
  const trail = useRef<THREE.InstancedMesh>(null);
  const hist = useRef<THREE.Vector3[]>([]);
  const { camera } = useThree();
  const tmpM = useMemo(() => new THREE.Matrix4(), []);
  const tmpV = useMemo(() => new THREE.Vector3(), []);
  const TRAIL = 14;

  useFrame(() => {
    const b = ball.current;
    const sh = shadow.current;
    const tr = trail.current;
    if (!b || !sh || !tr) return;
    const st = pb.timeline?.ball(pb.T);
    const visible = !!st?.visible;
    b.visible = visible;
    sh.visible = visible && st!.p.y > 0.3;
    if (!st || !visible) {
      tr.count = 0;
      hist.current = [];
      return;
    }
    b.position.set(st.p.x, Math.max(BALL_R, st.p.y), st.p.z);
    const cam = camera as THREE.PerspectiveCamera;
    const d = cam.position.distanceTo(b.position);
    // Keep the ball at least ~3 px tall regardless of camera.
    const minR = (3 * d * Math.tan(((cam.fov ?? 45) * Math.PI) / 360)) / 420;
    const s = Math.max(1, minR / BALL_R);
    b.scale.setScalar(s);
    sh.position.set(st.p.x, 0.07, st.p.z);
    const hs = Math.max(0.6, s * 0.9) * (1 + Math.min(1, st.p.y / 60));
    sh.scale.set(hs, hs, hs);
    (sh.material as THREE.MeshBasicMaterial).opacity = 0.4 * Math.max(0.15, 1 - st.p.y / 120);
    // Trail of recent positions while the ball is loose and moving.
    const h = hist.current;
    if (!st.held) {
      const last = h[h.length - 1];
      if (!last || last.distanceTo(b.position) > 0.4) h.push(b.position.clone());
      if (h.length > TRAIL) h.shift();
    } else h.length = 0;
    tr.count = h.length;
    for (let i = 0; i < h.length; i += 1) {
      const f = (i + 1) / (h.length + 1);
      tmpV.setScalar(s * 0.85 * f);
      tmpM.compose(h[i], new THREE.Quaternion(), tmpV);
      tr.setMatrixAt(i, tmpM);
    }
    tr.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      <mesh ref={ball} castShadow={false}>
        <sphereGeometry args={[BALL_R, 16, 12]} />
        <meshStandardMaterial color="#fbfaf4" emissive="#4a4a44" roughness={0.5} />
      </mesh>
      <mesh ref={shadow} rotation-x={-Math.PI / 2}>
        <circleGeometry args={[BALL_R * 1.4, 16]} />
        <meshBasicMaterial color="#000" transparent opacity={0.35} depthWrite={false} />
      </mesh>
      <instancedMesh ref={trail} args={[undefined, undefined, TRAIL]} frustumCulled={false}>
        <sphereGeometry args={[BALL_R, 8, 6]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.28} depthWrite={false} />
      </instancedMesh>
    </group>
  );
}

interface CamSpec {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
}

/** Smoothly damped camera between presets; "follow" tracks the play's focus point. */
export function CameraRig({ pb }: { pb: Playback }) {
  const { camera, size } = useThree();
  const look = useRef(new THREE.Vector3(0, 3, 30));
  const focusS = useRef(new THREE.Vector3(0, 3, 30));
  const lastMode = useRef(pb.cam);
  const narrow = size.width < size.height;

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const cam = camera as THREE.PerspectiveCamera;
    let spec: CamSpec;
    const aspectFov = (f: number) => (narrow ? f * 1.45 : f);
    switch (pb.cam) {
      case "batter":
        spec = { pos: new THREE.Vector3(0, 5.3, -13.5), look: new THREE.Vector3(0, 3.0, 30), fov: aspectFov(38) };
        break;
      case "pitcher":
        spec = { pos: new THREE.Vector3(0, 9.6, 80), look: new THREE.Vector3(0, 2.6, 0), fov: aspectFov(19) };
        break;
      case "overview":
        spec = { pos: new THREE.Vector3(-40, 230, -170), look: new THREE.Vector3(0, 0, 170), fov: aspectFov(50) };
        break;
      case "follow": {
        const f = pb.timeline?.focus(pb.T);
        if (f) focusS.current.lerp(new THREE.Vector3(f.x, Math.max(0, f.y), f.z), 1 - Math.exp(-dt * 5));
        const fz = Math.max(30, focusS.current.z);
        const fx = focusS.current.x;
        const dist = Math.hypot(fx, fz);
        spec = {
          pos: new THREE.Vector3(fx * 0.22, 32 + dist * 0.16 + focusS.current.y * 0.25, -38 + fz * 0.18),
          look: focusS.current.clone().setY(focusS.current.y * 0.7),
          fov: aspectFov(48),
        };
        break;
      }
      case "broadcast":
      default:
        spec = { pos: new THREE.Vector3(9, 22, 340), look: new THREE.Vector3(0, 3.4, 0), fov: aspectFov(5.4) };
    }
    if (lastMode.current !== pb.cam) {
      if (pb.cam === "follow") focusS.current.copy(look.current);
      // Hard cut between pitch cameras (broadcast style); glide into the follow cam.
      if (pb.cam !== "follow") {
        cam.position.copy(spec.pos);
        look.current.copy(spec.look);
        cam.fov = spec.fov;
      }
      lastMode.current = pb.cam;
    }
    const k = 1 - Math.exp(-dt * (pb.cam === "follow" ? 3 : 8));
    cam.position.lerp(spec.pos, k);
    look.current.lerp(spec.look, k);
    cam.fov += (spec.fov - cam.fov) * k;
    cam.lookAt(look.current);
    cam.updateProjectionMatrix();
  });
  return null;
}

/**
 * Strike zone, plate-coverage indicator / pitch target and a pointer plane at the
 * front of the plate. px/pz are Statcast plate coordinates (world x = −px).
 */
export function PlateOverlay({
  pb,
  onAim,
  onClick,
}: {
  pb: Playback;
  onAim: (px: number, pz: number) => void;
  onClick: () => void;
}) {
  const zone = useRef<THREE.LineSegments>(null);
  const pci = useRef<THREE.LineSegments>(null);
  const dot = useRef<THREE.Mesh>(null);
  const last = useRef<THREE.Mesh>(null);
  const zoneGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(new Array(8 * 3 + 12 * 3).fill(0), 3));
    return g;
  }, []);
  const pciGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(new Array(8 * 3).fill(0), 3));
    return g;
  }, []);
  useEffect(() => () => {
    zoneGeo.dispose();
    pciGeo.dispose();
  }, [zoneGeo, pciGeo]);

  useFrame(() => {
    const a = pb.aim;
    const z = PLATE_FRONT_Z;
    if (zone.current) {
      zone.current.visible = a.showZone;
      const pos = zoneGeo.attributes.position as THREE.BufferAttribute;
      const x0 = -0.83;
      const x1 = 0.83;
      const y0 = a.zoneBottom;
      const y1 = a.zoneTop;
      const pts = [
        [x0, y0, x1, y0],
        [x1, y0, x1, y1],
        [x1, y1, x0, y1],
        [x0, y1, x0, y0],
        // 3×3 grid
        [x0 + (x1 - x0) / 3, y0, x0 + (x1 - x0) / 3, y1],
        [x0 + (2 * (x1 - x0)) / 3, y0, x0 + (2 * (x1 - x0)) / 3, y1],
        [x0, y0 + (y1 - y0) / 3, x1, y0 + (y1 - y0) / 3],
        [x0, y0 + (2 * (y1 - y0)) / 3, x1, y0 + (2 * (y1 - y0)) / 3],
      ];
      pts.forEach(([ax, ay, bx, by], i) => {
        pos.setXYZ(i * 2, ax, ay, z);
        pos.setXYZ(i * 2 + 1, bx, by, z);
      });
      pos.needsUpdate = true;
      zoneGeo.setDrawRange(0, 16);
    }
    if (pci.current && dot.current) {
      pci.current.visible = a.visible && a.kind === "pci";
      dot.current.visible = a.visible;
      const x = -a.px;
      const y = a.pz;
      const pos = pciGeo.attributes.position as THREE.BufferAttribute;
      const c = [
        [x - a.w, y - a.h, x + a.w, y - a.h],
        [x + a.w, y - a.h, x + a.w, y + a.h],
        [x + a.w, y + a.h, x - a.w, y + a.h],
        [x - a.w, y + a.h, x - a.w, y - a.h],
      ];
      c.forEach(([ax, ay, bx, by], i) => {
        pos.setXYZ(i * 2, ax, ay, z - 0.02);
        pos.setXYZ(i * 2 + 1, bx, by, z - 0.02);
      });
      pos.needsUpdate = true;
      dot.current.position.set(x, y, z - 0.03);
      dot.current.scale.setScalar(a.kind === "target" ? 1.6 : 0.6);
    }
    if (last.current) {
      const lp = pb.lastPitch;
      last.current.visible = !!lp && a.showZone;
      if (lp) {
        last.current.position.set(-lp.px, lp.pz, z - 0.01);
        (last.current.material as THREE.MeshBasicMaterial).color.set(lp.strike ? "#ff5a4f" : "#5ab0ff");
      }
    }
  });

  const move = (e: ThreeEvent<PointerEvent>) => onAim(-e.point.x, e.point.y);
  return (
    <group>
      <lineSegments ref={zone} geometry={zoneGeo}>
        <lineBasicMaterial color="#ffffff" transparent opacity={0.55} depthTest={false} />
      </lineSegments>
      <lineSegments ref={pci} geometry={pciGeo}>
        <lineBasicMaterial color="#ffe14d" depthTest={false} />
      </lineSegments>
      <mesh ref={dot} renderOrder={10}>
        <circleGeometry args={[0.12, 20]} />
        <meshBasicMaterial color="#ffe14d" transparent opacity={0.85} depthTest={false} />
      </mesh>
      <mesh ref={last} renderOrder={9}>
        <circleGeometry args={[0.13, 20]} />
        <meshBasicMaterial color="#ff5a4f" transparent opacity={0.9} depthTest={false} />
      </mesh>
      <mesh
        position={[0, 3, PLATE_FRONT_Z]}
        rotation-y={Math.PI}
        onPointerMove={move}
        onPointerDown={(e) => {
          move(e);
          onClick();
        }}
      >
        <planeGeometry args={[40, 24]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

/** Cheap gradient sky dome + fog. */
export function SkyDome() {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: { top: { value: new THREE.Color("#3d76c2") }, horizon: { value: new THREE.Color("#cfe2f3") } },
        vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
        fragmentShader:
          "uniform vec3 top; uniform vec3 horizon; varying vec3 vP; void main(){ float h = clamp(vP.y * 1.6, 0.0, 1.0); gl_FragColor = vec4(mix(horizon, top, pow(h, 0.7)), 1.0); }",
      }),
    [],
  );
  useEffect(() => () => mat.dispose(), [mat]);
  return (
    <mesh material={mat} position={[0, 0, 150]}>
      <sphereGeometry args={[3000, 24, 12]} />
    </mesh>
  );
}
