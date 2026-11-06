/** Shape of `data/newstats/respect-<season>.json`, written by `ml-engine/newstats/export_respect.py`. */

export interface RespectPlayer {
  rank: number;
  playerId: number;
  name: string;
  teamId: number | null;
  pa: number;
  /** Avoidance not explained by chase/whiff, scaled so 100 = average, SD 15. */
  respectPlus: number;
  percentile: number;
  /** Raw avoidance before the chase/whiff adjustment, same scale. */
  avoidancePlus: number;
  /** Percentage points more often pitchers stay out of the zone / heart / off fastballs vs. expectation. */
  zoneAvoidPp: number | null;
  heartAvoidPp: number | null;
  fbAvoidPp: number | null;
  chasePct: number | null;
  whiffPct: number | null;
  woba: number | null;
}

export interface RespectReport {
  season: number;
  generatedAt: string;
  minPa: number;
  /** Full-season reliability (split-half, Spearman-Brown corrected). */
  reliability: { zone_avoid: number; heart_avoid: number; fb_avoid: number; respect: number };
  yearOverYear: { season: number; batters: number; r: number | null } | null;
  validity: Record<string, number>;
  players: RespectPlayer[];
}

export type RespectSortKey = "respectPlus" | "avoidancePlus" | "zoneAvoidPp" | "heartAvoidPp" | "fbAvoidPp" | "pa" | "woba";

export function formatPp(value: number | null): string {
  if (value == null) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(1)}`;
}

export function respectGrade(percentile: number): string {
  if (percentile >= 90) return "Feared";
  if (percentile >= 70) return "Respected";
  if (percentile >= 30) return "Neutral";
  if (percentile >= 10) return "Challenged";
  return "Attacked";
}
