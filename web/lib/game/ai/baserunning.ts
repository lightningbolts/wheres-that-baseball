/**
 * Stolen bases — 2nd, 3rd, home and double steals: a timing race between each
 * runner's jump and the pitcher's delivery + the catcher's pop time (Savant) +
 * throw, using the same movement model as plays. The defense plays on the lead
 * runner; trailing runners on a double steal take their base.
 */
import { runTime, throwTime, BASE_POS } from "@/lib/game/play/movement";
import type { BaseballGame, Runner } from "@/lib/game/rules/game";
import type { Rng } from "@/lib/game/math";

/** Base a runner leaves: 0 = first (steals 2nd), 1 = second (3rd), 2 = third (home). */
export type StealFrom = 0 | 1 | 2;

/** Primary lead by base: off first, a walking lead off second, a short one off third. */
const LEAD_FT: Record<StealFrom, number> = { 0: 13, 1: 25, 2: 15 };
/** Hand reaches the bag while the body is still sliding in (the plate is swept late). */
const SLIDE_FT: Record<StealFrom, number> = { 0: 8, 1: 8, 2: 5 };
/** Pitcher's first move → ball in the mitt (MLB ~1.3 s from the stretch). */
const DELIVERY_S = 1.35;
const CATCHER_TRANSFER_S = 0.72;
const TAG_S = 0.12;
const RUNNER_JUMP_S = 0.2;
/** League pop time to second on steal attempts (Savant), s. */
const LEAGUE_POP = 1.96;
/** Base stealers start from a crossover lean: harder first steps than a batter out of the box. */
const STEAL_ACCEL = 20;

export interface StealLeg {
  from: StealFrom;
  runnerId: number;
  /** Runner's time to the bag, s. */
  time: number;
}

export interface StealRace {
  /** Every runner going, lead runner first. */
  legs: StealLeg[];
  /** Lead runner — the one the defense plays on. */
  target: StealFrom;
  runner: number;
  defense: number;
}

/** Keep only legal attempts: a runner goes only if the next base is empty or its runner goes too. */
export function legalSteals(bases: readonly (Runner | null)[], froms: readonly StealFrom[]): StealFrom[] {
  const want = new Set(froms.filter((f) => bases[f]));
  const out: StealFrom[] = [];
  for (const f of [2, 1, 0] as StealFrom[]) {
    if (!want.has(f)) continue;
    if (f === 2 || !bases[f + 1] || out.includes((f + 1) as StealFrom)) out.push(f);
  }
  return out;
}

/** Bases a human may try to steal right now (each alone; combine for double steals). */
export function stealOptions(bases: readonly (Runner | null)[]): StealFrom[] {
  return ([0, 1, 2] as StealFrom[]).filter((f) => bases[f] && (f === 2 || !bases[f + 1]));
}

function catcherPop(game: BaseballGame): { arm: number; pop: number } {
  const c = game.fielding.lineup.find((b) => b.pos === "C");
  const f = game.fielders().find((x) => x.pos === "C");
  return { arm: f?.arm ?? c?.arm ?? 80, pop: c?.popTime ?? LEAGUE_POP };
}

export interface RunnerCraft {
  leadFt: number;
  jumpS: number;
  aggr: number;
}
const NO_CRAFT: RunnerCraft = { leadFt: 0, jumpS: 0, aggr: 1 };

/** The runner's base-stealing craft (lead, jump, aggressiveness) from his Savant record. */
export function craftOf(game: BaseballGame, playerId: number): RunnerCraft {
  const b = game.batting.lineup.find((x) => x.id === playerId) ?? game.batting.team.bench.find((x) => x.id === playerId);
  return b?.steal ?? NO_CRAFT;
}

export function legTime(from: StealFrom, sprint: number, craft: RunnerCraft = NO_CRAFT): number {
  return RUNNER_JUMP_S + craft.jumpS + runTime(90 - LEAD_FT[from] - craft.leadFt - SLIDE_FT[from], sprint, STEAL_ACCEL);
}

