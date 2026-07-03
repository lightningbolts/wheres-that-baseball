import type { TeamNerdCard } from "@/lib/mlb/nerdStats/types";
import type { TeamNerdProfile, TeamNerdStatEntry } from "@/lib/mlb/nerdInsights/types";

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
