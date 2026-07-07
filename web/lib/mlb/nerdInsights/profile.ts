import type { TeamNerdCard } from "@/lib/mlb/nerdStats/types";
import type { TeamNerdProfile, TeamNerdStatEntry } from "@/lib/mlb/nerdInsights/types";
import { MLB_TEAMS } from "@/lib/mlb/teams";

export function profileFromTeamCard(card: TeamNerdCard): TeamNerdProfile {
  const stats = new Map<string, TeamNerdStatEntry>();
  for (const entry of card.stats) {
    stats.set(entry.statId, {
      rank: entry.rank,
      displayValue: entry.displayValue,
      value: entry.value,
      title: entry.title,
      sort: entry.sort,
    });
  }
  return {
    teamId: card.teamId,
    abbrev: card.abbrev,
    stats,
  };
}

export function getTeamStat(
  profile: TeamNerdProfile | null | undefined,
  statId: string,
): TeamNerdStatEntry | undefined {
  return profile?.stats.get(statId);
}

export function isEliteRank(
  entry: TeamNerdStatEntry | undefined,
  maxRank = 5,
): entry is TeamNerdStatEntry {
  if (!entry || entry.rank > maxRank) return false;
  return entry.value > 0 || entry.displayValue !== "—";
}

/** Bottom-N in the league (insights only — wider than share-card cursed threshold). */
export function isCursedInsightRank(
  entry: TeamNerdStatEntry | undefined,
  bottomN = 8,
): entry is TeamNerdStatEntry {
  if (!entry) return false;
  const threshold = MLB_TEAMS.length - bottomN + 1;
  if (entry.rank < threshold) return false;
  return entry.value > 0 || entry.displayValue !== "—";
}

export function isNotableInsightRank(
  entry: TeamNerdStatEntry | undefined,
  eliteMaxRank = 8,
  cursedBottomN = 8,
): entry is TeamNerdStatEntry {
  return isEliteRank(entry, eliteMaxRank) || isCursedInsightRank(entry, cursedBottomN);
}

export function rankLabel(rank: number): string {
  const mod100 = rank % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${rank}th`;
  switch (rank % 10) {
    case 1:
      return `${rank}st`;
    case 2:
      return `${rank}nd`;
    case 3:
      return `${rank}rd`;
    default:
      return `${rank}th`;
  }
}
