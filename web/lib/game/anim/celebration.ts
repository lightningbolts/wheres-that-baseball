/**
 * Postgame celebrations as a Timeline the scene plays like any other: everyone starts
 * where the last play left him, the winners run to a gathering point and celebrate in a
 * style of their own (see CelebrationStyle), and the losers walk off to their dugout.
 * Hops and dogpiles lift people off the ground with ActorState.lift.
 */
import { v3, type V3 } from "@/lib/game/math";
import type { FieldPos } from "@/lib/game/types";
import type { CelebrationStyle } from "@/lib/game/rules/celebration";
import { trackAt, type Action, type ActorState, type BallState, type Timeline, type Track } from "@/lib/game/anim/timeline";

export interface XZ {
  x: number;
  z: number;
}

export interface CelebrationInput {
  style: CelebrationStyle;
  /** The winners were in the field (otherwise they were batting: a walk-off). */
  winnerFielding: boolean;
  fielders: Array<{ pos: FieldPos } & XZ>;
  /** The batting club's men on the field (the batter and the runners). */
  hitters: Array<{ id: number } & XZ>;
  /** The batting club's star of the moment (walk-off: the batter), or null. */
  hero: number | null;
  /** More of the batting club, coming out of the dugout (walk-offs only). */
  mob: Array<{ id: number } & XZ>;
  /** Walk-off home run: the party is at the plate (the trot is over). */
  homeRun: boolean;
  /** Dugout fronts (world x/z) of the batting and fielding clubs. */
  battingDugout: XZ;
  fieldingDugout: XZ;
  /** Seconds of choreography (the timeline keeps going quietly after it). */
  duration: number;
}

export const MOUND: XZ = { x: 0, z: 60.5 };
/** Just in front of the plate, where a walk-off party meets the man coming home. */
export const PLATE_SPOT: XZ = { x: 0, z: 4 };
/** Where the handshake line forms, between the mound and the plate. */
const LINE_Z = 32;

/** Dugout fronts: home on the first-base side (−x), visitors on the third-base side. */
export const DUGOUT_FRONT: Record<"away" | "home", XZ> = { home: { x: -64, z: -4 }, away: { x: 64, z: -4 } };

interface Plan {
  track: Track;
  /** Hop height (ft) at time t. */
  lift: (t: number) => number;
}

const hash = (n: number, salt: number) => {
  let h = (Math.imul(n ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt + 1, 0xc2b2ae35)) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0x27d4eb2f) >>> 0;
  return (h % 10007) / 10007;
};

const ground = () => 0;

/** A run from `from` to `to`, leaving at `leave`, at `speed` ft/s; returns the arrival time. */
function runTo(tr: Track, from: XZ, to: XZ, leave: number, speed: number): number {
  const d = Math.hypot(to.x - from.x, to.z - from.z);
  const arrive = leave + Math.max(0.05, d / speed);
  tr.pts.push({ t: leave, p: v3(from.x, 0, from.z) }, { t: arrive, p: v3(to.x, 0, to.z) });
  return arrive;
}

function newTrack(from: XZ, face?: XZ): Track {
  return { pts: [{ t: -10, p: v3(from.x, 0, from.z) }], actions: [], face: face ? v3(face.x, 0, face.z) : undefined };
}

/** Bouncing up and down from `t0` on: `h` ft high, `hz` hops a second, phase `ph` (0..1); dies away by `end`. */
function hops(t0: number, h: number, hz: number, ph: number, end: number): (t: number) => number {
  return (t) => {
    if (t < t0) return 0;
    const fade = t < end ? 1 : Math.max(0, 1 - (t - end) / 2.5);
    if (fade <= 0) return 0;
    const s = Math.sin(2 * Math.PI * (hz * (t - t0) + ph));
    return s > 0 ? h * s * fade : 0;
  };
}

/** Losers: a slow walk off toward their dugout, starting after a beat of disbelief. */
function walkOff(from: XZ, dug: XZ, delay: number, until: number): Plan {
  const tr = newTrack(from);
  const dx = dug.x - from.x;
  const dz = dug.z - from.z;
  const d = Math.hypot(dx, dz);
  const pace = 6.5;
  const go = Math.min(d, pace * Math.max(0, until + 6 - delay));
  if (go > 1) {
    tr.pts.push({ t: delay, p: v3(from.x, 0, from.z) });
    tr.pts.push({ t: delay + go / pace, p: v3(from.x + (dx / d) * go, 0, from.z + (dz / d) * go) });
  }
  return { track: tr, lift: ground };
}

