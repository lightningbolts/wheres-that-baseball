"use client";
/* eslint-disable react-hooks/immutability -- dev-only bench: the frame loop drives three.js objects held in a memo. */

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { BONE_COUNT, REST } from "@/components/game/scene/character/skeleton";
import { Person, Wardrobe, gloveShapes } from "@/components/game/scene/character/person";
import { BAT_COLORS, batGeometry, batMaterial } from "@/components/game/scene/character/bat";
import { useModel, useModelOn } from "@/components/game/scene/assets/models";
import { identity, loadRoster, rosterVersion } from "@/components/game/scene/character/roster";
import { loadScriptFont } from "@/components/game/scene/character/scriptFont";
import { clubSets, setVenue, uniformFor, type Uniform } from "@/components/game/scene/character/uniforms";
import type { Lod } from "@/components/game/scene/character/body";
import { newPose, newPoseCtx, newRigOut, poseClass, poseInto, solveRig, type ActorDraw, type ActorKind } from "@/components/game/scene/rig";
import type { Action } from "@/lib/game/anim/timeline";

interface Spec {
  label: string;
  kind: ActorKind;
  hand: "L" | "R";
  id: number;
  teamId: number;
  home: boolean;
  pos?: ActorDraw["pos"];
  /** A particular set (`clubSets` id) instead of plain home / road. */
  set?: string;
}

/** A cast covering the roles, builds, skin tones and home / road uniforms. */
const DEFAULT_CAST: Spec[] = [
  { label: "Batter · NYY home (Ramos)", kind: "batter", hand: "R", id: 671218, teamId: 147, home: true },
  { label: "Batter L · LAD road (Ohtani)", kind: "batter", hand: "L", id: 660271, teamId: 119, home: false },
  { label: "Pitcher L · BOS home (Tolle)", kind: "pitcher", hand: "L", id: 801139, teamId: 111, home: true, pos: "P" },
  { label: "Catcher · STL home", kind: "catcher", hand: "R", id: 671056, teamId: 138, home: true, pos: "C" },
  { label: "Fielder · HOU road (Altuve)", kind: "fielder", hand: "R", id: 514888, teamId: 117, home: false, pos: "2B" },
  { label: "Fielder L · CHC home", kind: "fielder", hand: "L", id: 691718, teamId: 112, home: true, pos: "CF" },
  { label: "Runner · CIN road (De La Cruz)", kind: "runner", hand: "R", id: 682829, teamId: 113, home: false },
  { label: "Umpire", kind: "umpire", hand: "R", id: 0, teamId: 0, home: false },
  { label: "Coach · SF home", kind: "coach", hand: "R", id: 0, teamId: 137, home: true },
];

/** Two real players per club, for the uniform contact sheet. */
const SHEET_IDS: Record<number, [number, number]> = {108: [687263, 545361], 109: [663457, 606466], 110: [624413, 702616], 111: [701350, 678882], 112: [691718, 673548], 113: [682829, 667472], 114: [680757, 608070], 115: [664983, 696100], 116: [650402, 805808], 117: [665161, 670541], 118: [695600, 677951], 119: [605141, 518692], 120: [694673, 682928], 121: [596019, 665742], 133: [703607, 643446], 134: [804606, 664040], 135: [665487, 592518], 136: [668227, 686527], 137: [687551, 646240], 138: [802139, 671056], 139: [650490, 666018], 140: [608369, 679822], 141: [703520, 665489], 142: [807712, 686797], 143: [656941, 607208], 144: [686948, 660670], 145: [803011, 678246], 146: [669065, 681715], 147: [700250, 641355], 158: [694192, 668930]};

/**
 * `?clubs=108,109,...` swaps the cast for those clubs: a home fielder in a cap beside a road
 * hitter in a helmet. With `&sets=1`, every set each club wears instead, alternates and City
 * Connect included, alternating fielders and hitters.
 */
function sheetCast(): Spec[] | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const q = params.get("clubs");
  if (!q) return null;
  const out: Spec[] = [];
  for (const t of q === "all" ? Object.keys(SHEET_IDS).map(Number) : q.split(",").map(Number)) {
    const ids = SHEET_IDS[t];
    if (!ids) continue;
    if (params.get("sets")) {
      clubSets(t).forEach((s, i) =>
        out.push({ label: `${t} ${s.id}`, kind: i % 2 ? "batter" : "fielder", hand: "R", id: ids[i % 2], teamId: t, home: setVenue(s) !== "road", pos: "SS", set: s.id }),
      );
      continue;
    }
    out.push({ label: `${t} home`, kind: "fielder", hand: "R", id: ids[0], teamId: t, home: true, pos: "SS" });
    out.push({ label: `${t} road`, kind: "batter", hand: "R", id: ids[1], teamId: t, home: false });
  }
  return out.length ? out : null;
}
const CAST: Spec[] = sheetCast() ?? DEFAULT_CAST;

