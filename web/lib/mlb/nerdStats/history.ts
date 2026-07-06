import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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
import { splitEffectiveMinGames } from "@/lib/mlb/nerdStats/splits";
import type { SeasonNerdCounters, TeamNerdCounters } from "@/lib/mlb/nerdStats/types";
import {
  getTeamById,
  getTeamIdsForGroup,
  MLB_TEAMS,
  type NerdStatGroupFilter,
} from "@/lib/mlb/teams";

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

const HISTORY_SPLITS: NerdStatHistorySplit[] = ["all", "home", "away"];

function historyDir(season: number): string {
  return join(process.cwd(), "data", "nerd-stats", String(season), "history");
}

function historyPath(season: number, statId: string): string {
  return join(historyDir(season), `${statId}.json`);
}

function meetsMinimum(
  definition: NerdStatDefinition,
  counters: TeamNerdCounters,
  split: NerdStatHistorySplit,
): boolean {
  if (definition.minGames == null) return true;
  const minGames = splitEffectiveMinGames(definition.minGames, split);
  return counters.finalGamesWithFeed >= minGames;
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

export function writeNerdStatHistory(season: number, history: NerdStatHistory): void {
  const dir = historyDir(season);
  mkdirSync(dir, { recursive: true });
  writeFileSync(historyPath(season, history.statId), `${JSON.stringify(history)}\n`, "utf8");
}

export function writeNerdStatHistories(
  season: number,
  histories: Iterable<NerdStatHistory>,
): number {
  let count = 0;
  for (const history of histories) {
    writeNerdStatHistory(season, history);
    count += 1;
  }
  return count;
}

export function loadNerdStatHistory(season: number, statId: string): NerdStatHistory | null {
  const path = historyPath(season, statId);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as NerdStatHistory;
}

export function listStoredHistoryStatIds(season: number): string[] {
  const dir = historyDir(season);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => file.replace(/\.json$/, ""));
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
