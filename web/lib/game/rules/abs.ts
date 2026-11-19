/**
 * ABS (Automated Ball-Strike) challenge system, as MLB plays it from 2026:
 * the human umpire calls every pitch; the batter, pitcher or catcher may challenge
 * a called ball or strike right away, and the Hawk-Eye zone decides. Each club starts
 * with two challenges and keeps one that wins; in extra innings a club that has run
 * out gets one more for each extra inning.
 *
 * The automated zone is the rulebook zone the game already plays to (PitchResult.inZone):
 * the umpire's call is wrong exactly when it disagrees with it.
 */
import { PLATE_HALF_WIDTH, type PitchFlight } from "@/lib/game/physics/pitch";
import { BALL_RADIUS_FT } from "@/lib/game/physics/ballFlight";
import type { PitchResult } from "@/lib/game/engine/atBat";

export const ABS_CHALLENGES = 2;

export type AbsSide = "away" | "home";

/** A called pitch either club could challenge: the batting club a called strike, the fielding club a ball. */
export function challengeableCall(result: Pick<PitchResult, "kind" | "wildPitch">): "offense" | "defense" | null {
  if (result.kind === "called_strike") return "offense";
  // A ball in the dirt that got away has already moved the runners: nobody argues it.
  if (result.kind === "ball" && !result.wildPitch) return "defense";
  return null;
}

/** The umpire's call disagrees with the automated zone. */
export function callIsWrong(result: Pick<PitchResult, "kind" | "inZone">): boolean {
  return (result.kind === "called_strike") !== result.inZone;
}

/** The call as the automated zone has it. */
export function overturned(result: PitchResult): PitchResult {
  return { ...result, kind: result.kind === "called_strike" ? "ball" : "called_strike", wildPitch: false, absOverturned: true };
}

/**
 * Signed distance of the pitch from the edge of the zone, ft: positive outside it,
 * negative inside (how deep). Uses where the ball crossed the front of the plate.
 */
export function edgeDistance(flight: Pick<PitchFlight, "px" | "pz">, zoneBottom: number, zoneTop: number): number {
  const halfW = PLATE_HALF_WIDTH + BALL_RADIUS_FT;
  const bot = zoneBottom - BALL_RADIUS_FT;
  const top = zoneTop + BALL_RADIUS_FT;
  const dx = Math.abs(flight.px) - halfW;
  const dzLow = bot - flight.pz;
  const dzHigh = flight.pz - top;
  const outside = Math.max(dx, dzLow, dzHigh);
  if (outside > 0) {
    // Outside a corner: straight-line distance to it.
    const ox = Math.max(0, dx);
    const oz = Math.max(0, dzLow, dzHigh);
    return Math.hypot(ox, oz);
  }
  return outside;
}

export type ZoneMissSide = "wide" | "low" | "high" | "corner";

/**
 * How far the pitch was in or out of the ABS zone, as the review shows it: inches from
 * the nearest edge (any part of the ball touching the zone is a strike), and, when it
 * missed, which way.
 */
export function zoneMiss(flight: Pick<PitchFlight, "px" | "pz">, zoneBottom: number, zoneTop: number): { inches: number; inZone: boolean; side: ZoneMissSide | null } {
  const d = edgeDistance(flight, zoneBottom, zoneTop);
  const inches = Math.abs(d) * 12;
  if (d <= 0) return { inches, inZone: true, side: null };
  const wide = Math.abs(flight.px) - (PLATE_HALF_WIDTH + BALL_RADIUS_FT) > 0;
  const low = zoneBottom - BALL_RADIUS_FT - flight.pz > 0;
  const high = flight.pz - (zoneTop + BALL_RADIUS_FT) > 0;
  const side: ZoneMissSide = wide && (low || high) ? "corner" : wide ? "wide" : low ? "low" : "high";
  return { inches, inZone: false, side };
}

/**
 * Real 2026 ABS challenge numbers, MLB regular season (2,430 games), from Baseball Savant:
 *   - ABS dashboard  https://baseballsavant.mlb.com/abs?gameType=regular&year=2026&level=mlb
 *     ("Season Data" totals and the "ABS Org. Breakdown" situational challenge rates)
 *   - ABS challenge leaderboard  https://baseballsavant.mlb.com/leaderboard/abs-challenges
 *     (challengeType=batter / catcher / pitcher, CSV export, summed)
 * Pulled 2026-11-16. Cross-checked with Baseball-Reference's ABS page (catcher 58.6%,
 * batter 48.8%, pitcher 39.6%) and AP's season wrap (4.35 challenges a game).
 *
 * "Opportunities" are Savant's challengeable pitches: takes called against the club
 * with a challenge left (a called strike for the batter, a called ball for the fielders).
 * Situational numbers are challenge rates per opportunity.
 */
