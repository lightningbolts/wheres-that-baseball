/**
 * Animation for a throw-over: the pitcher comes set, spins and throws to the bag, and
 * the runner dives back, is tagged, or is hung up and run down. Built to the same
 * Timeline interface as a pitch, so the scene, cameras and rigs play it unchanged.
 * The outcome comes from the rules (GameSession.pickoff); this only stages it.
 */
import { add, clamp, lerp3, v3, type V3 } from "@/lib/game/math";
import { BASE_POS } from "@/lib/game/play/movement";
import type { CommittedPickoff } from "@/lib/game/session/session";
import type { FieldPos } from "@/lib/game/types";
import {
  basePathPoint,
  THROW_RELEASE_S,
  trackAt,
  type ActorState,
  type BallState,
  type Timeline,
  type Track,
} from "@/lib/game/anim/timeline";

type Seg =
  | { kind: "held"; t0: number; holder: FieldPos }
  | { kind: "fly"; t0: number; t1: number; a: V3; b: V3; arc: number }
  | { kind: "roll"; t0: number; t1: number; a: V3; b: V3 };

const NEVER = 1e9;
/** Lead off the bag the runner takes as the pitcher comes set, ft. */
const LEAD: Record<number, number> = { 0: 12, 1: 18 };

export interface PickoffTimeline extends Timeline {
  /** When the play is decided (the tag, the dive back, the ball getting away). */
  callT: number;
}

