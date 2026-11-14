/**
 * Turn one committed pitch into a time-indexed animation: ball, fielders, runners,
 * batter and pitcher. Time T is pitch-flight time (0 = ball 50 ft from the plate);
 * the play after contact runs on T − contactT. Everything is derived from the
 * physics results — the animation never invents an outcome.
 */
import { add, clamp, horizDist, lerp3, scale, sub, v3, type V3 } from "@/lib/game/math";
import { pitchStateAt } from "@/lib/game/physics/pitch";
import { sampleAt } from "@/lib/game/physics/battedBall";
import { BASE_POS } from "@/lib/game/play/movement";
import { idealContactTime } from "@/lib/game/engine/atBat";
import type { PlayEvent } from "@/lib/game/play/resolvePlay";
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
}

interface Waypoint {
  t: number;
  p: V3;
}

interface Track {
  pts: Waypoint[];
  actions: Array<{ t: number; dur: number; action: Action }>;
  face?: V3;
}

export interface Timeline {
  /** Flight time the pitcher releases (negative: release is ~4 ft before the t=0 sample). */
  releaseT: number;
  /** Flight time of bat–ball contact (null = no contact). */
  contactT: number | null;
  /** Flight time of the swing (contact or miss), null for a take. */
  swingT: number | null;
  /** End of the animation, in flight time. */
  endT: number;
  /** Ball in play (vs. pitch / foul-back). */
  inPlay: boolean;
  ball(T: number): BallState;
  fielder(pos: FieldPos, T: number): ActorState;
  /** Runners and the batter-runner; ids from the play. */
  runnerIds: number[];
  runner(id: number, T: number): ActorState | null;
  batter(T: number): ActorState | null;
  /** Where a follow camera should look. */
  focus(T: number): V3;
}

const RELEASE_LEAD_FT = 4.3;
const MITT = v3(0, 2.4, -1.6);
const HOLD_TYPES = new Set(["catch", "field", "dive", "error"]);
const LEADS: Record<number, number> = { 1: 12, 2: 15, 3: 10 };
const BATTER_BOX = (side: "L" | "R") => v3(side === "R" ? 2.7 : -2.7, 0, 0.5);

function yawTo(from: V3, to: V3, fallback = 0): number {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  return Math.hypot(dx, dz) < 0.05 ? fallback : Math.atan2(dx, dz);
}

/** Base-path distance → point (home → 1st → 2nd → 3rd → home). */
export function basePathPoint(s: number): V3 {
  const seg = clamp(Math.floor(s / 90), 0, 3);
  const f = clamp((s - seg * 90) / 90, 0, 1);
  const a = seg === 0 ? BASE_POS[4] : BASE_POS[seg as 1 | 2 | 3];
  const b = BASE_POS[(seg + 1) as 1 | 2 | 3 | 4];
  return lerp3(a, b, f);
}

function trackAt(tr: Track, t: number, home: V3): ActorState {
  const pts = tr.pts;
  let p = pts[0].p;
  let speed = 0;
  let yaw = tr.face ? yawTo(pts[0].p, tr.face) : yawTo(home, v3(0, 0, 0)) + Math.PI;
  if (t >= pts[pts.length - 1].t) p = pts[pts.length - 1].p;
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1];
    const b = pts[i];
    if (t >= a.t && t < b.t) {
      const f = (t - a.t) / Math.max(1e-6, b.t - a.t);
      p = lerp3(a.p, b.p, f);
      const d = horizDist(sub(b.p, a.p));
      speed = d / Math.max(1e-6, b.t - a.t);
      if (d > 0.5) yaw = yawTo(a.p, b.p, yaw);
      break;
    }
  }
  if (speed < 1 && tr.face) yaw = yawTo(p, tr.face, yaw);
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

function coverFor(base: number, thrower: FieldPos | undefined): FieldPos {
  if (base === 1) return thrower === "1B" ? "P" : "1B";
  if (base === 2) return thrower === "SS" || thrower === "3B" || thrower === "LF" ? "2B" : "SS";
  if (base === 3) return thrower === "3B" ? "SS" : "3B";
  return "C";
}