export const SAVANT_ABS_2026 = {
  games: 2430,
  challenges: 10557, // 4.34 a game, 2.17 a club
  overturned: 5686, // 53.9%
  batter: { challenges: 4765, overturned: 2328, opportunities: 106311 }, // 48.9%, 4.48% of chances
  fielder: { challenges: 5792, overturned: 3358, opportunities: 239514 }, // 58.0%, 2.42% of chances
  catcher: { challenges: 5613, overturned: 3287 }, // 58.6%
  pitcher: { challenges: 179, overturned: 71 }, // 39.7%
  /** Challenge rate per opportunity, relative to the role's overall rate. */
  situational: {
    offense: {
      count: { ball3: 1.94, strike2: 4.23, full: 5.51, other: 0.71 },
      inning: [0.71, 0.65, 0.78, 0.84, 0.99, 1.02, 1.16, 1.26, 1.95], // 1st..9th
      extra: 2.32,
      runners: [0.88, 1.06, 1.39, 1.75],
      left: { 2: 0.98, 1: 1.03 },
    },
    defense: {
      count: { ball3: 2.26, strike2: 1.05, full: 2.6, other: 0.94 },
      inning: [0.82, 0.81, 0.87, 0.88, 0.89, 1.06, 1.05, 1.14, 1.81],
      extra: 1.48,
      runners: [0.89, 1.08, 1.19, 1.73],
      left: { 2: 1.06, 1: 0.84 },
    },
  },
} as const;

/**
 * How often this game's umpire gets a challengeable call wrong (measured over 40 CPU
 * games with this engine's umpireCall, twice): ~6.7% of called strikes, ~4.4% of called balls
 * (MLB 2026, per Savant's "possible overturns": 11.1% and 4.3%). Wrong calls here sit a
 * median 0.57 in from the zone edge, 90% within 1.6 in.
 */
const GAME_MISS_RATE = { offense: 0.067, defense: 0.044 } as const;

/**
 * Per-call challenge probabilities, chosen so a CPU club challenges as often as MLB clubs
 * did per opportunity and wins as often, given how often this game's umpire is wrong:
 * rate R = q·α + (1−q)·β and overturn share O = q·α / R.
 */
function baseRates(side: "offense" | "defense") {
  const r = side === "offense" ? SAVANT_ABS_2026.batter : SAVANT_ABS_2026.fielder;
  const R = r.challenges / r.opportunities;
  const O = r.overturned / r.challenges;
  const q = GAME_MISS_RATE[side];
  return { wrong: (R * O) / q, right: (R * (1 - O)) / (1 - q) };
}

/**
 * Normalizers so the situational and distance shaping average out to 1 over this
 * engine's called pitches (measured), then tuned end to end over 150 CPU-vs-CPU games:
 * 4.0 challenges a game (MLB 4.34), 52% overturned (53.9%) — batters 47% (48.9%),
 * catchers 59% (58.6%), pitchers ~2% of challenges at ~35% (39.7%).
 */
const NORM = {
  offense: { sit: 1.18, wrong: 0.42, right: 0.13 },
  defense: { sit: 1.14, wrong: 0.317, right: 0.036 },
};

/** Deterministic uniform in [0, 1) from the pitch and the situation (no dice: keeps replays exact). */
export function hash01(...xs: number[]): number {
  let h = 0;
  for (let i = 0; i < xs.length; i += 1) h += Math.sin(xs[i] * (12.9898 + i * 4.1414) + i * 78.233) * 43758.5453;
  return h - Math.floor(h);
}

export interface ChallengeSituation {
  result: PitchResult;
  zoneBottom: number;
  zoneTop: number;
  balls: number;
  strikes: number;
  outs: number;
  inning: number;
  regulation: number;
  /** Challenges the club that would challenge has left. */
  left: number;
  /** Runners on base (a walk with men on, a K with runners in scoring position, matters more). */
  runnersOn: number;
  /** Score margin from the challenging club's point of view. */
  margin: number;
}

/** Who taps his helmet (batter) or cap (catcher, pitcher) to ask for the review. */
export type AbsChallengerRole = "batter" | "catcher" | "pitcher";

