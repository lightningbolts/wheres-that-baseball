/** Defensive alignment and fielder ability model. */
import { sprayDir, scale, add, v3, type V3 } from "@/lib/game/math";
import type { FieldPos } from "@/lib/game/types";

export interface Fielder {
  pos: FieldPos;
  playerId: number;
  /** Starting position when the ball is hit, world ft. */
  p: V3;
  /** Top running speed, ft/s (Statcast sprint speed). */
  sprint: number;
  /** Max arm strength, mph. */
  arm: number;
  /** First-step reaction to the batted ball, s. */
  reaction: number;
  /** Catch/glove skill 0–1 (0.5 = MLB average). */
  glove: number;
}

/** Standard depth/angle per position (distance from home ft, spray deg + toward RF). */
const STANDARD: Record<FieldPos, [number, number]> = {
  P: [56, 0],
  C: [-3, 0],
  "1B": [108, 34],
  "2B": [152, 13],
  SS: [150, -12],
  "3B": [112, -32],
  LF: [292, -28],
  CF: [318, 0],
  RF: [292, 27],
};

/**
 * Field positions shaded for batter handedness: OF and middle IF shade ~4° toward
 * the pull side; with a runner on 1st the 1B holds the bag and middle IF play
 * double-play depth.
 */
export function alignment(
  batterSide: "L" | "R",
  runnerOnFirst: boolean,
  infieldIn: boolean,
): Record<FieldPos, V3> {
  const pull = batterSide === "R" ? -1 : 1; // RHB pulls toward LF (negative spray)
  const out = {} as Record<FieldPos, V3>;
  for (const [pos, [dist, ang]] of Object.entries(STANDARD) as Array<[FieldPos, [number, number]]>) {
    let d = dist;
    let a = ang;
    if (pos === "C") {
      out[pos] = v3(0, 0, -3);
      continue;
    }
    if (pos === "P") {
      out[pos] = v3(0, 0, d);
      continue;
    }
    if (["LF", "CF", "RF", "2B", "SS"].includes(pos)) a += 4 * pull;
    if (runnerOnFirst && pos === "1B") {
      d = 92;
      a = 43;
    }
    if (runnerOnFirst && (pos === "2B" || pos === "SS")) d -= 10;
    if (infieldIn && ["1B", "2B", "SS", "3B"].includes(pos)) d = Math.min(d, 95);
    out[pos] = add(v3(), scale(sprayDir(a), d));
  }
  return out;
}

export const DEFAULT_REACTION: Record<FieldPos, number> = {
  P: 0.45,
  C: 0.4,
  "1B": 0.34,
  "2B": 0.32,
  SS: 0.31,
  "3B": 0.3,
  LF: 0.55,
  CF: 0.5,
  RF: 0.55,
};

/**
 * Pitchers are not sprinters, and they field from the end of a follow-through: whatever the
 * roster says, nobody on the mound is shown (or timed) faster than this, ft/s.
 */
export const PITCHER_TOP_SPEED = 25;

/** A fielder's usable top speed, ft/s (the pitcher is capped at PITCHER_TOP_SPEED). */
export function topSpeed(f: Pick<Fielder, "pos" | "sprint">): number {
  return f.pos === "P" ? Math.min(f.sprint, PITCHER_TOP_SPEED) : f.sprint;
}

export const isInfielder = (pos: FieldPos) => pos === "1B" || pos === "2B" || pos === "SS" || pos === "3B" || pos === "P";
export const isOutfielder = (pos: FieldPos) => pos === "LF" || pos === "CF" || pos === "RF";

/**
 * The batter squared around: the corners crash toward the plate and the pitcher and
 * catcher break on the ball as it's bunted.
 */
export function chargeBunt(fielders: Fielder[]): Fielder[] {
  return fielders.map((f) => {
    if (f.pos === "1B" || f.pos === "3B") {
      const d = Math.hypot(f.p.x, f.p.z);
      const k = Math.max(0, d - 26) / d;
      return { ...f, p: v3(f.p.x * (1 - k * 0.32), f.p.y, f.p.z * (1 - k * 0.32)), reaction: f.reaction - 0.12 };
    }
    if (f.pos === "P" || f.pos === "C") return { ...f, reaction: f.reaction - 0.15 };
    return f;
  });
}