export function stealRace(game: BaseballGame, froms: readonly StealFrom[] = [0]): StealRace | null {
  const legal = legalSteals(game.bases, froms);
  if (!legal.length) return null;
  const legs: StealLeg[] = legal.map((from) => {
    const r = game.bases[from]!;
    // Out of free throw-overs, the pitcher can't hold him: a longer lead (~1.5 ft).
    const extra = game.disengagements >= 2 ? 0.05 : 0;
    return { from, runnerId: r.playerId, time: legTime(from, r.sprint, craftOf(game, r.playerId)) - extra };
  });
  const lead = legs[0];
  const { arm, pop } = catcherPop(game);
  let defense: number;
  if (lead.from === 2) {
    // Straight steal of home: the pitch itself beats him unless the pitcher is slow to the plate.
    defense = DELIVERY_S + TAG_S + 0.05;
  } else {
    const target = lead.from === 0 ? BASE_POS[2] : BASE_POS[3];
    defense = DELIVERY_S + CATCHER_TRANSFER_S + throwTime(BASE_POS[4], target, arm) + TAG_S + (pop - LEAGUE_POP);
  }
  return { legs, target: lead.from, runner: lead.time, defense };
}

/**
 * CPU decision for this pitch: which runners go (MLB: ~0.75 attempts per team-game,
 * ~79% success; steals of third ~1 in 8 attempts, home almost never).
 */
export function cpuWantsSteal(game: BaseballGame, rng: Rng): StealFrom[] | null {
  if (game.outs === 2 && Math.abs(game.score.home - game.score.away) > 3) return null;
  const b = game.bases;
  const roll = rng.next();
  // A pitcher who has used his throw-overs can't keep the runner close: he gets a bigger
  // lead (see stealRace), and he knows it (Statcast: attempts per pitch roughly 4x after
  // one disengagement, 7x after two; partly selection, so this is milder).
  const dis = Math.min(2, game.disengagements);
  const boost = [1, 1.4, 1.9][dis];
  // Steal of second (also the trailing half of a double steal).
  const second = b[0] && !b[1] ? stealRace(game, [0]) : null;
  if (second) {
    const edge = second.defense - second.runner;
    const aggr = craftOf(game, b[0]!.playerId).aggr;
    if (edge >= -0.05 && roll < Math.min(0.16 * boost, (0.025 + edge * 0.2) * Math.sqrt(aggr) * boost)) return [0];
    return null;
  }
  // Steal of third (never with two outs — a runner on second already scores on a single).
  const third = b[1] && !b[2] && game.outs < 2 ? stealRace(game, b[0] ? [1, 0] : [1]) : null;
  if (third) {
    const edge = third.defense - third.runner;
    const aggr = craftOf(game, b[1]!.playerId).aggr;
    if (edge >= 0.08 && roll < Math.min(0.07, (0.006 + edge * 0.08) * Math.sqrt(aggr))) return third.legs.map((l) => l.from);
  }
  return null;
}

/** Outcome per leg (lead runner first): the lead runner races the throw, the rest are safe. */
export function resolveSteal(race: StealRace, rng: Rng): { from: StealFrom; safe: boolean }[] {
  const leadSafe = race.runner + rng.gauss(0, 0.14) < race.defense + rng.gauss(0, 0.1);
  return race.legs.map((l, i) => ({ from: l.from, safe: i === 0 ? leadSafe : true }));
}

/**
 * Slower pitches give the runner time: the ball's flight to the plate adds to the
 * defense's clock (a 95 mph fastball ≈ 0.43 s, an 82 mph curve ≈ 0.5 s).
 */
export function withPitchSpeed(race: StealRace, releaseSpeedMph: number): StealRace {
  return { ...race, defense: race.defense + (95 - releaseSpeedMph) * 0.0055 };
}
