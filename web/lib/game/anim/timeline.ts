/**
 * Turn one committed pitch into a time-indexed animation: ball, fielders, runners,
 * batter and pitcher. Time T is pitch-flight time (0 = ball 50 ft from the plate);
 * the play after contact runs on T − contactT. Everything is derived from the
 * physics results — the animation never invents an outcome.
 *
 * Movement is authored as timed waypoints, then box-filtered in time so every
 * actor accelerates, decelerates and rounds corners instead of snapping between
 * constant-velocity legs. The filter is symmetric, so arrival times stay honest.
 */
import { add, clamp, horizDist, lerp3, scale, sub, v3, type V3 } from "@/lib/game/math";
import { pitchStateAt } from "@/lib/game/physics/pitch";
import { sampleAt, type BattedBallPath } from "@/lib/game/physics/battedBall";
import { BASE_POS } from "@/lib/game/play/movement";
import { idealContactTime } from "@/lib/game/engine/atBat";
import type { PlayEvent, PlayResult } from "@/lib/game/play/resolvePlay";
import type { CommittedPitch } from "@/lib/game/session/session";
import type { FieldPos } from "@/lib/game/types";

export type Action = "ready" | "idle" | "run" | "catch" | "field" | "throw" | "dive" | "pitch" | "swing" | "crouch" | "slide" | "stance" | "gone";

export interface ActorState {
  p: V3;
  /** Facing angle (rad) about +Y; 0 faces +Z (toward center field). */
  yaw: number;
  /** Ground speed ft/s (drives the run cycle). */
  speed: number;
  action: Action;
  /** Seconds since the action began (drives pose progress). */
  actionT: number;
}

export interface BallState {
  p: V3;
  visible: boolean;
  held: boolean;
  /** Who has the ball while it is held (the scene snaps it to that player's hand). */
  holder: FieldPos | null;
}

/** The batter's swing, for the pose solver: when it launches, when and where the barrel arrives. */
export interface SwingInfo {
  startT: number;
  contactT: number;
  /** World point the barrel passes through (the ball on contact; over/under it on a miss). */
  aim: V3;
  hit: boolean;
  bunt?: boolean;
}

export interface Waypoint {
  t: number;
  p: V3;
}

export interface Track {
  pts: Waypoint[];
  actions: Array<{ t: number; dur: number; action: Action }>;
  face?: V3;
  /** Timed facing changes (from `t` on, face `p`), e.g. a relay man turning to throw. */
  faces?: Array<{ t: number; p: V3 }>;
  /** Prefix integrals of x(t) / z(t) at each waypoint (built by finalize). */
  ix?: Float64Array;
  iz?: Float64Array;
}

export interface Timeline {
  /** Flight time the pitcher releases (negative: release is ~4 ft before the t=0 sample). */
  releaseT: number;
  /** World release point of the pitch. */
  releaseP: V3;
  /** Where and when the catcher receives a pitch that is not put in play. */
  receive: { t: number; p: V3 };
  /** Flight time of bat–ball contact (null = no contact). */
  contactT: number | null;
  /** Flight time of the swing (contact or miss), null for a take. */
  swingT: number | null;
  swing: SwingInfo | null;
  /** End of the animation, in flight time. */
  endT: number;
  /** Ball in play (vs. pitch / foul-back). */
  inPlay: boolean;
  ball(T: number): BallState;
  fielder(pos: FieldPos, T: number): ActorState;
  /** Runners and the batter-runner; ids from the play. */
  runnerIds: number[];
  batterId: number;
  runner(id: number, T: number): ActorState | null;
  batter(T: number): ActorState | null;
  /** Where a follow camera should look. */
  focus(T: number): V3;
}

export interface TimelineOptions {
  /** Flight time the swing launches (a human's button press); default is a fixed lead before contact. */
  swingStartT?: number;
}

const RELEASE_LEAD_FT = 4.3;
const MITT_Z = -1.7;
const HOLD_TYPES = new Set(["catch", "field", "dive", "error"]);
const LEADS: Record<number, number> = { 1: 12, 2: 15, 3: 10 };
const BATTER_BOX = (side: "L" | "R") => v3(side === "R" ? 2.7 : -2.7, 0, 0.5);

/** Half-width (s) of the box filter that turns waypoint legs into eased motion. */
export const SMOOTH_H = 0.2;
/** Fastest anybody is ever shown moving, ft/s. */
export const MAX_RUN_FT_S = 32;
/** Pitch delivery: seconds from first movement to release (matches the pitch pose). */
export const PITCH_RELEASE_S = 1.1;
/** Throw: seconds from the start of the throwing motion to release (matches the throw pose). */
export const THROW_RELEASE_S = 0.3;
/** Default launch-to-contact time of a swing. */
export const SWING_LAUNCH_S = 0.15;
/** The batter stays a batter (finishing the swing) this long after contact before running. */
export const BATTER_HANDOFF_S = 0.3;

