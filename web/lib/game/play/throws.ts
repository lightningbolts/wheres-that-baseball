/**
 * Throwing: how far and how fast a fielder can throw (from his real Statcast arm),
 * and how the defense gets the ball from the outfield to a base — a direct throw,
 * a throw through the cutoff man, or a relay through a middle infielder.
 *
 * Arm strength → range. `arm` is Savant's arm strength (mph, average of a player's
 * hardest throws). A fielder makes a game throw at ~88% of it, on a line or one hop,
 * out to his comfortable range:
 *
 *     arm  78 mph (weak)    → ~190 ft
 *     arm  88 mph (average) → ~250 ft
 *     arm  98 mph (cannon)  → ~310 ft
 *
 * Past that the throw has to be lofted or bounced: it dies on the hops (slow) and
 * sprays (offline). Past ~1.25× the range it can't get there with anything on it, so a
 * ball fielded that far out — off the wall, in the gap, in the corner — always goes to
 * a relay man: the shortstop (left side, center) or second baseman (right side) runs
 * out to a spot on the line between the ball and the base, takes the throw, turns
 * (0.6–0.9 s depending on his hands) and throws on. Two short strong throws beat one
 * long weak one; a strong arm from medium depth beats both and throws through.
 */
import { clamp, horizDist, lerp3, sprayAngleDeg, v3, type V3 } from "@/lib/game/math";
import { legTime, runTime, throwRange } from "@/lib/game/play/movement";
import { isOutfielder, type Fielder } from "@/lib/game/play/defense";
import { BASES } from "@/lib/game/physics/park";
import type { FieldPos } from "@/lib/game/types";

export type ThrowBase = 1 | 2 | 3 | 4;

const BASE_AT: Record<ThrowBase, V3> = { 1: BASES.first, 2: BASES.second, 3: BASES.third, 4: BASES.home };

export { legTime, throwRange };

/** Beyond this (ft) a fielder can't get the ball there with anything on it. */
export function maxCarry(armMph: number): number {
  return throwRange(armMph) * 1.25;
}

/**
 * How far off line a throw tends to be, as an s.d. in seconds of extra time for the
 * receiver to glove it and apply the tag. Short throws are on the bag; long ones,
 * especially past the range, spray.
 */
export function legSpread(d: number, armMph: number): number {
  const k = d / throwRange(armMph);
  return 0.03 + 0.05 * k + (k > 1 ? 0.18 * (k - 1) : 0);
}

/** Chance a throw is wild enough to get away (an error and an extra base). */
export function legErrorChance(d: number, armMph: number): number {
  const k = d / throwRange(armMph);
  return 0.0025 + 0.005 * k * k + (k > 1 ? 0.03 * (k - 1) : 0);
}

/** Exchange for a relay/cutoff man: catch, turn, throw (s). Better hands are quicker. */
export function exchangeTime(glove: number): number {
  return clamp(0.9 - 0.3 * glove, 0.6, 0.9);
}

export interface ThrowLeg {
  /** Who throws this leg. */
  pos: FieldPos;
  from: V3;
  to: V3;
  /** Release time and arrival time, s after contact. */
  t: number;
  arriveT: number;
  /** Who catches it (a relay/cutoff man in line, or the man covering the base). */
  receiver: FieldPos;
  /** `to` is a spot in line (relay/cutoff), not the bag. */
  cutoff: boolean;
  dist: number;
}

export interface ThrowPlan {
  base: ThrowBase;
  kind: "direct" | "relay";
  legs: ThrowLeg[];
  /** Ball at the bag, s after contact. */
  arriveT: number;
  /** Timing noise (s.d.) of the play at the bag from throw accuracy. */
  spread: number;
  /** Chance one of the throws gets away. */
  errP: number;
  /** A first or third baseman lined up in front of home, who could cut the throw. */
  cutoffMan?: { pos: FieldPos; p: V3; passT: number };
}

/** The middle infielder who goes out for a relay from a ball at `p`. */
export function relayManFor(p: V3): FieldPos {
  return sprayAngleDeg(p) <= 4 ? "SS" : "2B";
}

/** Who takes a throw at `base` (never the thrower, the relay man or the cutoff man). */
export function coverMan(base: ThrowBase, busy: ReadonlyArray<FieldPos | undefined>): FieldPos {
  const prefs: Record<ThrowBase, FieldPos[]> = {
    1: ["1B", "2B", "P"],
    2: ["SS", "2B", "P"],
    3: ["3B", "SS", "P"],
    4: ["C", "P"],
  };
  return prefs[base].find((p) => !busy.includes(p)) ?? prefs[base][prefs[base].length - 1];
}

interface PlanOpts {
  /** The relay man's own arm, hands and start (when he's on the field). */
  fielders: Fielder[];
  /** Relay plays allowed (default true). */
  relays?: boolean;
}

/**
 * Best way to get the ball from `thrower` (holding it at `from`, ready to release at
 * `tRelease`) to `base`: compares a direct throw with a relay and keeps the faster one,
 * charging a long direct throw for its spray. A ball that can't be carried goes to the
 * relay regardless.
 */