const POSES = ["rest", "auto", "idle", "stance", "swing", "set", "legkick", "release", "run", "crouch", "ready", "throw", "field", "catch", "slide"] as const;
type PoseName = (typeof POSES)[number];

/** What each kind does for a pose name ("auto" = the pose that suits the role). */
function actionFor(kind: ActorKind, pose: PoseName, t: number): { action: Action; actionT: number; speed: number } {
  const auto: Record<ActorKind, PoseName> = { batter: "stance", pitcher: "set", catcher: "crouch", fielder: "ready", runner: "run", umpire: "idle", coach: "idle" };
  const p = pose === "auto" ? auto[kind] : pose;
  switch (p) {
    case "stance":
      // t 0 → waiting for the pitch (no load) … 0.5 → release … 1 → ball past him.
      return { action: "stance", actionT: t <= 0.02 ? -10 : t * 2 - 1, speed: 0 };
    case "swing":
      return { action: "swing", actionT: t, speed: 0 };
    case "set":
      return { action: "idle", actionT: 0, speed: 0 };
    case "legkick":
      return { action: "pitch", actionT: 0.55, speed: 0 };
    case "release":
      return { action: "pitch", actionT: 0.6 + t, speed: 0 };
    case "run":
      return { action: "run", actionT: 1, speed: 24 };
    case "crouch":
      return { action: "crouch", actionT: 1, speed: 0 };
    case "ready":
      return { action: "ready", actionT: 1, speed: 0 };
    case "throw":
      return { action: "throw", actionT: t, speed: 0 };
    case "field":
      return { action: "field", actionT: t, speed: 0 };
    case "catch":
      return { action: "catch", actionT: t, speed: 0 };
    case "slide":
      return { action: "slide", actionT: 0.5, speed: 0 };
    default:
      return { action: "idle", actionT: 1, speed: 0 };
  }
}

interface Settings {
  pose: PoseName;
  t: number;
  lod: Lod | -1;
  spin: boolean;
  only: number;
}

const SPACING = 4.2;
const _c = new THREE.Color();

