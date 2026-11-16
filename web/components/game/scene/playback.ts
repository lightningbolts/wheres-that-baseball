/**
 * Mutable playback state shared between the React game view and the per-frame
 * scene components (no React re-render per frame). The view swaps timelines and
 * sets cues; the Director advances T in useFrame.
 */
import type { Uniform } from "@/components/game/scene/character/uniforms";
import * as THREE from "three";
import type { Timeline, ActorState } from "@/lib/game/anim/timeline";
import type { FieldPos } from "@/lib/game/types";
import type { ActorDraw } from "@/components/game/scene/rig";

export type CamMode = "batter" | "pitcher" | "broadcast" | "follow" | "overview";

export interface Cue {
  T: number;
  fn: () => void;
  done?: boolean;
  /** Land playback exactly on this cue's time for one frame (contact, catches). */
  snap?: boolean;
}

export interface Cast {
  /** Uniform colors for the fielding / batting team. */
  field: { jersey: THREE.Color; accent: THREE.Color; uni?: Uniform };
  bat: { jersey: THREE.Color; accent: THREE.Color; uni?: Uniform };
  pitcherHand: "L" | "R";
  batterHand: "L" | "R";
  /** Standby positions (between pitches). */
  fielders: Array<{ pos: FieldPos; p: { x: number; y: number; z: number }; id: number }>;
  runners: Array<{ id: number; base: 1 | 2 | 3 } | null>;
  batterId: number;
}

/** Where a ball held by this player sits this frame (written by Players, read by Ball). */
export interface Hands {
  ballP: THREE.Vector3;
  frame: number;
}

/** Short-lived, purely visual effects. */
export interface Fx {
  /** Camera shake amplitude (ft), decays on its own. */
  shake: number;
  /** FOV punch (0..1), decays on its own. */
  punch: number;
  /** Contact flash: real seconds since it fired (negative = idle), where, and how big. */
  flashAge: number;
  flashP: THREE.Vector3;
  flashPower: number;
  /** pb.now when the umpire last rang up a strike (−1 = never). */
  umpCallAt: number;
}

export interface Playback {
  timeline: Timeline | null;
  T: number;
  /** Seconds of timeline per real second, outside the slow-motion window. */
  rate: number;
  /** Optional slow-mo window (flight time) and its rate. */
  slow: { from: number; to: number; rate: number } | null;
  /** The rate actually applied this frame (eased toward the target rate). */
  rateNow: number;
  /** Real seconds of hit-stop left: playback all but freezes on contact. */
  hitstop: number;
  /** Timeline seconds advanced by the last frame (0 while paused / idle). */
  dT: number;
  /** Real seconds since the scene started; never pauses. */
  now: number;
  frame: number;
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
  fx: Fx;
  hands: Map<string, Hands>;
  /** Bumped on every camera cut: the scene snaps animation state instead of blending across it. */
  cutSeq: number;
}

export function createPlayback(): Playback {
  return {
    timeline: null,
    T: 0,
    rate: 1,
    slow: null,
    rateNow: 1,
    hitstop: 0,
    dT: 0,
    now: 0,
    frame: 0,
    paused: false,
    cues: [],
    onEnd: null,
    cam: "broadcast",
    cast: null,
    turbo: false,
    aim: { px: 0, pz: 2.5, visible: false, kind: "pci", w: 0.5, h: 0.36, zoneBottom: 1.6, zoneTop: 3.4, showZone: false },
    lastPitch: null,
    fx: { shake: 0, punch: 0, flashAge: -1, flashP: new THREE.Vector3(), flashPower: 0, umpCallAt: -1 },
    hands: new Map(),
    cutSeq: 0,
  };
}

/** Rate eases toward its target with this time constant (real s), so slow-mo never snaps. */
const RATE_TAU = 0.085;
const HITSTOP_RATE = 0.03;
/** Longest real frame the simulation will swallow in one step (tab switches, GC pauses). */
export const MAX_FRAME_DT = 1 / 20;

/**
 * Advance playback by one real frame: ease the rate, apply hit-stop, fire cues in
 * order and finish the timeline. The scene's Director calls this every frame.
 */
