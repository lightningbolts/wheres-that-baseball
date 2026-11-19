/**
 * Ball-in-play resolution — the "assisted fielding" brain.
 *
 * Everything is decided by timing races in feet and seconds against the real
 * physics path: which fielder gets there first (reaction + acceleration + top
 * speed vs. the ball), whether a fly is caught, how long the transfer and throw
 * take (arm strength, distance, relays), and when each runner arrives (sprint
 * speed, leads, start delays, rounding bases). Outs, hits, double plays,
 * fielder's choices, tag-ups and errors fall out of those races.
 *
 * A human defender can override the throw target via `chooseThrow` (return undefined → AI).
 */
import { judgeFair, sampleAt, type BallSample, type BattedBallPath } from "@/lib/game/physics/battedBall";
import { isFairPosition, type Park } from "@/lib/game/physics/park";
import { BASE_POS, runDistance, runTime, throwTime } from "@/lib/game/play/movement";
import { isInfielder, isOutfielder, topSpeed, type Fielder } from "@/lib/game/play/defense";
import { coverMan, exchangeTime, legTime, planThrow, returnThrow, type ThrowLeg, type ThrowPlan } from "@/lib/game/play/throws";
import { horizDist, sprayAngleDeg, type Rng, type V3 } from "@/lib/game/math";
import type { FieldPos } from "@/lib/game/types";

export type Base = 1 | 2 | 3 | 4;

export interface RunnerIn {
  playerId: number;
  sprint: number;
  /** Running on the pitch (steal / hit-and-run): already well down the line at contact. */
  going?: boolean;
}

export interface ThrowOption {
  base: Base;
  runnerId: number;
  /** Runner arrival minus ball arrival, s (positive → likely out). */
  margin: number;
  force: boolean;
}

export interface PlayInput {
  path: BattedBallPath;
  park: Park;
  fielders: Fielder[];
  /** Runners on [1st, 2nd, 3rd]. */
  runners: [RunnerIn | null, RunnerIn | null, RunnerIn | null];
  batter: RunnerIn & { bats: "L" | "R"; bunt?: boolean };
  outs: number;
  rng: Rng;
  /** Human throw decision; return null to hold the ball. Defaults to the AI. */
  chooseThrow?: (options: ThrowOption[], fielded: { pos: FieldPos; t: number }) => Base | null | undefined;
  launch: { ev: number; la: number };
  /**
   * Outfield throws can go through relay / cutoff men (default true). Pass false to keep
   * every throw direct (the pre-relay model).
   */
  relays?: boolean;
  /** Game situation for send/hold calls: inning and batting team's lead (negative = trailing). */
  situation?: { inning: number; scoreDiff: number };
}

export interface RunnerOutcome {
  playerId: number;
  from: 0 | 1 | 2 | 3;
  to: Base;
  out: boolean;
  /** Time the runner reached `to` (or was put out). */
  t: number;
  /** Put out: when he would have reached `to` (> t on a close force/tag — he was still short of the bag). */
  arriveT?: number;
  /**
   * Base-path waypoints (s = feet from home along the bases, t = s after contact) for a
   * runner whose route isn't one run from his lead to `to`: back to the bag to tag up,
   * holding halfway, frozen on a liner. The final leg to `to` (ending at `t`) follows them.
   */
  path?: Array<{ t: number; s: number }>;
}

export type PlayEventType =
  | "catch"
  | "drop"
  | "dive"
  | "field"
  | "throw"
  | "force_out"
  | "tag_out"
  | "safe"
  | "score"
  | "homerun"
  | "ground_rule_double"
  | "foul"
  | "error";

export interface PlayEvent {
  t: number;
  type: PlayEventType;
  pos?: FieldPos;
  base?: Base;
  playerId?: number;
  from?: V3;
  to?: V3;
  /** For throws: arrival time. */
  arriveT?: number;
  /** For throws: who catches it (absent on older plays → whoever covers `base`). */
  receiver?: FieldPos;
  /** For throws: `to` is a relay/cutoff man's spot in line, not the bag at `base`. */
  cutoff?: boolean;
  /** For throws home: a cutoff man lined up in front of the plate that the ball goes past. */
  lineup?: { pos: FieldPos; p: V3 };
}

export interface PlayResult {
  foul: boolean;
  outs: number;
  runners: RunnerOutcome[];
  runs: number[];
  /** Bases credited as a hit (0 = no hit). */
  hit: 0 | 1 | 2 | 3 | 4;
  error: boolean;
  caught: boolean;
  fieldedBy: FieldPos | null;
  scoring: string;
  sacFly: boolean;
  doublePlay: boolean;
  fieldersChoice: boolean;
  events: PlayEvent[];
  /** Time the last movement on the play ends (for animation / pacing). */
  endT: number;
}

const POS_NUM: Record<FieldPos, number> = { P: 1, C: 2, "1B": 3, "2B": 4, "3B": 5, SS: 6, LF: 7, CF: 8, RF: 9 };
const CATCH_REACH = 2.5;
const DIVE_REACH = 7;
const GROUND_REACH = 2.2;
const IF_DIVE_REACH = 4.5;
/** How far behind an infielder (ft, from the plate) he can still run down a grounder. */
const PAST_INFIELDER = 14;
/** Real routes aren't straight lines at full speed: judging the ball costs distance. */
const ROUTE_EFF = { outfield: 1.13, infield: 1.06 };

function slack(f: Fielder, s: BallSample, reach: number): number {
  const d = Math.max(0, horizDist(f.p, s.p) * (isOutfielder(f.pos) ? ROUTE_EFF.outfield : ROUTE_EFF.infield) - reach);
  return s.t - f.reaction - runTime(d, f.sprint);
}

/**
 * When `pos` can be standing on `base` to take a throw, s after contact: he reads the
 * ball, breaks for the bag and gets there (the pitcher from the end of his follow-through).
 * A man who isn't on the field (or the thrower himself) never holds a throw up.
 */
function coverReady(fielders: Fielder[], pos: FieldPos | undefined, base: Base): number {
  const c = pos ? fielders.find((x) => x.pos === pos) : undefined;
  if (!c) return 0;
  return c.reaction + 0.15 + runTime(Math.max(0, horizDist(c.p, BASE_POS[base]) - 2), c.sprint);
}

/**
 * When a tag lands: the ball has to be in the glove (a beat after it arrives) and the runner
 * has to have come to the glove — a throw that beats him by a second waits for him to slide
 * in, it doesn't tag him from 25 ft away.
 */
function tagTime(tBall: number, tRunner: number): number {
  return Math.max(tBall + 0.12, tRunner - 0.15);
}