function Cast({ s }: { s: Settings }) {
  const kit = useMemo(() => {
    const wardrobe = new Wardrobe();
    const people = CAST.map(() => new Person(wardrobe));
    const group = new THREE.Group();
    for (const p of people) group.add(p.mesh);
    const batGeo = batGeometry();
    const batMat = batMaterial();
    const bats = new THREE.InstancedMesh(batGeo, batMat, CAST.length);
    bats.frustumCulled = false;
    bats.castShadow = true;
    bats.count = 0;
    bats.setColorAt(0, BAT_COLORS[0]);
    group.add(bats);
    // `?player=<MLB id>` puts that player in every batter's shoes (his stance and swing).
    const swap = typeof window === "undefined" ? 0 : Number(new URLSearchParams(window.location.search).get("player") ?? 0);
    const actors: ActorDraw[] = CAST.map((c, i) => {
      const set = c.set ? clubSets(c.teamId).find((s) => s.id === c.set)?.kit : undefined;
      const uni: Uniform | null = set
        ? { teamId: c.teamId, home: c.home, jersey: set.jersey, cap: set.cap, letter: set.ink, trim: set.accent, stripe: set.stripe, kit: set }
        : c.teamId
          ? uniformFor(c.teamId, c.home, 0x223344)
          : null;
      return {
        key: `lab-${i}`,
        state: { p: { x: 0, y: 0, z: 0 }, yaw: 0, speed: 0, action: "idle", actionT: 0 },
        kind: c.kind,
        jersey: new THREE.Color(c.kind === "umpire" ? "#1d2026" : (uni?.jersey ?? 0xf4f3ee)),
        accent: new THREE.Color(c.kind === "umpire" ? "#2a2d35" : (uni?.trim ?? 0x223344)),
        skin: new THREE.Color(["#e8c4a0", "#8d5a3b", "#c99a74"][i % 3]),
        hand: c.hand,
        helmet: c.kind === "batter" || c.kind === "runner",
        pos: c.pos ?? null,
        id: swap && c.kind === "batter" ? swap : c.id,
        uni: c.kind === "umpire" ? null : uni,
      } as ActorDraw;
    });
    return { wardrobe, people, group, bats, batGeo, batMat, actors, rigs: CAST.map(() => newRigOut()), pose: newPose(), ctx: newPoseCtx() };
  }, []);
  useEffect(() => {
    loadRoster();
    loadScriptFont();
    return () => {
      for (const p of kit.people) p.dispose();
      kit.wardrobe.dispose();
      kit.batGeo.dispose();
      kit.batMat.dispose();
      kit.bats.dispose();
    };
  }, [kit]);
  useModelOn("bat", () => kit.bats);
  const gloveModel = useModel("glove");
  useEffect(() => {
    if (!gloveModel) return;
    kit.wardrobe.setGloves(gloveShapes(gloveModel.lods.map((l) => l.geometry)));
    return () => kit.wardrobe.setGloves(undefined);
  }, [gloveModel, kit]);
  const turn = useRef(0);
  const { camera } = useThree();

  useFrame((state, dt) => {
    if (s.spin) turn.current += dt * 0.6;
    const now = state.clock.elapsedTime;
    let nBats = 0;
    const version = rosterVersion();
    for (let i = 0; i < CAST.length; i += 1) {
      const a = kit.actors[i];
      const person = kit.people[i];
      if (s.only >= 0 && s.only !== i) {
        person.mesh.visible = false;
        continue;
      }
      const x = s.only >= 0 ? 0 : (i - (CAST.length - 1) / 2) * SPACING;
      const z = 0;
      const yaw = turn.current;
      if (version && a.id) {
        const tone = identity(a.id).skin;
        if (tone !== null && a.skin.getHex() !== tone) a.skin.set(tone);
      }
      const act = actionFor(a.kind, s.pose, s.t);
      a.state.action = act.action;
      a.state.actionT = act.actionT;
      a.state.speed = act.speed;
      a.state.p.x = x;
      a.state.p.z = z;
      a.state.yaw = yaw;
      const out = kit.rigs[i];
      if (s.pose === "rest") {
        const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(x, 0, z);
        for (let b = 0; b < BONE_COUNT; b += 1) out.bones[b].makeTranslation(REST[b * 3], REST[b * 3 + 1], REST[b * 3 + 2]).premultiply(m);
        out.hasBat = false;
        out.hidden = false;
        out.center.set(x, 3, z);
      } else {
        const c = kit.ctx;
        c.time = now;
        c.phase = act.speed > 0 ? (s.spin ? now * 9 : s.t * Math.PI * 2 * 4) : 0;
        c.speed = act.speed;
        c.x = x;
        c.z = z;
        c.yaw = yaw;
        c.groundY = 0;
        c.seed = (i * 0.37) % 1;
        c.swingDur = 0.15;
        poseInto(kit.pose, a, poseClass(a), c);
        // The pitcher's delivery strides forward; keep him on his mark.
        if (a.kind === "pitcher") kit.pose.rootZ = 0;
        solveRig(a, kit.pose, x, z, yaw, 0, out);
      }
      const dist = camera.position.distanceTo(new THREE.Vector3(x, 3, z));
      const frac = 6 / (2 * Math.max(1, dist) * Math.tan((((camera as THREE.PerspectiveCamera).fov ?? 50) * Math.PI) / 360));
      const lod: Lod = s.lod >= 0 ? (s.lod as Lod) : frac > 0.12 ? 0 : frac > 0.036 ? 1 : 2;
      person.dress(a, lod);
      if (person.stale(a)) person.paint(a);
      person.mesh.visible = !out.hidden;
      if (!out.hidden) person.pose(out, 1, x, 0, z);
      if (!out.hidden && out.hasBat) {
        kit.bats.setMatrixAt(nBats, out.bat);
        kit.bats.setColorAt(nBats, _c.copy(BAT_COLORS[i % BAT_COLORS.length]));
        nBats += 1;
      }
    }
    kit.bats.count = nBats;
    kit.bats.instanceMatrix.needsUpdate = true;
    if (kit.bats.instanceColor) kit.bats.instanceColor.needsUpdate = true;
  });
  return <primitive object={kit.group} />;
}

