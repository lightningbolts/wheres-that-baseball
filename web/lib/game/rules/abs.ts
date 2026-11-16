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
  return { ...result, kind: result.kind === "called_strike" ? "ball" : "called_strike", wildPitch: false };
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

/** Deterministic "eye" error in [-1, 1] from where the pitch crossed (no dice: keeps replays exact). */
function perception(px: number, pz: number): number {
  const s = Math.sin(px * 12.9898 + pz * 78.233) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
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

/**
 * The CPU's call: the catcher or batter "feels" how far off the pitch was (with a
 * deterministic read error of up to ~1.2 in) and challenges when it looks like a clear
 * miss — more readily when the count, the inning and the score make it matter, less
 * readily with the last challenge in hand.
 */
export function cpuWantsChallenge(s: ChallengeSituation): boolean {
  const side = challengeableCall(s.result);
  if (!side || s.left <= 0) return false;
  const d = edgeDistance(s.result.flight, s.zoneBottom, s.zoneTop);
  // How wrong the call looks to the challenger (ft): a called strike outside, a ball inside.
  const looks = (side === "offense" ? d : -d) + perception(s.result.flight.px, s.result.flight.pz) * 0.1;
  const decisive = side === "offense" ? s.strikes >= 2 : s.balls >= 3;
  const late = s.inning >= s.regulation - 2 && Math.abs(s.margin) <= 3;
  let bar = 0.12;
  if (decisive) bar -= 0.05;
  if (late) bar -= 0.03;
  if (s.runnersOn >= 2) bar -= 0.01;
  if (s.left === 1) bar += 0.04;
  // Early in the count, early in the game: hold on to them.
  if (!decisive && s.inning <= 3 && s.balls + s.strikes <= 1) bar += 0.05;
  return looks > Math.max(0.025, bar);
}