function yawTo(from: V3, to: V3, fallback = 0): number {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  return Math.hypot(dx, dz) < 0.05 ? fallback : Math.atan2(dx, dz);
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/** Base-path distance → point (home → 1st → 2nd → 3rd → home). */
/**
 * A batted ball no one is holding, `u` s after contact. Once it leaves play it carries on
 * into the seats (the path's render-only tail) and stays put for `linger` s before a fan
 * has it, rather than freezing in mid-air at the wall.
 */
function looseBall(path: BattedBallPath, u: number, linger: number): BallState {
  if (u <= path.endT || !path.tail.length) {
    const s = sampleAt(path, Math.min(u, path.endT));
    const left = path.homeRun || path.outOfPlayFoul || path.groundRuleDouble;
    return { p: s.p, visible: !(left && !path.tail.length && u > path.endT + 0.6), held: false, holder: null };
  }
  const tail = path.tail;
  const last = tail[tail.length - 1];
  if (u >= last.t) return { p: last.p, visible: u < last.t + linger, held: false, holder: null };
  let a = { t: path.endT, p: sampleAt(path, path.endT).p };
  for (const s of tail) {
    if (s.t >= u) {
      const f = (u - a.t) / (s.t - a.t || 1);
      return { p: lerp3(a.p, s.p, f), visible: true, held: false, holder: null };
    }
    a = s;
  }
  return { p: last.p, visible: true, held: false, holder: null };
}

export function basePathPoint(s: number): V3 {
  const seg = clamp(Math.floor(s / 90), 0, 3);
  const f = clamp((s - seg * 90) / 90, 0, 1);
  const a = seg === 0 ? BASE_POS[4] : BASE_POS[seg as 1 | 2 | 3];
  const b = BASE_POS[(seg + 1) as 1 | 2 | 3 | 4];
  return lerp3(a, b, f);
}

const DIAMOND_C = { x: 0, z: 63.64 };

/** Unit normal of base-path leg `seg` pointing away from the infield. */
function outward(seg: number): { x: number; z: number } {
  const m = basePathPoint(seg * 90 + 45);
  const dx = m.x - DIAMOND_C.x;
  const dz = m.z - DIAMOND_C.z;
  const l = Math.hypot(dx, dz) || 1;
  return { x: dx / l, z: dz / l };
}

/**
 * A runner's actual route from startS to endS: on the base line, but swinging wide
 * before any base he rounds (the "banana" turn) and carrying a little wide after it.
 */
export function runPathPoint(s: number, startS: number, endS: number): V3 {
  const p = basePathPoint(s);
  for (const c of [90, 180, 270]) {
    if (!(startS < c - 25 && endS > c + 25)) continue;
    const d = s - c;
    if (d > -45 && d <= 0) {
      const u = (d + 45) / 45;
      const k = 5.5 * 6.75 * u * u * (1 - u);
      const n = outward(c / 90 - 1);
      p.x += n.x * k;
      p.z += n.z * k;
    } else if (d > 0 && d < 36) {
      const u = d / 36;
      const k = 3.2 * 6.75 * u * (1 - u) * (1 - u);
      const n = outward(c / 90);
      p.x += n.x * k;
      p.z += n.z * k;
    }
  }
  return p;
}

// ---------- Smoothed tracks ----------

function finalize(tr: Track): Track {
  const pts = tr.pts;
  pts.sort((a, b) => a.t - b.t);
  for (let i = 1; i < pts.length; i += 1) if (pts[i].t <= pts[i - 1].t) pts[i] = { t: pts[i - 1].t + 1e-3, p: pts[i].p };
  // Nobody outruns a sprinter. Arrival times are what sync with the ball, so a leg that is
  // too fast keeps its arrival and leaves earlier instead (a good jump, not a teleport).
  for (let i = pts.length - 1; i >= 2; i -= 1) {
    const need = Math.hypot(pts[i].p.x - pts[i - 1].p.x, pts[i].p.z - pts[i - 1].p.z) / MAX_RUN_FT_S;
    if (pts[i].t - pts[i - 1].t < need) pts[i - 1] = { t: Math.max(pts[0].t + 1e-3 * (i - 1), pts[i].t - need), p: pts[i - 1].p };
  }
  const ix = new Float64Array(pts.length);
  const iz = new Float64Array(pts.length);
  for (let i = 1; i < pts.length; i += 1) {
    const dt = pts[i].t - pts[i - 1].t;
    ix[i] = ix[i - 1] + (dt * (pts[i - 1].p.x + pts[i].p.x)) / 2;
    iz[i] = iz[i - 1] + (dt * (pts[i - 1].p.z + pts[i].p.z)) / 2;
  }
  tr.ix = ix;
  tr.iz = iz;
  return tr;
}

const _a = { x: 0, z: 0 };
const _b = { x: 0, z: 0 };

/** Raw (piecewise-linear) position at t; holds the end points outside the track. */
function rawAt(pts: Waypoint[], t: number, out: { x: number; z: number }): void {
  const n = pts.length;
  if (t <= pts[0].t) {
    out.x = pts[0].p.x;
    out.z = pts[0].p.z;
    return;
  }
  for (let i = 1; i < n; i += 1) {
    if (t < pts[i].t) {
      const a = pts[i - 1];
      const b = pts[i];
      const f = (t - a.t) / (b.t - a.t);
      out.x = a.p.x + (b.p.x - a.p.x) * f;
      out.z = a.p.z + (b.p.z - a.p.z) * f;
      return;
    }
  }
  out.x = pts[n - 1].p.x;
  out.z = pts[n - 1].p.z;
}

/** ∫ position dt from the first waypoint to t. */
function integralAt(tr: Track, t: number, out: { x: number; z: number }): void {
  const pts = tr.pts;
  const n = pts.length;
  const ix = tr.ix!;
  const iz = tr.iz!;
  if (t <= pts[0].t) {
    out.x = (t - pts[0].t) * pts[0].p.x;
    out.z = (t - pts[0].t) * pts[0].p.z;
    return;
  }
  for (let i = 1; i < n; i += 1) {
    if (t < pts[i].t) {
      const a = pts[i - 1];
      const b = pts[i];
      const dt = t - a.t;
      const f = dt / (b.t - a.t);
      out.x = ix[i - 1] + dt * (a.p.x + (b.p.x - a.p.x) * f * 0.5);
      out.z = iz[i - 1] + dt * (a.p.z + (b.p.z - a.p.z) * f * 0.5);
      return;
    }
  }
  out.x = ix[n - 1] + (t - pts[n - 1].t) * pts[n - 1].p.x;
  out.z = iz[n - 1] + (t - pts[n - 1].t) * pts[n - 1].p.z;
}

/**
 * Sample a track: position is the waypoint polyline averaged over ±SMOOTH_H, so
 * velocity is continuous (trapezoidal ramps), and its exact derivative gives speed
 * and heading.
 */
export function trackAt(tr: Track, t: number): ActorState {
  if (!tr.ix) finalize(tr);
  const h = SMOOTH_H;
  integralAt(tr, t + h, _a);
  integralAt(tr, t - h, _b);
  const p = v3((_a.x - _b.x) / (2 * h), 0, (_a.z - _b.z) / (2 * h));
  rawAt(tr.pts, t + h, _a);
  rawAt(tr.pts, t - h, _b);
  const vx = (_a.x - _b.x) / (2 * h);
  const vz = (_a.z - _b.z) / (2 * h);
  const speed = Math.hypot(vx, vz);
  // Default facing: toward the plate; a moving actor faces where he is going.
  const face = faceAt(tr, t);
  const faceYaw = face ? yawTo(p, face, Math.atan2(-p.x, -p.z)) : Math.atan2(-p.x, -p.z);
  const w = clamp((speed - 1) / 4, 0, 1);
  const yaw = w > 0 ? lerpAngle(faceYaw, Math.atan2(vx, vz), w * w * (3 - 2 * w)) : faceYaw;
  let action: Action = speed > 3 ? "run" : "ready";
  let actionT = 0;
  for (const a of tr.actions) {
    if (t >= a.t && t < a.t + a.dur) {
      action = a.action;
      actionT = t - a.t;
    }
  }
  return { p, yaw, speed, action, actionT };
}

function faceAt(tr: Track, t: number): V3 | undefined {
  let face = tr.face;
  if (tr.faces) for (const f of tr.faces) if (t >= f.t) face = f.p;
  return face;
}

function coverFor(base: number, thrower: FieldPos | undefined): FieldPos {
  if (base === 1) return thrower === "1B" ? "P" : "1B";
  if (base === 2) return thrower === "SS" || thrower === "3B" || thrower === "LF" ? "2B" : "SS";
  if (base === 3) return thrower === "3B" ? "SS" : "3B";
  return "C";
}

/** Route `tr` so the actor leaves in time to stand on `spot` at `arrive` (running ~24 ft/s). */
function routeTo(tr: Track, spot: V3, arrive: number, earliest: number): void {
  const last = tr.pts[tr.pts.length - 1];
  rawAt(tr.pts, arrive, _a);
  const d = Math.hypot(spot.x - _a.x, spot.z - _a.z);
  const leave = Math.max(earliest, arrive - d / 24 - 0.2);
  rawAt(tr.pts, leave, _a);
  const from = v3(_a.x, 0, _a.z);
  tr.pts = tr.pts.filter((w) => w.t < leave);
  if (!tr.pts.length) tr.pts.push({ t: Math.min(last.t, leave - 1), p: from });
  tr.pts.push({ t: leave, p: from }, { t: Math.max(arrive, leave + 0.05), p: spot });
}

/** How long the play stays on screen after it is decided by an out, s. */
export const OUT_HOLD_S = 0.75;

/**
 * Plays that end in outs don't wait for everyone to jog back: a third out ends the play
 * as soon as it is made, and an all-out play (no hit, run or error) as soon as the last
 * runner is retired or reaches his bag. Returns play-relative time, or Infinity.
 */
export function outPlayEnd(play: PlayResult, inningOver: boolean): number {
  const outs = play.runners.filter((r) => r.out);
  if (!outs.length) return Infinity;
  if (inningOver) return Math.max(...outs.map((r) => r.t)) + OUT_HOLD_S;
  if (play.hit > 0 || play.error || play.runs.length > 0) return Infinity;
  const moved = play.runners.filter((r) => r.out || r.to !== r.from);
  const decided = Math.max(...moved.map((r) => r.t));
  // A caught fly: the batter is out at the catch; runners just go back or tag.
  const catchT = play.caught ? (play.events.find((e) => e.type === "catch" || e.type === "dive")?.t ?? 0) : 0;
  return Math.max(decided, catchT) + OUT_HOLD_S;
}

export function buildTimeline(c: CommittedPitch, opts: TimelineOptions = {}): Timeline {
  const { result, play, fielders, runners, battingSide } = c;
  const flight = result.flight;
  const v0 = flight.samples[0].v;
  const releaseT = -RELEASE_LEAD_FT / Math.max(1, Math.abs(v0.z));
  const releaseP = add(flight.samples[0].p, scale(v0, releaseT));
  const swung = result.swing.swing && result.kind !== "hbp";
  const swingT = swung ? idealContactTime(flight) + clamp(result.swing.timingErrMs, -60, 45) / 1000 : null;
  const contactT = result.contactT != null && result.contact?.contact ? result.contactT : null;
  const path = result.path;
  const inPlay = result.kind === "in_play" && !!play && !play.foul;
  const crossT = flight.cross.t;
  const lastSample = flight.samples[flight.samples.length - 1];
  const events: PlayEvent[] = play ? [...play.events].sort((a, b) => a.t - b.t) : [];
  const toFlight = (u: number) => (contactT ?? 0) + u;
  // Steal attempts on this pitch, lead runner first (base = the bag he left: 0 = first …).
  const stealEvents = c.events
    .filter((e) => e.kind === "stolen_base" || e.kind === "caught_stealing")
    .sort((a, b) => (b.base ?? 0) - (a.base ?? 0));
  const stealEvent = stealEvents[0];
  const stealLead = stealEvent?.base ?? 0;

  // ---- The pitch past the plate: straight on into the catcher's mitt ----
  const pastZ = Math.max(1, Math.abs(lastSample.v.z));
  const mittT = lastSample.p.z > MITT_Z ? lastSample.t + (lastSample.p.z - MITT_Z) / pastZ : lastSample.t;
  const pitchAt = (T: number): V3 => {
    if (T <= lastSample.t) return pitchStateAt(flight, T).p;
    const dt = T - lastSample.t;
    return v3(lastSample.p.x + lastSample.v.x * dt, lastSample.p.y + lastSample.v.y * dt, lastSample.p.z + lastSample.v.z * dt);
  };
  const mittRaw = pitchAt(mittT);
  const mittP = v3(clamp(mittRaw.x, -2.6, 2.6), clamp(mittRaw.y, 0.45, 5.4), MITT_Z);

  // ---- Swing ----
  let swing: SwingInfo | null = null;
  if (swingT != null) {
    const at = pitchStateAt(flight, swingT).p;
    const hit = contactT != null;
    const miss = clamp(result.swing.verticalErrFt, -0.8, 0.8);
    // A whiff launched too late still shows a full (late) swing rather than snapping to its finish.
    const through = !hit && opts.swingStartT != null ? Math.max(swingT, opts.swingStartT + 0.07) : swingT;
    const bunt = !!result.bunt;
    // A bunter shows it as the pitcher comes set; a swing launches just before contact.
    const startT = bunt ? Math.min(releaseT - 0.15, swingT - 0.5) : clamp(opts.swingStartT ?? through - SWING_LAUNCH_S, through - 0.24, through - 0.06);
    swing = { startT, contactT: bunt ? swingT : through, aim: v3(at.x, bunt ? at.y : at.y - (hit ? 0 : miss), at.z), hit, bunt };
  }

  // ---- Ball after contact: gathered, then thrown around ----
  const firstThrow = events.find((e) => e.type === "throw");
  const holds = events.filter((e) => HOLD_TYPES.has(e.type) && e.pos && e.to && (!firstThrow || e.t <= firstThrow.t));
  const gather = play?.caught ? holds[0] : holds[holds.length - 1];
  const throws = events.filter((e) => e.type === "throw" && e.from && e.to && e.arriveT != null);
  const homeRun = !!path?.homeRun;
  // The sim takes a fly the moment it is catchable (up to ~9.5 ft); on screen the ball is let fall a
  // few hundredths more to a natural glove height, so a routine catch isn't a leap.
  let gatherT = gather?.t ?? 0;
  let gatherP = gather?.to ? add(gather.to, v3(0, 3, 0)) : v3(0, 3, 0);
  let gatherLead = v3(0, 0, 0);
  if (gather && path && play?.caught && gather.type !== "dive") {
    const landT = Math.min(path.firstLanding?.t ?? path.endT, path.wallT ?? Infinity);
    const s0 = sampleAt(path, Math.min(gather.t, path.endT));
    gatherP = s0.p;
    for (const s of path.samples) {
      if (s.t <= gather.t) continue;
      if (s.t >= landT || s.t > gather.t + 0.3 || s.phase !== "air") break;
      gatherT = s.t;
      gatherP = s.p;
      if (s.p.y <= 6.5) break;
    }
    const prev = sampleAt(path, Math.max(0, gatherT - 0.1));
    const dx = gatherP.x - prev.p.x;
    const dz = gatherP.z - prev.p.z;
    const n = Math.hypot(dx, dz);
    // He stands a step short of the ball's line and takes it out in front.
    if (n > 1e-3) gatherLead = v3((-dx / n) * 1.1, 0, (-dz / n) * 1.1);
  }
  const receiver = new Map<PlayEvent, FieldPos | null>();
  throws.forEach((th, i) => {
    const pos = th.receiver ?? (i === 0 ? coverFor(th.base ?? 1, th.pos) : coverFor(th.base ?? 1, undefined));
    receiver.set(th, pos === th.pos ? null : pos);
  });

  const ballInPlay = (u: number): BallState => {
    if (!path) return { p: mittP, visible: false, held: false, holder: null };
    if (!gather || u < gatherT) return looseBall(path, u, 3);
    let p = gatherP;
    let holder: FieldPos | null = gather.pos ?? null;
    for (const th of throws) {
      if (u < th.t) break;
      const from = add(th.from!, v3(0, 5.2, 0));
      const to = add(th.to!, v3(0, 4.2, 0));
      if (u >= th.arriveT!) {
        p = to;
        holder = receiver.get(th) ?? null;
        continue;
      }
      const f = (u - th.t) / Math.max(0.05, th.arriveT! - th.t);
      const d = horizDist(sub(th.to!, th.from!));
      const arc = 4 * f * (1 - f) * Math.min(28, d * 0.06);
      p = add(lerp3(from, to, f), v3(0, arc, 0));
      return { p, visible: true, held: false, holder: null };
    }
    return { p, visible: true, held: true, holder };
  };

  // Stolen-base attempt: the catcher comes up throwing to second.
  // The catcher throws on the lead runner (to second or third); a steal of home is a tag at the plate.
  const stealSafe = stealEvent?.kind === "stolen_base";
  const stealBase = (stealLead + 2) as 2 | 3 | 4;
  const stealThrow =
    stealEvent && stealLead < 2 && !inPlay && contactT == null
      ? { t: mittT + 0.72, arriveT: crossT + (stealLead === 0 ? (stealSafe ? 1.98 : 1.8) : stealSafe ? 1.72 : 1.56), to: stealBase as 2 | 3 }
      : null;
  const stealCover: FieldPos = stealLead === 1 ? "3B" : battingSide === "R" ? "2B" : "SS";

  const ball = (T: number): BallState => {
    if (T < releaseT) return { p: releaseP, visible: true, held: true, holder: "P" };
    if (contactT != null && T >= contactT) {
      if (result.kind === "foul_tip") return { p: mittP, visible: true, held: true, holder: "C" };
      if (inPlay) return ballInPlay(T - contactT);
      if (path) return looseBall(path, T - contactT, 1.2);
    }
    if (T < flight.samples[0].t) return { p: lerp3(releaseP, flight.samples[0].p, (T - releaseT) / -releaseT), visible: true, held: false, holder: null };
    if (result.kind === "hbp") return { p: pitchAt(Math.min(T, crossT)), visible: T < crossT + 0.5, held: false, holder: null };
    if (T < mittT) return { p: pitchAt(T), visible: true, held: false, holder: null };
    if (stealThrow && T >= stealThrow.t) {
      const from = v3(0, 5.2, -2.2);
      const to = add(BASE_POS[stealThrow.to], v3(0, 2.2, -1));
      if (T >= stealThrow.arriveT) return { p: to, visible: true, held: true, holder: stealCover };
      const f = (T - stealThrow.t) / (stealThrow.arriveT - stealThrow.t);
      return { p: add(lerp3(from, to, f), v3(0, 4 * f * (1 - f) * 5, 0)), visible: true, held: false, holder: null };
    }
    return { p: mittP, visible: true, held: true, holder: "C" };
  };
  // One ball lookup per frame is shared by every fielder's facing and the camera.
  let memoT = NaN;
  let memoBall: BallState | null = null;
  const ballMemo = (T: number): BallState => {
    if (T !== memoT || !memoBall) {
      memoT = T;
      memoBall = ball(T);
    }
    return memoBall;
  };

  // ---- Fielders ----
  const tracks = new Map<FieldPos, Track>();
  const landing = path?.firstLanding?.p ?? (path ? path.samples[path.samples.length - 1].p : v3(0, 0, 60));
  for (const f of fielders) {
    const start = f.p;
    const tr: Track = { pts: [{ t: -10, p: start }], actions: [], face: v3(0, 0, 0) };
    if (f.pos === "P") {
      tr.actions.push({ t: -10, dur: 10 + releaseT - PITCH_RELEASE_S, action: "idle" });
      tr.actions.push({ t: releaseT - PITCH_RELEASE_S, dur: PITCH_RELEASE_S + 0.9, action: "pitch" });
    }
    if (f.pos === "C") {
      tr.face = v3(0, 0, 60.5);
      const upAt = contactT != null && inPlay ? contactT + 0.35 : stealThrow ? stealThrow.t - THROW_RELEASE_S : Infinity;
      tr.actions.push({ t: -10, dur: upAt === Infinity ? 60 : 10 + upAt, action: "crouch" });
      if (stealThrow) {
        tr.actions.push({ t: stealThrow.t - THROW_RELEASE_S, dur: THROW_RELEASE_S + 0.5, action: "throw" });
        tr.face = BASE_POS[stealThrow.to];
      }
    }
    tracks.set(f.pos, tr);
  }
  if (stealThrow) {
    const tr = tracks.get(stealCover);
    if (tr) {
      const bag = BASE_POS[stealThrow.to];
      routeTo(tr, v3(bag.x + (stealThrow.to === 3 ? 1.5 : 0), 0, bag.z - 1.5), stealThrow.arriveT - 0.3, releaseT + 0.1);
      tr.actions.push({ t: stealThrow.arriveT - 0.5, dur: 1.1, action: "catch" });
      tr.face = v3(0, 0, 0);
    }
  }
  if (inPlay && contactT != null) {
    const fieldedBy = gather?.pos;
    const outfieldBall = fieldedBy === "LF" || fieldedBy === "CF" || fieldedBy === "RF";
    for (const f of fielders) {
      const tr = tracks.get(f.pos)!;
      tr.face = undefined;
      const react = toFlight(f.reaction);
      const pStart = tr.pts[tr.pts.length - 1].p;
      tr.pts.push({ t: Math.max(react, tr.pts[tr.pts.length - 1].t + 0.01), p: pStart });
      const myAttempts = holds.filter((h) => h.pos === f.pos);
      if (f.pos === fieldedBy && gather) {
        for (const h of myAttempts.filter((x) => x !== gather)) {
          tr.pts.push({ t: toFlight(h.t), p: v3(h.to!.x, 0, h.to!.z) });
          tr.actions.push({ t: toFlight(h.t) - 0.25, dur: 0.9, action: "dive" });
        }
        const gp = play?.caught && gather.type !== "dive" ? v3(gatherP.x + gatherLead.x, 0, gatherP.z + gatherLead.z) : v3(gather.to!.x, 0, gather.to!.z);
        tr.pts.push({ t: Math.max(toFlight(gatherT) - 0.05, tr.pts[tr.pts.length - 1].t + 0.05), p: gp });
        if (gather.type === "dive") tr.actions.push({ t: toFlight(gather.t) - 0.28, dur: 1.0, action: "dive" });
        else if (play?.caught) tr.actions.push({ t: toFlight(gatherT) - 0.7, dur: 1.15, action: "catch" });
        else tr.actions.push({ t: toFlight(gather.t) - 0.4, dur: 0.75, action: "field" });
        const myThrow = throws.find((th) => th.pos === f.pos);
        if (myThrow) {
          tr.actions.push({ t: toFlight(myThrow.t) - THROW_RELEASE_S, dur: THROW_RELEASE_S + 0.5, action: "throw" });
          tr.face = myThrow.to;
        }
      } else if (myAttempts.length) {
        const h = myAttempts[0];
        tr.pts.push({ t: toFlight(h.t), p: v3(h.to!.x, 0, h.to!.z) });
        tr.actions.push({ t: toFlight(h.t) - 0.25, dur: 1.0, action: "dive" });
      } else if (outfieldBall && (f.pos === "1B" || f.pos === "2B" || f.pos === "SS" || f.pos === "3B")) {
        // The ball is through to the outfield: infielders don't chase it, they take their
        // bases and the middle infielder on the ball's side goes out as the cutoff.
        const leftSide = landing.x > 0;
        const bag = (b: 1 | 2 | 3) => BASE_POS[b];
        let spot: V3;
        if (f.pos === "1B") spot = v3(bag(1).x + 2, 0, bag(1).z - 2);
        else if (f.pos === "3B") spot = v3(bag(3).x - 2, 0, bag(3).z - 2);
        else if ((f.pos === "SS") === leftSide) spot = lerp3(v3(bag(2).x, 0, bag(2).z), v3(landing.x, 0, landing.z), 0.38);
        else spot = v3(bag(2).x, 0, bag(2).z - 1.5);
        const d = Math.hypot(spot.x - pStart.x, spot.z - pStart.z);
        tr.pts.push({ t: react + 0.15 + d / 21, p: spot });
        tr.face = v3(landing.x, 0, landing.z);
      } else {
        // Back up the play: drift toward the ball, outfielders more.
        const k = f.pos === "LF" || f.pos === "CF" || f.pos === "RF" ? 0.35 : f.pos === "P" ? 0.15 : 0.08;
        const toward = lerp3(pStart, v3(landing.x, 0, landing.z), k);
        tr.pts.push({ t: react + 2.6, p: toward });
      }
    }
    // Covers for each throw (a relay pivot covers the base it then throws from).
    for (const th of throws) {
      const pos = receiver.get(th);
      const tr = pos ? tracks.get(pos) : undefined;
      if (!pos || !tr) continue;
      const base = th.base ?? 1;
      const bp = BASE_POS[base as 1 | 2 | 3 | 4];
      // A relay / cutoff man sets up on his spot in line, a beat early, facing the thrower.
      const spot = th.cutoff ? v3(th.to!.x, 0, th.to!.z) : v3(bp.x * 0.98, 0, bp.z * 0.98 + (base === 4 ? 1.5 : 0));
      const f = fielders.find((x) => x.pos === pos);
      routeTo(tr, spot, toFlight(th.arriveT!) - (th.cutoff ? 0.6 : 0.3), toFlight(f?.reaction ?? 0.3));
      tr.actions.push({ t: toFlight(th.arriveT!) - 0.55, dur: 1.0, action: "catch" });
      tr.face = th.from;
      tr.faces = undefined;
      const relay = throws.find((x) => x !== th && x.t > th.t && x.pos === pos);
      if (relay) {
        // Catch, turn, and throw on.
        tr.faces = [{ t: toFlight(th.arriveT!) + 0.1, p: relay.to! }];
        tr.actions.push({ t: toFlight(relay.t) - THROW_RELEASE_S, dur: THROW_RELEASE_S + 0.5, action: "throw" });
      }
    }
    // The cutoff man lines up in front of the plate on a throw home (the ball goes past him).
    for (const th of throws) {
      if (!th.lineup || [...receiver.values()].includes(th.lineup.pos)) continue;
      const tr = tracks.get(th.lineup.pos);
      const f = fielders.find((x) => x.pos === th.lineup!.pos);
      if (!tr) continue;
      routeTo(tr, v3(th.lineup.p.x, 0, th.lineup.p.z), toFlight(th.arriveT!) - 1.0, toFlight(f?.reaction ?? 0.3));
      tr.face = th.from;
    }
    // Doubled off by the fielder himself: he runs over and steps on the bag.
    if (play?.caught && gather?.pos) {
      for (const e of events) {
        if (e.type !== "force_out" || !e.base || throws.some((th) => th.base === e.base && th.arriveT! <= e.t + 0.01)) continue;
        const tr = tracks.get(gather.pos);
        if (!tr) continue;
        const bp = BASE_POS[e.base];
        routeTo(tr, v3(bp.x * 0.98, 0, bp.z * 0.98), toFlight(e.t), toFlight(gatherT) + 0.1);
        tr.face = undefined;
      }
    }
  }
  for (const tr of tracks.values()) finalize(tr);
  const fielder = (pos: FieldPos, T: number): ActorState => {
    const tr = tracks.get(pos);
    if (!tr) return { p: v3(0, 0, 0), yaw: 0, speed: 0, action: "gone", actionT: 0 };
    const st = trackAt(tr, T);
    // During a live play, idle fielders watch the ball.
    if (inPlay && contactT != null && T > contactT && !tr.face && st.speed < 5) {
      const b = ballMemo(T).p;
      const w = 1 - clamp((st.speed - 1) / 4, 0, 1);
      st.yaw = lerpAngle(st.yaw, yawTo(st.p, b, st.yaw), w);
    }
    return st;
  };

  // ---- Runners (and the batter-runner) ----
  const runTracks = new Map<number, Track & { goneAt: number; from: number }>();
  const runnerIds: number[] = [];
  const sprintOf = new Map<number, number>();
  for (const r of runners) if (r) sprintOf.set(r.playerId, r.sprint);
  const batterId = c.ctx.batter.id;
  sprintOf.set(batterId, c.ctx.batter.sprint);
  const baseFace = (s: number) => basePathPoint(Math.min(360, s + 30));
  const batterBox = BATTER_BOX(battingSide);
  const dugout = v3(battingSide === "R" ? 60 : -60, 0, -12);
  /** Lead-off choreography shared by every pitch, so swapping timelines never moves a runner. */
  const leadS = (base: number) => base * 90 + (LEADS[base] ?? 10) * 0.5;
  const leadPts = (base: number): Waypoint[] => [
    { t: -10, p: basePathPoint(base * 90) },
    { t: releaseT - 1.2, p: basePathPoint(base * 90) },
    { t: releaseT - 0.2, p: basePathPoint(leadS(base)) },
    { t: crossT, p: basePathPoint(leadS(base) + 4) },
  ];
  if (inPlay && play && contactT != null) {
    for (const ro of play.runners) {
      const sprint = sprintOf.get(ro.playerId) ?? 27;
      if (ro.path?.length && ro.from > 0) {
        // Scripted route (tagging up, holding halfway, frozen on a liner), then the last leg.
        const t0 = contactT;
        const pts: Waypoint[] = leadPts(ro.from).filter((w) => w.t < t0);
        let lastS = leadS(ro.from) + 4;
        let lastT = t0;
        pts.push({ t: t0, p: basePathPoint(lastS) });
        const leg = (s1: number, t1: number) => {
          const d = Math.abs(s1 - lastS);
          const tA = Math.max(t1, lastT + Math.max(0.05, d / MAX_RUN_FT_S));
          const steps = Math.max(1, Math.ceil(d / 7.5));
          for (let i = 1; i <= steps; i += 1) {
            const f = i / steps;
            pts.push({ t: lastT + (tA - lastT) * f, p: basePathPoint(lastS + (s1 - lastS) * f) });
          }
          lastS = s1;
          lastT = tA;
        };
        for (const w of ro.path) leg(w.s, toFlight(w.t));
        const v = sprint * 0.93;
        const dir = Math.sign(ro.to * 90 - lastS) || 1;
        const shortFt = ro.out ? clamp(((ro.arriveT ?? ro.t) - ro.t) * v, 2, 60) : 0;
        const endS = ro.to * 90 - dir * shortFt;
        leg(endS, toFlight(ro.t));
        const tEnd = lastT;
        const actions: Track["actions"] = [];
        const moved = Math.abs(endS - ro.from * 90) > 20;
        // Slide into a contested bag ahead; dive back into his own on a close one.
        if (moved && (ro.out || throws.some((th) => th.base === ro.to && !th.cutoff))) actions.push({ t: tEnd - 0.32, dur: 0.95, action: "slide" });
        else if (ro.to === ro.from && (ro.out || throws.some((th) => th.base === ro.to && !th.cutoff && Math.abs(toFlight(th.arriveT!) - tEnd) < 0.5))) {
          actions.push({ t: tEnd - 0.32, dur: 0.95, action: "slide" });
        }
        if (ro.out || ro.to === 4) {
          const at = pts[pts.length - 1].p;
          const dd = Math.max(1, Math.hypot(dugout.x - at.x, dugout.z - at.z));
          const wait = ro.out ? 0.7 : 0.05;
          const jog = Math.min(dd, 16);
          pts.push({ t: tEnd + wait, p: at });
          pts.push({ t: tEnd + wait + jog / 13, p: lerp3(at, dugout, jog / dd) });
        }
        runTracks.set(ro.playerId, { pts, actions, face: baseFace(ro.to * 90), goneAt: Infinity, from: ro.from });
        runnerIds.push(ro.playerId);
        continue;
      }
      const startS = ro.from === 0 ? 0 : leadS(ro.from) + 4;
      const v = homeRun ? 19 : sprint * 0.93;
      // Put out: draw him where he really was when the ball (or tag) beat him — a runner who
      // lost the race by 0.3 s is a long stride and a half from the bag, not on it.
      const shortFt = ro.out ? clamp(((ro.arriveT ?? ro.t) - ro.t) * v, 3, 60) : 0;
      const endS = ro.to === ro.from ? ro.from * 90 : ro.out ? Math.max(startS + 2, ro.to * 90 - shortFt) : ro.to * 90;
      const d = Math.abs(endS - startS);
      // Forced out at first: he keeps running, through the bag, after the out.
      const runThrough = ro.out && ro.from === 0 && ro.to === 1 && shortFt < 40;
      let tEnd = homeRun ? toFlight(1.2 + (ro.to * 90 - startS) / v + ro.from * 0.4) : toFlight(ro.t);
      let tStart = tEnd - d / v - 0.35;
      const minStart = toFlight(ro.from === 0 ? BATTER_HANDOFF_S : 0.1);
      if (tStart < minStart) {
        tStart = minStart;
        tEnd = Math.max(tEnd, tStart + d / 32);
      } else if (ro.from === 0 && !homeRun && tStart - minStart < 0.9 && d / (tEnd - minStart) > v * 0.75) {
        // The batter-runner breaks out of the box on contact rather than standing to watch.
        tStart = minStart;
      }
      const pts: Waypoint[] = ro.from === 0 ? [{ t: -10, p: batterBox }] : leadPts(ro.from).filter((w) => w.t < tStart);
      if (ro.from === 0) pts.push({ t: tStart, p: batterBox });
      else pts.push({ t: tStart, p: basePathPoint(startS) });
      const steps = Math.max(2, Math.ceil(d / 7.5));
      for (let i = 1; i <= steps; i += 1) {
        const f = i / steps;
        const s = startS + (endS - startS) * f;
        pts.push({ t: tStart + (tEnd - tStart) * f, p: endS >= startS ? runPathPoint(s, startS, endS) : basePathPoint(s) });
      }
      const actions: Track["actions"] = [];
      // Slide into any base where there is a play on the runner (never into first).
      const playAtBase = throws.some((th) => th.base === ro.to && !th.cutoff);
      if (!homeRun && d > 20 && ro.to !== 1 && (ro.out || playAtBase)) actions.push({ t: tEnd - 0.32, dur: 0.95, action: "slide" });
      if (runThrough) {
        const tBag = tEnd + (90 - endS) / v;
        pts.push({ t: tBag, p: basePathPoint(90) });
        // Down the line in foul ground, not toward second, easing up as he goes.
        const line = (s: number) => lerp3(BASE_POS[4], BASE_POS[1], s / 90);
        pts.push({ t: tBag + 9 / v, p: line(99) });
        pts.push({ t: tBag + 9 / v + 0.55, p: line(104) });
        pts.push({ t: tBag + 9 / v + 1.25, p: line(106.5) });
      }
      if (ro.out || ro.to === 4) {
        // Jog off toward the dugout; he leaves the scene when the next pitch is set up.
        const at = pts[pts.length - 1].p;
        const dd = Math.max(1, Math.hypot(dugout.x - at.x, dugout.z - at.z));
        const wait = ro.out ? 0.7 : 0.05;
        const jog = Math.min(dd, 16);
        const t0 = Math.max(tEnd, pts[pts.length - 1].t);
        pts.push({ t: t0 + wait, p: at });
        pts.push({ t: t0 + wait + jog / 13, p: lerp3(at, dugout, jog / dd) });
      }
      runTracks.set(ro.playerId, { pts, actions, face: baseFace(endS), goneAt: Infinity, from: ro.from });
      runnerIds.push(ro.playerId);
    }
  } else {
    runners.forEach((r, i) => {
      if (!r) return;
      const base = i + 1;
      const pts = leadPts(base);
      const actions: Track["actions"] = [];
      let goneAt = Infinity;
      const se = stealEvents.find((e) => (e.base ?? 0) === i);
      if (se) {
        const safe = se.kind === "stolen_base";
        const lead = se === stealEvent;
        // Lead runner: at the bag with the throw (or the pitch, stealing home); trailers a beat sooner.
        const atBag = i === 2 ? crossT + (safe ? 1.5 : 0.75) : stealThrow ? stealThrow.arriveT + (lead ? -0.08 : -0.3) : crossT + 1.6;
        const bagS = (base + 1) * 90;
        pts.length = 2;
        pts.push({ t: releaseT - 0.35, p: basePathPoint(leadS(base) + 3) });
        pts.push({ t: atBag, p: basePathPoint(safe ? bagS : bagS - (i === 2 ? 14 : 3)) });
        if (safe || i < 2) actions.push({ t: atBag - 0.32, dur: 0.95, action: "slide" });
        if (!safe) goneAt = atBag + 1.7;
        else if (i === 2) goneAt = atBag + 1.4;
      } else {
        pts.push({ t: crossT + 1.15, p: basePathPoint(base * 90) });
      }
      runTracks.set(r.playerId, { pts, actions, face: baseFace(base * 90), goneAt, from: base });
      runnerIds.push(r.playerId);
    });
  }
  for (const tr of runTracks.values()) finalize(tr);
  const handoffT = inPlay && contactT != null ? contactT + BATTER_HANDOFF_S : Infinity;
  const runner = (id: number, T: number): ActorState | null => {
    const tr = runTracks.get(id);
    if (!tr) return null;
    if (T > tr.goneAt) return null;
    // The batter-runner only exists once the batter has finished his swing.
    if (tr.from === 0 && T <= handoffT) return null;
    return trackAt(tr, T);
  };

  const batter = (T: number): ActorState | null => {
    if (T > handoffT) return null;
    const yaw = battingSide === "R" ? -Math.PI / 2 : Math.PI / 2;
    if (swing && T >= swing.startT) return { p: batterBox, yaw, speed: 0, action: "swing", actionT: T - swing.startT };
    return { p: batterBox, yaw, speed: 0, action: "stance", actionT: T - releaseT };
  };

  // ---- Timing ----
  let endT = crossT + 1.3;
  if (stealEvent) endT = crossT + 3.2;
  if (contactT != null && path && !inPlay) endT = contactT + Math.min(3, Math.max(path.endT + 0.4, Math.min((path.tail.at(-1)?.t ?? 0) + 0.3, path.endT + 1.2)));
  if (result.kind === "foul_tip") endT = crossT + 1.2;
  if (inPlay && play && contactT != null) {
    let last = play.endT + 1.2;
    for (const tr of runTracks.values()) last = Math.max(last, tr.pts[tr.pts.length - 1].t - contactT + 0.4);
    if (homeRun) last = Math.max(last, path!.endT + 1.5, (path!.tail.at(-1)?.t ?? 0) + 0.6);
    // Outs move on, but safe runners still get to their bags first — unless the third
    // out has already ended the half, when nobody's trip to a base counts any more.
    const halfOver = c.events.some((e) => e.kind === "inning_end" || e.kind === "game_over");
    let safeEnd = 0;
    if (!halfOver) for (const ro of play.runners) {
      const tr = runTracks.get(ro.playerId);
      if (tr && !ro.out && ro.to !== 4) safeEnd = Math.max(safeEnd, tr.pts[tr.pts.length - 1].t - contactT + 0.25);
    }
    last = Math.min(last, Math.max(safeEnd, outPlayEnd(play, halfOver)));
    endT = contactT + Math.min(last, 24);
  }

  const focus = (T: number): V3 => {
    const b = ballMemo(T);
    if (!inPlay || contactT == null) return b.p;
    // Home run: follow the ball into the seats, then ease over to the trot.
    if (homeRun && path) {
      const restT = path.tail.length ? path.tail[path.tail.length - 1].t : path.endT;
      const k = clamp((T - toFlight(Math.min(restT, path.endT + 1.2) + 0.2)) / 1.1, 0, 1);
      const br = k > 0 ? runner(batterId, T) : null;
      if (br) return lerp3(b.p, br.p, k * k * (3 - 2 * k));
    }
    if (!b.held) return b.p;
    // Ball held: frame the lead runner still moving, else the ball.
    let lead: V3 | null = null;
    for (const id of runnerIds) {
      const r = runner(id, T);
      if (r && r.speed > 4) lead = r.p;
    }
    return lead ? lerp3(b.p, lead, 0.5) : b.p;
  };

  return {
    releaseT,
    releaseP,
    receive: { t: mittT, p: mittP },
    contactT,
    swingT,
    swing,
    endT,
    inPlay,
    ball: ballMemo,
    fielder,
    runnerIds,
    batterId,
    runner,
    batter,
    focus,
  };
}