export function advancePlayback(pb: Playback, rawDt: number): void {
  const dt = Math.min(Math.max(rawDt, 0), MAX_FRAME_DT);
  pb.now += dt;
  pb.frame += 1;
  pb.dT = 0;
  const fx = pb.fx;
  fx.shake *= Math.exp(-dt / 0.11);
  fx.punch *= Math.exp(-dt / 0.2);
  if (fx.flashAge >= 0) fx.flashAge += dt;
  const tl = pb.timeline;
  if (!tl || pb.paused) return;
  let target = pb.rate;
  if (pb.slow && pb.T >= pb.slow.from && pb.T < pb.slow.to) target = pb.slow.rate;
  pb.rateNow += (target - pb.rateNow) * (1 - Math.exp(-dt / RATE_TAU));
  let rate = pb.rateNow;
  if (pb.turbo) rate = Math.max(rate, pb.rate) * 4;
  else if (pb.hitstop > 0) {
    pb.hitstop -= dt;
    rate *= HITSTOP_RATE;
  }
  const from = pb.T;
  let to = from + dt * rate;
  // Land exactly on a snap cue so the frame it fires on shows that instant.
  if (!pb.turbo) for (const c of pb.cues) if (c.snap && !c.done && c.T > from && c.T < to) to = c.T;
  pb.T = to;
  pb.dT = to - from;
  for (const c of pb.cues) {
    if (!c.done && pb.T >= c.T) {
      c.done = true;
      c.fn();
      if (pb.paused) return;
    }
  }
  // A cue may have swapped the timeline; always test the one now playing.
  const cur = pb.timeline;
  if (cur && pb.T >= cur.endT && pb.onEnd) {
    const end = pb.onEnd;
    pb.onEnd = null;
    end();
  }
}

const RUNNER_SKIN = ["#e8c4a0", "#c99a74", "#8d5a3b", "#5e3b26", "#f1d3b5", "#a87454"].map((c) => new THREE.Color(c));
export const skinFor = (id: number) => RUNNER_SKIN[Math.abs(id * 7919) % RUNNER_SKIN.length];

const UMP = { jersey: new THREE.Color("#1d2026"), accent: new THREE.Color("#2a2d35") };
const FIELD_KEYS: Record<FieldPos, string> = { P: "f-P", C: "f-C", "1B": "f-1B", "2B": "f-2B", "3B": "f-3B", SS: "f-SS", LF: "f-LF", CF: "f-CF", RF: "f-RF" };
export const fielderKey = (pos: FieldPos) => FIELD_KEYS[pos];
const runnerKeys = new Map<number, string>();
/** A player keeps one key as batter and as runner, so his animation state carries over. */
export function runnerKey(id: number): string {
  let k = runnerKeys.get(id);
  if (!k) {
    if (runnerKeys.size > 400) runnerKeys.clear();
    k = `r-${id}`;
    runnerKeys.set(id, k);
  }
  return k;
}

const BASE_XZ = [
  { x: -63.64, z: 63.64 },
  { x: 0, z: 127.28 },
  { x: 63.64, z: 63.64 },
];

function still(x: number, z: number, yaw: number, action: ActorState["action"], actionT = 0): ActorState {
  return { p: { x, y: 0, z }, yaw, speed: 0, action, actionT };
}
const UMP_STATE = still(0.45, -5.9, 0, "crouch");
const COACH_STATES = [still(-82, 48, Math.atan2(82, -8), "idle"), still(82, 48, Math.atan2(-82, -8), "idle")];
const COACH_KEYS = ["c1", "c3"];
const COACH_SKIN = [skinFor(-82), skinFor(82)];

// Pooled draw list: the scene asks for it every frame.
const pool: ActorDraw[] = [];
const list: ActorDraw[] = [];
function draw(i: number): ActorDraw {
  let d = pool[i];
  if (!d) {
    d = { key: "", state: UMP_STATE, kind: "fielder", jersey: UMP.jersey, accent: UMP.accent, skin: RUNNER_SKIN[0], hand: "R", helmet: false, pos: null, id: 0 };
    pool[i] = d;
  }
  return d;
}
const standby = new Map<string, ActorState>();
function standbyState(key: string, x: number, z: number, yaw: number, action: ActorState["action"]): ActorState {
  let s = standby.get(key);
  if (!s) {
    if (standby.size > 400) standby.clear();
    s = still(x, z, yaw, action, -10);
    standby.set(key, s);
  }
  s.p.x = x;
  s.p.z = z;
  s.yaw = yaw;
  s.action = action;
  return s;
}

