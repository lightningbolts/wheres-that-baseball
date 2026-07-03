import type { TeamNerdCard } from "@/lib/mlb/nerdStats/types";

type TeamNerdStat = TeamNerdCard["stats"][number];

/** Pitch-type movement/spin/velo stats — too inside-baseball for social share cards. */
const PITCH_NERD_STAT_PATTERN = /-avg-(velocity|spin|h-break|v-break)$/;

export const MAX_CHAOS_PER_SIDE = 4;
export const MAX_FULL_SHARE_STATS = 8;

export function isBlankNerdDisplayValue(displayValue: string): boolean {
  const trimmed = displayValue.trim();
  return trimmed === "" || trimmed === "—" || trimmed === "---" || trimmed === "–" || trimmed === "N/A";
}

export function isPitchNerdStat(statId: string): boolean {
  return PITCH_NERD_STAT_PATTERN.test(statId);
}

export function isShareWorthyTeamStat(stat: TeamNerdStat): boolean {
  return !isPitchNerdStat(stat.statId) && !isBlankNerdDisplayValue(stat.displayValue);
}

export function isEliteNerdRank(rank: number): boolean {
  return rank <= 3;
}

export function isCursedNerdRank(rank: number): boolean {
  return rank >= 28;
}

export function isEliteOrCursedNerdRank(rank: number): boolean {
  return isEliteNerdRank(rank) || isCursedNerdRank(rank);
}

export function nerdRankBadgeLabel(rank: number, sort: "asc" | "desc"): string | null {
  if (isEliteNerdRank(rank)) return sort === "desc" ? "elite chaos" : "elite sus";
  if (isCursedNerdRank(rank)) return sort === "desc" ? "cursed chaos" : "cursed sus";
  return null;
}

/** Elite/cursed stats that are fun enough to post — no pitch movement grids. */
export function pickEliteCursedTeamStats(stats: TeamNerdStat[]): TeamNerdStat[] {
  return stats
    .filter((stat) => isShareWorthyTeamStat(stat) && isEliteOrCursedNerdRank(stat.rank))
    .sort((a, b) => {
      const aElite = isEliteNerdRank(a.rank);
      const bElite = isEliteNerdRank(b.rank);
      if (aElite && bElite) return a.rank - b.rank;
      if (aElite) return -1;
      if (bElite) return 1;
      return b.rank - a.rank;
    });
}

/** Single-column full share card — top elite/cursed chaos highlights. */
export function pickFullShareCardStats(stats: TeamNerdStat[]): TeamNerdStat[] {
  return pickEliteCursedTeamStats(stats).slice(0, MAX_FULL_SHARE_STATS);
}

export function splitShareableChaosStats(stats: TeamNerdStat[]) {
  const picked = pickEliteCursedTeamStats(stats);
  return {
    elite: picked.filter((stat) => isEliteNerdRank(stat.rank)).slice(0, MAX_CHAOS_PER_SIDE),
    cursed: picked.filter((stat) => isCursedNerdRank(stat.rank)).slice(0, MAX_CHAOS_PER_SIDE),
  };
}
