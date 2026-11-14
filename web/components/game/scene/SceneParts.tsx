"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { PLATE_FRONT_Z } from "@/lib/game/physics/pitch";
import { MAX_FRAME_DT, advancePlayback, fielderKey, type Playback } from "@/components/game/scene/playback";

/** Advances playback time and fires cues. Mount first so it runs before readers. */
export function Director({ pb }: { pb: Playback }) {
  useFrame((_, rawDt) => advancePlayback(pb, rawDt));
  return null;
}

const BALL_R = 0.121;
const TRAIL = 16;
const IDENT_Q = new THREE.Quaternion();

export function Ball({ pb }: { pb: Playback }) {
  const ball = useRef<THREE.Mesh>(null);
  const shadow = useRef<THREE.Mesh>(null);
  const trail = useRef<THREE.InstancedMesh>(null);
  const { camera } = useThree();
  const st = useMemo(
    () => ({
      hist: Array.from({ length: TRAIL }, () => new THREE.Vector3()),
      head: 0,
      count: 0,
      off: new THREE.Vector3(),
      shown: new THREE.Vector3(),
      wasVisible: false,
      mode: "",
      cut: -1,
      m: new THREE.Matrix4(),
      v: new THREE.Vector3(),
      p: new THREE.Vector3(),
    }),
    [],
  );

  useFrame((_, rawDt) => {
    const b = ball.current;
    const sh = shadow.current;
    const tr = trail.current;
    if (!b || !sh || !tr) return;
    const tl = pb.timeline;
    const p = st.p;
    let visible = false;
    let held = false;
    let mode = "free";
    if (tl) {
      const bs = tl.ball(pb.T);
      visible = bs.visible;
      held = bs.held;
      p.set(bs.p.x, bs.p.y, bs.p.z);
      if (held && bs.holder) mode = fielderKey(bs.holder);
    } else if (pb.cast) {
      // Between pitches the pitcher has it.
      held = true;
      mode = fielderKey("P");
    }
    if (held && mode !== "free") {
      // A held ball rides the holder's glove or throwing hand.
      const h = pb.hands.get(mode);
      if (h && h.frame === pb.frame) {
        p.copy(h.ballP);
        visible = true;
      }
    }
    b.visible = visible;
    if (!visible) {
      sh.visible = false;
      tr.count = 0;
      st.count = 0;
      st.wasVisible = false;
      st.mode = mode;
      return;
    }
    // Hand-offs (release, catch, pick-up) blend from where the ball was drawn.
    const cut = st.cut !== pb.cutSeq;
    st.cut = pb.cutSeq;
    if (cut || !st.wasVisible) st.off.set(0, 0, 0);
    else if (mode !== st.mode) {
      st.off.copy(st.shown).sub(p);
      if (st.off.lengthSq() > 49) st.off.set(0, 0, 0);
    }
    st.mode = mode;
    st.wasVisible = true;
    const dA = tl ? pb.dT : Math.min(Math.max(rawDt, 0), MAX_FRAME_DT);
    st.off.multiplyScalar(Math.exp(-dA / 0.06));
    p.add(st.off);
    if (!held) p.y = Math.max(BALL_R, p.y);
    st.shown.copy(p);
    b.position.copy(p);
    const cam = camera as THREE.PerspectiveCamera;
    const d = cam.position.distanceTo(p);
    // Keep the ball at least ~3.5 px tall regardless of camera.
    const minR = (3.5 * d * Math.tan(((cam.fov ?? 45) * Math.PI) / 360)) / 420;
    const s = Math.max(1, minR / BALL_R);
    b.scale.setScalar(s);
    sh.visible = p.y > 0.3 && !held;
    sh.position.set(p.x, 0.07, p.z);
    const hs = Math.max(0.6, s * 0.9) * (1 + Math.min(1, p.y / 60));
    sh.scale.set(hs, hs, hs);
    (sh.material as THREE.MeshBasicMaterial).opacity = 0.4 * Math.max(0.15, 1 - p.y / 120);
    // Trail of recent positions while the ball is loose and moving (ring buffer).
    if (held) st.count = 0;
    else {
      const last = st.hist[(st.head + TRAIL - 1) % TRAIL];
      if (st.count === 0 || last.distanceToSquared(p) > 0.16) {
        st.hist[st.head].copy(p);
        st.head = (st.head + 1) % TRAIL;
        if (st.count < TRAIL) st.count += 1;
      }
    }
    tr.count = st.count;
    for (let i = 0; i < st.count; i += 1) {
      // i = 0 is the oldest sample.
      const at = st.hist[(st.head + TRAIL - st.count + i) % TRAIL];
      st.v.setScalar(s * 0.85 * ((i + 1) / (st.count + 1)));
      st.m.compose(at, IDENT_Q, st.v);
      tr.setMatrixAt(i, st.m);
    }
    tr.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      <mesh ref={ball} castShadow={false}>
        <sphereGeometry args={[BALL_R, 16, 12]} />
        <meshStandardMaterial color="#fbfaf4" emissive="#55554e" roughness={0.5} />
      </mesh>
      <mesh ref={shadow} rotation-x={-Math.PI / 2}>
        <circleGeometry args={[BALL_R * 1.4, 16]} />
        <meshBasicMaterial color="#000" transparent opacity={0.35} depthWrite={false} />
      </mesh>
      <instancedMesh ref={trail} args={[undefined, undefined, TRAIL]} frustumCulled={false}>
        <sphereGeometry args={[BALL_R, 8, 6]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.26} depthWrite={false} />
      </instancedMesh>
    </group>
  );
}

/** Flash + expanding ring where bat meets ball. */
export function ContactFx({ pb }: { pb: Playback }) {
  const disc = useRef<THREE.Mesh>(null);
  const ring = useRef<THREE.Mesh>(null);
  const { camera } = useThree();
  useFrame(() => {
    const d = disc.current;
    const r = ring.current;
    if (!d || !r) return;
    const fx = pb.fx;
    const age = fx.flashAge;
    const on = age >= 0 && age < 0.28;
    d.visible = on && age < 0.12;
    r.visible = on;
    if (!on) return;
    const k = age / 0.28;
    const size = 0.5 + fx.flashPower;
    d.position.copy(fx.flashP);
    d.quaternion.copy(camera.quaternion);
    d.scale.setScalar(size * (0.9 + age * 9));
    (d.material as THREE.MeshBasicMaterial).opacity = 0.9 * Math.max(0, 1 - age / 0.12);
    r.position.copy(fx.flashP);
    r.quaternion.copy(camera.quaternion);
    r.scale.setScalar(size * (0.6 + 3.2 * Math.sqrt(k)));
    (r.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - k) * (1 - k);
  });
  return (
    <group>
      <mesh ref={disc} visible={false} renderOrder={20}>
        <circleGeometry args={[0.5, 20]} />
        <meshBasicMaterial color="#fff6d8" transparent opacity={0} depthTest={false} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      <mesh ref={ring} visible={false} renderOrder={20}>
        <ringGeometry args={[0.42, 0.5, 28]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0} depthTest={false} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
    </group>
  );
}

/** Critically damped spring toward a target (frame-rate independent, no overshoot). */
function springTo(cur: THREE.Vector3, vel: THREE.Vector3, to: THREE.Vector3, smoothTime: number, dt: number) {
  const omega = 2 / smoothTime;
  const x = omega * dt;
  const e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const cx = cur.x - to.x;
  const cy = cur.y - to.y;
  const cz = cur.z - to.z;
  const tx = (vel.x + omega * cx) * dt;
  const ty = (vel.y + omega * cy) * dt;
  const tz = (vel.z + omega * cz) * dt;
  vel.set((vel.x - omega * tx) * e, (vel.y - omega * ty) * e, (vel.z - omega * tz) * e);
  cur.set(to.x + (cx + tx) * e, to.y + (cy + ty) * e, to.z + (cz + tz) * e);
}

/** Camera presets with spring-damped motion; "follow" tracks (and leads) the play's focus point. */
export function CameraRig({ pb }: { pb: Playback }) {
  const { camera, size } = useThree();
  const narrow = size.width < size.height;
  const st = useMemo(
    () => ({
      pos: new THREE.Vector3(9, 22, 340),
      look: new THREE.Vector3(0, 3.4, 0),
      vPos: new THREE.Vector3(),
      vLook: new THREE.Vector3(),
      fov: 6,
      toPos: new THREE.Vector3(),
      toLook: new THREE.Vector3(),
      focus: new THREE.Vector3(0, 3, 30),
      mode: "" as string,
      // Seconds since the camera started gliding into the follow view.
      glide: 10,
    }),
    [],
  );

  useFrame((_, rawDt) => {
    const dt = Math.min(Math.max(rawDt, 0), MAX_FRAME_DT);
    const cam = camera as THREE.PerspectiveCamera;
    const wide = narrow ? 1.45 : 1;
    let fov: number;
    switch (pb.cam) {
      case "batter":
        st.toPos.set(0, 5.3, -13.5);
        st.toLook.set(0, 3.0, 30);
        fov = 38 * wide;
        break;
      case "pitcher":
        st.toPos.set(0, 9.6, 80);
        st.toLook.set(0, 2.6, 0);
        fov = 19 * wide;
        break;
      case "overview":
        st.toPos.set(-40, 230, -170);
        st.toLook.set(0, 0, 170);
        fov = 50 * wide;
        break;
      case "follow": {
        const tl = pb.timeline;
        if (tl) {
          // Lead the ball a little so it never outruns the frame.
          const ahead = tl.focus(pb.T + 0.3);
          const ax = ahead.x;
          const ay = ahead.y;
          const az = ahead.z;
          const f = tl.focus(pb.T);
          st.focus.set(f.x + (ax - f.x) * 0.55, Math.max(0, f.y + (ay - f.y) * 0.4), f.z + (az - f.z) * 0.55);
        }
        const fx = st.focus.x;
        const fy = st.focus.y;
        const fz = Math.max(30, st.focus.z);
        const dist = Math.hypot(fx, fz);
        st.toPos.set(fx * 0.22, 32 + dist * 0.16 + fy * 0.25, -38 + fz * 0.18);
        st.toLook.set(fx, fy * 0.7, st.focus.z);
        fov = 48 * wide;
        break;
      }
      case "broadcast":
      default:
        st.toPos.set(9, 22, 340);
        st.toLook.set(0, 3.4, 0);
        fov = 5.4 * wide;
    }
    if (st.mode !== pb.cam) {
      // Broadcast-style hard cuts, except the crane up from the batter's view into the play.
      const glide = st.mode === "batter" && pb.cam === "follow";
      if (glide) st.glide = 0;
      else {
        st.pos.copy(st.toPos);
        st.look.copy(st.toLook);
        st.vPos.set(0, 0, 0);
        st.vLook.set(0, 0, 0);
        st.fov = fov;
        st.glide = 10;
      }
      st.mode = pb.cam;
    }
    st.glide += dt;
    const follow = pb.cam === "follow";
    // The crane move starts gently and tightens up once the camera is in position.
    const ease = follow ? Math.min(1, st.glide / 1.2) : 1;
    springTo(st.pos, st.vPos, st.toPos, follow ? 0.75 - 0.3 * ease : 0.25, dt);
    springTo(st.look, st.vLook, st.toLook, follow ? 0.3 - 0.08 * ease : 0.25, dt);
    st.fov += (fov - st.fov) * (1 - Math.exp(-dt / (follow ? 0.3 : 0.12)));
    cam.position.copy(st.pos);
    cam.lookAt(st.look);
    const shake = pb.fx.shake;
    if (shake > 0.002) {
      const t = pb.now;
      cam.position.x += shake * Math.sin(t * 83.1);
      cam.position.y += shake * 0.7 * Math.sin(t * 97.3 + 1.3);
      cam.rotateZ(shake * 0.012 * Math.sin(t * 61.7 + 0.4));
    }
    const f = st.fov * (1 - 0.045 * pb.fx.punch);
    if (Math.abs(cam.fov - f) > 1e-4) {
      cam.fov = f;
      cam.updateProjectionMatrix();
    }
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
  const zoneKey = useRef({ b: NaN, t: NaN });
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
      const k = zoneKey.current;
      if (a.showZone && (k.b !== a.zoneBottom || k.t !== a.zoneTop)) {
        k.b = a.zoneBottom;
        k.t = a.zoneTop;
        const pos = zoneGeo.attributes.position as THREE.BufferAttribute;
        const x0 = -0.83;
        const x1 = 0.83;
        const y0 = a.zoneBottom;
        const y1 = a.zoneTop;
        const xa = x0 + (x1 - x0) / 3;
        const xb = x0 + (2 * (x1 - x0)) / 3;
        const ya = y0 + (y1 - y0) / 3;
        const yb = y0 + (2 * (y1 - y0)) / 3;
        let i = 0;
        const seg = (ax: number, ay: number, bx: number, by: number) => {
          pos.setXYZ(i, ax, ay, z);
          pos.setXYZ(i + 1, bx, by, z);
          i += 2;
        };
        seg(x0, y0, x1, y0);
        seg(x1, y0, x1, y1);
        seg(x1, y1, x0, y1);
        seg(x0, y1, x0, y0);
        // 3×3 grid
        seg(xa, y0, xa, y1);
        seg(xb, y0, xb, y1);
        seg(x0, ya, x1, ya);
        seg(x0, yb, x1, yb);
        pos.needsUpdate = true;
        zoneGeo.setDrawRange(0, 16);
      }
    }
    if (pci.current && dot.current) {
      pci.current.visible = a.visible && a.kind === "pci";
      dot.current.visible = a.visible;
      if (a.visible) {
        const x = -a.px;
        const y = a.pz;
        const zz = z - 0.02;
        const pos = pciGeo.attributes.position as THREE.BufferAttribute;
        pos.setXYZ(0, x - a.w, y - a.h, zz);
        pos.setXYZ(1, x + a.w, y - a.h, zz);
        pos.setXYZ(2, x + a.w, y - a.h, zz);
        pos.setXYZ(3, x + a.w, y + a.h, zz);
        pos.setXYZ(4, x + a.w, y + a.h, zz);
        pos.setXYZ(5, x - a.w, y + a.h, zz);
        pos.setXYZ(6, x - a.w, y + a.h, zz);
        pos.setXYZ(7, x - a.w, y - a.h, zz);
        pos.needsUpdate = true;
        dot.current.position.set(x, y, z - 0.03);
        dot.current.scale.setScalar(a.kind === "target" ? 1.6 : 0.6);
      }
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