/** Arms up (the catch pose with no ball to catch) over [t, t + dur). */
const armsUp = (tr: Track, t: number, dur: number) => tr.actions.push({ t, dur, action: "catch" as Action });

/**
 * Lay out the winners around their spot and give each one his part. `ws` are in order
 * of importance: the hero (pitcher / walk-off man) first, when there is one.
 */
function winners(style: CelebrationStyle, ws: XZ[], center: XZ, heroFirst: boolean, end: number): Plan[] {
  const n = ws.length;
  const plans: Plan[] = [];
  if (style === "handshake") {
    // A line across the infield grass, filled in the order they stand left to right so nobody
    // crosses; then neighbours turn to each other and slap hands, pairs alternating.
    const order = ws.map((w, i) => ({ w, i })).sort((a, b) => a.w.x - b.w.x);
    const slots: XZ[] = order.map((_, k) => ({ x: (k - (n - 1) / 2) * 3.1, z: LINE_Z }));
    const arrive: number[] = [];
    order.forEach(({ w, i }, k) => {
      const tr = newTrack(w, { x: 0, z: 0 });
      // Outfielders come in hard so the line forms before the card goes up.
      const d = Math.hypot(w.x - slots[k].x, w.z - slots[k].z);
      arrive[k] = runTo(tr, w, slots[k], 0.25 + 0.4 * hash(i, 1), Math.min(26, Math.max(17 + 4 * hash(i, 2), d / 4)));
      plans[i] = { track: tr, lift: ground };
    });
    // A shared beat: b pairs slots (0,1), (2,3)… on even beats and (1,2), (3,4)… on odd ones;
    // a pair slaps hands once both men are in the line (nobody waits for the center fielder).
    const beat = 0.9;
    const first = Math.min(...arrive) + 0.2;
    order.forEach(({ i }, k) => {
      const tr = plans[i].track;
      tr.faces = [];
      for (let b = 0, t = first; t < end + 30; b += 1, t += beat) {
        if (t < arrive[k]) continue;
        const partner = (k + b) % 2 === 0 ? k + 1 : k - 1;
        if (partner < 0 || partner >= n || t < arrive[partner]) {
          tr.faces.push({ t, p: v3(slots[k].x, 0, 0) });
          continue;
        }
        tr.faces.push({ t, p: v3(slots[partner].x, 0, slots[partner].z) });
        if (t < end) armsUp(tr, t + 0.25, 0.4);
      }
    });
    return plans;
  }
  if (style === "huddle") {
    // A circle on the infield, everyone facing in, bouncing together.
    const r = Math.max(4.5, n * 0.85);
    let ready = 0;
    ws.forEach((w, i) => {
      const a0 = Math.atan2(w.x - center.x, w.z - center.z);
      const slot = { x: center.x + r * Math.sin(a0), z: center.z + r * Math.cos(a0) };
      const tr = newTrack(w, center);
      ready = Math.max(ready, runTo(tr, w, slot, 0.2 + 0.4 * hash(i, 3), 20 + 4 * hash(i, 4)));
      plans[i] = { track: tr, lift: ground };
    });
    // Spread the slots evenly once all are there (keeps the order they came in from).
    const order = ws.map((w, i) => ({ i, a: Math.atan2(w.x - center.x, w.z - center.z) })).sort((a, b) => a.a - b.a);
    order.forEach(({ i }, k) => {
      const a = (k / n) * Math.PI * 2 + order[0].a;
      const tr = plans[i].track;
      const last = tr.pts[tr.pts.length - 1];
      tr.pts.push({ t: Math.max(last.t, ready) + 0.6, p: v3(center.x + r * 0.8 * Math.sin(a), 0, center.z + r * 0.8 * Math.cos(a)) });
      armsUp(tr, ready + 0.4, end - ready);
      plans[i].lift = hops(ready + 0.8, 1.1, 1.5, 0, end);
    });
    return plans;
  }
  if (style === "dogpile") {
    // First men in go down at the spot, the next ones land on top of them, the rest jump around the pile.
    const lead = ws.map((w, i) => ({ i, t: 0.15 + Math.hypot(w.x - center.x, w.z - center.z) / 26 + (heroFirst && i === 0 ? -0.3 : 0.15 * hash(i, 5)) }));
    lead.sort((a, b) => a.t - b.t);
    lead.forEach(({ i }, k) => {
      const w = ws[i];
      const tr = newTrack(w, center);
      const layer = k < 3 ? 0 : k < 7 ? 1 : 2;
      const ang = k * 2.39996 + 0.7;
      const rad = layer === 0 ? 0.9 * k : layer === 1 ? 1.4 : 3.3 + 0.6 * hash(i, 6);
      const slot = { x: center.x + rad * Math.sin(ang), z: center.z + rad * Math.cos(ang) };
      const arrive = runTo(tr, w, slot, 0.1 + 0.25 * hash(i, 7), 24 + 4 * hash(i, 8));
      if (layer < 2) {
        tr.actions.push({ t: arrive - 0.3, dur: 99, action: "dive" });
        tr.face = v3(center.x - 3 * Math.sin(ang), 0, center.z - 3 * Math.cos(ang));
        const up = layer === 0 ? 0 : 1.3 + 0.5 * hash(i, 9);
        plans[i] = { track: tr, lift: (t) => (t < arrive - 0.15 ? 0 : up * Math.min(1, (t - arrive + 0.15) / 0.25)) };
      } else {
        armsUp(tr, arrive, end - arrive + 1.5);
        plans[i] = { track: tr, lift: hops(arrive, 1.3, 1.7, hash(i, 10), end) };
      }
    });
    return plans;
  }
  // walkoff / swarm: the hero in the middle, everyone else packed around him, hopping.
  ws.forEach((w, i) => {
    const hero = heroFirst && i === 0;
    const tr = newTrack(w, center);
    let to: XZ;
    if (hero) to = center;
    else {
      const k = heroFirst ? i - 1 : i;
      const a = k * 2.39996 + 0.4;
      const r = (style === "swarm" ? 2.6 : 3.0) + (k % 3) * 1.1;
      to = { x: center.x + r * Math.sin(a), z: center.z + r * Math.cos(a) };
    }
    const leave = hero ? 0 : 0.1 + 0.35 * hash(i, 11);
    const arrive = runTo(tr, w, to, leave, hero ? 14 : 23 + 4 * hash(i, 12));
    if (!hero) {
      // Jostling: a step in toward the middle and back while they are there.
      tr.pts.push({ t: arrive + 1.2, p: v3(center.x + (to.x - center.x) * 0.75, 0, center.z + (to.z - center.z) * 0.75) });
      tr.pts.push({ t: arrive + 2.6, p: v3(to.x, 0, to.z) });
    }
    armsUp(tr, arrive - 0.1, end - arrive + 2);
    plans[i] = { track: tr, lift: hops(arrive, hero ? 1.8 : 1.0 + 0.6 * hash(i, 13), hero ? 1.2 : 1.5 + 0.6 * hash(i, 14), hash(i, 15), end) };
  });
  return plans;
}

