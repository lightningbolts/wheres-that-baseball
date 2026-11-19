/**
 * How a finished game is celebrated: read off the final game state (who won, how the
 * last run scored, what the losing lineup managed) and what was riding on it (passed in
 * by the franchise as `GameSetup.stakes`). Pure: the controller turns the result into
 * choreography, banner text and crowd noise.
 */
import type { BaseballGame, GameEvent } from "@/lib/game/rules/game";

/** What winning this game means for a club. */
export type StakeKind = "clinch-division" | "clinch-wildcard" | "series-clinch" | "pennant" | "world-series" | "elimination-save";

export interface Stake {
  kind: StakeKind;
  /** Short line for the banner, e.g. "AL East champions", "Advance to the ALCS". */
  label: string;
}

/** What a win would mean for each club (null / absent: nothing beyond the W). */
export interface GameStakes {
  away?: Stake | null;
  home?: Stake | null;
}

/**
 * The choreography:
 * - handshake: the winners jog in to a line between the mound and the plate and slap hands;
 * - walkoff: the winning dugout empties and mobs the plate;
 * - swarm: the fielders swarm the pitcher on the mound (no-hitter / perfect game);
 * - huddle: a bouncing circle on the infield (clinching a berth / a series);
 * - dogpile: everyone sprints in and piles on (pennant, World Series).
 */
export type CelebrationStyle = "handshake" | "walkoff" | "swarm" | "huddle" | "dogpile";

export type WalkoffKind = "home-run" | "single" | "double" | "triple" | "walk" | "hbp" | "error" | "other";

export interface Celebration {
  style: CelebrationStyle;
  winner: "away" | "home";
  /** The winners were in the field for the last out (otherwise they were batting: a walk-off). */
  winnerFielding: boolean;
  walkoff: WalkoffKind | null;
  feat: "perfect-game" | "no-hitter" | null;
  stake: Stake | null;
  title: string;
  sub: string;
  /** Fireworks over the park (home club celebrations and titles) and confetti (pennant / title). */
  fireworks: boolean;
  confetti: boolean;
  /** 0..1: how loud and how long. */
  intensity: number;
  /** Length of the on-field celebration before the final screen (s of playback). */
  duration: number;
}

const DURATION: Record<CelebrationStyle, number> = { handshake: 5, walkoff: 7.5, swarm: 7.5, huddle: 7, dogpile: 8.5 };
const INTENSITY: Record<CelebrationStyle, number> = { handshake: 0.55, walkoff: 1, swarm: 0.95, huddle: 0.85, dogpile: 1 };

/** The losing club's line: hits, and whether anybody reached at all. */
export function lineupAgainst(game: BaseballGame, loser: "away" | "home"): { hits: number; reached: boolean; outs: number } {
  const lose = game[loser];
  const win = game[loser === "away" ? "home" : "away"];
  const ids = new Set<number>();
  for (const slot of lose.slots) for (const b of slot) ids.add(b.id);
  let hits = 0;
  let pa = 0;
  for (const id of ids) {
    const l = game.bat.get(id);
    if (!l) continue;
    hits += l.h;
    pa += l.pa;
  }
  let outs = 0;
  for (const p of win.staff) outs += game.pit.get(p.id)?.outs ?? 0;
  // Every batter who came up was put out (no walk, HBP, error or dropped third strike).
  return { hits, reached: pa > outs, outs };
}

function walkoffKind(events: GameEvent[]): WalkoffKind {
  const ip = events.find((e) => e.kind === "in_play" && e.play);
  if (ip?.play) {
    const h = ip.play.hit;
    if (h === 4) return "home-run";
    if (h === 3) return "triple";
    if (h === 2) return "double";
    if (h === 1) return "single";
    if (ip.play.error) return "error";
    return "other";
  }
  if (events.some((e) => e.kind === "walk")) return "walk";
  if (events.some((e) => e.kind === "hbp")) return "hbp";
  return "other";
}

const WALKOFF_TEXT: Record<WalkoffKind, string> = {
  "home-run": "Walk-off home run",
  single: "Walk-off single",
  double: "Walk-off double",
  triple: "Walk-off triple",
  walk: "Walk-off walk",
  hbp: "Walk-off hit by pitch",
  error: "Walk-off error",
  other: "Walk-off win",
};

const STAKE_TITLE: Record<StakeKind, string> = {
  "world-series": "World Series Champions",
  pennant: "Pennant Winners",
  "series-clinch": "Series Won",
  "clinch-division": "Clinched",
  "clinch-wildcard": "Clinched",
  "elimination-save": "Still Alive",
};

/**
 * How the game that just went final is celebrated. `last` = the events of the play that
 * ended it (tells a walk-off homer from a walk-off walk). `name` turns a side into a
 * club name for the banner.
 */
export function detectCelebration(game: BaseballGame, stakes: GameStakes | undefined, last: GameEvent[], name: (side: "away" | "home") => string = (s) => s): Celebration | null {
  if (!game.final || game.score.away === game.score.home) return null;
  const winner: "away" | "home" = game.score.home > game.score.away ? "home" : "away";
  const loser = winner === "home" ? "away" : "home";
  // The game ended in the bottom half with the home club ahead: the winning run just scored.
  const isWalkoff = winner === "home" && !game.top;
  const walkoff = isWalkoff ? walkoffKind(last) : null;
  const winnerFielding = !isWalkoff;
  const line = lineupAgainst(game, loser);
  const full = line.outs >= 3 * game.regulation;
  const feat = full && line.hits === 0 ? (line.reached ? "no-hitter" : "perfect-game") : null;
  const stake = stakes?.[winner] ?? null;
  const big = stake && (stake.kind === "world-series" || stake.kind === "pennant");
  const style: CelebrationStyle = big
    ? "dogpile"
    : feat && winnerFielding
      ? "swarm"
      : isWalkoff
        ? "walkoff"
        : stake && stake.kind !== "elimination-save"
          ? "huddle"
          : "handshake";
  const featText = feat === "perfect-game" ? "Perfect game" : feat === "no-hitter" ? (game[winner].staff.length > 1 ? "Combined no-hitter" : "No-hitter") : null;
  const pitcher = feat ? game[winner].staff.map((p) => p.name).join(", ") : null;
  const score = `${name("away")} ${game.score.away}, ${name("home")} ${game.score.home}`;
  let title: string;
  const subs: string[] = [];
  if (stake) {
    title = STAKE_TITLE[stake.kind];
    subs.push(stake.label);
    if (featText) subs.push(featText);
    if (walkoff) subs.push(WALKOFF_TEXT[walkoff]);
  } else if (featText) {
    title = featText;
    subs.push(pitcher ?? "");
    if (walkoff) subs.push(WALKOFF_TEXT[walkoff]);
  } else if (walkoff) {
    title = "Walk-off!";
    subs.push(WALKOFF_TEXT[walkoff]);
  } else {
    title = `${name(winner)} win`;
  }
  subs.push(score);
  const intensity = Math.min(1, INTENSITY[style] + (stake ? 0.1 : 0));
  return {
    style,
    winner,
    winnerFielding,
    walkoff,
    feat,
    stake,
    title,
    sub: subs.filter(Boolean).join(" · "),
    fireworks: !!big || (winner === "home" && (style !== "handshake" || !!stake)),
    confetti: !!big,
    intensity,
    duration: DURATION[style] + (stake ? 1 : 0),
  };
}
