import {
  buildFullStatLeaderboard,
  buildStatLeaderboard,
  collectNotableEventsForStat,
  NERD_STAT_DEFINITIONS,
  pickStatOfTheDay,
  withNerdStatSplit,
  withNerdStatWindow,
} from "@/lib/mlb/nerdStats/definitions";
import type {
  NerdStatDetail,
  NerdStatsSummary,
  SeasonNerdCounters,
  TeamNerdCard,
} from "@/lib/mlb/nerdStats/types";
import { getTeamById, MLB_TEAMS } from "@/lib/mlb/teams";
import type { NerdStatSplitFilter } from "@/lib/mlb/nerdStats/splits";
import { nerdStatSplitLabel } from "@/lib/mlb/nerdStats/splits";
import type { NerdStatWindowId } from "@/lib/mlb/nerdStats/windows";
import { nerdStatWindowLabel } from "@/lib/mlb/nerdStats/windows";

export function buildNerdStatsSummary(
  season: number,
  counters: SeasonNerdCounters,
  indexedGameCount: number,
  window: NerdStatWindowId = "season",
  split: NerdStatSplitFilter = "all",
): NerdStatsSummary {
  return withNerdStatWindow(window, () =>
    withNerdStatSplit(split, () => {
      const stats = NERD_STAT_DEFINITIONS.map((definition) =>
        buildStatLeaderboard(definition, counters, 5),
      );

      return {
        season,
        generatedAt: new Date().toISOString(),
        indexedGameCount,
        stats,
        statOfTheDayId: pickStatOfTheDay(season, stats),
        window,
        windowLabel: nerdStatWindowLabel(window),
        split: split === "all" ? undefined : split,
        splitLabel: nerdStatSplitLabel(split) ?? undefined,
      };
    }),
  );
}

export function buildNerdStatDetail(
  season: number,
  statId: string,
  counters: SeasonNerdCounters,
  window: NerdStatWindowId = "season",
  split: NerdStatSplitFilter = "all",
): NerdStatDetail | null {
  const definition = NERD_STAT_DEFINITIONS.find((stat) => stat.id === statId);
  if (!definition) return null;

  const stat = withNerdStatWindow(window, () =>
    withNerdStatSplit(split, () => buildFullStatLeaderboard(definition, counters)),
  );

  return {
    season,
    stat,
    allTeams: stat.leaders,
    notableEvents: collectNotableEventsForStat(counters, statId),
    generatedAt: new Date().toISOString(),
  };
}

export function buildTeamNerdCard(
  season: number,
  teamId: number,
  counters: SeasonNerdCounters,
): TeamNerdCard | null {
  const team = getTeamById(teamId);
  if (!team) return null;

  const stats = NERD_STAT_DEFINITIONS.map((definition) => {
    const leaderboard = buildFullStatLeaderboard(definition, counters);
    const entry = leaderboard.leaders.find((leader) => leader.teamId === teamId);
    return {
      statId: definition.id,
      title: definition.title,
      category: definition.category,
      rank: entry?.rank ?? 30,
      value: entry?.value ?? 0,
      displayValue: entry?.displayValue ?? "—",
      sort: definition.sort,
    };
  });

  return {
    season,
    teamId,
    abbrev: team.abbrev,
    teamName: team.name,
    generatedAt: new Date().toISOString(),
    stats,
  };
}

export function buildAllTeamNerdCards(
  season: number,
  counters: SeasonNerdCounters,
): TeamNerdCard[] {
  return MLB_TEAMS.map((team) => buildTeamNerdCard(season, team.id, counters)!).filter(Boolean);
}