const HIDDEN_BALL: BallState = { p: v3(0, -50, 0), visible: false, held: false, holder: null };

function stateOf(plan: Plan, t: number): ActorState {
  const s = trackAt(plan.track, t);
  const lift = plan.lift(t);
  if (lift > 0) s.lift = lift;
  return s;
}

/** The celebration as a Timeline (T = seconds since it began; it ends at `duration`). */
export function buildCelebrationTimeline(inp: CelebrationInput): Timeline {
  const end = inp.duration;
  const center: XZ =
    inp.style === "handshake"
      ? { x: 0, z: LINE_Z }
      : inp.style === "huddle"
        ? { x: 0, z: 50 }
        : inp.style === "swarm" || (inp.style === "dogpile" && inp.winnerFielding)
          ? MOUND
          : inp.homeRun || inp.hero == null
            ? PLATE_SPOT
            : heroSpot(inp);
  const fielderPlans = new Map<FieldPos, Plan>();
  const runnerPlans = new Map<number, Plan>();
  if (inp.winnerFielding) {
    // The pitcher is the man of the hour on the mound.
    const ordered = [...inp.fielders].sort((a, b) => (a.pos === "P" ? -1 : b.pos === "P" ? 1 : a.pos === "C" ? -1 : b.pos === "C" ? 1 : 0));
    const plans = winners(inp.style, ordered, center, inp.style === "swarm" || inp.style === "dogpile", end);
    ordered.forEach((f, i) => fielderPlans.set(f.pos, plans[i]));
    inp.hitters.forEach((h, i) => runnerPlans.set(h.id, walkOff(h, inp.battingDugout, 0.6 + 0.5 * hash(h.id, 16) + 0.1 * i, end)));
  } else {
    const hero = inp.hitters.find((h) => h.id === inp.hero);
    const all = [...(hero ? [hero] : []), ...inp.hitters.filter((h) => h !== hero), ...inp.mob];
    const plans = winners(inp.style, all, center, !!hero, end);
    all.forEach((h, i) => runnerPlans.set(h.id, plans[i]));
    for (const f of inp.fielders) fielderPlans.set(f.pos, walkOff(f, inp.fieldingDugout, 0.8 + 1.2 * hash(f.pos.length * 31 + f.pos.charCodeAt(0), 17), end));
  }
  const runnerIds = [...runnerPlans.keys()];
  const focus = v3(center.x, 2, center.z);
  return {
    releaseT: -100,
    releaseP: v3(0, 6, 55),
    receive: { t: -100, p: v3(0, 2.5, -1.7) },
    contactT: null,
    swingT: null,
    swing: null,
    endT: end,
    inPlay: false,
    ball: () => HIDDEN_BALL,
    fielder: (pos, T) => {
      const p = fielderPlans.get(pos);
      return p ? stateOf(p, T) : { p: v3(0, 0, 0), yaw: 0, speed: 0, action: "ready", actionT: 0 };
    },
    runnerIds,
    batterId: inp.hero ?? inp.hitters[0]?.id ?? 0,
    runner: (id, T) => {
      const p = runnerPlans.get(id);
      return p ? stateOf(p, T) : null;
    },
    batter: () => null,
    focus: () => focus,
  };
}

