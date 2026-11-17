/**
 * How the ballpark crowd reacts to a play. The crowd is mostly home fans with a pocket of
 * visitors: a home run by the home team brings the place down, the same swing by the road
 * team gets a groan from the home crowd and a small cheer from the visiting section.
 *
 * Pure: the controller feeds it the committed pitch and the score around it, and turns
 * the result into sound (`sfx`) and fans out of their seats (`crowdState`).
 */
import type { PlayResult } from "@/lib/game/play/resolvePlay";
import type { GameEvent } from "@/lib/game/rules/game";

/** Share of the seats held by fans of the visiting team. */
export const AWAY_FAN_SHARE = 0.12;

export interface CrowdInput {
  events: GameEvent[];
  play?: PlayResult;
  /** Half-inning of the pitch: true = the visitors are batting. */
  top: boolean;
  inning: number;
  /** Innings in regulation. */
  regulation: number;
  /** Outs and occupied bases before the pitch. */
  outsBefore: number;
  basesBefore: [boolean, boolean, boolean];
  scoreBefore: { away: number; home: number };
  scoreAfter: { away: number; home: number };
}

export interface CrowdReaction {
  /** How hard each team's fans cheer, 0..1. */
  home: number;
  away: number;
  /** How hard each team's fans groan, 0..1 (the other team just did something big). */
  homeGroan: number;
  awayGroan: number;
  /** Short tag for what set them off (debugging / tests). */
  why: string | null;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** How much a play is worth to the batting side (≥ 0) and to the fielding side (≥ 0). */
function worth(i: CrowdInput): { bat: number; field: number; why: string | null } {
  const kinds = new Set(i.events.map((e) => e.kind));
  const p = i.play && !i.play.foul ? i.play : undefined;
  const battingAway = i.top;
  const before = battingAway ? i.scoreBefore.away - i.scoreBefore.home : i.scoreBefore.home - i.scoreBefore.away;
  const after = battingAway ? i.scoreAfter.away - i.scoreAfter.home : i.scoreAfter.home - i.scoreAfter.away;
  const runs = Math.max(0, after - before);
  const risp = i.basesBefore[1] || i.basesBefore[2];
  const onBase = i.basesBefore.filter(Boolean).length;
  let bat = 0;
  let field = 0;
  let why: string | null = null;
  const take = (v: number, w: string, side: "bat" | "field") => {
    if (side === "bat" ? v > bat : v > field) why = w;
    if (side === "bat") bat = Math.max(bat, v);
    else field = Math.max(field, v);
  };

  if (p?.hit === 4) take(onBase === 3 ? 1 : 0.85 + 0.05 * onBase, onBase === 3 ? "grand slam" : "home run", "bat");
  else if (p?.hit === 3) take(0.6, "triple", "bat");
  else if (p?.hit === 2) take(0.45, "double", "bat");
  else if (p?.hit === 1) take(0.22, "single", "bat");
  else if (p?.error) take(0.3, "error", "bat");
  if (kinds.has("stolen_base")) take(0.18, "stolen base", "bat");
  if (runs > 0) take(Math.max(bat, 0.3) + 0.15 * runs, "runs score", "bat");
  // Taking the lead or tying it up.
  if (before <= 0 && after > 0) take(bat + 0.3, "go-ahead", "bat");
  else if (before < 0 && after === 0) take(bat + 0.2, "tying run", "bat");

  // ABS: the building waits on the zone, then whoever it helps lets loose — loudest when
  // the overturn rings up strike three or ball four, and the other side's fans enjoy a
  // challenge that comes up empty.
  const abs = i.events.find((e) => e.kind === "abs_challenge")?.abs;
  if (abs) {
    const byBatting = (abs.side === "away") === i.top;
    const side = byBatting ? "bat" : "field";
    const other = byBatting ? "field" : "bat";
    if (abs.overturned) {
      const flip = abs.strikeout || abs.walk;
      // A walk with men on (or a K with runners in scoring position) is bigger.
      const traffic = abs.walk ? 0.05 * onBase : abs.strikeout && risp ? 0.1 : 0;
      take(flip ? 0.6 + traffic : 0.32, flip ? (abs.strikeout ? "overturned to strike three" : "overturned to ball four") : "overturned", side);
    } else {
      take(abs.left === 0 ? 0.36 : 0.26, abs.left === 0 ? "out of challenges" : "challenge denied", other);
    }
  }
  if (kinds.has("strikeout")) take(0.2 + (risp ? 0.12 : 0) + (i.outsBefore === 2 ? 0.08 : 0), "strikeout", "field");
  if (kinds.has("caught_stealing")) take(0.3, "caught stealing", "field");
  // Pickoffs: the defense's fans love a runner caught napping (more so after a rundown);
  // a balk or a throw that gets away is the offense's gift.
  const po = i.events.find((e) => e.kind === "picked_off");
  if (po) take(po.pickoff?.outcome === "rundown_out" ? 0.5 : 0.42, po.pickoff?.outcome === "rundown_out" ? "run down" : "picked off", "field");
  if (kinds.has("balk")) take(0.3, "balk", "bat");
  if (kinds.has("pickoff_error")) take(0.32, "pickoff gets away", "bat");
  if (p?.doublePlay) take(p.outs >= 3 ? 0.9 : 0.5, p.outs >= 3 ? "triple play" : "double play", "field");
  // Stranding runners: the third out with men in scoring position.
  if (kinds.has("inning_end") && risp && runs === 0) take(field + 0.18 + 0.05 * onBase, "strands runners", "field");

  // A game ending on this play.
  if (kinds.has("game_over")) {
    if (after > 0) take(1, battingAway ? "go-ahead in the last" : "walk-off", "bat");
    else take(1, "final out", "field");
  }

  // Late and close counts for more; a blowout counts for less.
  const late = i.inning >= i.regulation - 2;
  const margin = Math.min(Math.abs(before), Math.abs(after));
  const lev = (late ? 1.25 : 1) * (margin <= 2 ? 1.1 : margin >= 6 ? 0.6 : 1);
  return { bat: clamp01(bat * lev), field: clamp01(field * lev), why };
}

export function crowdReaction(i: CrowdInput): CrowdReaction {
  const { bat, field, why } = worth(i);
  const battingHome = !i.top;
  const homeGood = battingHome ? bat : field;
  const awayGood = battingHome ? field : bat;
  // A big moment for one side is a groan for the other; small ones barely register.
  const groan = (x: number) => (x >= 0.35 ? clamp01(x * 0.9) : 0);
  return {
    home: homeGood,
    away: awayGood,
    homeGroan: groan(awayGood),
    awayGroan: groan(homeGood),
    why: homeGood || awayGood ? why : null,
  };
}

/**
 * Anticipation as a ball leaves the bat (before anyone knows if it's caught): the crowd
 * rises on a deep drive. `battingHome` picks which fans get up.
 */
export function crowdRise(evMph: number, laDeg: number, distFt: number | null, battingHome: boolean): { home: number; away: number } {
  const deep = distFt != null && laDeg > 15 && laDeg < 45 ? clamp01((distFt - 280) / 110) : 0;
  const hard = clamp01((evMph - 95) / 20) * 0.4;
  const x = Math.max(deep * 0.75, hard * (laDeg > 5 && laDeg < 40 ? 1 : 0.3));
  return battingHome ? { home: x, away: 0 } : { home: 0, away: x };
}

/** Overall crowd volume for a reaction: the home crowd is most of the building. */
export function crowdVolume(r: { home: number; away: number }): number {
  return clamp01(r.home * (1 - AWAY_FAN_SHARE) + r.away * AWAY_FAN_SHARE * 1.6);
}
