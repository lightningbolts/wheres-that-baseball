/**
 * Project 11-outcome ML probabilities onto a ternary "match" simplex:
 * Pitcher control · Batter damage · Free pass.
 */

import type { OutcomeProbabilities } from "@/types/database";

export interface MatchBuckets {
  pitcher: number;
  batter: number;
  freePass: number;
}

export interface MatchPoint {
  buckets: MatchBuckets;
  /** SVG coordinates inside the equilateral triangle. */
  x: number;
  y: number;
}

/** ViewBox for the ternary triangle (padding included). */
export const MATCH_CHART_VIEW = {
  width: 280,
  height: 250,
  pad: 28,
} as const;

const TOP = { x: MATCH_CHART_VIEW.width / 2, y: MATCH_CHART_VIEW.pad };
const BOTTOM_LEFT = {
  x: MATCH_CHART_VIEW.pad,
  y: MATCH_CHART_VIEW.height - MATCH_CHART_VIEW.pad,
};
const BOTTOM_RIGHT = {
  x: MATCH_CHART_VIEW.width - MATCH_CHART_VIEW.pad,
  y: MATCH_CHART_VIEW.height - MATCH_CHART_VIEW.pad,
};

export const MATCH_CORNERS = {
  pitcher: TOP,
  batter: BOTTOM_RIGHT,
  freePass: BOTTOM_LEFT,
} as const;

/** Collapse outcome probabilities into the three match corners. */
export function projectMatchBuckets(probabilities: OutcomeProbabilities): MatchBuckets {
  const pitcher =
    (probabilities.strikeout ?? 0) +
    (probabilities.field_out ?? 0) +
    (probabilities.gidp ?? 0) +
    (probabilities.sac_bunt ?? 0) +
    (probabilities.sac_fly ?? 0);

  const batter =
    (probabilities.single ?? 0) +
    (probabilities.double ?? 0) +
    (probabilities.triple ?? 0) +
    (probabilities.home_run ?? 0);

  const freePass = (probabilities.walk ?? 0) + (probabilities.hit_by_pitch ?? 0);

  const total = pitcher + batter + freePass;
  if (total <= 0) {
    return { pitcher: 1 / 3, batter: 1 / 3, freePass: 1 / 3 };
  }

  return {
    pitcher: pitcher / total,
    batter: batter / total,
    freePass: freePass / total,
  };
}

/** Barycentric → Cartesian for the equilateral triangle. */
export function bucketsToPoint(buckets: MatchBuckets): { x: number; y: number } {
  return {
    x:
      buckets.pitcher * MATCH_CORNERS.pitcher.x +
      buckets.batter * MATCH_CORNERS.batter.x +
      buckets.freePass * MATCH_CORNERS.freePass.x,
    y:
      buckets.pitcher * MATCH_CORNERS.pitcher.y +
      buckets.batter * MATCH_CORNERS.batter.y +
      buckets.freePass * MATCH_CORNERS.freePass.y,
  };
}

export function projectMatchPoint(probabilities: OutcomeProbabilities): MatchPoint {
  const buckets = projectMatchBuckets(probabilities);
  const { x, y } = bucketsToPoint(buckets);
  return { buckets, x, y };
}

export function trianglePath(): string {
  const { pitcher, batter, freePass } = MATCH_CORNERS;
  return `M ${pitcher.x} ${pitcher.y} L ${batter.x} ${batter.y} L ${freePass.x} ${freePass.y} Z`;
}

/** Midlines from each corner to the opposite edge (ternary guides). */
export function ternaryGuidePaths(): string[] {
  const midPitcherBatter = {
    x: (MATCH_CORNERS.pitcher.x + MATCH_CORNERS.batter.x) / 2,
    y: (MATCH_CORNERS.pitcher.y + MATCH_CORNERS.batter.y) / 2,
  };
  const midPitcherFree = {
    x: (MATCH_CORNERS.pitcher.x + MATCH_CORNERS.freePass.x) / 2,
    y: (MATCH_CORNERS.pitcher.y + MATCH_CORNERS.freePass.y) / 2,
  };
  const midBatterFree = {
    x: (MATCH_CORNERS.batter.x + MATCH_CORNERS.freePass.x) / 2,
    y: (MATCH_CORNERS.batter.y + MATCH_CORNERS.freePass.y) / 2,
  };

  return [
    `M ${MATCH_CORNERS.freePass.x} ${MATCH_CORNERS.freePass.y} L ${midPitcherBatter.x} ${midPitcherBatter.y}`,
    `M ${MATCH_CORNERS.batter.x} ${MATCH_CORNERS.batter.y} L ${midPitcherFree.x} ${midPitcherFree.y}`,
    `M ${MATCH_CORNERS.pitcher.x} ${MATCH_CORNERS.pitcher.y} L ${midBatterFree.x} ${midBatterFree.y}`,
  ];
}
