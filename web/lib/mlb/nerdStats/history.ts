import {
  createEmptySeasonCounters,
  mergeSeasonCounters,
} from "@/lib/mlb/nerdStats/counters";
import {
  getNerdStatDefinition,
  NERD_STAT_DEFINITIONS,
  withNerdStatSplit,
  withNerdStatWindow,
  type NerdStatDefinition,
} from "@/lib/mlb/nerdStats/definitions";
import type { PerGameNerdCacheEntry } from "@/lib/mlb/nerdStats/gameCache";
import type { SeasonNerdCounters, TeamNerdCounters } from "@/lib/mlb/nerdStats/types";
import {
  getTeamById,
  getTeamIdsForGroup,
  MLB_TEAMS,
  NERD_STAT_GROUP_FILTERS,
  type NerdStatGroupFilter,
} from "@/lib/mlb/teams";
import { getTeamColor } from "@/lib/mlb/teamColors";

export type NerdStatHistoryBasis = "cumulative" | "rolling7" | "daily";
export type NerdStatHistorySplit = "all" | "home" | "away";

export interface NerdStatTeamHistorySeries {
  cumulative: (number | null)[];
  rolling7: (number | null)[];
  daily: (number | null)[];
}

export interface NerdStatHistory {
  season: number;
  statId: string;
  dates: string[];
  splits: Record<NerdStatHistorySplit, { teams: Record<string, NerdStatTeamHistorySeries> }>;
  generatedAt: string;
}

export interface NerdStatHistorySeriesPoint {
  date: string;
  teamValue: number | null;
  groupAverage: number | null;
  teamRank: number | null;
}

export interface SelectHistorySeriesOptions {
  basis: NerdStatHistoryBasis;
  split: NerdStatHistorySplit;
  group: NerdStatGroupFilter;
  teamId: number;
  sort: "asc" | "desc";
}

export interface SelectedHistorySeries {
  points: NerdStatHistorySeriesPoint[];
  teamLabel: string;
  teamAbbrev: string;
}

export interface MultiTeamHistorySeries {
  teamId: number;
  teamAbbrev: string;
  teamName: string;
  color: string;
  values: (number | null)[];
}

export interface SelectedMultiHistorySeries {
  dates: string[];
  teams: MultiTeamHistorySeries[];
  groupLabel: string;
}

export interface SelectMultiHistorySeriesOptions {
  basis: NerdStatHistoryBasis;
  split: NerdStatHistorySplit;
  group: NerdStatGroupFilter;
}

const HISTORY_SPLITS: NerdStatHistorySplit[] = ["all", "home", "away"];

function meetsMinimum(
  definition: NerdStatDefinition,
  counters: TeamNerdCounters,
  split: NerdStatHistorySplit,
): boolean {
  // Trend charts show values as soon as a team has feed data; standings minGames
  // thresholds are for leaderboard stability, not daily history.
  void definition;
  void split;
  return counters.finalGamesWithFeed > 0;
}

function sliceFromEntry(
  entry: PerGameNerdCacheEntry,
  split: NerdStatHistorySplit,
): SeasonNerdCounters {
  if (split === "home") return entry.home;
  if (split === "away") return entry.away;
  return entry.combined;
}

function mergeEntries(
  entries: PerGameNerdCacheEntry[],
  split: NerdStatHistorySplit,
): SeasonNerdCounters {
  const counters = createEmptySeasonCounters();
  for (const entry of entries) {
    mergeSeasonCounters(counters, sliceFromEntry(entry, split));
  }
  return counters;
}

function addDaysUtc(date: string, delta: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + delta);
  return parsed.toISOString().slice(0, 10);
}

