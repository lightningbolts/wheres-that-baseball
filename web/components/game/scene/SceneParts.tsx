"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { PLATE_FRONT_Z } from "@/lib/game/physics/pitch";
import { getQuality } from "@/components/game/scene/quality";
import { MAX_FRAME_DT, advancePlayback, fielderKey, type Playback } from "@/components/game/scene/playback";
import { MARK_COLOR, MAX_MARKS, plateCam, plateHud, zoneBox } from "@/components/game/scene/view";
import { BALL_RADIUS_FT } from "@/lib/game/physics/ballFlight";
import { newCamState, stepCamera } from "@/components/game/scene/camera";
import { useModelOn } from "@/components/game/scene/assets/models";

/** Advances playback time and fires cues. Mount first so it runs before readers. */
export function Director({ pb }: { pb: Playback }) {
  useFrame((_, rawDt) => advancePlayback(pb, rawDt));
  return null;
}

const BALL_R = 0.121;
const DEG = Math.PI / 180;
const TRAIL = 16;
const IDENT_Q = new THREE.Quaternion();

/** Catcher cam: how long after the catch the pitch is still drawn carrying on toward the (unseen) mitt, s. */
const CARRY_S = 0.25;
const _ndc = new THREE.Vector3();

/**
 * The catcher and his mitt are never drawn in the catcher cam: the camera sits just
 * behind him, so his glove would fill the bottom of the frame. The pitch still travels
 * to it, though: past the plate the ball keeps coming on its own path, under and past
 * the lens, into a mitt that is out of the shot. Writes the ball's position into `out`
 * and returns whether it is still on screen. Only a pitch that ends up in the mitt.
 */
function pitchIntoMitt(pb: Playback, camera: THREE.Camera, out: THREE.Vector3): boolean {
  const tl = pb.timeline;
  if (!tl || pb.cam !== "batter") return false;
  const r = tl.receive;
  const since = pb.T - r.t;
  if (since < 0 || since > CARRY_S) return false;
  const dt = 1 / 120;
  const prev = tl.ball(r.t - dt).p;
  // Velocity into the catch, then on under gravity (and a touch of extra drop as the glove pulls it in).
  const vx = (r.p.x - prev.x) / dt;
  const vy = (r.p.y - prev.y) / dt;
  const vz = (r.p.z - prev.z) / dt;
  out.set(r.p.x + vx * since, r.p.y + vy * since - 0.5 * (32.2 + 60) * since * since, r.p.z + vz * since);
  // Gone once it has passed the lens or left the frame.
  _ndc.copy(out).project(camera);
  return _ndc.z < 1 && _ndc.z > -1 && Math.abs(_ndc.x) < 1.15 && Math.abs(_ndc.y) < 1.15;
}

