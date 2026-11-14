/**
 * Mutable playback state shared between the React game view and the per-frame
 * scene components (no React re-render per frame). The view swaps timelines and
 * sets cues; the Director advances T in useFrame.
 */
import * as THREE from "three";
import type { Timeline, ActorState } from "@/lib/game/anim/timeline";
import type { FieldPos } from "@/lib/game/types";
import type { ActorDraw } from "@/components/game/scene/rig";

export type CamMode = "batter" | "pitcher" | "broadcast" | "follow" | "overview";

export interface Cue {
  T: number;
  fn: () => void;
  done?: boolean;
}

export interface Cast {
  /** Uniform colors for the fielding / batting team. */
  field: { jersey: THREE.Color; accent: THREE.Color };
  bat: { jersey: THREE.Color; accent: THREE.Color };
  pitcherHand: "L" | "R";
  batterHand: "L" | "R";
  /** Standby positions (between pitches). */
  fielders: Array<{ pos: FieldPos; p: { x: number; y: number; z: number }; id: number }>;
  runners: Array<{ id: number; base: 1 | 2 | 3 } | null>;
  batterId: number;
}

export interface Playback {
  timeline: Timeline | null;
  T: number;
  /** Seconds of timeline per real second, outside the slow-motion window. */
  rate: number;
  /** Optional slow-mo window (flight time) and its rate. */
  slow: { from: number; to: number; rate: number } | null;
  paused: boolean;
  cues: Cue[];
  onEnd: (() => void) | null;
  cam: CamMode;
  cast: Cast | null;
  /** Skip-to-end requested (fast forward). */
  turbo: boolean;
  /** Aim marker on the plate plane (Statcast px/pz), for the HUD's 3D overlays. */
  aim: { px: number; pz: number; visible: boolean; kind: "pci" | "target"; w: number; h: number; zoneBottom: number; zoneTop: number; showZone: boolean };
  /** Most recent pitch location to show after the pitch. */
  lastPitch: { px: number; pz: number; strike: boolean } | null;
}

export function createPlayback(): Playback {
  return {
    timeline: null,
    T: 0,
    rate: 1,
    slow: null,
    paused: false,
    cues: [],
    onEnd: null,
    cam: "broadcast",
    cast: null,
    turbo: false,
    aim: { px: 0, pz: 2.5, visible: false, kind: "pci", w: 0.5, h: 0.36, zoneBottom: 1.6, zoneTop: 3.4, showZone: false },
    lastPitch: null,
  };
}

const RUNNER_SKIN = ["#e8c4a0", "#c99a74", "#8d5a3b", "#5e3b26", "#f1d3b5", "#a87454"].map((c) => new THREE.Color(c));
export const skinFor = (id: number) => RUNNER_SKIN[Math.abs(id * 7919) % RUNNER_SKIN.length];

const UMP = { jersey: new THREE.Color("#1d2026"), accent: new THREE.Color("#2a2d35") };
const ZERO = { x: 0, y: 0, z: 0 };

/** Everyone on the field at time T (fielders, batter, runners, umpire, coaches). */
export function actorsAt(pb: Playback, time: number): ActorDraw[] {
  const c = pb.cast;
  if (!c) return [];
  const tl = pb.timeline;
  const T = pb.T;
  const out: ActorDraw[] = [];
  const ballP = tl?.ball(T);
  const ballV = ballP ? new THREE.Vector3(ballP.p.x, ballP.p.y, ballP.p.z) : null;
  for (const f of c.fielders) {
    let st: ActorState;
    if (tl) st = tl.fielder(f.pos, T);
    else {
      const yaw = Math.atan2(-f.p.x, -f.p.z);
      st = { p: f.p, yaw: f.pos === "C" ? 0 : yaw, speed: 0, action: f.pos === "C" ? "crouch" : f.pos === "P" ? "idle" : "ready", actionT: 0 };
    }
    out.push({
      key: `f-${f.pos}`,
      state: st,
      kind: f.pos === "C" ? "catcher" : f.pos === "P" ? "pitcher" : "fielder",
      jersey: c.field.jersey,
      accent: c.field.accent,
      skin: skinFor(f.id),
      hand: f.pos === "P" ? c.pitcherHand : "R",
      helmet: false,
      ball: ballV && ballV.distanceTo(new THREE.Vector3(st.p.x, 4, st.p.z)) < 5 ? toLocal(ballV, st) : null,
    });
  }
  // Batter
  const bSide = c.batterHand;
  const bState: ActorState | null = tl
    ? tl.batter(T)
    : { p: { x: bSide === "R" ? 2.7 : -2.7, y: 0, z: 0.5 }, yaw: bSide === "R" ? -Math.PI / 2 : Math.PI / 2, speed: 0, action: "stance", actionT: 0 };
  if (bState)
    out.push({ key: "batter", state: bState, kind: "batter", jersey: c.bat.jersey, accent: c.bat.accent, skin: skinFor(c.batterId), hand: bSide, helmet: true });
  // Runners
  if (tl) {
    for (const id of tl.runnerIds) {
      const st = tl.runner(id, T);
      if (!st) continue;
      out.push({ key: `r-${id}`, state: st, kind: "runner", jersey: c.bat.jersey, accent: c.bat.accent, skin: skinFor(id), hand: "R", helmet: true });
    }
  } else {
    for (const r of c.runners) {
      if (!r) continue;
      const bp = r.base === 1 ? { x: -63.64, z: 63.64 } : r.base === 2 ? { x: 0, z: 127.28 } : { x: 63.64, z: 63.64 };
      out.push({
        key: `r-${r.id}`,
        state: { p: { x: bp.x, y: 0, z: bp.z }, yaw: Math.atan2(-bp.x, -bp.z), speed: 0, action: "ready", actionT: 0 },
        kind: "runner",
        jersey: c.bat.jersey,
        accent: c.bat.accent,
        skin: skinFor(r.id),
        hand: "R",
        helmet: true,
      });
    }
  }
  // Home-plate umpire and base coaches.
  out.push({ key: "ump", state: { p: { x: 0.4, y: 0, z: -5.6 }, yaw: 0, speed: 0, action: "crouch", actionT: 0 }, kind: "umpire", jersey: UMP.jersey, accent: UMP.accent, skin: skinFor(3), hand: "R", helmet: false });
  for (const [k, x, z] of [["c1", -82, 48], ["c3", 82, 48]] as const) {
    out.push({ key: k, state: { p: { x, y: 0, z }, yaw: Math.atan2(-x, -z + 40), speed: 0, action: "idle", actionT: 0 }, kind: "coach", jersey: c.bat.jersey, accent: c.bat.accent, skin: skinFor(x), hand: "R", helmet: false });
  }
  void ZERO;
  void time;
  return out;
}

/** Ball position in an actor's root-local frame (for glove targeting). */
function toLocal(b: THREE.Vector3, st: ActorState): THREE.Vector3 {
  const dx = b.x - st.p.x;
  const dz = b.z - st.p.z;
  const c = Math.cos(-st.yaw);
  const s = Math.sin(-st.yaw);
  // Inverse yaw rotation (local +Z forward, +X left).
  return new THREE.Vector3(dx * c + dz * s, b.y, -dx * s + dz * c);
}