function computeTeamValues(
  definition: NerdStatDefinition,
  season: SeasonNerdCounters,
  split: NerdStatHistorySplit,
): Record<string, number | null> {
  const values: Record<string, number | null> = {};
  for (const team of MLB_TEAMS) {
    const teamId = String(team.id);
    values[teamId] = withNerdStatWindow("season", () =>
      withNerdStatSplit(split, () => {
        const counters = season[teamId];
        if (!counters || counters.finalGamesWithFeed === 0) return null;
        if (!meetsMinimum(definition, counters, split)) return null;
        const value = definition.compute(counters);
        return value != null && Number.isFinite(value) ? value : null;
      }),
    );
  }
  return values;
}

function createEmptyTeamSeries(length: number): NerdStatTeamHistorySeries {
  return {
    cumulative: Array.from({ length }, () => null),
    rolling7: Array.from({ length }, () => null),
    daily: Array.from({ length }, () => null),
  };
}

function groupCachesByDate(
  caches: PerGameNerdCacheEntry[],
): Map<string, PerGameNerdCacheEntry[]> {
  const byDate = new Map<string, PerGameNerdCacheEntry[]>();
  for (const entry of caches) {
    const bucket = byDate.get(entry.gameDate);
    if (bucket) bucket.push(entry);
    else byDate.set(entry.gameDate, [entry]);
  }
  return byDate;
}

export function buildNerdStatHistoryForStat(
  season: number,
  statId: string,
  caches: PerGameNerdCacheEntry[],
): NerdStatHistory | null {
  const definition = getNerdStatDefinition(statId);
  if (!definition) return null;

  const sorted = [...caches].sort((a, b) => a.gameDate.localeCompare(b.gameDate) || a.gamePk - b.gamePk);
  const byDate = groupCachesByDate(sorted);
  const dates = [...byDate.keys()].sort();
  if (dates.length === 0) {
    return {
      season,
      statId,
      dates: [],
      splits: {
        all: { teams: {} },
        home: { teams: {} },
        away: { teams: {} },
      },
      generatedAt: new Date().toISOString(),
    };
  }

  const splits: NerdStatHistory["splits"] = {
    all: { teams: {} },
    home: { teams: {} },
    away: { teams: {} },
  };

  for (const split of HISTORY_SPLITS) {
    const teamSeries: Record<string, NerdStatTeamHistorySeries> = {};
    for (const team of MLB_TEAMS) {
      teamSeries[String(team.id)] = createEmptyTeamSeries(dates.length);
    }

    const cumulative = createEmptySeasonCounters();

    for (let index = 0; index < dates.length; index += 1) {
      const date = dates[index]!;
      const dayEntries = byDate.get(date) ?? [];
      const dailyCounters = mergeEntries(dayEntries, split);
      mergeSeasonCounters(cumulative, dailyCounters);

      const rollingSince = addDaysUtc(date, -6);
      const rollingEntries = sorted.filter(
        (entry) => entry.gameDate >= rollingSince && entry.gameDate <= date,
      );
      const rollingCounters = mergeEntries(rollingEntries, split);

      const cumulativeValues = computeTeamValues(definition, cumulative, split);
      const dailyValues = computeTeamValues(definition, dailyCounters, split);
      const rollingValues = computeTeamValues(definition, rollingCounters, split);

      for (const team of MLB_TEAMS) {
        const teamId = String(team.id);
        teamSeries[teamId]!.cumulative[index] = cumulativeValues[teamId] ?? null;
        teamSeries[teamId]!.daily[index] = dailyValues[teamId] ?? null;
        teamSeries[teamId]!.rolling7[index] = rollingValues[teamId] ?? null;
      }
    }

    splits[split] = { teams: teamSeries };
  }

  return {
    season,
    statId,
    dates,
    splits,
    generatedAt: new Date().toISOString(),
  };
}

export function buildNerdStatHistory(
  season: number,
  caches: PerGameNerdCacheEntry[],
  statIds: string[] = NERD_STAT_DEFINITIONS.map((definition) => definition.id),
): Map<string, NerdStatHistory> {
  const results = new Map<string, NerdStatHistory>();
  for (const statId of statIds) {
    const history = buildNerdStatHistoryForStat(season, statId, caches);
    if (history) results.set(statId, history);
  }
  return results;
}