/** A walk-off hit: the party meets the hero where he stopped (pulled in toward the infield). */
function heroSpot(inp: CelebrationInput): XZ {
  const h = inp.hitters.find((x) => x.id === inp.hero);
  if (!h) return PLATE_SPOT;
  const d = Math.hypot(h.x, h.z);
  const k = d > 95 ? 95 / d : 1;
  return { x: h.x * k, z: Math.max(4, h.z * k) };
}

/**
 * Walk-off home run: the dugout empties while the hitter is still rounding the bases and
 * waits for him in a ring at the plate (open on the third-base side, where he comes in).
 * Wraps the play's own timeline; everything else in it is unchanged.
 */
export function withPlateMob(tl: Timeline, mob: Array<{ id: number } & XZ>, from: number): Timeline {
  if (!mob.length) return tl;
  const plans = new Map<number, Plan>();
  mob.forEach((m, k) => {
    // A half ring behind and beside the plate, leaving the lane from third open.
    const a = Math.PI * (0.55 + (1.25 * k) / Math.max(1, mob.length - 1));
    const r = 5.5 + (k % 2) * 1.6;
    const to = { x: PLATE_SPOT.x + r * Math.sin(a), z: PLATE_SPOT.z + r * Math.cos(a) };
    const tr = newTrack(m, { x: 30, z: 60 });
    const leave = from + 0.5 * hash(m.id, 18);
    const arrive = runTo(tr, m, to, leave, 16 + 3 * hash(m.id, 19));
    plans.set(m.id, { track: tr, lift: hops(arrive + 0.5, 0.7, 1.3, hash(m.id, 20), tl.endT + 30) });
  });
  const ids = [...tl.runnerIds, ...plans.keys()];
  return {
    ...tl,
    runnerIds: ids,
    runner: (id, T) => {
      const p = plans.get(id);
      return p ? stateOf(p, T) : tl.runner(id, T);
    },
  };
}

export type { V3 };