/**
 * Who takes an infielder's throw at `base`: first baseman at first (the pitcher when the
 * first baseman fielded it), the middle infielder away from the ball at second, the third
 * baseman at third (the shortstop when he fielded it), the catcher at home.
 */
export function infieldCover(base: Base, thrower: FieldPos): FieldPos {
  if (base === 1) return thrower === "1B" ? "P" : "1B";
  if (base === 2) return thrower === "SS" || thrower === "3B" ? "2B" : "SS";
  if (base === 3) return thrower === "3B" ? "SS" : "3B";
  return thrower === "C" ? "P" : "C";
}

/** A fielder has to stand on the field to make the play: never in or over the stands. */
const WALL_BODY = 1.5;
function inPlayableArea(s: BallSample, park: Park): boolean {
  const spray = sprayAngleDeg(s.p);
  const r = horizDist(s.p);
  // At the outfield fence he can reach over to rob a home run.
  if (s.p.z > 0 && Math.abs(spray) <= 45) return r < park.fence(spray) + 1.5;
  // Foul ground: the ball must come down on the field side of the stands' wall.
  return r < park.wallDist(spray) - WALL_BODY;
}

interface AirChance {
  f: Fielder;
  t: number;
  slack: number;
  dive: boolean;
}

/** When the ball stops being catchable for an out: it hits the ground, or the outfield wall. */
function liveFrom(path: BattedBallPath): number {
  return Math.min(path.firstLanding?.t ?? path.endT, path.wallT ?? Infinity);
}

function bestAirCatch(path: BattedBallPath, fielders: Fielder[], park: Park): AirChance | null {
  const landT = liveFrom(path);
  let best: AirChance | null = null;
  for (const f of fielders) {
    let maxSlack = -Infinity;
    let maxDive = -Infinity;
    let tDive = 0;
    const slacks: Array<[number, number]> = [];
    for (const s of path.samples) {
      if (s.t >= landT || s.phase !== "air") break;
      if (s.t < 0.12 || s.p.y > (isOutfielder(f.pos) ? 9.5 : 8.5) || !inPlayableArea(s, park)) continue;
      const sl = slack(f, s, CATCH_REACH);
      slacks.push([s.t, sl]);
      if (sl > maxSlack) maxSlack = sl;
      if (s.p.y < 5) {
        const ds = slack(f, s, DIVE_REACH);
        if (ds > maxDive) {
          maxDive = ds;
          tDive = s.t;
        }
      }
    }
    if (maxSlack >= 0) {
      // Catch as soon as the fielder is comfortably there.
      const want = Math.min(0.3, maxSlack);
      const t = slacks.find(([, sl]) => sl >= want)?.[0] ?? landT;
      const cand: AirChance = { f, t, slack: maxSlack, dive: false };
      // Prefer the fielder with more slack; outfielders coming in have priority on ties.
      if (!best || best.dive || cand.slack + (isOutfielder(f.pos) ? 0.15 : 0) > best.slack + (isOutfielder(best.f.pos) ? 0.15 : 0)) {
        best = cand;
      }
    } else if (maxDive >= 0 && (!best || (best.dive && maxDive > best.slack))) {
      best = { f, t: tDive, slack: maxDive, dive: true };
    }
  }
  return best;
}

interface GroundChance {
  f: Fielder;
  t: number;
  p: V3;
  dive: boolean;
}

