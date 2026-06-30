import type {
  NerdStatLeader,
  NerdStatLeaderboard,
  NotableNerdEvent,
  SeasonNerdCounters,
} from "@/lib/mlb/nerdStats/types";
import {
  NERD_STAT_DEFINITIONS,
  type NerdStatDefinition,
} from "@/lib/mlb/nerdStats/statDefinitions";
import { getTeamById, MLB_TEAMS } from "@/lib/mlb/teams";

export {
  getNerdStatDefinition,
  NERD_STAT_DEFINITIONS,
  pickStatOfTheDay,
  type NerdStatDefinition,
} from "@/lib/mlb/nerdStats/statDefinitions";

function meetsMinimum(definition: NerdStatDefinition, counters: { finalGamesWithFeed: number }): boolean {
  if (definition.minGames == null) return true;
  return counters.finalGamesWithFeed >= definition.minGames;
}

function computeLeagueAverage(
  definition: NerdStatDefinition,
  season: SeasonNerdCounters,
): number | null {
  const values: number[] = [];
  for (const team of MLB_TEAMS) {
    const counters = season[String(team.id)];
    if (!counters || !meetsMinimum(definition, counters)) continue;
    const value = definition.compute(counters);
    if (value != null && Number.isFinite(value)) values.push(value);
  }
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function buildLeader(
  teamId: number,
  rank: number,
  value: number,
  definition: NerdStatDefinition,
): NerdStatLeader {
  const team = getTeamById(teamId);
  return {
    teamId,
    abbrev: team?.abbrev ?? "???",
    teamName: team?.name ?? "Unknown",
    value,
    rank,
    displayValue: definition.formatValue(value),
  };
}

export function buildStatLeaderboard(
  definition: NerdStatDefinition,
  season: SeasonNerdCounters,
  leaderCount = 5,
): NerdStatLeaderboard {
  const entries: NerdStatLeader[] = [];

  for (const team of MLB_TEAMS) {
    const counters = season[String(team.id)];
    if (!counters || !meetsMinimum(definition, counters)) continue;
    const value = definition.compute(counters);
    if (value == null || !Number.isFinite(value)) continue;
    entries.push(buildLeader(team.id, 0, value, definition));
  }

  entries.sort((a, b) =>
    definition.sort === "desc" ? b.value - a.value : a.value - b.value,
  );

  entries.forEach((entry, index) => {
    entry.rank = index + 1;
  });

  const leagueAverage = computeLeagueAverage(definition, season);

  return {
    id: definition.id,
    title: definition.title,
    subtitle: definition.subtitle,
    category: definition.category,
    sort: definition.sort,
    unit: definition.unit,
    leagueAverage,
    leagueAverageDisplay:
      leagueAverage != null ? definition.formatValue(leagueAverage) : null,
    leaders: entries.slice(0, leaderCount),
  };
}

export function buildFullStatLeaderboard(
  definition: NerdStatDefinition,
  season: SeasonNerdCounters,
): NerdStatLeaderboard {
  return buildStatLeaderboard(definition, season, 30);
}

export function collectNotableEventsForStat(
  season: SeasonNerdCounters,
  statId: string,
): NotableNerdEvent[] {
  const events: NotableNerdEvent[] = [];
  for (const team of MLB_TEAMS) {
    const counters = season[String(team.id)];
    if (!counters) continue;
    events.push(...counters.notableEvents.filter((event) => event.statId === statId));
  }

  events.sort((a, b) => b.gameDate.localeCompare(a.gameDate));
  return events.slice(0, 50);
}

export function getAllStatDefinitions(): NerdStatDefinition[] {
  return NERD_STAT_DEFINITIONS;
}
