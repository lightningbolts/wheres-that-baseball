/**
 * Mutable playback state shared between the React game view and the per-frame
 * scene components (no React re-render per frame). The view swaps timelines and
 * sets cues; the Director advances T in useFrame.
 */
import type { Uniform } from "@/components/game/scene/character/uniforms";
import * as THREE from "three";
import { identity } from "@/components/game/scene/character/roster";
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
  /** 1 while the picture is covered (the dip of a broadcast cut, the inning bumper): nobody sees the scene. */
  curtain: 0 | 1;
  /** pb.now when a new half-inning's opening shot was asked for (the camera pushes in from wide); −1 = never. */
  introAt: number;
  /** Between plays: everyone walks from where the last play left him to where the next one needs him. */
  trans: Transition | null;
  /** Men with no part in what is on now (struck out, put out, scored), jogging off to the dugout. */
  leavers: Leaver[];
  /** Who was drawn last frame, and where (what a transition starts from). */
  seen: Map<string, Seen>;
}

/** One person as last drawn (reused from frame to frame). */
interface Seen {
  x: number;
  z: number;
  frame: number;
  gone: boolean;
  draw: ActorDraw;
}

/** Somebody on his way to a new spot: his drawn position is the track's plus what is left of the gap. */
interface Mover {
  fromX: number;
  fromZ: number;
  /** Seconds the walk takes; −1 until his destination is known. */
  dur: number;
  state: ActorState;
  /** Arrives already moving (a newcomer) rather than starting from rest. */
  easeOut: boolean;
}

/** Somebody the next play has no part for (struck out, put out, scored): he jogs off to the dugout. */
interface Leaver {
  draw: ActorDraw;
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
  /** pb.now he set off, and how long he is in view (s). */
  t0: number;
  dur: number;
}