export function buildPickoffTimeline(k: CommittedPickoff): PickoffTimeline {
  const i = k.from;
  const sO = (i + 1) * 90;
  const sN = (i + 2) * 90;
  const bagO = BASE_POS[(i + 1) as 1 | 2];
  const target = k.runners[i];
  const balk = k.events.some((e) => e.kind === "balk");
  const outcome = k.outcome;
  const rundown = outcome === "rundown_out" || outcome === "rundown_safe";
  const coverO: FieldPos = i === 0 ? "1B" : "SS";
  const coverN: FieldPos = i === 0 ? "SS" : "3B";
  const backupO: FieldPos = i === 0 ? "P" : "2B";
  const on = (s: number, inside = 0): V3 => {
    const p = basePathPoint(s);
    // Fielders work a step inside the line (toward the mound).
    const m = v3(0, 0, 60.5);
    const d = Math.hypot(m.x - p.x, m.z - p.z) || 1;
    return v3(p.x + ((m.x - p.x) / d) * inside, 0, p.z + ((m.z - p.z) / d) * inside);
  };

  const tLead = 1.0;
  const tMove = 1.55;
  const tRel = tMove + THROW_RELEASE_S;
  const mound = k.fielders.find((f) => f.pos === "P")?.p ?? v3(0, 0, 60.5);
  const hand = add(mound, v3(0, 5.6, 0));
  const glove = add(on(sO, 1.5), v3(0, 2.4, 0));
  const flight = Math.hypot(glove.x - hand.x, glove.z - hand.z) / 118;
  const tArr = tRel + flight;

  // ---- Fielders: everyone holds; the play's fielders move. ----
  const tracks = new Map<FieldPos, Track>();
  for (const f of k.fielders) {
    const tr: Track = { pts: [{ t: -10, p: f.p }], actions: [], face: f.pos === "C" ? v3(0, 0, 60.5) : v3(0, 0, 0) };
    if (f.pos === "C") tr.actions.push({ t: -10, dur: NEVER, action: "crouch" });
    tracks.set(f.pos, tr);
  }
  const tr = (pos: FieldPos) => tracks.get(pos);
  const go = (pos: FieldPos, t: number, p: V3) => {
    const x = tr(pos);
    if (!x) return;
    const last = x.pts[x.pts.length - 1];
    x.pts.push({ t: Math.max(t, last.t + 0.05), p });
  };
  const hold = (pos: FieldPos, t: number) => {
    const x = tr(pos);
    if (!x) return;
    const last = x.pts[x.pts.length - 1];
    if (t > last.t) x.pts.push({ t, p: last.p });
  };
  const act = (pos: FieldPos, t: number, dur: number, action: ActorState["action"]) => tr(pos)?.actions.push({ t, dur, action });
  const face = (pos: FieldPos, t: number, p: V3) => {
    const x = tr(pos);
    if (x) (x.faces ??= []).push({ t, p });
  };
  const pt = tr("P");
  if (pt) {
    pt.actions.push({ t: -10, dur: 10 + tMove, action: "idle" });
    pt.actions.push({ t: tMove, dur: THROW_RELEASE_S + 0.5, action: "throw" });
    face("P", tMove - 0.25, bagO);
  }
  // The cover man is on the bag (or gets there) for the throw.
  hold(coverO, tMove - 0.7);
  go(coverO, tRel, on(sO, 1.5));
  act(coverO, tArr - 0.45, 0.9, "catch");
  face(coverO, 0, mound);

  // ---- Ball ----
  const segs: Seg[] = [{ kind: "held", t0: -10, holder: "P" }];
  const fly = (t0: number, a: V3, b: V3, speed: number, receiver: FieldPos | null): number => {
    const t1 = t0 + Math.hypot(b.x - a.x, b.z - a.z) / speed;
    segs.push({ kind: "fly", t0, t1, a, b, arc: clamp(Math.hypot(b.x - a.x, b.z - a.z) * 0.03, 0.5, 3) });
    if (receiver) segs.push({ kind: "held", t0: t1, holder: receiver });
    return t1;
  };
  const at = (pos: FieldPos, t: number): V3 => {
    const x = tr(pos);
    return x ? add(trackAt(x, t).p, v3(0, 5.2, 0)) : v3(0, 5, 0);
  };

  // ---- Runners ----
  const runTracks = new Map<number, Track>();
  const runnerIds: number[] = [];
  const dugout = v3(k.battingSide === "R" ? 60 : -60, 0, -12);
  const jogOff = (t: Track, t0: number) => {
    const p = t.pts[t.pts.length - 1].p;
    const dd = Math.max(1, Math.hypot(dugout.x - p.x, dugout.z - p.z));
    t.pts.push({ t: t0 + 0.8, p });
    t.pts.push({ t: t0 + 0.8 + Math.min(dd, 18) / 12, p: lerp3(p, dugout, Math.min(dd, 18) / dd) });
  };
  let callT = tArr + 0.05;
  let endT = tArr + 1.8;

  k.runners.forEach((r, b) => {
    if (!r) return;
    const s0 = (b + 1) * 90;
    const lead = LEAD[b] ?? 8;
    const t: Track = { pts: [{ t: -10, p: basePathPoint(s0) }, { t: 0.2, p: basePathPoint(s0) }, { t: tLead, p: basePathPoint(s0 + lead) }], actions: [], face: basePathPoint(s0 + 40) };
    runTracks.set(r.playerId, t);
    runnerIds.push(r.playerId);
    if (b !== i) {
      // Everybody else moves up on a balk or a throw that gets away.
      if (balk || outcome === "error") {
        const t0 = tArr + (balk ? 0.9 : 0.35);
        const s1 = (b + 2) * 90;
        t.pts.push({ t: t0, p: basePathPoint(s0 + lead) });
        t.pts.push({ t: t0 + (s1 - s0 - lead) / (balk ? 13 : 24), p: basePathPoint(s1) });
      }
      return;
    }
    if (outcome === "safe" || outcome === "error" || outcome === "out") {
      // Back to the bag: in time (or not) as the throw arrives.
      const out = outcome === "out";
      const back = out ? tArr + 0.14 : tArr - 0.04;
      t.pts.push({ t: tMove + 0.18, p: basePathPoint(s0 + lead) });
      t.pts.push({ t: back, p: basePathPoint(out ? s0 + 3.5 : s0 + 1) });
      t.actions.push({ t: back - 0.36, dur: 1.1, action: "slide" });
      t.face = basePathPoint(s0);
      callT = back + 0.04;
      if (out) {
        go(coverO, tArr + 0.1, on(s0 + 2.5, 0.6));
        act(coverO, tArr + 0.02, 0.6, "field");
        jogOff(t, callT + 0.5);
        endT = callT + 2.2;
      } else if (balk) {
        const t0 = tArr + 0.9;
        t.pts.push({ t: t0 + 0.6, p: basePathPoint(s0) });
        t.pts.push({ t: t0 + 0.6 + 90 / 13, p: basePathPoint(s0 + 90) });
        endT = t0 + 0.6 + 90 / 13 + 0.6;
      }
      if (outcome === "error") {
        // Up and gone for the next base while the ball rolls down the line.
        const up = tArr + 0.75;
        t.pts.push({ t: up, p: basePathPoint(s0 + 1) });
        const reach = up + (sN - s0) / 25;
        t.pts.push({ t: reach, p: basePathPoint(sN) });
        t.actions.push({ t: reach - 0.32, dur: 0.95, action: "slide" });
        t.face = basePathPoint(sN + 30);
        endT = reach + 1.3;
      }
      return;
    }
    // Rundown: caught leaning, he breaks for the next base and is hung up between.
    const far = s0 + lead + 22;
    const mid = s0 + 46;
    t.pts.push({ t: tMove + 0.25, p: basePathPoint(s0 + lead + 4) });
    t.pts.push({ t: tArr + 0.35, p: basePathPoint(far) });
    const tA = tArr + 0.75;
    t.pts.push({ t: tA + 0.1, p: basePathPoint(mid) });
    // The first baseman (or shortstop) charges him and feeds the man at the next bag.
    go(coverO, tA, on(s0 + 24, 0.5));
    act(coverO, tA - THROW_RELEASE_S, THROW_RELEASE_S + 0.5, "throw");
    face(coverO, tArr + 0.2, basePathPoint(sN));
    go(coverN, tArr + 0.2, on(sN - 10, 0.5));
    act(coverN, tA + 0.15, 0.8, "catch");
    face(coverN, tArr + 0.2, basePathPoint(s0));
    go(backupO, tA + 0.5, on(s0 + 2, 1));
    face(backupO, tA + 0.5, basePathPoint(sN));
    // He turns back for the bag he left; the next-base man runs him back and throws.
    const tB = tA + 1.45;
    t.pts.push({ t: tA + 0.45, p: basePathPoint(mid - 2) });
    t.pts.push({ t: tB, p: basePathPoint(s0 + 26) });
    go(coverN, tB, on(s0 + 52, 0.4));
    act(coverN, tB - THROW_RELEASE_S, THROW_RELEASE_S + 0.5, "throw");
    // The cover man peels off out of the base path.
    go(coverO, tA + 0.6, on(s0 + 30, 9));
    if (outcome === "rundown_out") {
      const tag = tB + 0.75;
      t.pts.push({ t: tag, p: basePathPoint(s0 + 11) });
      go(backupO, tag - 0.05, on(s0 + 9, 0.3));
      act(backupO, tB + 0.2, 1.0, "catch");
      callT = tag;
      jogOff(t, tag + 0.4);
      endT = tag + 2.4;
    } else {
      // The throw back gets by him: he turns again and takes the next base.
      const turn = tB + 0.35;
      t.pts.push({ t: turn, p: basePathPoint(s0 + 22) });
      const reach = turn + (sN - s0 - 22) / 25;
      t.pts.push({ t: reach, p: basePathPoint(sN) });
      t.actions.push({ t: reach - 0.32, dur: 0.95, action: "slide" });
      t.face = basePathPoint(sN + 30);
      act(backupO, tB + 0.2, 0.9, "dive");
      callT = reach;
      endT = reach + 1.5;
    }
  });

  // Ball path (after the tracks exist, so throws leave from where the fielders are).
  const tArrive = fly(tRel, hand, glove, 118, outcome === "error" ? null : coverO);
  if (outcome === "error") {
    const dir = v3(glove.x - hand.x, 0, glove.z - hand.z);
    const n = Math.hypot(dir.x, dir.z) || 1;
    const past = add(glove, v3((dir.x / n) * 14, -2.2, (dir.z / n) * 14));
    const stop = v3(glove.x + (dir.x / n) * 70, 0.15, glove.z + (dir.z / n) * 70);
    segs.push({ kind: "fly", t0: tArrive, t1: tArrive + 0.15, a: glove, b: past, arc: 0.2 });
    segs.push({ kind: "roll", t0: tArrive + 0.15, t1: tArrive + 2.4, a: past, b: stop });
    go(coverO, tArrive + 1.8, v3(stop.x * 0.95, 0, stop.z * 0.95));
    act(coverO, tArrive + 2.3, 0.8, "field");
    segs.push({ kind: "held", t0: tArrive + 2.6, holder: coverO });
  } else if (rundown) {
    const tA = tArr + 0.75;
    fly(tA, at(coverO, tA), add(on(sN - 10, 0.5), v3(0, 4.6, 0)), 80, coverN);
    const tB = tA + 1.45;
    if (outcome === "rundown_out") fly(tB, at(coverN, tB), add(on(sO + 6, 0.6), v3(0, 4.4, 0)), 75, backupO);
    else {
      const a = at(coverN, tB);
      const by = add(on(sO - 4, 1), v3(0, 0.6, 0));
      const t1 = fly(tB, a, by, 75, null);
      const stop = v3(by.x * 1.25, 0.15, by.z * 0.9 - 8);
      segs.push({ kind: "roll", t0: t1, t1: t1 + 1.6, a: by, b: stop });
      go(backupO, t1 + 1.7, v3(stop.x, 0, stop.z));
      segs.push({ kind: "held", t0: t1 + 1.9, holder: backupO });
    }
  }

  const ball = (T: number): BallState => {
    let s: Seg = segs[0];
    for (const x of segs) if (T >= x.t0) s = x;
    if (s.kind === "held") {
      const x = tr(s.holder);
      const p = x ? add(trackAt(x, T).p, v3(0, 4, 0)) : hand;
      return { p, visible: true, held: true, holder: s.holder };
    }
    const f = clamp((T - s.t0) / Math.max(0.05, s.t1 - s.t0), 0, 1);
    if (s.kind === "roll") {
      const e = 1 - (1 - f) * (1 - f);
      return { p: lerp3(s.a, s.b, e), visible: true, held: false, holder: null };
    }
    return { p: add(lerp3(s.a, s.b, f), v3(0, 4 * f * (1 - f) * s.arc, 0)), visible: true, held: false, holder: null };
  };

  const fielder = (pos: FieldPos, T: number): ActorState => {
    const x = tracks.get(pos);
    if (!x) return { p: v3(0, 0, 0), yaw: 0, speed: 0, action: "gone", actionT: 0 };
    return trackAt(x, T);
  };
  const runner = (id: number, T: number): ActorState | null => {
    const x = runTracks.get(id);
    return x ? trackAt(x, T) : null;
  };
  const box = v3(k.battingSide === "R" ? 2.7 : -2.7, 0, 0.5);
  const batter = (): ActorState => ({ p: box, yaw: k.battingSide === "R" ? -Math.PI / 2 : Math.PI / 2, speed: 0, action: "stance", actionT: 0 });
  const focusId = target?.playerId;
  const focus = (T: number): V3 => {
    const b = ball(T).p;
    const r = focusId != null ? runner(focusId, T)?.p : null;
    return r ? lerp3(v3(b.x, 0, b.z), r, 0.5) : v3(b.x, 0, b.z);
  };

  return {
    releaseT: NEVER,
    releaseP: hand,
    receive: { t: NEVER, p: v3(0, 2.5, -1.7) },
    contactT: null,
    swingT: null,
    swing: null,
    endT,
    inPlay: false,
    ball,
    fielder,
    runnerIds,
    batterId: k.ctx.batter.id,
    runner,
    batter,
    focus,
    callT,
  };
}