function groundChances(path: BattedBallPath, fielders: Fielder[], park: Park, from: number): GroundChance[] {
  const out: GroundChance[] = [];
  for (const f of fielders) {
    if (f.pos === "C" && (path.firstLanding?.p.z ?? 0) > 25) continue;
    let found: GroundChance | null = null;
    let diveFound: GroundChance | null = null;
    // An infielder only plays a grounder he can cut off; once it's through him it belongs
    // to the outfield (he peels off to cover a bag instead of chasing it into the grass).
    const cutOff = isInfielder(f.pos) ? horizDist(f.p) + PAST_INFIELDER : Infinity;
    for (const s of path.samples) {
      // Playing a carom off the wall he can glove it chest-high; otherwise it has to be down.
      const maxY = path.wallT != null && s.t >= path.wallT ? 7 : 3;
      if (s.t < from || s.p.y > maxY || !inPlayableArea(s, park)) continue;
      if (horizDist(s.p) > cutOff) break;
      if (slack(f, s, GROUND_REACH) >= 0) {
        found = { f, t: s.t, p: s.p, dive: false };
        break;
      }
      if (!diveFound && isInfielder(f.pos) && s.t < from + 1.2 && slack(f, s, IF_DIVE_REACH) >= 0) {
        diveFound = { f, t: s.t, p: s.p, dive: true };
      }
    }
    if (!found && horizDist(path.samples[path.samples.length - 1].p) <= cutOff) {
      // The ball eventually stops (or sits at the wall): everyone can get to it.
      const last = path.samples[path.samples.length - 1];
      const d = Math.max(0, horizDist(f.p, last.p) - GROUND_REACH);
      found = { f, t: Math.max(last.t, f.reaction + runTime(d, f.sprint)), p: last.p, dive: false };
    }
    if (diveFound && (!found || diveFound.t < found.t - 0.25)) out.push(diveFound);
    if (found) out.push(found);
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Base-path distance from a runner's start (base + lead) to a target base. */
function pathDist(fromBase: number, lead: number, to: Base): number {
  return (to - fromBase) * 90 - lead;
}

interface RunnerPlan {
  playerId: number;
  sprint: number;
  from: 0 | 1 | 2 | 3;
  lead: number;
  tGo: number;
  target: Base;
  forced: boolean;
  out: boolean;
  outT: number;
  done: boolean;
}

function arrival(r: RunnerPlan, to: Base): number {
  const d = pathDist(r.from, r.lead, to);
  const rounded = Math.max(0, to - r.from - 1);
  return r.tGo + runTime(d, r.sprint) + rounded * 0.3;
}

export function resolvePlay(input: PlayInput): PlayResult {
  // The pitcher is timed at a pitcher's speed everywhere (fielding, covering a bag).
  if (input.fielders.some((f) => topSpeed(f) !== f.sprint)) {
    input = { ...input, fielders: input.fielders.map((f) => (topSpeed(f) === f.sprint ? f : { ...f, sprint: topSpeed(f) })) };
  }
  const { path, park, fielders, runners, batter, outs, rng } = input;
  const events: PlayEvent[] = [];
  const result = (partial: Partial<PlayResult>): PlayResult => ({
    foul: false,
    outs: 0,
    runners: [],
    runs: [],
    hit: 0,
    error: false,
    caught: false,
    fieldedBy: null,
    scoring: "",
    sacFly: false,
    doublePlay: false,
    fieldersChoice: false,
    events,
    endT: path.endT,
    ...partial,
  });

  const onBase = runners
    .map((r, i) => (r ? { ...r, base: (i + 1) as 1 | 2 | 3 } : null))
    .filter((x): x is RunnerIn & { base: 1 | 2 | 3 } => x != null);

  // Home run: everyone trots home (~22 s for the batter; staggered for animation).
  if (path.homeRun) {
    events.push({ t: path.endT, type: "homerun" });
    const rs: RunnerOutcome[] = [
      ...onBase.map((r) => ({ playerId: r.playerId, from: r.base, to: 4 as Base, out: false, t: path.endT + (4 - r.base) * 5 })),
      { playerId: batter.playerId, from: 0 as const, to: 4 as Base, out: false, t: path.endT + 20 },
    ];
    return result({ hit: 4, runners: rs, runs: rs.map((r) => r.playerId), scoring: "HR", endT: path.endT + 20 });
  }
  // A fly caught before it lands is an out even if it would have bounced over the wall.
  const airFirst = path.groundRuleDouble ? bestAirCatch(path, fielders, park) : null;
  if (path.groundRuleDouble && !airFirst) {
    events.push({ t: path.endT, type: "ground_rule_double" });
    const rs: RunnerOutcome[] = [
      ...onBase.map((r) => ({ playerId: r.playerId, from: r.base, to: Math.min(4, r.base + 2) as Base, out: false, t: path.endT + 6 })),
      { playerId: batter.playerId, from: 0 as const, to: 2 as Base, out: false, t: path.endT + 7 },
    ];
    return result({
      hit: 2,
      runners: rs,
      runs: rs.filter((r) => r.to === 4).map((r) => r.playerId),
      scoring: "2B (GR)",
      endT: path.endT + 7,
    });
  }

  // Wrigley's ivy: a ball that dies in the vines before anyone can play it is two bases.
  if (path.lodged && path.wallT != null && !bestAirCatch(path, fielders, park)) {
    const first = groundChances(path, fielders, park, Math.min(path.firstLanding?.t ?? path.wallT, path.wallT))[0];
    if (!first || first.t >= path.wallT) {
      const t = path.wallT + 1.5;
      events.push({ t, type: "ground_rule_double" });
      const rs: RunnerOutcome[] = [
        ...onBase.map((r) => ({ playerId: r.playerId, from: r.base, to: Math.min(4, r.base + 2) as Base, out: false, t: t + 6 })),
        { playerId: batter.playerId, from: 0 as const, to: 2 as Base, out: false, t: t + 7 },
      ];
      return result({
        hit: 2,
        runners: rs,
        runs: rs.filter((r) => r.to === 4).map((r) => r.playerId),
        scoring: "2B (GR, ivy)",
        endT: t + 7,
      });
    }
  }

  // ---- 1. Can anyone catch it in the air? ----
  const air = bestAirCatch(path, fielders, park);
  let groundFrom = liveFrom(path);
  let missedBy: Fielder | null = null;
  if (air) {
    const p = air.dive
      ? 0.38 + 0.25 * air.f.glove
      : air.slack >= 0.5
        ? 0.993 - 0.006 * (0.5 - air.f.glove)
        : 0.86 + 0.25 * air.slack + 0.06 * air.f.glove;
    const ballAt = sampleAt(path, air.t);
    if (rng.chance(p)) {
      events.push({ t: air.t, type: air.dive ? "dive" : "catch", pos: air.f.pos, to: ballAt.p });
      return resolveCaughtFly(input, air.f, air.t, ballAt.p, events, result);
    }
    events.push({ t: air.t, type: air.dive ? "dive" : "drop", pos: air.f.pos, to: ballAt.p });
    if (!air.dive && !isFairPosition(ballAt.p)) {
      // A dropped foul fly is just a foul ball: the count moves, nobody advances.
      events.push({ t: air.t, type: "foul" });
      return result({ foul: true, endT: air.t + 1 });
    }
    if (!air.dive) {
      // Dropped a catchable ball: error; the fielder picks it up ~1 s later right there.
      return resolveGroundOrHit(input, { f: air.f, t: air.t + 1.0, p: ballAt.p, dive: false }, events, result, true);
    }
    missedBy = air.f;
    groundFrom = Math.max(groundFrom, air.t);
  }

  // Foul ball that leaves play or drops uncaught in foul ground.
  if (path.outOfPlayFoul && !path.firstLanding) {
    events.push({ t: path.endT, type: "foul" });
    return result({ foul: true });
  }

  // ---- 2. First fielder to the ball on the ground ----
  const chances = groundChances(path, fielders.filter((f) => f !== missedBy), park, groundFrom);
  let pick: GroundChance | null = null;
  for (const c of chances) {
    if (c.dive) {
      if (rng.chance(0.45 + 0.3 * c.f.glove)) {
        events.push({ t: c.t, type: "dive", pos: c.f.pos, to: c.p });
        pick = { ...c, t: c.t + 0.45 }; // getting up costs time
        break;
      }
      continue; // dove and missed — next fielder
    }
    pick = c;
    break;
  }
  if (!pick) pick = chances[chances.length - 1];

  if (!judgeFair(path, pick.t) || path.outOfPlayFoul) {
    events.push({ t: Math.min(pick.t, path.endT), type: "foul" });
    return result({ foul: true, endT: Math.min(pick.t, path.endT) });
  }

  // Fielding error on a routine chance.
  const errP = isInfielder(pick.f.pos) ? 0.017 - 0.012 * pick.f.glove : 0.008 - 0.006 * pick.f.glove;
  return resolveGroundOrHit(input, pick, events, result, rng.chance(errP));
}

/** Primary leads by base (ft), as in the runner plans. */
const LEAD_FT: Record<1 | 2 | 3, number> = { 1: 12, 2: 15, 3: 10 };

interface TagPlan {
  r: RunnerIn;
  from: 1 | 2 | 3;
  /** Feet off the bag when the ball is caught. */
  off: number;
  /** Time he's back on (or touching) his bag after the catch. */
  tBack: number;
  /** Route before the final leg (for the animation). */
  path: Array<{ t: number; s: number }>;
  advance: boolean;
  /** Arrival at the next base when advancing. */
  tRun: number;
  out: boolean;
  outT: number;
  doubledOff: boolean;
}

/**
 * A ball caught in the air with fewer than two outs (before the catch). Every runner has
 * to be on his bag after the catch: on a fly he goes back to tag (or hangs halfway if it
 * might fall), on a liner he's frozen off the bag and has to scramble back, and a runner
 * going on the pitch may not make it. After touching, he can try for the next base
 * against the throw (direct or relayed). The defense throws on the likeliest out —
 * doubling a runner off his bag or cutting down an advancing one.
 */
function resolveCaughtFly(
  input: PlayInput,
  f: Fielder,
  tCatch: number,
  at: V3,
  events: PlayEvent[],
  result: (p: Partial<PlayResult>) => PlayResult,
): PlayResult {
  const { runners, outs, rng, launch, fielders } = input;
  const kind = launch.la >= 50 ? "P" : launch.la >= 22 ? "F" : launch.la >= 10 ? "L" : "G";
  const scoring = `${kind}${POS_NUM[f.pos]}`;
  const rs: RunnerOutcome[] = [{ playerId: input.batter.playerId, from: 0, to: 1, out: true, t: tCatch }];
  if (outs + 1 >= 3) {
    return result({ outs: 1, caught: true, fieldedBy: f.pos, runners: rs, scoring, endT: tCatch + 1 });
  }
  const deep = horizDist(at);
  const liner = kind === "L" || kind === "G" || tCatch < 1.8;
  const pop = !liner && (kind === "P" || deep < 150);
  const outfield = isOutfielder(f.pos);
  // An infield or shallow pop holds everyone; a towering fly caught deep in the outfield is a
  // normal tag-up, timed like any other (the runner is already standing on the bag).
  const shallowPop = pop && (!outfield || deep < 150);
  const transfer = outfield ? 1.0 : liner ? 0.7 : 0.6;
  const tRelease = tCatch + transfer;
  const sit = input.situation;

  // Where the defense can get the ball to `base` (s after contact), and how.
  const plans = new Map<Base, ThrowPlan | null>();
  const planTo = (base: Base): ThrowPlan | null => {
    if (!plans.has(base)) {
      plans.set(base, horizDist(at, BASE_POS[base]) < 12 ? null : planThrow(f, at, tRelease, base, { fielders, relays: input.relays }));
    }
    return plans.get(base)!;
  };
  const ballAt = (base: Base): number => {
    const d = horizDist(at, BASE_POS[base]);
    // The fielder near the bag runs over and steps on it.
    if (d < 12) return tCatch + 0.2 + runTime(Math.max(0, d - 3), f.sprint);
    const plan = planTo(base)!;
    // Someone has to be on the bag to take it.
    const cover = fielders.find((x) => x.pos === plan.legs[plan.legs.length - 1].receiver);
    const coverT = cover ? cover.reaction + 0.15 + runTime(Math.max(0, horizDist(cover.p, BASE_POS[base]) - 2), cover.sprint) : 0;
    return Math.max(plan.arriveT, coverT + 0.1);
  };

  // ---- Each runner, lead first: where is he at the catch, and does he go? ----
  const tags: TagPlan[] = [];
  for (const base of [3, 2, 1] as const) {
    const r = runners[base - 1];
    if (!r) continue;
    const lead = LEAD_FT[base];
    const bag = base * 90;
    let tagIntent = false;
    let want: number; // where he means to be when the ball comes down
    if (liner) want = lead + 3;
    else if (pop) {
      // It hangs: plenty of time to stand on the bag.
      tagIntent = true;
      want = 0;
    } else {
      // A fly that may drop: tag if it's deep enough to move up on, else hang halfway.
      tagIntent = base === 3 || (base === 2 && deep > 200) || (base === 1 && deep > 280);
      want = tagIntent ? 0 : base === 2 ? 20 : 30;
    }
    const path: TagPlan["path"] = [];
    let off: number;
    let tBack: number;
    if (r.going) {
      // Running on the pitch: he's well down the line before he reads it and turns around.
      const tStop = liner ? tCatch + 0.15 : Math.min(tCatch, 0.75);
      const offStop = Math.min(84, lead + (base === 3 ? 22 : 26) + runDistance(tStop, r.sprint));
      const tTurn = tStop + 0.35;
      const tHome = tTurn + runTime(offStop, r.sprint);
      path.push({ t: tStop, s: bag + offStop }, { t: tTurn, s: bag + offStop });
      if (tCatch <= tTurn) off = offStop;
      else off = Math.max(want, offStop - runDistance(tCatch - tTurn, r.sprint));
      if (off > want + 0.5 || liner) tBack = tHome;
      else {
        // He made it back to his spot before the catch and waits there.
        const tAt = tTurn + runTime(offStop - want, r.sprint);
        path.push({ t: tAt, s: bag + want }, { t: tCatch + 0.1, s: bag + want });
        tBack = want > 0 ? tCatch + 0.15 + runTime(want, r.sprint) : tAt;
      }
    } else if (liner && base === 3 && outfield && tCatch > 1.1) {
      // A liner to the outfield with a man on third: he freezes, sees it carry, and gets
      // back to tag — nothing to gain from being off the bag on a ball in the air.
      const back = runDistance(tCatch - 0.55, r.sprint * 0.85);
      off = Math.max(0, want - back);
      const tOn = 0.55 + runTime(want, r.sprint * 0.85);
      path.push({ t: 0.45, s: bag + want });
      if (off > 0.5) {
        path.push({ t: tCatch, s: bag + off });
        tBack = tCatch + 0.1 + runTime(off, r.sprint);
      } else {
        path.push({ t: tOn, s: bag }, { t: tCatch, s: bag });
        off = 0;
        tBack = tCatch;
      }
    } else if (liner) {
      // Frozen in his secondary lead until the ball is caught.
      off = want;
      path.push({ t: Math.min(0.3, tCatch), s: bag + off }, { t: tCatch + 0.15, s: bag + off });
      // He breaks back on the catch and dives in: the last ~6 ft are the dive.
      tBack = tCatch + 0.1 + runTime(Math.max(0, off - 6), r.sprint) + 0.15;
    } else if (tagIntent) {
      // Back to the bag to tag while the ball is in the air.
      off = 0;
      const tOn = Math.min(tCatch - 0.4, 0.3 + runTime(lead, r.sprint * 0.7));
      path.push({ t: tOn, s: bag }, { t: tCatch, s: bag });
      tBack = tCatch;
    } else {
      off = want;
      const tOut = Math.max(0.4, Math.min(tCatch - 0.3, tCatch * 0.6));
      path.push({ t: tOut, s: bag + want }, { t: tCatch + 0.12, s: bag + want });
      tBack = tCatch + 0.12 + runTime(want, r.sprint);
    }

    // ---- Tag and go? ----
    let advance = false;
    let tRun = 0;
    const to = (base + 1) as Base;
    const ahead = tags.find((x) => x.from === to);
    const blocked = to <= 3 && !!runners[to - 1] && !ahead?.advance;
    if ((!liner || outfield) && !shallowPop && !blocked && (outfield || deep > 200)) {
      const onBag = off <= 0.5;
      // A rocking start timed to the catch; from halfway he has to get back and touch first.
      const tLeave = Math.max(tCatch, tBack) + (onBag ? 0.05 : 0.3);
      // Timed off a rocking start he's at speed in a few strides (MLB tag times ~3.4–3.9 s);
      // the hand reaches the bag a couple of feet before the body.
      tRun = tLeave + runTime(86, r.sprint, onBag ? 30 : 15);
      let margin = to === 4 ? (outs === 0 ? 0.25 : 0.1) : to === 3 ? (outs === 0 ? 0.3 : 0.55) : 0.35;
      if (sit && to === 4) {
        if (sit.inning >= 7 && sit.scoreDiff >= -1 && sit.scoreDiff <= 0) margin -= 0.1;
        else if (Math.abs(sit.scoreDiff) >= 4) margin += 0.15;
      }
      const perceived = ballAt(to) + rng.gauss(0, 0.25);
      advance = tRun + margin < perceived;
      if (advance) path.push({ t: tLeave - (onBag ? 0.05 : 0), s: bag });
    }
    tags.push({ r, from: base, off, tBack, path, advance, tRun, out: false, outT: 0, doubledOff: false });
  }

  // ---- The throw ----
  const options: ThrowOption[] = [];
  for (const g of tags) {
    if (g.advance) options.push({ base: (g.from + 1) as Base, runnerId: g.r.playerId, margin: g.tRun - ballAt((g.from + 1) as Base), force: false });
    else if (g.off > 0.5) options.push({ base: g.from, runnerId: g.r.playerId, margin: g.tBack - ballAt(g.from), force: true });
  }
  let target: Base | null = null;
  if (options.length) {
    const human = input.chooseThrow?.(options, { pos: f.pos, t: tCatch });
    if (human !== undefined) target = human;
    else {
      const best = [...options].sort((a, b) => b.margin - a.margin)[0];
      target = best.margin > -0.3 ? best.base : null;
    }
  }
  let outsMade = 1;
  const thrownAt = target != null ? options.find((o) => o.base === target) : undefined;
  const g = thrownAt && tags.find((x) => x.r.playerId === thrownAt.runnerId);
  if (target != null && g) {
    const plan = planTo(target);
    const tArr = ballAt(target);
    if (plan) pushLegs(events, plan.legs, target, plan);
    const spread = plan?.spread ?? 0.04;
    if (g.advance) {
      if (tArr + 0.12 < g.tRun + rng.gauss(0, Math.hypot(0.08, spread)) && outs + outsMade < 3) {
        g.out = true;
        g.outT = tagTime(tArr, g.tRun);
        outsMade += 1;
        events.push({ t: g.outT, type: "tag_out", base: target, playerId: g.r.playerId });
      }
    } else if (tArr + 0.05 < g.tBack + rng.gauss(0, Math.hypot(0.08, spread)) && outs + outsMade < 3) {
      // Doubled off: the ball beats him back to the bag.
      g.out = true;
      g.doubledOff = true;
      g.outT = tArr + 0.05;
      outsMade += 1;
      events.push({ t: g.outT, type: "force_out", base: target, playerId: g.r.playerId });
    }
  } else if (target != null && outfield) {
    pushLegs(events, [returnThrow(f, at, tRelease, fielders)], 2);
  } else if (outfield && tags.some((x) => x.advance)) {
    // Nobody to get: the ball comes back in to the relay man.
    pushLegs(events, [returnThrow(f, at, tRelease, fielders)], 2);
  }

  const runs: number[] = [];
  let sacFly = false;
  for (const x of tags) {
    if (x.doubledOff) {
      rs.push({ playerId: x.r.playerId, from: x.from, to: x.from, out: true, t: x.outT, arriveT: x.tBack, path: x.path });
    } else if (x.advance) {
      const to = (x.from + 1) as Base;
      rs.push({ playerId: x.r.playerId, from: x.from, to, out: x.out, t: x.out ? x.outT : x.tRun, arriveT: x.out ? x.tRun : undefined, path: x.path });
    } else {
      rs.push({ playerId: x.r.playerId, from: x.from, to: x.from, out: false, t: Math.max(tCatch, x.tBack), path: x.path });
    }
  }
  // Runs count if they cross before a third out (all time plays here).
  const thirdOut = outs + outsMade >= 3 ? rs.filter((x) => x.out && x.from !== 0).sort((a, b) => a.t - b.t)[2 - outs - 1] : undefined;
  for (const x of rs) {
    if (x.to !== 4 || x.out) continue;
    if (thirdOut && !(x.t < thirdOut.t)) continue;
    runs.push(x.playerId);
    // A sac fly is any caught fly an outfielder makes, high-angle pops included.
    sacFly = kind === "F" || kind === "L" || (kind === "P" && outfield);
    events.push({ t: x.t, type: "score", playerId: x.playerId });
  }
  events.sort((a, b) => a.t - b.t);
  return result({
    outs: outsMade,
    caught: true,
    fieldedBy: f.pos,
    runners: rs,
    runs,
    scoring: outsMade > 1 ? `${scoring} DP` : scoring,
    sacFly,
    doublePlay: outsMade > 1,
    endT: Math.max(tCatch + 1.5, ...rs.map((x) => x.t), ...events.map((e) => e.arriveT ?? e.t)),
  });
}

function resolveGroundOrHit(
  input: PlayInput,
  pick: GroundChance,
  events: PlayEvent[],
  result: (p: Partial<PlayResult>) => PlayResult,
  error: boolean,
): PlayResult {
  const { runners, outs, rng, batter, launch, path } = input;
  const f = pick.f;
  const tField = pick.t;
  const P = pick.p;
  events.push({ t: tField, type: error ? "error" : "field", pos: f.pos, to: P });

  const twoOuts = outs === 2;
  const grounder = launch.la < 10;
  // The catcher pouncing on a dribbler is an infield play too (a force at first, not a tag).
  const infieldPlay = (isInfielder(f.pos) || f.pos === "C") && horizDist(P) < 175 && grounder;
  const landT = path.firstLanding?.t ?? tField;

  // ---- Runner plans ----
  const plans: RunnerPlan[] = [];
  const forcedFrom = new Set<number>();
  if (runners[0]) {
    forcedFrom.add(1);
    if (runners[1]) {
      forcedFrom.add(2);
      if (runners[2]) forcedFrom.add(3);
    }
  }
  for (const base of [3, 2, 1] as const) {
    const r = runners[base - 1];
    if (!r) continue;
    const forced = forcedFrom.has(base);
    const lead = base === 1 ? 12 : base === 2 ? 15 : 10;
    // Start: contact with 2 outs or on forced grounders; else read the ball.
    let tGo = 0.1;
    let effLead = lead;
    if (!twoOuts && !grounder) {
      if (launch.la >= 22) {
        // Fly ball: go halfway, run once it drops.
        tGo = landT;
        effLead = 45;
      } else {
        // Liner: freeze for the read, then go once it's clearly through.
        tGo = Math.min(landT, 0.5);
        effLead = lead + 4;
      }
    }
    // Sent on the pitch: by contact he's ~a third of the way, and on a grounder or liner he keeps going.
    if (r.going && (grounder || launch.la < 22 || twoOuts)) {
      tGo = 0;
      effLead = lead + (base === 3 ? 22 : 26);
    }
    plans.push({ playerId: r.playerId, sprint: r.sprint, from: base, lead: effLead, tGo, target: (base + 1) as Base, forced, out: false, outT: 0, done: false });
  }
  const bPlan: RunnerPlan = {
    playerId: batter.playerId,
    sprint: batter.sprint,
    from: 0,
    lead: 0,
    // Out of the box: lefties are a step closer; a bunter is already moving as he squares.
    tGo: (batter.bats === "L" ? 0.2 : 0.3) - (batter.bunt ? 0.12 : 0),
    target: 1,
    forced: true,
    out: false,
    outT: 0,
    done: false,
  };
  plans.push(bPlan);

  // Error: everyone safe, one extra base for runners.
  if (error) {
    for (const p of plans) {
      p.target = Math.min(4, p.from === 0 ? 1 : p.from + 1 + (infieldPlay ? 0 : 1)) as Base;
    }
    return finish(input, plans, events, result, { error: true, fieldedBy: f.pos, hitBases: 0, scoring: `E${POS_NUM[f.pos]}` });
  }

  const transfer = (isInfielder(f.pos) ? 0.55 : 0.85) + (pick.dive ? 0.35 : 0);
  const tRelease = tField + transfer;
  // Outfielders throw direct or through a relay, whichever gets there first (arm-dependent).
  const planCache = new Map<Base, ThrowPlan>();
  const planFor = (base: Base): ThrowPlan => {
    let p = planCache.get(base);
    if (!p) planCache.set(base, (p = planThrow(f, P, tRelease, base, { fielders: input.fielders, relays: input.relays })));
    return p;
  };
  const throwArrive = (base: Base) => {
    const d = horizDist(P, BASE_POS[base]);
    // Fielder near the bag just steps on it.
    if (d < 10) return tField + runTime(d, f.sprint) + 0.05;
    // The ball can't beat the man who has to catch it to the bag.
    if (isOutfielder(f.pos)) {
      const plan = planFor(base);
      return Math.max(plan.arriveT, coverReady(input.fielders, plan.legs[plan.legs.length - 1].receiver, base) + 0.1);
    }
    return Math.max(tRelease + throwTime(P, BASE_POS[base], f.arm), coverReady(input.fielders, coverMan(base, [f.pos]), base) + 0.1);
  };

  if (infieldPlay) {
    // An infielder throws to whoever covers — or, when the cover man can't get there in
    // time (a first baseman far off the bag waiting on the pitcher), runs it over himself.
    const take = (base: Base): InfieldTake => {
      const d = horizDist(P, BASE_POS[base]);
      const self = tField + runTime(d, f.sprint) + 0.05;
      if (d < 10) return { t: self, self: true };
      const receiver = infieldCover(base, f.pos);
      const thrown = Math.max(tRelease + throwTime(P, BASE_POS[base], f.arm), coverReady(input.fielders, receiver, base) + 0.1);
      return thrown <= self ? { t: thrown, self: false, receiver } : { t: self, self: true };
    };
    return resolveInfieldGrounder(input, f, P, tField, plans, take, events, result);
  }

  // ---- Ball fielded in the outfield (a hit): runners pick bases vs. the throw ----
  // Lead runners first; a trailing runner can't pass the one ahead.
  let ceiling: Base = 4;
  for (const p of plans) {
    let target: Base = Math.min(ceiling, Math.max(p.from + 1, 1)) as Base;
    // Coaches send runners on plays they win ~70% of the time; batters are more conservative.
    const aggr = p.from === 0 ? 0.3 : -0.05;
    while (target < 4 && target + 1 <= ceiling) {
      const next = (target + 1) as Base;
      const perceived = throwArrive(next) + rng.gauss(0, 0.3);
      if (arrival(p, next) + aggr < perceived) target = next;
      else break;
    }
    p.target = target;
    ceiling = (target === 4 ? 4 : Math.max(1, target - 1)) as Base;
  }
  const hitBases = Math.min(3, bPlan.target) as 1 | 2 | 3;

  // Defense throws where an out is likeliest among advancing runners.
  const options: ThrowOption[] = plans
    .filter((p) => p.target > (p.from || 0))
    .map((p) => ({ base: p.target, runnerId: p.playerId, margin: arrival(p, p.target) - throwArrive(p.target), force: false }));
  let target: Base | null = null;
  const human = input.chooseThrow?.(options, { pos: f.pos, t: tField });
  if (human !== undefined) target = human;
  else {
    const best = [...options].sort((a, b) => b.margin - a.margin)[0];
    target = best && best.margin > -0.3 ? best.base : null;
  }
  if (target == null) {
    // No play: the ball comes back in to the relay man (or second base on a short one).
    pushLegs(events, [returnThrow(f, P, tRelease, input.fielders)], 2);
  }
  if (target != null) {
    const plan: ThrowPlan | null = horizDist(P, BASE_POS[target]) < 10 ? null : isOutfielder(f.pos) ? planFor(target) : null;
    const tArr = throwArrive(target);
    const legs: ThrowLeg[] = plan
      ? plan.legs.map((l) => ({ ...l }))
      : [{ pos: f.pos, from: P, to: BASE_POS[target], t: tRelease, arriveT: tArr, receiver: coverMan(target, [f.pos]), cutoff: false, dist: horizDist(P, BASE_POS[target]) }];
    const spread = plan?.spread ?? 0.05;
    const runner = plans.find((p) => p.target === target);
    let leadSafe = true;
    if (runner && !runner.done) {
      const tRun = arrival(runner, target);
      const throwErr = rng.chance(plan?.errP ?? 0.012);
      if (throwErr) {
        pushLegs(events, legs, target, plan);
        events.push({ t: tArr, type: "error", base: target });
        for (const p of plans) p.target = Math.min(4, p.target + 1) as Base;
        return finish(input, plans, events, result, { error: true, fieldedBy: f.pos, hitBases, scoring: hitLabel(hitBases, f.pos) + " +E" });
      }
      // A runner forced to this bag (the batter at first, say) is out when the ball gets there;
      // anyone else has to be tagged.
      const force = runner.forced && target === runner.from + 1;
      if ((force ? tArr : tArr + 0.12) < tRun + rng.gauss(0, Math.hypot(0.07, spread))) {
        runner.out = true;
        runner.outT = force ? tArr : tagTime(tArr, tRun);
        leadSafe = false;
        events.push({ t: runner.outT, type: force ? "force_out" : "tag_out", base: target, playerId: runner.playerId });
      }
    }
    // Trailing runners move up on the throw when the base ahead is open.
    const movedUp: RunnerPlan[] = [];
    for (const p of [...plans].sort((a, b) => b.target - a.target)) {
      if (p.out || p.target >= target || p.target >= 3) continue;
      const next = (p.target + 1) as Base;
      if (plans.some((q) => q !== p && !q.out && q.target === next)) continue;
      if (arrival(p, next) < tArr + 0.55) {
        p.target = next;
        movedUp.push(p);
      }
    }
    // Cut it! The lead runner beats the throw, so the cutoff (or relay) man takes it and
    // goes after the trailer moving up on the throw.
    const cutMan = plan?.cutoffMan
      ? { pos: plan.cutoffMan.pos, p: plan.cutoffMan.p, t: plan.cutoffMan.passT }
      : plan?.kind === "relay"
        ? { pos: legs[0].receiver, p: legs[0].to, t: legs[0].arriveT }
        : null;
    const trailer = movedUp[0];
    const cutter = cutMan && input.fielders.find((x) => x.pos === cutMan.pos);
    if (cutMan && cutter && trailer && leadSafe && runner && arrival(runner, target) < tArr - 0.05 && outs + plans.filter((p) => p.out).length < 3) {
      const nb = trailer.target;
      const out = cutMan.t + exchangeTime(cutter.glove) * 0.8;
      const tCut = out + legTime(horizDist(cutMan.p, BASE_POS[nb]), cutter.arm);
      const cutLegs: ThrowLeg[] = [
        { ...legs[0], to: cutMan.p, arriveT: cutMan.t, receiver: cutMan.pos, cutoff: true },
        { pos: cutMan.pos, from: cutMan.p, to: BASE_POS[nb], t: out, arriveT: tCut, receiver: coverMan(nb, [f.pos, cutMan.pos]), cutoff: false, dist: 0 },
      ];
      pushLegs(events, cutLegs, nb);
      if (tCut + 0.12 < arrival(trailer, nb) + rng.gauss(0, 0.08)) {
        trailer.out = true;
        trailer.outT = tagTime(tCut, arrival(trailer, nb));
        events.push({ t: trailer.outT, type: "tag_out", base: nb, playerId: trailer.playerId });
      }
    } else {
      pushLegs(events, legs, target, plan);
    }
  }
  return finish(input, plans, events, result, { fieldedBy: f.pos, hitBases, scoring: hitLabel(hitBases, f.pos) });
}

/** Record a (possibly multi-leg) throw as throw events. */
function pushLegs(events: PlayEvent[], legs: ThrowLeg[], base: Base, plan?: ThrowPlan | null): void {
  legs.forEach((l, i) => {
    const e: PlayEvent = { t: l.t, type: "throw", pos: l.pos, from: l.from, to: l.to, base, arriveT: l.arriveT };
    if (l.receiver) e.receiver = l.receiver;
    if (l.cutoff) e.cutoff = true;
    if (i === legs.length - 1 && plan?.cutoffMan && plan.kind === "direct") e.lineup = { pos: plan.cutoffMan.pos, p: plan.cutoffMan.p };
    events.push(e);
  });
}

function hitLabel(bases: number, pos: FieldPos): string {
  return `${["", "1B", "2B", "3B"][bases]}${POS_NUM[pos]}`;
}

/** How an infielder gets the ball to a base: thrown to the cover man, or carried himself. */
interface InfieldTake {
  /** Ball (and a fielder on the bag) there, s after contact. */
  t: number;
  self: boolean;
  receiver?: FieldPos;
}

function resolveInfieldGrounder(
  input: PlayInput,
  f: Fielder,
  P: V3,
  tField: number,
  plans: RunnerPlan[],
  take: (b: Base) => InfieldTake,
  events: PlayEvent[],
  result: (p: Partial<PlayResult>) => PlayResult,
): PlayResult {
  const { outs, rng, fielders } = input;
  const throwArrive = (b: Base) => take(b).t;
  const twoOuts = outs === 2;
  // Non-forced runners: 3rd holds unless 2 outs; 2nd advances on balls to the right side.
  for (const p of plans) {
    if (p.forced || twoOuts) continue;
    if (p.from === 3) {
      // Contact play: break for home when the throw there would be late; otherwise hold.
      const go = arrival({ ...p, target: 4 }, 4) + 0.15 < throwArrive(4) + rng.gauss(0, 0.15);
      p.target = go ? 4 : 3;
    }
    if (p.from === 2) {
      const rightSide = f.pos === "1B" || f.pos === "2B";
      p.target = rightSide ? 3 : 2;
      if (p.target === 2) p.done = true;
    }
    if (p.target === p.from) p.done = true;
  }

  const forcedPlans = plans.filter((p) => p.forced);
  const options: ThrowOption[] = forcedPlans.map((p) => ({
    base: p.target,
    runnerId: p.playerId,
    margin: arrival(p, p.target) - throwArrive(p.target),
    force: true,
  }));
  let target: Base | null;
  const human = input.chooseThrow?.(options, { pos: f.pos, t: tField });
  // Holding the ball is always allowed; a base with no force on it is no choice at all (the AI picks).
  if (human === null || (human !== undefined && options.some((o) => o.base === human))) target = human;
  else {
    // Lead force if comfortably available, else the surest out; close plays at 1st still get thrown.
    // With fewer than two outs, go to second for the double play when it's there; an
    // infielder standing on a bag takes the free force; otherwise the lead runner if comfortable.
    const onBag = options.find((o) => horizDist(P, BASE_POS[o.base]) < 10 && o.margin > 0);
    const dpStart = outs < 2 ? options.find((o) => o.base === 2 && o.margin > 0.25) : undefined;
    const lead = [...options].sort((a, b) => b.base - a.base).find((o) => o.margin > 0.35);
    const surest = [...options].sort((a, b) => b.margin - a.margin)[0];
    target = onBag?.base ?? dpStart?.base ?? lead?.base ?? (surest && surest.margin > -0.25 ? surest.base : null);
  }
  let outsMade = 0;
  let dp = false;
  let fc = false;
  let pivotPos: FieldPos = "2B";
  let firstTake: InfieldTake | null = null;
  const runner = target != null ? forcedPlans.find((p) => p.target === target) : undefined;
  if (target != null && runner) {
    const tk = (firstTake = take(target));
    const tArr = tk.t;
    if (!tk.self) {
      events.push({ t: tField + 0.55, type: "throw", pos: f.pos, from: P, to: BASE_POS[target], base: target, arriveT: tArr, receiver: tk.receiver });
    }
    if (rng.chance(!tk.self ? 0.01 : 0.001)) {
      events.push({ t: tArr, type: "error", base: target });
      for (const p of plans) p.target = Math.min(4, (p.done ? p.target : p.target + 1)) as Base;
      return finish(input, plans, events, result, { error: true, fieldedBy: f.pos, hitBases: 0, scoring: `E${POS_NUM[f.pos]}` });
    }
    if (tArr < arrival(runner, target) + rng.gauss(0, 0.06)) {
      runner.out = true;
      runner.outT = tArr;
      outsMade = 1;
      events.push({ t: tArr, type: "force_out", base: target, playerId: runner.playerId });
      if (runner.from !== 0) fc = true;
      // Turn two: relay to first after the force at 2nd/3rd/home.
      if (target !== 1 && outs + 1 < 3) {
        // The man who took the force (the fielder himself on an unassisted one) turns it.
        pivotPos = tk.self ? f.pos : tk.receiver!;
        const pivot = fielders.find((x) => x.pos === pivotPos) ?? f;
        // First is covered by the first baseman — by the pitcher if the first baseman fielded it.
        const firstCover = infieldCover(1, f.pos === "1B" ? "1B" : pivotPos);
        const tRelay = Math.max(
          tArr + (target === 4 ? 0.55 : 0.7) + throwTime(BASE_POS[target], BASE_POS[1], pivot.arm),
          coverReady(fielders, firstCover, 1) + 0.1,
        );
        const b = plans.find((p) => p.from === 0)!;
        const relay: PlayEvent = { t: tArr + 0.7, type: "throw", pos: pivotPos, from: BASE_POS[target], to: BASE_POS[1], base: 1, arriveT: tRelay, receiver: firstCover };
        if (tRelay < arrival(b, 1) + rng.gauss(0, 0.07)) {
          events.push(relay);
          b.out = true;
          b.outT = tRelay;
          outsMade = 2;
          dp = true;
          fc = false;
          events.push({ t: tRelay, type: "force_out", base: 1, playerId: b.playerId });
        } else {
          events.push(relay);
        }
      }
    }
  }
  const batterOut = plans.find((p) => p.from === 0)!.out;
  // An infield single: no throw made or the throw lost the race to first, with no out elsewhere.
  const infieldHit = !batterOut && outsMade === 0 && (target === null || target === 1);
  const relayTo = dp ? [...events].reverse().find((e) => e.type === "throw" && e.base === 1)?.receiver ?? "1B" : "1B";
  const seq = dp
    ? `${POS_NUM[f.pos]}${pivotPos === f.pos ? "" : `-${POS_NUM[pivotPos]}`}-${POS_NUM[relayTo]} DP`
    : `${POS_NUM[f.pos]}${target === 1 && batterOut && firstTake && !firstTake.self ? `-${POS_NUM[firstTake.receiver!]}` : target === 1 ? "U" : ""}`;
  return finish(input, plans, events, result, {
    fieldedBy: f.pos,
    hitBases: infieldHit ? 1 : 0,
    scoring: infieldHit ? `1B${POS_NUM[f.pos]}` : fc ? `FC${POS_NUM[f.pos]}` : seq,
    doublePlay: dp,
    fieldersChoice: fc,
  });
}

function finish(
  input: PlayInput,
  plans: RunnerPlan[],
  events: PlayEvent[],
  result: (p: Partial<PlayResult>) => PlayResult,
  meta: {
    fieldedBy: FieldPos;
    hitBases: number;
    scoring: string;
    error?: boolean;
    doublePlay?: boolean;
    fieldersChoice?: boolean;
  },
): PlayResult {
  const { outs } = input;
  const outsMade = plans.filter((p) => p.out).length;
  const rs: RunnerOutcome[] = plans.map((p) => ({
    playerId: p.playerId,
    from: p.from,
    to: p.target,
    out: p.out,
    t: p.out ? p.outT : p.done ? 0 : arrival(p, p.target),
    arriveT: p.out ? arrival(p, p.target) : undefined,
  }));
  // Third-out rule: no runs if the third out is a force (or the batter before 1st); else time play.
  let runs = rs.filter((r) => r.to === 4 && !r.out);
  if (outs + outsMade >= 3) {
    const outsSorted = rs.filter((r) => r.out).sort((a, b) => a.t - b.t);
    const third = outsSorted[2 - outs];
    const plan = third && plans.find((p) => p.playerId === third.playerId);
    // A force applies only at the next base: the batter thrown out at first, or a forced runner at the
    // base he was forced to. A runner tagged going for an extra base is a time play.
    const isForce = third && third.to === third.from + 1 && (third.from === 0 || plan?.forced);
    runs = isForce ? [] : runs.filter((r) => r.t < third.t);
  }
  for (const r of runs) events.push({ t: r.t, type: "score", playerId: r.playerId });
  events.sort((a, b) => a.t - b.t);
  return result({
    outs: outsMade,
    runners: rs,
    runs: runs.map((r) => r.playerId),
    hit: (meta.error ? 0 : Math.min(3, meta.hitBases)) as 0 | 1 | 2 | 3,
    error: meta.error ?? false,
    fieldedBy: meta.fieldedBy,
    scoring: meta.scoring,
    doublePlay: meta.doublePlay ?? false,
    fieldersChoice: meta.fieldersChoice ?? false,
    endT: Math.max(input.path.firstLanding?.t ?? 0, ...rs.map((r) => r.t), ...events.map((e) => e.arriveT ?? e.t)) + 0.5,
  });
}