function valuesForBasis(
  series: NerdStatTeamHistorySeries,
  basis: NerdStatHistoryBasis,
): (number | null)[] {
  if (basis === "daily") return series.daily;
  if (basis === "rolling7") return series.rolling7;
  return series.cumulative;
}

function computeRank(
  value: number,
  peerValues: number[],
  sort: "asc" | "desc",
): number {
  const sorted =
    sort === "desc"
      ? [...peerValues].sort((a, b) => b - a)
      : [...peerValues].sort((a, b) => a - b);
  const index = sorted.indexOf(value);
  return index >= 0 ? index + 1 : sorted.length + 1;
}

export function selectHistorySeries(
  history: NerdStatHistory,
  options: SelectHistorySeriesOptions,
): SelectedHistorySeries {
  const { basis, split, group, teamId, sort } = options;
  const groupTeamIds = new Set(getTeamIdsForGroup(group));
  const splitData = history.splits[split];
  const teamKey = String(teamId);
  const team = getTeamById(teamId);
  const teamSeries = splitData?.teams[teamKey];

  const points: NerdStatHistorySeriesPoint[] = history.dates.map((date, index) => {
    const teamValue = teamSeries ? valuesForBasis(teamSeries, basis)[index] ?? null : null;

    const peerValues: number[] = [];
    for (const id of groupTeamIds) {
      const peerSeries = splitData?.teams[String(id)];
      if (!peerSeries) continue;
      const peerValue = valuesForBasis(peerSeries, basis)[index];
      if (peerValue != null && Number.isFinite(peerValue)) peerValues.push(peerValue);
    }

    const groupAverage =
      peerValues.length > 0
        ? peerValues.reduce((sum, value) => sum + value, 0) / peerValues.length
        : null;

    const teamRank =
      teamValue != null && peerValues.length > 0
        ? computeRank(teamValue, peerValues, sort)
        : null;

    return { date, teamValue, groupAverage, teamRank };
  });

  return {
    points,
    teamLabel: team?.name ?? "Unknown",
    teamAbbrev: team?.abbrev ?? "???",
  };
}

function groupLabelForFilter(group: NerdStatGroupFilter): string {
  return NERD_STAT_GROUP_FILTERS.find((item) => item.id === group)?.label ?? "Teams";
}

export function selectMultiHistorySeries(
  history: NerdStatHistory,
  options: SelectMultiHistorySeriesOptions,
): SelectedMultiHistorySeries {
  const { basis, split, group } = options;
  const splitData = history.splits[split];
  const teamIds = getTeamIdsForGroup(group);

  const teams: MultiTeamHistorySeries[] = teamIds
    .map((teamId) => {
      const team = getTeamById(teamId);
      const teamSeries = splitData?.teams[String(teamId)];
      if (!team || !teamSeries) return null;
      return {
        teamId,
        teamAbbrev: team.abbrev,
        teamName: team.name,
        color: getTeamColor(teamId),
        values: valuesForBasis(teamSeries, basis),
      };
    })
    .filter((entry): entry is MultiTeamHistorySeries => entry != null);

  return {
    dates: history.dates,
    teams,
    groupLabel: groupLabelForFilter(group),
  };
}

export function multiSeriesHasPlottedValues(series: SelectedMultiHistorySeries): boolean {
  return series.teams.some((team) =>
    team.values.some((value) => value != null && Number.isFinite(value)),
  );
}

export const NERD_STAT_HISTORY_BASES: Array<{ id: NerdStatHistoryBasis; label: string }> = [
  { id: "cumulative", label: "Cumulative" },
  { id: "rolling7", label: "7-day rolling" },
  { id: "daily", label: "Daily" },
];

export const NERD_STAT_HISTORY_SPLITS: Array<{ id: NerdStatHistorySplit; label: string }> = [
  { id: "all", label: "All games" },
  { id: "home", label: "Home" },
  { id: "away", label: "Away" },
];