export function planThrow(thrower: Fielder, from: V3, tRelease: number, base: ThrowBase, opts: PlanOpts): ThrowPlan {
  const to = BASE_AT[base];
  const d = horizDist(from, to);
  const direct = directPlan(thrower, from, tRelease, base, d, opts.fielders);
  if (opts.relays === false || !isOutfielder(thrower.pos) || d < 150) return direct;
  const relay = relayPlan(thrower, from, tRelease, base, d, opts.fielders);
  if (!relay) return direct;
  if (d > maxCarry(thrower.arm)) return relay;
  // Judge on expected time plus a share of the spread: a long bouncing throw is a gamble.
  const score = (p: ThrowPlan) => p.arriveT + 0.5 * p.spread;
  return score(relay) < score(direct) ? relay : direct;
}

function directPlan(thrower: Fielder, from: V3, tRelease: number, base: ThrowBase, d: number, fielders: Fielder[]): ThrowPlan {
  const to = BASE_AT[base];
  const arriveT = tRelease + legTime(d, thrower.arm);
  // On a throw to second the middle infielder on the ball's side has gone out toward it.
  const receiver = coverMan(base, [thrower.pos, base === 2 && isOutfielder(thrower.pos) ? relayManFor(from) : undefined]);
  const plan: ThrowPlan = {
    base,
    kind: "direct",
    legs: [{ pos: thrower.pos, from, to, t: tRelease, arriveT, receiver, cutoff: false, dist: d }],
    arriveT,
    spread: legSpread(d, thrower.arm),
    errP: legErrorChance(d, thrower.arm),
  };
  // Throws home from the outfield come through a cutoff man ~45 ft up the line.
  if (base === 4 && isOutfielder(thrower.pos) && d > 150) {
    const pos: FieldPos = sprayAngleDeg(from) < -15 ? "3B" : "1B";
    if (fielders.some((f) => f.pos === pos)) {
      const p = lerp3(v3(to.x, 0, to.z), v3(from.x, 0, from.z), 45 / d);
      plan.cutoffMan = { pos, p, passT: tRelease + legTime(d - 45, thrower.arm) };
    }
  }
  return plan;
}

function relayPlan(thrower: Fielder, from: V3, tRelease: number, base: ThrowBase, d: number, fielders: Fielder[]): ThrowPlan | null {
  const pos = relayManFor(from);
  const man = fielders.find((f) => f.pos === pos);
  if (!man || man.pos === thrower.pos) return null;
  const to = BASE_AT[base];
  const exch = exchangeTime(man.glove);
  const range = throwRange(thrower.arm);
  let best: ThrowPlan | null = null;
  // Where on the line he sets up: try spots from 30% to 60% of the way out from the bag.
  for (let k = 0.3; k <= 0.601; k += 0.05) {
    const l2 = d * k;
    const l1 = d - l2;
    // He's no help standing on top of the bag, and the outfielder still has to reach him.
    if (l2 < 60 || l1 > range * 1.1) continue;
    const spot = lerp3(v3(to.x, 0, to.z), v3(from.x, 0, from.z), k);
    const there = man.reaction + 0.25 + runTime(horizDist(man.p, spot), man.sprint);
    const recv = Math.max(tRelease + legTime(l1, thrower.arm), there + 0.1);
    const out = recv + exch;
    const arriveT = out + legTime(l2, man.arm);
    if (best && arriveT >= best.arriveT) continue;
    const receiver = coverMan(base, [thrower.pos, pos]);
    best = {
      base,
      kind: "relay",
      legs: [
        { pos: thrower.pos, from, to: spot, t: tRelease, arriveT: recv, receiver: pos, cutoff: true, dist: l1 },
        { pos, from: spot, to, t: out, arriveT, receiver, cutoff: false, dist: l2 },
      ],
      arriveT,
      spread: Math.hypot(legSpread(l1, thrower.arm) * 0.6, legSpread(l2, man.arm)),
      errP: legErrorChance(l1, thrower.arm) * 0.5 + legErrorChance(l2, man.arm),
    };
  }
  return best;
}

/**
 * No play anywhere: the outfielder gets the ball back in to the relay man (or straight
 * to the bag at second on a short one), so runners can't take more.
 */
export function returnThrow(thrower: Fielder, from: V3, tRelease: number, fielders: Fielder[]): ThrowLeg {
  const bag = BASE_AT[2];
  const d = horizDist(from, bag);
  const pos = relayManFor(from);
  const man = fielders.find((f) => f.pos === pos && f.pos !== thrower.pos);
  if (!isOutfielder(thrower.pos) || d < 170 || !man) {
    const receiver = coverMan(2, [thrower.pos, isOutfielder(thrower.pos) ? pos : undefined]);
    return { pos: thrower.pos, from, to: bag, t: tRelease, arriveT: tRelease + legTime(d, thrower.arm), receiver, cutoff: false, dist: d };
  }
  const k = clamp(1 - Math.min(throwRange(thrower.arm) * 0.6, d - 60) / d, 0.25, 0.6);
  const spot = lerp3(v3(bag.x, 0, bag.z), v3(from.x, 0, from.z), k);
  const l1 = d * (1 - k);
  const there = man.reaction + 0.25 + runTime(horizDist(man.p, spot), man.sprint);
  return { pos: thrower.pos, from, to: spot, t: tRelease, arriveT: Math.max(tRelease + legTime(l1, thrower.arm), there + 0.1), receiver: pos, cutoff: true, dist: l1 };
}
