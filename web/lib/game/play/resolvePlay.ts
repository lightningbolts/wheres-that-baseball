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
import { BASE_POS, runTime, throwTime } from "@/lib/game/play/movement";
import { isInfielder, isOutfielder, type Fielder } from "@/lib/game/play/defense";
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
/** Real routes aren't straight lines at full speed: judging the ball costs distance. */
const ROUTE_EFF = { outfield: 1.13, infield: 1.06 };

function slack(f: Fielder, s: BallSample, reach: number): number {
  const d = Math.max(0, horizDist(f.p, s.p) * (isOutfielder(f.pos) ? ROUTE_EFF.outfield : ROUTE_EFF.infield) - reach);
  return s.t - f.reaction - runTime(d, f.sprint);
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

function bestAirCatch(path: BattedBallPath, fielders: Fielder[], park: Park): AirChance | null {
  const landT = path.firstLanding?.t ?? path.endT;
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
    for (const s of path.samples) {
      if (s.t < from || s.p.y > 3 || !inPlayableArea(s, park)) continue;
      if (slack(f, s, GROUND_REACH) >= 0) {
        found = { f, t: s.t, p: s.p, dive: false };
        break;
      }
      if (!diveFound && isInfielder(f.pos) && s.t < from + 1.2 && slack(f, s, IF_DIVE_REACH) >= 0) {
        diveFound = { f, t: s.t, p: s.p, dive: true };
      }
    }
    if (!found) {
      // The ball eventually stops (or sits at the wall): everyone can get to it.
      const last = path.samples[path.samples.length - 1];
      const d = Math.max(0, horizDist(f.p, last.p) - GROUND_REACH);
      found = { f, t: Math.max(last.t, f.reaction + runTime(d, f.sprint)), p: last.p, dive: false };
    }
    if (diveFound && diveFound.t < found.t - 0.25) out.push(diveFound);
    out.push(found);
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

  // ---- 1. Can anyone catch it in the air? ----
  const air = bestAirCatch(path, fielders, park);
  let groundFrom = path.firstLanding?.t ?? path.endT;
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

function resolveCaughtFly(
  input: PlayInput,
  f: Fielder,
  tCatch: number,
  at: V3,
  events: PlayEvent[],
  result: (p: Partial<PlayResult>) => PlayResult,
): PlayResult {
  const { runners, outs, rng, launch } = input;
  const kind = launch.la >= 50 ? "P" : launch.la >= 22 ? "F" : launch.la >= 10 ? "L" : "G";
  const scoring = `${kind}${POS_NUM[f.pos]}`;
  const rs: RunnerOutcome[] = [{ playerId: input.batter.playerId, from: 0, to: 1, out: true, t: tCatch }];
  let outsMade = 1;
  const runs: number[] = [];
  let sacFly = false;
  if (outs + 1 >= 3) {
    return result({ outs: 1, caught: true, fieldedBy: f.pos, runners: rs, scoring, endT: tCatch + 1 });
  }
  // Tag-ups, lead runner first: go if he beats the throw by a safe margin.
  const transfer = isOutfielder(f.pos) ? 1.0 : 0.7;
  let throwUsed = false;
  for (const base of [3, 2, 1] as const) {
    const r = runners[base - 1];
    if (!r) continue;
    const to = (base + 1) as Base;
    // Runners can't advance into an occupied base that isn't also moving.
    const blocked = to <= 3 && runners[to - 1] && !rs.some((x) => x.from === to && x.to > to && !x.out);
    const tRun = tCatch + 0.05 + runTime(90, r.sprint); // rocking start timed to the catch
    const tThrow = tCatch + transfer + throwTime(at, BASE_POS[to], f.arm);
    const deep = horizDist(at);
    const goMargin = to === 4 ? 0.15 : 0.3; // aggressive to score, conservative to 3rd
    const perceived = tThrow + rng.gauss(0, 0.25);
    const tries = !blocked && deep > (to === 4 ? 160 : 200) && tRun + goMargin < perceived && kind !== "P";
    if (!tries) {
      rs.push({ playerId: r.playerId, from: base, to: base as Base, out: false, t: tCatch });
      continue;
    }
    let out = false;
    if (!throwUsed) {
      throwUsed = true;
      events.push({ t: tCatch + transfer, type: "throw", pos: f.pos, from: at, to: BASE_POS[to], base: to, arriveT: tThrow });
      out = tThrow + 0.12 < tRun + rng.gauss(0, 0.08) && outs + outsMade < 3;
    }
    if (out) {
      outsMade += 1;
      events.push({ t: tThrow + 0.12, type: "tag_out", base: to, playerId: r.playerId });
      rs.push({ playerId: r.playerId, from: base, to, out: true, t: tThrow + 0.12 });
    } else {
      rs.push({ playerId: r.playerId, from: base, to, out: false, t: tRun });
      if (to === 4) {
        // Run counts if he touches home before a third out (a time play).
        const thirdOut = rs.find((x) => x.out && x.from !== 0 && outs + outsMade >= 3);
        if (!thirdOut || tRun < thirdOut.t) {
          runs.push(r.playerId);
          sacFly = kind === "F" || kind === "L";
          events.push({ t: tRun, type: "score", playerId: r.playerId });
        }
      }
    }
  }
  return result({
    outs: outsMade,
    caught: true,
    fieldedBy: f.pos,
    runners: rs,
    runs,
    scoring: outsMade > 1 ? `${scoring} DP` : scoring,
    sacFly,
    doublePlay: outsMade > 1,
    endT: Math.max(tCatch + 1.5, ...rs.map((x) => x.t)),
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
  const infieldPlay = isInfielder(f.pos) && horizDist(P) < 175 && grounder;
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
  const throwArrive = (base: Base) => {
    const d = horizDist(P, BASE_POS[base]);
    // Fielder near the bag just steps on it.
    if (d < 10) return tField + runTime(d, f.sprint) + 0.05;
    return tField + transfer + throwTime(P, BASE_POS[base], f.arm);
  };

  if (infieldPlay) {
    return resolveInfieldGrounder(input, f, P, tField, plans, throwArrive, events, result);
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
    // No play: the ball comes back in to the cutoff man at second.
    events.push({ t: tField + transfer, type: "throw", pos: f.pos, from: P, to: BASE_POS[2], base: 2, arriveT: throwArrive(2) });
  }
  if (target != null) {
    const tArr = throwArrive(target);
    events.push({ t: tField + transfer, type: "throw", pos: f.pos, from: P, to: BASE_POS[target], base: target, arriveT: tArr });
    const runner = plans.find((p) => p.target === target);
    if (runner && !runner.done) {
      const tRun = arrival(runner, target);
      const throwErr = rng.chance(0.012);
      if (throwErr) {
        events.push({ t: tArr, type: "error", base: target });
        for (const p of plans) p.target = Math.min(4, p.target + 1) as Base;
        return finish(input, plans, events, result, { error: true, fieldedBy: f.pos, hitBases, scoring: hitLabel(hitBases, f.pos) + " +E" });
      }
      if (tArr + 0.12 < tRun + rng.gauss(0, 0.07)) {
        runner.out = true;
        runner.outT = tArr + 0.12;
        events.push({ t: runner.outT, type: "tag_out", base: target, playerId: runner.playerId });
      }
    }
    // Trailing runners move up on the throw when the base ahead is open and the cutoff can't stop them.
    for (const p of [...plans].sort((a, b) => b.target - a.target)) {
      if (p.out || p.target >= target || p.target >= 3) continue;
      const next = (p.target + 1) as Base;
      if (plans.some((q) => q !== p && !q.out && q.target === next)) continue;
      if (arrival(p, next) < tArr + 0.55) p.target = next;
    }
  }
  return finish(input, plans, events, result, { fieldedBy: f.pos, hitBases, scoring: hitLabel(hitBases, f.pos) });
}

function hitLabel(bases: number, pos: FieldPos): string {
  return `${["", "1B", "2B", "3B"][bases]}${POS_NUM[pos]}`;
}

function resolveInfieldGrounder(
  input: PlayInput,
  f: Fielder,
  P: V3,
  tField: number,
  plans: RunnerPlan[],
  throwArrive: (b: Base) => number,
  events: PlayEvent[],
  result: (p: Partial<PlayResult>) => PlayResult,
): PlayResult {
  const { outs, rng, fielders } = input;
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
  if (human !== undefined) target = human;
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
  if (target != null) {
    const runner = forcedPlans.find((p) => p.target === target)!;
    const tArr = throwArrive(target);
    const d = horizDist(P, BASE_POS[target]);
    if (d >= 10) {
      events.push({ t: tField + 0.55, type: "throw", pos: f.pos, from: P, to: BASE_POS[target], base: target, arriveT: tArr });
    }
    if (rng.chance(d >= 10 ? 0.01 : 0.001)) {
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
        pivotPos = target === 2 ? (f.pos === "SS" || f.pos === "3B" ? "2B" : "SS") : target === 3 ? "3B" : "C";
        const pivot = fielders.find((x) => x.pos === pivotPos) ?? f;
        const tRelay = tArr + (target === 4 ? 0.55 : 0.7) + throwTime(BASE_POS[target], BASE_POS[1], pivot.arm);
        const b = plans.find((p) => p.from === 0)!;
        if (tRelay < arrival(b, 1) + rng.gauss(0, 0.07)) {
          events.push({ t: tArr + 0.7, type: "throw", pos: pivotPos, from: BASE_POS[target], to: BASE_POS[1], base: 1, arriveT: tRelay });
          b.out = true;
          b.outT = tRelay;
          outsMade = 2;
          dp = true;
          fc = false;
          events.push({ t: tRelay, type: "force_out", base: 1, playerId: b.playerId });
        } else {
          events.push({ t: tArr + 0.7, type: "throw", pos: pivotPos, from: BASE_POS[target], to: BASE_POS[1], base: 1, arriveT: tRelay });
        }
      }
    }
  }
  const batterOut = plans.find((p) => p.from === 0)!.out;
  // An infield single: no throw made or the throw lost the race to first, with no out elsewhere.
  const infieldHit = !batterOut && outsMade === 0 && (target === null || target === 1);
  const seq = dp ? `${POS_NUM[f.pos]}-${POS_NUM[pivotPos]}-3 DP` : `${POS_NUM[f.pos]}${target === 1 && batterOut && horizDist(P, BASE_POS[1]) >= 10 ? "-3" : target === 1 ? "U" : ""}`;
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