/** The situational multiplier on the challenge rate (count, inning, traffic, challenges left). */
export function situationFactor(s: ChallengeSituation, side: "offense" | "defense"): number {
  const t = SAVANT_ABS_2026.situational[side];
  const count =
    s.balls === 3 && s.strikes === 2 ? t.count.full : s.balls === 3 ? t.count.ball3 : s.strikes === 2 ? t.count.strike2 : t.count.other;
  // Innings by the regulation length (a 7-inning game's 7th plays like a 9th).
  const k = Math.round(((s.inning - 1) / Math.max(1, s.regulation - 1)) * 8);
  const inning = s.inning > s.regulation ? t.extra : t.inning[Math.min(8, Math.max(0, k))];
  const runners = t.runners[Math.min(3, Math.max(0, s.runnersOn))];
  const left = s.left >= 2 ? t.left[2] : t.left[1];
  // Late innings, traffic and the count overlap (two strikes in the 9th with men on…):
  // the count carries its full weight, the rest are damped.
  return (count * Math.sqrt(inning) * Math.sqrt(runners) * left) / NORM[side].sit;
}

/**
 * Distance shaping, ft → weight. A wrong call that misses by more is easier to see and
 * gets challenged more; a right call gets (mistakenly) challenged only near the edge.
 * `looks` is how wrong the call looks to the challenger, signed (+ wrong side, ft).
 */
export function distanceWeight(looksFt: number, wrong: boolean, side: "offense" | "defense"): number {
  const inches = looksFt * 12;
  if (wrong) {
    const d = Math.max(0, inches);
    return (d / (d + 0.45)) ** 1.5 / NORM[side].wrong;
  }
  return Math.exp(Math.min(0, inches) / 0.7) / NORM[side].right;
}

/** Chance the CPU club challenges this call (0 when it can't). */
export function challengeProbability(s: ChallengeSituation): number {
  const side = challengeableCall(s.result);
  if (!side || s.left <= 0) return 0;
  const wrong = callIsWrong(s.result);
  const d = edgeDistance(s.result.flight, s.zoneBottom, s.zoneTop);
  // A called strike is wrong-side when the pitch is outside; a ball when it is inside.
  const looks = side === "offense" ? d : -d;
  const base = baseRates(side);
  return Math.min(0.97, (wrong ? base.wrong : base.right) * situationFactor(s, side) * distanceWeight(looks, wrong, side));
}

/**
 * The CPU club's call on a challengeable take: the probability comes from Savant's 2026
 * rates (by role and situation), shaped by how far the pitch was from the edge, and is
 * drawn with a deterministic hash of the pitch so replays stay exact. Returns who
 * challenges, or null.
 */
export function cpuChallenge(s: ChallengeSituation): AbsChallengerRole | null {
  const side = challengeableCall(s.result);
  const p = challengeProbability(s);
  if (!side || p <= 0) return null;
  const wrong = callIsWrong(s.result);
  const { px, pz } = s.result.flight;
  if (hash01(px, pz, s.balls, s.strikes, s.outs, s.inning) >= p) return null;
  if (side === "offense") return "batter";
  // Pitchers made 3.1% of fielding challenges and won 39.7% of them (catchers 58.6%).
  const f = SAVANT_ABS_2026;
  const pitcherShare = wrong
    ? f.pitcher.overturned / f.fielder.overturned
    : (f.pitcher.challenges - f.pitcher.overturned) / (f.fielder.challenges - f.fielder.overturned);
  return hash01(pz, px, s.inning, s.outs + 7) < pitcherShare ? "pitcher" : "catcher";
}

/** Deterministic "eye" error in [-1, 1] from where the pitch crossed (legacy policy). */
function perception(px: number, pz: number): number {
  const s = Math.sin(px * 12.9898 + pz * 78.233) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

/**
 * The original CPU challenge rule (an edge-distance threshold by situation), kept so
 * games saved under it (GameSetup.cpuAbs === 1) replay exactly as they were played.
 */
export function legacyCpuWantsChallenge(s: ChallengeSituation): boolean {
  const side = challengeableCall(s.result);
  if (!side || s.left <= 0) return false;
  const d = edgeDistance(s.result.flight, s.zoneBottom, s.zoneTop);
  const looks = (side === "offense" ? d : -d) + perception(s.result.flight.px, s.result.flight.pz) * 0.1;
  const decisive = side === "offense" ? s.strikes >= 2 : s.balls >= 3;
  const late = s.inning >= s.regulation - 2 && Math.abs(s.margin) <= 3;
  let bar = 0.12;
  if (decisive) bar -= 0.05;
  if (late) bar -= 0.03;
  if (s.runnersOn >= 2) bar -= 0.01;
  if (s.left === 1) bar += 0.04;
  if (!decisive && s.inning <= 3 && s.balls + s.strikes <= 1) bar += 0.05;
  return looks > Math.max(0.025, bar);
}

/** Whether the CPU club challenges this call (see cpuChallenge). */
export function cpuWantsChallenge(s: ChallengeSituation): boolean {
  return cpuChallenge(s) !== null;
}