export interface Transition {
  /** pb.now it began. */
  t0: number;
  /** The picture was cut (or covered) at the change: nobody walks across the field, people are simply there. */
  cut: boolean;
  /** New half-inning: the defense jogs out to its positions. */
  takeField: boolean;
  movers: Map<string, Mover>;
  /** Keys on the field when it began (anybody else is a newcomer). */
  known: Set<string>;
  /** Dugout side the offense comes from (world x); the defense takes the field from the other one. */
  dugX: number;
  /** The new cast has been drawn once. */
  resolved: boolean;
  /** How long the new batter takes to walk up to his box (s); 0 when the same man is still up. */
  walkUp: number;
  /** Longest walk still going (s); past it the transition is dropped. */
  until: number;
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
    curtain: 0,
    introAt: -1,
    trans: null,
    leavers: [],
    seen: new Map(),
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
const realSkin = new Map<number, THREE.Color>();
/** The player's own skin tone (sampled from his headshot) once the roster is in; a stand-in until then. */
export function skinFor(id: number): THREE.Color {
  const tone = id > 0 ? identity(id).skin : null;
  if (tone === null) return RUNNER_SKIN[Math.abs(id * 7919) % RUNNER_SKIN.length];
  let c = realSkin.get(id);
  if (!c || c.getHex() !== tone) {
    c = new THREE.Color(tone);
    realSkin.set(id, c);
  }
  return c;
}

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

/** Jog-off pace (ft/s): the same one the timeline uses for a man who has been put out. */
const JOG_FT_S = 13;
const DUGOUT_Z = -12;
/** How far outside his box a new batter is first seen, by camera (just off the edge of each shot). */
const ENTER_FT: Record<CamMode, number> = { batter: 11, pitcher: 21, broadcast: 30, follow: 20, overview: 20 };
/** Pace of a batter coming up to the plate (ft/s), and how long a man jogging off stays in the scene (s). */
const WALK_UP_FT_S = 17;
const LEAVE_S = 5;

/**
 * Start a between-plays transition: call it just before the cast or the timeline is
 * swapped. Everybody on screen then walks from where he stands to where the next play
 * puts him (instead of jumping there), the men with no part in it jog off, and a new
 * batter walks up. Across a cut nobody crosses the field; only the new arrivals walk in.
 */
export function beginTransition(pb: Playback, opts: { cut: boolean; takeField?: boolean }): void {
  // One that has not been on screen yet still stands (two changes in the same frame are one change).
  if (pb.trans && !pb.trans.resolved) {
    pb.trans.cut ||= opts.cut;
    pb.trans.takeField ||= !!opts.takeField;
    return;
  }
  if (opts.cut) pb.leavers.length = 0;
  const tr: Transition = {
    t0: pb.now,
    cut: opts.cut,
    takeField: !!opts.takeField,
    movers: new Map(),
    known: new Set(),
    dugX: pb.cast?.batterHand === "L" ? -60 : 60,
    resolved: false,
    until: 0.25,
    walkUp: 0,
  };
  for (const [key, s] of pb.seen) {
    if (s.frame < pb.frame - 1 || s.gone) continue;
    // A new half-inning has nine new fielders: all of them come on.
    if (tr.takeField && s.draw.pos) continue;
    tr.known.add(key);
    if (!tr.cut) tr.movers.set(key, { fromX: s.x, fromZ: s.z, dur: -1, state: still(s.x, s.z, 0, "ready"), easeOut: false });
  }
  pb.trans = tr;
}

/** Where a newcomer is first seen: a batter beside his box, a fielder short of his position. */
function entrance(pb: Playback, tr: Transition, d: ActorDraw): Mover | null {
  const p = d.state.p;
  if (d.kind === "batter") {
    const side = p.x >= 0 ? 1 : -1;
    const dist = tr.cut ? 9 : ENTER_FT[pb.cam];
    return { fromX: p.x + side * dist * 0.94, fromZ: p.z - dist * 0.34, dur: -1, state: still(p.x, p.z, 0, "run"), easeOut: true };
  }
  if (tr.takeField && d.pos) {
    const dx = -tr.dugX - p.x;
    const dz = DUGOUT_Z - p.z;
    const far = Math.max(1, Math.hypot(dx, dz));
    const dist = Math.min(22, 0.3 * far);
    return { fromX: p.x + (dx / far) * dist, fromZ: p.z + (dz / far) * dist, dur: -1, state: still(p.x, p.z, 0, "run"), easeOut: true };
  }
  return null;
}

/** Seconds until the batter walking up to the plate is set in the box (0 when nobody is on his way). */
export function walkUpLeft(pb: Playback): number {
  const tr = pb.trans;
  return tr ? Math.max(0, tr.walkUp - (pb.now - tr.t0)) : 0;
}

/** Put a drawn actor where the transition has him this frame (his track's state, unless he is still walking). */
function place(pb: Playback, tr: Transition, d: ActorDraw, el: number): void {
  let m = tr.movers.get(d.key);
  if (!m) {
    if (tr.known.has(d.key)) return;
    tr.known.add(d.key);
    const e = entrance(pb, tr, d);
    if (!e) return;
    m = e;
    tr.movers.set(d.key, m);
  }
  const base = d.state;
  const gx = m.fromX - base.p.x;
  const gz = m.fromZ - base.p.z;
  const gap = Math.hypot(gx, gz);
  if (m.dur < 0) {
    m.dur = gap < 0.5 ? 0 : m.easeOut ? gap / WALK_UP_FT_S + 0.2 : Math.min(1.7, Math.max(0.3, gap / 14));
    tr.until = Math.max(tr.until, m.dur);
    if (d.kind === "batter" && m.easeOut) tr.walkUp = m.dur;
  }
  if (el >= m.dur) return;
  const u = el / m.dur;
  // Newcomers arrive already moving and ease to a stop; everyone else starts from rest too.
  const left = m.easeOut ? (1 - u) * (1 - u) : 1 - u * u * (3 - 2 * u);
  const rate = (m.easeOut ? 2 * (1 - u) : 6 * u * (1 - u)) / m.dur;
  const st = m.state;
  const speed = gap * rate;
  st.p.x = base.p.x + gx * left;
  st.p.y = base.p.y;
  st.p.z = base.p.z + gz * left;
  st.speed = speed;
  st.action = speed > 3 ? "run" : base.action;
  st.actionT = base.actionT;
  st.yaw = speed > 2.5 ? Math.atan2(-gx, -gz) : base.yaw;
  d.state = st;
}

/** A man who was in the scene a frame ago and has no part in it now jogs off toward the dugout (he never just vanishes). */
function sendOff(pb: Playback, s: Seen): void {
  const dugX = pb.cast?.batterHand === "L" ? -60 : 60;
  const dx = dugX - s.x;
  const dz = DUGOUT_Z - s.z;
  const far = Math.hypot(dx, dz);
  if (far < 8) return;
  const yaw = Math.atan2(dx, dz);
  pb.leavers.push({ draw: { ...s.draw, kind: "runner", state: still(s.x, s.z, yaw, "run") }, x: s.x, z: s.z, dirX: dx / far, dirZ: dz / far, t0: pb.now, dur: Math.min(LEAVE_S, far / JOG_FT_S) });
}

/**
 * Everyone on the field at the current playback time (fielders, batter, runners,
 * umpire, coaches). The returned array and its entries are reused between calls.
 */
export function actorsAt(pb: Playback): ActorDraw[] {
  castAt(pb);
  let tr = pb.trans;
  const el = tr ? pb.now - tr.t0 : 0;
  if (tr && tr.resolved && el > tr.until) tr = pb.trans = null;
  const frame = pb.frame;
  const seen = pb.seen;
  for (let i = 0; i < list.length; i += 1) {
    const d = list[i];
    // Umpire and coaches stand where they stand.
    if (d.id === 0 && !d.pos) continue;
    if (tr) place(pb, tr, d, el);
    let s = seen.get(d.key);
    if (!s) {
      if (seen.size > 80) for (const [k, v] of seen) if (v.frame < frame - 1) seen.delete(k);
      s = { x: 0, z: 0, frame: -1, gone: false, draw: { ...d } };
      seen.set(d.key, s);
    }
    s.x = d.state.p.x;
    s.z = d.state.p.z;
    s.frame = frame;
    s.gone = d.state.action === "gone";
    const k = s.draw;
    k.key = d.key;
    k.kind = d.kind;
    k.jersey = d.jersey;
    k.accent = d.accent;
    k.uni = d.uni;
    k.skin = d.skin;
    k.hand = d.hand;
    k.helmet = d.helmet;
    k.pos = d.pos;
    k.id = d.id;
  }
  // Across a cut (or with the picture covered, or in fast-forward) people are simply gone.
  const quiet = pb.curtain === 1 || pb.turbo || (tr ? tr.cut && !tr.resolved : false);
  if (tr) tr.resolved = true;
  const leavers = pb.leavers;
  if (quiet) leavers.length = 0;
  else {
    for (const s of seen.values()) {
      if (s.frame !== frame - 1 || s.gone || leavers.length >= 4) continue;
      if (s.draw.kind === "batter" || s.draw.kind === "runner") sendOff(pb, s);
    }
  }
  for (let i = leavers.length - 1; i >= 0; i -= 1) {
    const l = leavers[i];
    const t = pb.now - l.t0;
    const back = seen.get(l.draw.key);
    if (t >= l.dur || (back && back.frame === frame)) {
      leavers.splice(i, 1);
      continue;
    }
    // Up to a jog over the first few steps, then steady.
    const tau = 0.3;
    const ramp = 1 - Math.exp(-t / tau);
    const dist = JOG_FT_S * (t - tau * ramp);
    const st = l.draw.state;
    st.p.x = l.x + l.dirX * dist;
    st.p.z = l.z + l.dirZ * dist;
    st.speed = JOG_FT_S * ramp;
    list.push(l.draw);
  }
  return list;
}

/** The cast on its tracks (or standing by), before any between-plays walking is applied. */
function castAt(pb: Playback): void {
  list.length = 0;
  const c = pb.cast;
  if (!c) return;
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
  }
  {
    for (const r of c.runners) {
      // A runner the play has no track for holds his base (he never just vanishes).
      if (!r || (tl && tl.runnerIds.includes(r.id))) continue;
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
}
