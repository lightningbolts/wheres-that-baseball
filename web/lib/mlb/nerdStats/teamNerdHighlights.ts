import type { TeamNerdCard } from "@/lib/mlb/nerdStats/types";

type TeamNerdStat = TeamNerdCard["stats"][number];

export function isBlankNerdDisplayValue(displayValue: string): boolean {
  const trimmed = displayValue.trim();
  return trimmed === "" || trimmed === "—" || trimmed === "---" || trimmed === "–" || trimmed === "N/A";
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

/** Elite (top 3) and cursed (bottom 3) stats with real values — for short share cards. */
export function pickEliteCursedTeamStats(stats: TeamNerdStat[]): TeamNerdStat[] {
  return stats
    .filter((stat) => isEliteOrCursedNerdRank(stat.rank) && !isBlankNerdDisplayValue(stat.displayValue))
    .sort((a, b) => {
      const aElite = isEliteNerdRank(a.rank);
      const bElite = isEliteNerdRank(b.rank);
      if (aElite && bElite) return a.rank - b.rank;
      if (aElite) return -1;
      if (bElite) return 1;
      return b.rank - a.rank;
    });
}
