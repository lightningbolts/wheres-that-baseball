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

/** Shape of `data/newstats/attack-<season>.json`, written by `ml-engine/newstats/export_attack.py`. */
export interface AttackPlayer {
  rank: number;
  playerId: number;
  name: string;
  teamId: number | null;
  pitches: number;
  bf: number;
  /** How often he challenges hitters vs. expectation, scaled so 100 = average, SD 15. */
  attackPlus: number;
  percentile: number;
  /** Percentage points more pitches in the zone / heart of the zone than expected. */
  zoneAttackPp: number | null;
  heartAttackPp: number | null;
  zonePct: number | null;
  fbPct: number | null;
  kPct: number | null;
  bbPct: number | null;
}

export interface AttackReport {
  season: number;
  generatedAt: string;
  minPitches: number;
  reliability: { zone_attack: number; heart_attack: number; attack: number; pitch_around: number };
  yearOverYear: { season: number; pitchers: number; r: number | null } | null;
  validity: Record<string, number>;
  players: AttackPlayer[];
}

export type AttackSortKey = "attackPlus" | "zoneAttackPp" | "heartAttackPp" | "zonePct" | "bbPct" | "kPct" | "pitches";

export function attackGrade(percentile: number): string {
  if (percentile >= 90) return "Fearless";
  if (percentile >= 70) return "Aggressive";
  if (percentile >= 30) return "Balanced";
  if (percentile >= 10) return "Careful";
  return "Nibbler";
}