function read(): Settings & { cam: string } {
  const q = typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);
  const pose = (q.get("pose") ?? "auto") as PoseName;
  return {
    pose: POSES.includes(pose) ? pose : "auto",
    t: Number(q.get("t") ?? 0.1),
    lod: q.get("lod") === null ? -1 : (Number(q.get("lod")) as Lod),
    spin: q.get("spin") === "1",
    only: q.get("only") === null ? -1 : Number(q.get("only")),
    cam: q.get("cam") ?? "",
  };
}

/** `?cam=x,y,z,tx,ty,tz` places the camera for repeatable screenshots. */
function CameraPreset({ cam }: { cam: string }) {
  const { camera, controls } = useThree();
  useEffect(() => {
    const v = cam.split(",").map(Number);
    if (v.length < 6 || v.some((n) => !Number.isFinite(n))) return;
    camera.position.set(v[0], v[1], v[2]);
    const oc = controls as unknown as { target: THREE.Vector3; update: () => void } | null;
    if (oc) {
      oc.target.set(v[3], v[4], v[5]);
      oc.update();
    } else camera.lookAt(v[3], v[4], v[5]);
  }, [cam, camera, controls]);
  return null;
}

export function PlayerLab() {
  const [s, setS] = useState<Settings & { cam: string }>({ pose: "auto", t: 0.1, lod: -1, spin: false, only: -1, cam: "" });
  const live = useRef(s);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    live.current = s;
  }, [s]);
  useEffect(() => {
    setS(read());
    setReady(true);
    // `window.__lab({ pose, t, lod, only, cam })` changes the view without reloading the page.
    const w = window as unknown as { __lab?: (p: Partial<Settings & { cam: string }>) => void };
    w.__lab = (p) => setS((old) => ({ ...old, ...p }));
    return () => {
      delete w.__lab;
    };
  }, []);
  const settings = useMemo<Settings>(
    () => ({
      get pose() {
        return live.current.pose;
      },
      get t() {
        return live.current.t;
      },
      get lod() {
        return live.current.lod;
      },
      get spin() {
        return live.current.spin;
      },
      get only() {
        return live.current.only;
      },
    }),
    [],
  );
  if (!ready) return null;
  return (
    <div style={{ position: "fixed", inset: 0, background: "#5d6f7d" }}>
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: [0, 4.2, 26], fov: 30, near: 0.1, far: 400 }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.05;
        }}
      >
        <color attach="background" args={["#6f8596"]} />
        <hemisphereLight args={["#cfe2ff", "#4c6a3a", 1.0]} />
        <directionalLight
          args={["#fff3dc", 2.6]}
          position={[14, 26, 18]}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-24}
          shadow-camera-right={24}
          shadow-camera-top={12}
          shadow-camera-bottom={-6}
        />
        <directionalLight args={["#bcd0ff", 0.5]} position={[-12, 9, -14]} />
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[320, 60]} />
          <meshStandardMaterial color="#3f7a3a" roughness={1} />
        </mesh>
        <Cast s={settings} />
        <OrbitControls makeDefault target={[0, 3.2, 0]} />
        <CameraPreset cam={s.cam} />
      </Canvas>
      <div style={{ position: "absolute", left: 12, top: 12, display: "flex", gap: 8, flexWrap: "wrap", font: "12px system-ui", color: "#fff", alignItems: "center" }}>
        <label>
          Pose{" "}
          <select value={s.pose} onChange={(e) => setS({ ...s, pose: e.target.value as PoseName })}>
            {POSES.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <label>
          t <input type="range" min={0} max={1} step={0.01} value={s.t} onChange={(e) => setS({ ...s, t: Number(e.target.value) })} />
        </label>
        <label>
          LOD{" "}
          <select value={s.lod} onChange={(e) => setS({ ...s, lod: Number(e.target.value) as Lod | -1 })}>
            <option value={-1}>auto</option>
            <option value={0}>0</option>
            <option value={1}>1</option>
            <option value={2}>2</option>
          </select>
        </label>
        <label>
          Show{" "}
          <select value={s.only} onChange={(e) => setS({ ...s, only: Number(e.target.value) })}>
            <option value={-1}>everyone</option>
            {CAST.map((c, i) => (
              <option key={c.label} value={i}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input type="checkbox" checked={s.spin} onChange={(e) => setS({ ...s, spin: e.target.checked })} /> turntable
        </label>
      </div>
    </div>
  );
}
