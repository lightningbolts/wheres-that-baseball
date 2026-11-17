/**
 * Pickoff throws, pickoffs and rundowns, under the pitch-clock disengagement rule
 * (two step-offs or throw-overs per plate appearance; a third that doesn't get the
 * runner is a balk).
 *
 * Calibration targets:
 *  - CBS Sports, "Four under-the-radar effects of MLB's new rules": pitcher pickoff
 *    throws fell from 6.1-6.9 a game (2018-22) to 3.94 a game in 2023, while the
 *    success rate rose from 1.5-1.8% to 2.7% of throws.
 *    https://www.cbssports.com/mlb/news/four-under-the-radar-effects-of-mlbs-new-rules-including-fewer-and-more-efficient-pickoffs
 *  - Baseball Savant, Pitcher Running Game leaderboard, 2026 regular season: 172
 *    pickoffs (129 of them at first) and 99 balks among qualified pitchers.
 *    https://baseballsavant.mlb.com/leaderboard/pitcher-running-game?year=2026
 *  - Statcast running-game notes: runners go about once every 68 pitches with no
 *    disengagement, every 17 after one, every 10 after two: a pitcher out of
 *    throw-overs can't keep the runner close. (The jump is partly selection, so the
 *    steal model uses a milder multiplier.)
 * The share of pickoffs that turn into rundowns, how often a runner gets out of one, and
 * the throwing-error rate are not published league-wide; those three are estimates,
 * marked below.
 *
 * Every decision is a deterministic hash of the game state (no RNG draws), so a game
 * replays exactly and the RNG stream of the pitch that follows is untouched.
 */
import type { BaseballGame, Runner } from "@/lib/game/rules/game";
import { hash01 } from "@/lib/game/rules/abs";
import { craftOf, type StealFrom } from "@/lib/game/ai/baserunning";

export type PickoffOutcome = "safe" | "out" | "rundown_out" | "rundown_safe" | "error";

/** Throw-overs a pitcher gets per plate appearance before a failed one is a balk. */
export const FREE_DISENGAGEMENTS = 2;

/** Per eligible pitch (runner on first, second open), tuned to ~3.9 throws a game. */
const ATTEMPT_BASE = 0.056;
/** Throws behind a runner on second are rarer (~1 in 8 throw-overs). */
const SECOND_SHARE = 0.18;
/** Outs per throw for an average runner vs. a righty; the mix of leads and lefties lands it on 2.7% (CBS). */
const OUT_RATE = 0.022;
/** Estimate: about a third of pickoffs are a runner hung up and run down. */
const RUNDOWN_SHARE = 0.32;
/** Estimate: a runner caught in a rundown gets to a bag safely about 1 in 7. */
const RUNDOWN_ESCAPE = 0.15;
/** Estimate: a throw-over gets past the fielder about once in 170. */
const ERROR_RATE = 0.006;

/** Bases a throw-over can go to now: a runner whose next base is open. */
export function pickoffTargets(bases: readonly (Runner | null)[]): StealFrom[] {
  const out: StealFrom[] = [];
  if (bases[0] && !bases[1]) out.push(0);
  if (bases[1] && !bases[2]) out.push(1);
  return out;
}

function salt(game: BaseballGame, from: StealFrom): number[] {
  const r = game.bases[from];
  return [
    game.inning * 2 + (game.top ? 1 : 0),
    game.outs,
    game.balls * 4 + game.strikes,
    game.fielding.pitchCount,
    game.disengagements,
    (r?.playerId ?? 0) % 9973,
    game.log.length,
    from,
  ];
}

/** How much a runner worries the defense: speed and how often he runs. */
function threat(game: BaseballGame, from: StealFrom): number {
  const r = game.bases[from]!;
  const aggr = Math.max(0.2, Math.min(3, craftOf(game, r.playerId).aggr));
  const speed = Math.max(0.5, Math.min(1.8, 1 + (r.sprint - 27) * 0.12));
  return Math.sqrt(aggr) * speed;
}

function lefty(game: BaseballGame): boolean {
  return game.fielding.pitcher.throws === "L";
}

/** Chance the CPU throws over to `from` on this pitch. */
export function pickoffChance(game: BaseballGame, from: StealFrom): number {
  if (game.final || game.disengagements >= FREE_DISENGAGEMENTS) return 0;
  if (!pickoffTargets(game.bases).includes(from)) return 0;
  const margin = Math.abs(game.score.home - game.score.away);
  // Nobody holds a runner in a blowout; a runner who matters gets more attention.
  const situation = margin >= 6 ? 0.2 : margin <= 2 ? 1.15 : 0.85;
  const used = game.disengagements === 0 ? 1 : 0.45;
  const outs = game.outs === 2 ? 0.85 : 1;
  // Lefties face first: their move is quick, and they use it.
  const hand = from === 0 && lefty(game) ? 1.3 : 1;
  const base = from === 0 ? 1 : SECOND_SHARE;
  return Math.min(0.5, ATTEMPT_BASE * base * threat(game, from) * situation * used * outs * hand);
}

/** The CPU defense's throw-over this pitch, or null to go to the plate. */
export function cpuPickoff(game: BaseballGame): StealFrom | null {
  for (const from of pickoffTargets(game.bases)) {
    const p = pickoffChance(game, from);
    if (p > 0 && hash01(3.17, ...salt(game, from)) < p) return from;
  }
  return null;
}

/** What happens on a throw over to the runner on `from`. */
export function pickoffOutcome(game: BaseballGame, from: StealFrom): PickoffOutcome {
  const r = game.bases[from];
  if (!r) return "safe";
  const aggr = Math.max(0.3, Math.min(2.5, craftOf(game, r.playerId).aggr));
  // A big lead is a target; a lefty's move to first catches more; second is a longer play.
  const lead = Math.sqrt(aggr) * (from === 0 && lefty(game) ? 1.45 : 1) * (from === 1 ? 0.75 : 1);
  const pOut = OUT_RATE * lead;
  const u = hash01(8.41, 1.93, ...salt(game, from));
  const direct = pOut * (1 - RUNDOWN_SHARE);
  const rundown = pOut * RUNDOWN_SHARE;
  if (u < direct) return "out";
  if (u < direct + rundown * (1 - RUNDOWN_ESCAPE)) return "rundown_out";
  if (u < pOut) return "rundown_safe";
  if (u < pOut + ERROR_RATE) return "error";
  return "safe";
}