/**
 * Everyone on the field at the current playback time (fielders, batter, runners,
 * umpire, coaches). The returned array and its entries are reused between calls.
 */
export function actorsAt(pb: Playback): ActorDraw[] {
  list.length = 0;
  const c = pb.cast;
  if (!c) return list;
  const tl = pb.timeline;
  const T = pb.T;
  let n = 0;
  for (const f of c.fielders) {
    const d = draw(n);
    n += 1;
    d.key = FIELD_KEYS[f.pos];
    d.state = tl
      ? tl.fielder(f.pos, T)
      : standbyState(d.key, f.p.x, f.p.z, f.pos === "C" ? 0 : Math.atan2(-f.p.x, -f.p.z), f.pos === "C" ? "crouch" : f.pos === "P" ? "idle" : "ready");
    d.kind = f.pos === "C" ? "catcher" : f.pos === "P" ? "pitcher" : "fielder";
    d.jersey = c.field.jersey;
    d.accent = c.field.accent;
    d.uni = c.field.uni ?? null;
    d.skin = skinFor(f.id);
    d.id = f.id;
    d.hand = f.pos === "P" ? c.pitcherHand : "R";
    d.helmet = false;
    d.pos = f.pos;
    list.push(d);
  }
  // Batter (once the ball is in play he becomes the batter-runner, same key).
  const bSide = c.batterHand;
  const bKey = runnerKey(c.batterId);
  const bState = tl ? tl.batter(T) : standbyState(bKey, bSide === "R" ? 2.7 : -2.7, 0.5, bSide === "R" ? -Math.PI / 2 : Math.PI / 2, "stance");
  if (bState) {
    const d = draw(n);
    n += 1;
    d.key = bKey;
    d.state = bState;
    d.kind = "batter";
    d.jersey = c.bat.jersey;
    d.accent = c.bat.accent;
    d.uni = c.bat.uni ?? null;
    d.skin = skinFor(c.batterId);
    d.id = c.batterId;
    d.hand = bSide;
    d.helmet = true;
    d.pos = null;
    list.push(d);
  }
  // Runners
  if (tl) {
    for (const id of tl.runnerIds) {
      const st = tl.runner(id, T);
      if (!st) continue;
      const d = draw(n);
      n += 1;
      d.key = runnerKey(id);
      d.state = st;
      d.kind = "runner";
      d.jersey = c.bat.jersey;
      d.accent = c.bat.accent;
      d.uni = c.bat.uni ?? null;
      d.skin = skinFor(id);
      d.id = id;
      d.hand = "R";
      d.helmet = true;
      d.pos = null;
      list.push(d);
    }
  } else {
    for (const r of c.runners) {
      if (!r) continue;
      const bp = BASE_XZ[r.base - 1];
      const d = draw(n);
      n += 1;
      d.key = runnerKey(r.id);
      d.state = standbyState(d.key, bp.x, bp.z, Math.atan2(-bp.x, -bp.z), "ready");
      d.kind = "runner";
      d.jersey = c.bat.jersey;
      d.accent = c.bat.accent;
      d.uni = c.bat.uni ?? null;
      d.skin = skinFor(r.id);
      d.id = r.id;
      d.hand = "R";
      d.helmet = true;
      d.pos = null;
      list.push(d);
    }
  }
  // Home-plate umpire (not from the catcher cam, which looks over his shoulder) and base coaches.
  if (pb.cam !== "batter") {
    const u = draw(n);
    n += 1;
    u.key = "ump";
    u.state = UMP_STATE;
    u.kind = "umpire";
    u.jersey = UMP.jersey;
    u.accent = UMP.accent;
    u.uni = null;
    u.skin = skinFor(3);
    u.id = 0;
    u.hand = "R";
    u.helmet = false;
    u.pos = null;
    list.push(u);
  }
  for (let i = 0; i < 2; i += 1) {
    const d = draw(n);
    n += 1;
    d.key = COACH_KEYS[i];
    d.state = COACH_STATES[i];
    d.kind = "coach";
    d.jersey = c.bat.jersey;
    d.accent = c.bat.accent;
    d.uni = c.bat.uni ?? null;
    d.skin = COACH_SKIN[i];
    d.id = 0;
    d.hand = "R";
    d.helmet = false;
    d.pos = null;
    list.push(d);
  }
  return list;
}
