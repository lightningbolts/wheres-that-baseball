/**
 * Stolen bases (second base only): a timing race between the runner's jump and
 * the pitcher's delivery + catcher's pop time + throw — same movement model as plays.
 */
import { runTime, throwTime, BASE_POS } from "@/lib/game/play/movement";
import type { BaseballGame } from "@/lib/game/rules/game";
import type { Rng } from "@/lib/game/math";

const LEAD_FT = 13;
/** Hand reaches the bag while the body is still sliding in. */
const SLIDE_FT = 8;
/** Pitcher's first move → ball in the mitt (MLB ~1.3 s from the stretch). */
const DELIVERY_S = 1.35;
const CATCHER_TRANSFER_S = 0.72;
const TAG_S = 0.12;
const RUNNER_JUMP_S = 0.2;
/** Base stealers start from a crossover lean: harder first steps than a batter out of the box. */
const STEAL_ACCEL = 20;

export interface StealRace {
  runner: number;
  defense: number;
}

export function stealRace(game: BaseballGame): StealRace | null {
  const r = game.bases[0];
  if (!r || game.bases[1]) return null;
  const c = game.fielders().find((f) => f.pos === "C");
  const runner = RUNNER_JUMP_S + runTime(90 - LEAD_FT - SLIDE_FT, r.sprint, STEAL_ACCEL);
  const defense = DELIVERY_S + CATCHER_TRANSFER_S + throwTime(BASE_POS[4], BASE_POS[2], c?.arm ?? 80) + TAG_S;
  return { runner, defense };
}

/** CPU decision to go on this pitch (MLB: ~0.75 attempts per team-game, ~79% success). */
export function cpuWantsSteal(game: BaseballGame, rng: Rng): boolean {
  if (game.outs === 2 && game.score.home !== game.score.away && Math.abs(game.score.home - game.score.away) > 3) return false;
  const race = stealRace(game);
  if (!race) return false;
  const edge = race.defense - race.runner;
  if (edge < -0.05) return false;
  return rng.chance(Math.min(0.1, 0.025 + edge * 0.2));
}

export function resolveSteal(race: StealRace, rng: Rng): boolean {
  return race.runner + rng.gauss(0, 0.14) < race.defense + rng.gauss(0, 0.1);
}