export function Ball({ pb }: { pb: Playback }) {
  const ball = useRef<THREE.Mesh>(null);
  const shadow = useRef<THREE.Mesh>(null);
  const trail = useRef<THREE.InstancedMesh>(null);
  const dot = useRef<THREE.Group>(null);
  const { camera, size } = useThree();
  // The Blender-built ball (stitched cover) replaces the plain sphere once it loads. The
  // cover glows a little (emissive, through its own texture) so it reads against the sky.
  useModelOn("baseball", () => ball.current, {
    material: (m) => {
      const c = m.clone();
      c.emissive.set("#55554e");
      c.emissiveMap = c.map;
      return c;
    },
  });
  const st = useMemo(
    () => ({
      hist: Array.from({ length: TRAIL }, () => new THREE.Vector3()),
      head: 0,
      count: 0,
      off: new THREE.Vector3(),
      shown: new THREE.Vector3(),
      mitt: new THREE.Vector3(),
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
    const dt = dot.current;
    if (!b || !sh || !tr || !dt) return;
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
      } else if (tl && pb.cam === "batter" && mode === fielderKey("C")) {
        // The catcher is not drawn in the catcher cam: the pitch carries on out of the shot into his mitt.
        visible = pitchIntoMitt(pb, camera, st.mitt);
        if (visible) {
          p.copy(st.mitt);
          // Still in flight as far as the shot is concerned: keep its trail and marker.
          held = false;
        }
      }
    }
    b.visible = visible;
    if (!visible) {
      sh.visible = false;
      dt.visible = false;
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
    // A pitch on its way to the plate, seen from a plate camera: the one thing the
    // player has to read, so it is drawn larger at range and on top of everything.
    const plateView = pb.cam === "batter" || pb.cam === "pitcher" || pb.cam === "broadcast";
    const pitching = !!tl && !held && plateView && pb.T >= tl.releaseT && pb.T < Math.min(tl.contactT ?? Infinity, tl.receive.t);
    // Keep the ball a minimum size on screen regardless of camera (radius in CSS px).
    const minPx = pitching ? (pb.cam === "batter" ? 3.4 : 2.8) : pb.cam === "follow" && !held ? 2.8 : 2.2;
    const ftPerPx = (2 * d * Math.tan(((cam.fov ?? 45) * Math.PI) / 360)) / Math.max(240, size.height);
    const s = Math.max(1, (minPx * ftPerPx) / BALL_R);
    b.scale.setScalar(s);
    dt.visible = pitching;
    if (pitching) {
      dt.position.copy(p);
      dt.quaternion.copy(cam.quaternion);
      dt.scale.setScalar(s);
    }
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
      {/* Camera-facing disc + dark rim over the pitched ball: never hidden, readable on any backdrop. */}
      <group ref={dot} visible={false}>
        <mesh renderOrder={30}>
          <ringGeometry args={[BALL_R * 0.98, BALL_R * 1.3, 24]} />
          <meshBasicMaterial color="#0a0f18" transparent opacity={0.75} depthTest={false} depthWrite={false} />
        </mesh>
        <mesh renderOrder={31}>
          <circleGeometry args={[BALL_R, 24]} />
          <meshBasicMaterial color="#fffdf2" transparent opacity={0.96} depthTest={false} depthWrite={false} />
        </mesh>
      </group>
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

/** The game camera: the shots and the moves between them live in camera.ts; this applies them, plus contact shake. */
export function CameraRig({ pb }: { pb: Playback }) {
  const { camera, size } = useThree();
  const aspect = size.width / Math.max(1, size.height);
  const st = useMemo(() => newCamState(), []);

  useFrame((_, rawDt) => {
    const cam = camera as THREE.PerspectiveCamera;
    stepCamera(st, pb, rawDt, aspect);
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
    // Without a logarithmic depth buffer (Low graphics) a 0.3 ft near plane leaves too little
    // depth precision at the infield for the layered field marks: keep it a foot out (the
    // batter cam already uses 1; nothing else comes that close to a lens).
    const near = getQuality().boot.logDepth ? st.near : Math.max(1, st.near);
    if (Math.abs(cam.fov - f) > 1e-4 || cam.near !== near) {
      cam.fov = f;
      cam.near = near;
      cam.updateProjectionMatrix();
    }
    // World matrix (and its inverse) now, not at render time: everything after this in the
    // frame that projects through the camera (the ball's carry into the mitt, overlays) has to
    // see this frame's view, or a hard cut gets one frame decided by the old one.
    cam.updateMatrixWorld();
  });
  return null;
}

/** A rectangular outline with real thickness (WebGL lines are always 1 px): four quads. */
function frameGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(new Array(16 * 3).fill(0), 3));
  const idx: number[] = [];
  for (let q = 0; q < 4; q += 1) idx.push(q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3);
  g.setIndex(idx);
  return g;
}

function writeFrame(g: THREE.BufferGeometry, x0: number, y0: number, x1: number, y1: number, t: number, z: number) {
  const pos = g.attributes.position as THREE.BufferAttribute;
  const h = t / 2;
  let i = 0;
  const quad = (ax: number, ay: number, bx: number, by: number) => {
    pos.setXYZ(i, ax, ay, z);
    pos.setXYZ(i + 1, bx, ay, z);
    pos.setXYZ(i + 2, bx, by, z);
    pos.setXYZ(i + 3, ax, by, z);
    i += 4;
  };
  quad(x0 - h, y0 - h, x1 + h, y0 + h);
  quad(x0 - h, y1 - h, x1 + h, y1 + h);
  quad(x0 - h, y0 + h, x0 + h, y1 - h);
  quad(x1 - h, y0 + h, x1 + h, y1 - h);
  pos.needsUpdate = true;
}

/** White numerals 1…n on transparent squares, for the pitch-sequence markers. */
function numeralTextures(n: number): THREE.CanvasTexture[] {
  const out: THREE.CanvasTexture[] = [];
  for (let i = 0; i < n; i += 1) {
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 64;
    const x = c.getContext("2d");
    if (x) {
      x.font = "bold 44px ui-sans-serif, system-ui, sans-serif";
      x.textAlign = "center";
      x.textBaseline = "middle";
      x.lineWidth = 6;
      x.strokeStyle = "rgba(0,0,0,0.55)";
      x.strokeText(String(i + 1), 32, 35);
      x.fillStyle = "#fff";
      x.fillText(String(i + 1), 32, 35);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    out.push(t);
  }
  return out;
}

const MARK_COLORS = Object.fromEntries(Object.entries(MARK_COLOR).map(([k, v]) => [k, new THREE.Color(v)])) as Record<keyof typeof MARK_COLOR, THREE.Color>;
const MARK_SLOTS = Array.from({ length: MAX_MARKS }, (_, i) => i);
const smooth01 = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};
/** Seconds for the strike zone to fade in / out (eased, on the real clock so slow motion does not drag it). */
const ZONE_FADE_IN_S = 0.32;
const ZONE_FADE_OUT_S = 0.22;

/** Radial falloff for the pre-pitch read spot (null on the server). */
function softSpotTexture(): THREE.Texture | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, "rgba(255,255,255,0.95)");
  grd.addColorStop(0.45, "rgba(255,255,255,0.55)");
  grd.addColorStop(0.75, "rgba(255,255,255,0.12)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Strike zone, plate-coverage indicator / pitch target, where each pitch of the
 * at-bat crossed, the incoming pitch's approach ring, and a pointer plane at the
 * front of the plate. px/pz are Statcast plate coordinates (world x = −px).
 * Everything is drawn over the scene and sized in screen pixels, so it reads the
 * same from the catcher cam, from behind the mound and from center field.
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
  const { camera, size } = useThree();
  const hud = useMemo(() => plateHud(pb), [pb]);
  const zone = useRef<THREE.Mesh>(null);
  const grid = useRef<THREE.LineSegments>(null);
  const pci = useRef<THREE.Mesh>(null);
  const dot = useRef<THREE.Mesh>(null);
  const target = useRef<THREE.Mesh>(null);
  const approach = useRef<THREE.Mesh>(null);
  const hint = useRef<THREE.Group>(null);
  const hintTex = useMemo(() => softSpotTexture(), []);
  const marks = useRef<Array<THREE.Group | null>>([]);
  /** Zone fade progress 0 (off) → 1 (on), eased for display; snaps on a camera cut. */
  const zoneFade = useRef({ level: 0, cut: -1 });
  const grab = useRef<{ x: number; y: number } | null>(null);
  const zoneGeo = useMemo(() => frameGeometry(), []);
  const pciGeo = useMemo(() => frameGeometry(), []);
  const gridGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(new Array(8 * 3).fill(0), 3));
    return g;
  }, []);
  const numerals = useMemo(() => numeralTextures(MAX_MARKS), []);
  useEffect(
    () => () => {
      zoneGeo.dispose();
      pciGeo.dispose();
      gridGeo.dispose();
      numerals.forEach((t) => t.dispose());
      hintTex?.dispose();
    },
    [zoneGeo, pciGeo, gridGeo, numerals, hintTex],
  );

  useFrame((_, rawDt) => {
    const a = pb.aim;
    const z = PLATE_FRONT_Z;
    const cam = camera as THREE.PerspectiveCamera;
    const dist = Math.hypot(cam.position.x, cam.position.y - 2.5, cam.position.z - z);
    // Feet per CSS pixel at the plate: line weights and marker sizes are set in pixels.
    const ftPerPx = (2 * dist * Math.tan(((cam.fov ?? 45) * Math.PI) / 360)) / Math.max(240, size.height);
    const line = 2.6 * ftPerPx;
    // All-Star: no zone while the pitcher winds up and the ball is in the air.
    if (hud.zoneHiddenUntil != null && (!pb.timeline || pb.T >= hud.zoneHiddenUntil)) hud.zoneHiddenUntil = null;
    // ABS: nothing to go on while a club decides whether to challenge.
    const held = hud.zoneHeldFrom != null && (!pb.timeline || pb.T >= hud.zoneHeldFrom);
    const zoneOn = a.showZone && hud.zoneHiddenUntil == null && !held;
    // The zone fades in and out rather than popping (a camera cut just shows the new state).
    const zf = zoneFade.current;
    if (zf.cut !== pb.cutSeq) {
      zf.cut = pb.cutSeq;
      zf.level = zoneOn ? 1 : 0;
    } else {
      const dt = Math.min(Math.max(rawDt, 0), MAX_FRAME_DT);
      zf.level = zoneOn ? Math.min(1, zf.level + dt / ZONE_FADE_IN_S) : Math.max(0, zf.level - dt / ZONE_FADE_OUT_S);
    }
    const zoneAlpha = smooth01(zf.level);
    const zoneShown = zoneAlpha > 0.004;
    if (zone.current && grid.current) {
      zone.current.visible = zoneShown;
      grid.current.visible = zoneShown;
      (zone.current.material as THREE.MeshBasicMaterial).opacity = 0.9 * zoneAlpha;
      (grid.current.material as THREE.LineBasicMaterial).opacity = 0.3 * zoneAlpha;
      if (zoneShown) {
        const { x0, x1, y0, y1 } = zoneBox(a.zoneBottom, a.zoneTop);
        writeFrame(zoneGeo, x0, y0, x1, y1, line, z);
        const pos = gridGeo.attributes.position as THREE.BufferAttribute;
        const xa = x0 + (x1 - x0) / 3;
        const xb = x0 + (2 * (x1 - x0)) / 3;
        const ya = y0 + (y1 - y0) / 3;
        const yb = y0 + (2 * (y1 - y0)) / 3;
        pos.setXYZ(0, xa, y0, z);
        pos.setXYZ(1, xa, y1, z);
        pos.setXYZ(2, xb, y0, z);
        pos.setXYZ(3, xb, y1, z);
        pos.setXYZ(4, x0, ya, z);
        pos.setXYZ(5, x1, ya, z);
        pos.setXYZ(6, x0, yb, z);
        pos.setXYZ(7, x1, yb, z);
        pos.needsUpdate = true;
      }
    }
    if (pci.current && dot.current && target.current) {
      const isPci = a.kind === "pci";
      pci.current.visible = a.visible && isPci;
      dot.current.visible = a.visible;
      target.current.visible = a.visible && !isPci;
      if (a.visible) {
        const x = -a.px;
        const y = a.pz;
        if (isPci) writeFrame(pciGeo, x - a.w, y - a.h, x + a.w, y + a.h, line * 1.15, z);
        dot.current.position.set(x, y, z);
        dot.current.quaternion.copy(cam.quaternion);
        dot.current.scale.setScalar(Math.max(0.03, 2.4 * ftPerPx));
        target.current.position.set(x, y, z);
        target.current.quaternion.copy(cam.quaternion);
        target.current.scale.setScalar(Math.max(BALL_R * 1.5, 7 * ftPerPx));
      }
    }
    // Where each pitch of the at-bat crossed: numbered, colored by result, newest on top.
    const list = hud.marks;
    const first = Math.max(0, list.length - MAX_MARKS);
    // True ball size: a marker that touches the drawn zone is a strike, one clear of it a ball.
    const r = BALL_RADIUS_FT;
    const age = hud.markAt < 0 ? 10 : pb.now - hud.markAt;
    for (let i = 0; i < MAX_MARKS; i += 1) {
      const g = marks.current[i];
      if (!g) continue;
      const m = list[first + i];
      g.visible = zoneShown && !!m;
      if (!g.visible || !m) continue;
      const newest = first + i === list.length - 1;
      g.position.set(-m.px, m.pz, z);
      g.quaternion.copy(cam.quaternion);
      g.scale.setScalar(r * (newest ? 1 + 0.9 * Math.exp(-age / 0.12) : 1));
      const disc = (g.children[1] as THREE.Mesh).material as THREE.MeshBasicMaterial;
      disc.color.copy(MARK_COLORS[m.kind]);
      disc.opacity = (newest ? 0.95 : 0.55) * zoneAlpha;
      ((g.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = (newest ? 0.9 : 0.35) * zoneAlpha;
      const num = (g.children[2] as THREE.Mesh).material as THREE.MeshBasicMaterial;
      num.map = numerals[(m.n - 1) % MAX_MARKS];
      num.opacity = (newest ? 1 : 0.7) * zoneAlpha;
    }
    // Pre-pitch read: a soft glow where the catcher set up, faded in as the pitcher
    // comes set and gone as the ball leaves the hand.
    const hg = hint.current;
    if (hg) {
      const h = hud.hint;
      let alpha = 0;
      if (h && pb.cam === "batter" && pb.timeline && a.showZone) {
        alpha = smooth01((pb.T - h.from) / 0.3) * smooth01((h.to - pb.T) / 0.22);
      }
      hg.visible = alpha > 0.01;
      if (h && hg.visible) {
        hg.position.set(-h.px, h.pz, z);
        hg.quaternion.copy(cam.quaternion);
        const breathe = 1 + 0.06 * Math.sin(pb.now * 7);
        hg.scale.setScalar(h.r * breathe);
        ((hg.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.85 * alpha;
        ((hg.children[1] as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.7 * alpha;
      }
    }
    // Pitch-location ring: appears on the zone plane partway through the flight and
    // closes onto the exact spot where the pitch will cross (break included).
    const ap = approach.current;
    if (ap) {
      let on = false;
      const tl = pb.timeline;
      if (tl && hud.assistFrom != null && a.showZone && a.kind === "pci" && pb.cam === "batter" && pb.T >= tl.releaseT && pb.T < Math.min(tl.contactT ?? Infinity, tl.receive.t)) {
        const p = tl.ball(pb.T).p;
        const span = Math.max(1, tl.releaseP.z - z);
        const frac = 1 - (p.z - z) / span;
        const alpha = smooth01((frac - hud.assistFrom) / 0.12);
        const c = hud.cross;
        if (c && p.z > z && alpha > 0.01) {
          on = true;
          ap.position.set(-c.px, c.pz, z);
          ap.quaternion.copy(cam.quaternion);
          ap.scale.setScalar(Math.max(BALL_R, 4 * ftPerPx) * (1 + 3.2 * (1 - frac)));
          (ap.material as THREE.MeshBasicMaterial).opacity = 0.85 * alpha;
        }
      }
      ap.visible = on;
    }
  });

  // Mouse: the marker follows the pointer and a press is the action button.
  // Touch: drag anywhere to move the marker from where it is (the finger never
  // hides it); the on-screen buttons act.
  const move = (e: ThreeEvent<PointerEvent>) => {
    if (e.nativeEvent.pointerType === "touch") {
      const g = grab.current;
      if (g) onAim(g.x - e.point.x, g.y + e.point.y);
    } else onAim(-e.point.x, e.point.y);
  };
  const down = (e: ThreeEvent<PointerEvent>) => {
    if (e.nativeEvent.pointerType === "touch") {
      grab.current = { x: pb.aim.px + e.point.x, y: pb.aim.pz - e.point.y };
      return;
    }
    move(e);
    onClick();
  };
  const up = () => {
    grab.current = null;
  };
  return (
    <group>
      <mesh ref={zone} geometry={zoneGeo} renderOrder={5} frustumCulled={false}>
        <meshBasicMaterial color="#ffffff" transparent opacity={0.9} depthTest={false} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <lineSegments ref={grid} geometry={gridGeo} renderOrder={5} frustumCulled={false}>
        <lineBasicMaterial color="#ffffff" transparent opacity={0.3} depthTest={false} depthWrite={false} />
      </lineSegments>
      {MARK_SLOTS.map((i) => (
        <group
          key={i}
          visible={false}
          ref={(g) => {
            marks.current[i] = g;
          }}
        >
          <mesh renderOrder={8}>
            <ringGeometry args={[0.8, 1, 24]} />
            <meshBasicMaterial color="#0a0f18" transparent opacity={0.6} depthTest={false} depthWrite={false} />
          </mesh>
          <mesh renderOrder={8}>
            <circleGeometry args={[0.84, 24]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.9} depthTest={false} depthWrite={false} />
          </mesh>
          <mesh renderOrder={9}>
            <planeGeometry args={[1.25, 1.25]} />
            <meshBasicMaterial map={numerals[i]} transparent depthTest={false} depthWrite={false} />
          </mesh>
        </group>
      ))}
      <mesh ref={pci} geometry={pciGeo} renderOrder={10} frustumCulled={false}>
        <meshBasicMaterial color="#ffe14d" transparent opacity={0.95} depthTest={false} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={target} renderOrder={10} visible={false}>
        <ringGeometry args={[0.78, 1, 28]} />
        <meshBasicMaterial color="#ffe14d" transparent opacity={0.95} depthTest={false} depthWrite={false} />
      </mesh>
      <mesh ref={dot} renderOrder={11} visible={false}>
        <circleGeometry args={[1, 16]} />
        <meshBasicMaterial color="#ffe14d" transparent opacity={0.95} depthTest={false} depthWrite={false} />
      </mesh>
      <group ref={hint} visible={false}>
        <mesh renderOrder={7}>
          <planeGeometry args={[2.6, 2.6]} />
          <meshBasicMaterial map={hintTex} color="#ffb347" transparent opacity={0} depthTest={false} depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
        <mesh renderOrder={7}>
          <ringGeometry args={[0.94, 1, 40]} />
          <meshBasicMaterial color="#ffd27a" transparent opacity={0} depthTest={false} depthWrite={false} />
        </mesh>
      </group>
      <mesh ref={approach} renderOrder={12} visible={false}>
        <ringGeometry args={[0.82, 1, 32]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0} depthTest={false} depthWrite={false} />
      </mesh>
      <mesh position={[0, 3, PLATE_FRONT_Z]} rotation-y={Math.PI} onPointerMove={move} onPointerDown={down} onPointerUp={up} onPointerLeave={up}>
        <planeGeometry args={[60, 36]} />
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
        depthTest: false,
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
    <mesh material={mat} position={[0, 0, 150]} renderOrder={-1000}>
      <sphereGeometry args={[3000, 24, 12]} />
    </mesh>
  );
}