export function buildTimeline(c: CommittedPitch): Timeline {
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

  // ---- Ball after contact: gathered, then thrown around ----
  const firstThrow = events.find((e) => e.type === "throw");
  const holds = events.filter((e) => HOLD_TYPES.has(e.type) && e.pos && e.to && (!firstThrow || e.t <= firstThrow.t));
  const gather = play?.caught ? holds[0] : holds[holds.length - 1];
  const throws = events.filter((e) => e.type === "throw" && e.from && e.to && e.arriveT != null);
  const homeRun = !!path?.homeRun;

  const ballInPlay = (u: number): BallState => {
    if (!path) return { p: MITT, visible: false, held: false };
    if (!gather || u < gather.t) {
      const s = sampleAt(path, Math.min(u, path.endT));
      const gone = (homeRun || path.outOfPlayFoul) && u > path.endT + 0.6;
      return { p: s.p, visible: !gone, held: false };
    }
    let p = add(gather.to!, v3(0, 3, 0));
    for (const th of throws) {
      if (u < th.t) break;
      const from = add(th.from!, v3(0, 5, 0));
      const to = add(th.to!, v3(0, 4.5, 0));
      if (u >= th.arriveT!) {
        p = to;
        continue;
      }
      const f = (u - th.t) / Math.max(0.05, th.arriveT! - th.t);
      const d = horizDist(sub(th.to!, th.from!));
      const arc = 4 * f * (1 - f) * Math.min(28, d * 0.06);
      p = add(lerp3(from, to, f), v3(0, arc, 0));
      return { p, visible: true, held: false };
    }
    return { p, visible: true, held: true };
  };

  // Foul back / foul tip: the batted path (or the mitt for a tip).
  const ball = (T: number): BallState => {
    if (T < releaseT) return { p: releaseP, visible: false, held: true };
    if (contactT != null && T >= contactT) {
      if (result.kind === "foul_tip") return { p: MITT, visible: true, held: true };
      if (inPlay) return ballInPlay(T - contactT);
      if (path) {
        const u = T - contactT;
        const s = sampleAt(path, Math.min(u, path.endT));
        return { p: s.p, visible: u < Math.min(path.endT + 0.4, 4), held: false };
      }
    }
    if (T < flight.samples[0].t) return { p: lerp3(releaseP, flight.samples[0].p, (T - releaseT) / -releaseT), visible: true, held: false };
    if (T <= lastSample.t && !(T > crossT + 0.03 && result.kind !== "hbp")) return { p: pitchStateAt(flight, T).p, visible: true, held: false };
    if (result.kind === "hbp") return { p: pitchStateAt(flight, Math.min(T, crossT)).p, visible: T < crossT + 0.5, held: false };
    // Into the mitt.
    const tIn = crossT + 0.03;
    const at = pitchStateAt(flight, tIn).p;
    const mitt = v3(at.x * 0.7, clamp(at.y, 0.6, 4.2), MITT.z);
    if (T < tIn + 0.04) return { p: lerp3(at, mitt, (T - tIn) / 0.04), visible: true, held: false };
    return { p: mitt, visible: true, held: true };
  };

  // ---- Fielders ----
  const tracks = new Map<FieldPos, Track>();
  const landing = path?.firstLanding?.p ?? (path ? path.samples[path.samples.length - 1].p : v3(0, 0, 60));
  for (const f of fielders) {
    const start = f.p;
    const tr: Track = { pts: [{ t: -10, p: start }], actions: [], face: v3(0, 0, 0) };
    if (f.pos === "P") {
      tr.face = v3(0, 0, 0);
      tr.actions.push({ t: releaseT - 1.1, dur: 1.5, action: "pitch" });
      tr.pts.push({ t: releaseT + 0.25, p: v3(start.x, 0, start.z - 5) });
    }
    if (f.pos === "C") {
      tr.face = v3(0, 0, 60.5);
      tr.actions.push({ t: -10, dur: contactT != null && inPlay ? 10 + contactT + 0.4 : 30, action: "crouch" });
    }
    tracks.set(f.pos, tr);
  }
  if (inPlay && contactT != null) {
    const fieldedBy = gather?.pos;
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
          tr.actions.push({ t: toFlight(h.t) - 0.2, dur: 0.7, action: "dive" });
        }
        const gp = v3(gather.to!.x, 0, gather.to!.z);
        tr.pts.push({ t: Math.max(toFlight(gather.t) - 0.05, tr.pts[tr.pts.length - 1].t + 0.05), p: gp });
        tr.actions.push({ t: toFlight(gather.t) - 0.25, dur: 0.5, action: gather.type === "dive" ? "dive" : play?.caught ? "catch" : "field" });
        const myThrow = throws.find((th) => th.pos === f.pos);
        if (myThrow) {
          tr.actions.push({ t: toFlight(myThrow.t) - 0.15, dur: 0.55, action: "throw" });
          tr.face = myThrow.to;
        }
      } else if (myAttempts.length) {
        const h = myAttempts[0];
        tr.pts.push({ t: toFlight(h.t), p: v3(h.to!.x, 0, h.to!.z) });
        tr.actions.push({ t: toFlight(h.t) - 0.2, dur: 0.8, action: "dive" });
      } else {
        // Back up the play: drift toward the ball, outfielders more.
        const k = f.pos === "LF" || f.pos === "CF" || f.pos === "RF" ? 0.35 : f.pos === "P" ? 0.15 : 0.08;
        const toward = lerp3(pStart, v3(landing.x, 0, landing.z), k);
        tr.pts.push({ t: react + 2.2, p: toward });
      }
    }
    // Covers for each throw (a relay pivot covers the base it then throws from).
    for (const th of throws) {
      const base = th.base ?? 1;
      const pos = th === throws[0] ? coverFor(base, th.pos) : coverFor(base, undefined);
      const tr = tracks.get(pos);
      if (!tr || pos === th.pos) continue;
      const bp = BASE_POS[base as 1 | 2 | 3 | 4];
      const spot = v3(bp.x * 0.98, 0, bp.z * 0.98 + (base === 4 ? 1.5 : 0));
      const arrive = toFlight(th.arriveT!) - 0.25;
      const last = tr.pts[tr.pts.length - 1];
      tr.pts = tr.pts.filter((w) => w.t < arrive - 0.6);
      if (!tr.pts.length) tr.pts.push(last);
      tr.pts.push({ t: arrive, p: spot });
      tr.actions.push({ t: toFlight(th.arriveT!) - 0.1, dur: 0.4, action: "catch" });
      tr.face = th.from;
      const relay = throws.find((x) => x !== th && x.t > th.t && x.pos === pos);
      if (relay) tr.actions.push({ t: toFlight(relay.t) - 0.12, dur: 0.5, action: "throw" });
    }
  }
  const fielder = (pos: FieldPos, T: number): ActorState => {
    const tr = tracks.get(pos);
    if (!tr) return { p: v3(0, 0, 0), yaw: 0, speed: 0, action: "gone", actionT: 0 };
    return trackAt(tr, T, tr.pts[0].p);
  };

  // ---- Runners (and the batter-runner) ----
  const runTracks = new Map<number, Track & { goneAt: number }>();
  const runnerIds: number[] = [];
  const sprintOf = new Map<number, number>();
  for (const r of runners) if (r) sprintOf.set(r.playerId, r.sprint);
  const batterId = c.ctx.batter.id;
  sprintOf.set(batterId, c.ctx.batter.sprint);
  const baseFace = (s: number) => basePathPoint(Math.min(360, s + 30));
  const stealEvent = c.events.find((e) => e.kind === "stolen_base" || e.kind === "caught_stealing");
  if (inPlay && play && contactT != null) {
    for (const ro of play.runners) {
      const sprint = sprintOf.get(ro.playerId) ?? 27;
      const startS = ro.from === 0 ? 0 : ro.from * 90 + (LEADS[ro.from] ?? 10);
      const endS = ro.to === ro.from ? ro.from * 90 : ro.out ? ro.to * 90 - 4 : ro.to * 90;
      const d = Math.abs(endS - startS);
      const v = homeRun ? 19 : sprint * 0.93;
      let tEnd = homeRun ? toFlight(1.2 + (ro.to * 90 - startS) / v + ro.from * 0.4) : toFlight(ro.t);
      let tStart = tEnd - d / v - 0.35;
      const minStart = toFlight(ro.from === 0 ? 0.25 : 0.1);
      if (tStart < minStart) {
        tStart = minStart;
        tEnd = Math.max(tEnd, tStart + d / 32);
      }
      const pts: Waypoint[] = [{ t: -10, p: ro.from === 0 ? BATTER_BOX(battingSide) : basePathPoint(startS) }];
      if (ro.from === 0) pts.push({ t: minStart, p: BASE_POS[4] });
      const steps = Math.max(2, Math.ceil(d / 15));
      for (let i = 0; i <= steps; i += 1) {
        const f = i / steps;
        pts.push({ t: tStart + (tEnd - tStart) * f, p: basePathPoint(startS + (endS - startS) * f) });
      }
      const actions: Track["actions"] = [];
      if (ro.out) actions.push({ t: tEnd - 0.2, dur: 0.5, action: "slide" });
      const offAt = ro.out || ro.to === 4 ? tEnd + 1.6 : Infinity;
      if (ro.out || ro.to === 4) {
        const dugout = v3(battingSide === "R" ? 60 : -60, 0, -5);
        pts.push({ t: tEnd + 0.6, p: pts[pts.length - 1].p });
        pts.push({ t: offAt, p: lerp3(pts[pts.length - 1].p, dugout, 0.25) });
      }
      runTracks.set(ro.playerId, { pts, actions, face: baseFace(endS), goneAt: offAt });
      runnerIds.push(ro.playerId);
    }
  } else {
    runners.forEach((r, i) => {
      if (!r) return;
      const base = i + 1;
      const s0 = base * 90 + (LEADS[base] ?? 10) * 0.5;
      const pts: Waypoint[] = [{ t: -10, p: basePathPoint(base * 90) }, { t: releaseT - 0.8, p: basePathPoint(s0) }];
      const actions: Track["actions"] = [];
      let goneAt = Infinity;
      if (stealEvent && base === 1) {
        const safe = stealEvent.kind === "stolen_base";
        pts.push({ t: releaseT - 0.3, p: basePathPoint(s0 + 2) });
        pts.push({ t: crossT + 1.9, p: basePathPoint(safe ? 180 : 177) });
        actions.push({ t: crossT + 1.6, dur: 0.6, action: "slide" });
        if (!safe) goneAt = crossT + 3.6;
      } else {
        pts.push({ t: crossT + 0.6, p: basePathPoint(s0 + 4) }, { t: crossT + 2.0, p: basePathPoint(base * 90) });
      }
      runTracks.set(r.playerId, { pts, actions, face: baseFace(base * 90), goneAt });
      runnerIds.push(r.playerId);
    });
  }
  const runner = (id: number, T: number): ActorState | null => {
    const tr = runTracks.get(id);
    if (!tr) return null;
    if (T > tr.goneAt) return null;
    return trackAt(tr, T, tr.pts[0].p);
  };

  const batterBox = BATTER_BOX(battingSide);
  const batter = (T: number): ActorState | null => {
    if (inPlay && contactT != null && T > contactT + 0.25) return null;
    const yaw = battingSide === "R" ? -Math.PI / 2 : Math.PI / 2;
    if (swingT != null && T >= swingT - 0.16) return { p: batterBox, yaw, speed: 0, action: "swing", actionT: T - (swingT - 0.16) };
    return { p: batterBox, yaw, speed: 0, action: "stance", actionT: T - releaseT };
  };

  // ---- Timing ----
  let endT = crossT + 1.3;
  if (stealEvent) endT = crossT + 3.2;
  if (contactT != null && path && !inPlay) endT = contactT + Math.min(3, path.endT + 0.4);
  if (result.kind === "foul_tip") endT = crossT + 1.2;
  if (inPlay && play && contactT != null) {
    let last = play.endT + 1.2;
    for (const tr of runTracks.values()) last = Math.max(last, tr.pts[tr.pts.length - 1].t - contactT + 0.4);
    if (homeRun) last = Math.max(last, path!.endT + 1.5);
    endT = contactT + Math.min(last, 24);
  }

  const focus = (T: number): V3 => {
    const b = ball(T);
    if (!inPlay || contactT == null) return b.p;
    if (!b.held) return b.p;
    // Ball held: frame the lead runner still moving, else the ball.
    let lead: V3 | null = null;
    for (const id of runnerIds) {
      const r = runner(id, T);
      if (r && r.speed > 4) lead = r.p;
    }
    return lead ? lerp3(b.p, lead, 0.5) : b.p;
  };

  return { releaseT, contactT, swingT, endT, inPlay, ball, fielder, runnerIds, runner, batter, focus };
}
