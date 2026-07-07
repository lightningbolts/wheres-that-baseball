import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  buildAllTeamNerdCards,
  buildNerdStatDetail,
  buildNerdStatsSummary,
} from "@/lib/mlb/nerdStats/build";
import {
  createEmptySeasonCounters,
  mergeSeasonCounters,
  normalizeSeasonCounters,
} from "@/lib/mlb/nerdStats/counters";
import { NERD_STAT_DEFINITIONS } from "@/lib/mlb/nerdStats/definitions";
import { extractNerdCountersFromGame } from "@/lib/mlb/nerdStats/extractGame";
import { writePerGameNerdCache } from "@/lib/mlb/nerdStats/gameCache";
import { writeGameSourceRow } from "@/lib/mlb/nerdStats/gameSourceCache";
import { enrichCountersWithSavantBatSpeed } from "@/lib/mlb/nerdStats/savantBatSpeed";
import type {
  GameNerdSourceRow,
  NerdStatDetail,
  NerdStatsManifest,
  NerdStatsSummary,
  SeasonNerdCounters,
  TeamNerdCard,
} from "@/lib/mlb/nerdStats/types";
import {
  nerdStatWindowLabel,
  NERD_STAT_WINDOWS,
  parseNerdStatWindow,
  type NerdStatWindowId,
} from "@/lib/mlb/nerdStats/windows";
import {
  nerdStatSplitLabel,
  NERD_STAT_SPLITS,
  parseNerdStatSplit,
  type NerdStatSplitFilter,
  type NerdStatSplitId,
} from "@/lib/mlb/nerdStats/splits";

function seasonDir(season: number): string {
  return join(process.cwd(), "data", "nerd-stats", String(season));
}

function summaryPath(season: number): string {
  return join(seasonDir(season), "summary.json");
}

function manifestPath(season: number): string {
  return join(seasonDir(season), "manifest.json");
}

function countersPath(season: number): string {
  return join(seasonDir(season), "counters.json");
}

function statPath(season: number, statId: string): string {
  return join(seasonDir(season), "stats", `${statId}.json`);
}

function teamCardPath(season: number, teamId: number): string {
  return join(seasonDir(season), "teams", `${teamId}.json`);
}

function windowDir(season: number, windowId: NerdStatWindowId): string {
  return join(seasonDir(season), "windows", windowId);
}

function windowSummaryPath(season: number, windowId: NerdStatWindowId): string {
  return join(windowDir(season, windowId), "summary.json");
}

function windowCountersPath(season: number, windowId: NerdStatWindowId): string {
  return join(windowDir(season, windowId), "counters.json");
}

function windowStatPath(season: number, windowId: NerdStatWindowId, statId: string): string {
  return join(windowDir(season, windowId), "stats", `${statId}.json`);
}

function splitDir(season: number, split: NerdStatSplitId): string {
  return join(seasonDir(season), "splits", split);
}

function splitSummaryPath(season: number, split: NerdStatSplitId): string {
  return join(splitDir(season, split), "summary.json");
}

function splitCountersPath(season: number, split: NerdStatSplitId): string {
  return join(splitDir(season, split), "counters.json");
}

function splitStatPath(season: number, split: NerdStatSplitId, statId: string): string {
  return join(splitDir(season, split), "stats", `${statId}.json`);
}

function ensureSeasonDir(season: number): void {
  mkdirSync(join(seasonDir(season), "stats"), { recursive: true });
  mkdirSync(join(seasonDir(season), "teams"), { recursive: true });
  mkdirSync(join(seasonDir(season), "windows"), { recursive: true });
  mkdirSync(join(seasonDir(season), "splits"), { recursive: true });
  for (const split of NERD_STAT_SPLITS) {
    mkdirSync(join(splitDir(season, split.id), "stats"), { recursive: true });
  }
}

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data)}\n`, "utf8");
}

export function loadNerdStatsManifest(season: number): NerdStatsManifest {
  return (
    readJson<NerdStatsManifest>(manifestPath(season)) ?? {
      season,
      processedGamePks: [],
      generatedAt: new Date(0).toISOString(),
    }
  );
}

export function loadNerdStatsSummary(
  season: number,
  window: NerdStatWindowId = "season",
  split: NerdStatSplitFilter = "all",
): NerdStatsSummary | null {
  if (split !== "all" && window !== "season") return null;

  const path =
    split !== "all"
      ? splitSummaryPath(season, split)
      : window === "season"
        ? summaryPath(season)
        : windowSummaryPath(season, window);
  const summary = readJson<NerdStatsSummary>(path);
  if (!summary) return null;
  return {
    ...summary,
    window: summary.window ?? window,
    windowLabel: summary.windowLabel ?? nerdStatWindowLabel(window),
    split: summary.split ?? (split === "all" ? undefined : split),
    splitLabel: summary.splitLabel ?? nerdStatSplitLabel(split) ?? undefined,
  };
}

export function loadNerdStatDetail(
  season: number,
  statId: string,
  window: NerdStatWindowId = "season",
  split: NerdStatSplitFilter = "all",
): NerdStatDetail | null {
  if (split !== "all" && window !== "season") return null;

  // Always derive from counters so detail matches summary cards (rolling-window
  // updates rewrite summary.json but may skip stale per-stat JSON on disk).
  const counters = loadCountersForStore(season, window, split);
  return buildNerdStatDetail(season, statId, counters, window, split);
}

function loadCountersForStore(
  season: number,
  window: NerdStatWindowId,
  split: NerdStatSplitFilter,
): SeasonNerdCounters {
  if (split !== "all") return loadSplitCounters(season, split);
  if (window === "season") return loadSeasonCounters(season);
  return loadWindowCounters(season, window);
}

export function loadSplitCounters(season: number, split: NerdStatSplitId): SeasonNerdCounters {
  const raw = readJson<SeasonNerdCounters>(splitCountersPath(season, split));
  if (!raw) return createEmptySeasonCounters();
  return normalizeSeasonCounters(raw);
}

export function loadWindowCounters(season: number, window: NerdStatWindowId): SeasonNerdCounters {
  if (window === "season") return loadSeasonCounters(season);
  const raw = readJson<SeasonNerdCounters>(windowCountersPath(season, window));
  if (!raw) return createEmptySeasonCounters();
  return normalizeSeasonCounters(raw);
}

export function loadTeamNerdCard(season: number, teamId: number): TeamNerdCard | null {
  return readJson<TeamNerdCard>(teamCardPath(season, teamId));
}

export function loadSeasonCounters(season: number): SeasonNerdCounters {
  const raw = readJson<SeasonNerdCounters>(countersPath(season));
  if (!raw) return createEmptySeasonCounters();
  return normalizeSeasonCounters(raw);
}

export interface WriteNerdStatsStoreOptions {
  /** When set, only these stat detail JSON files are written. */
  statIds?: string[];
  /** Skip rewriting per-team nerd card files. */
  skipTeamCards?: boolean;
  /** Override game count written into summary (e.g. when rebuilding from counters). */
  indexedGameCount?: number;
}

export function listMissingStatIds(season: number): string[] {
  const stored = new Set(listStoredStatIds(season));
  return NERD_STAT_DEFINITIONS.map((definition) => definition.id).filter((id) => !stored.has(id));
}

export function writeNerdStatsStore(
  season: number,
  counters: SeasonNerdCounters,
  processedGamePks: number[],
  options: WriteNerdStatsStoreOptions = {},
): { writtenStatIds: string[] } {
  return writeNerdStatsStoreAtPath(season, "season", counters, processedGamePks, options);
}

export function writeWindowNerdStatsStore(
  season: number,
  window: NerdStatWindowId,
  counters: SeasonNerdCounters,
  processedGamePks: number[],
  options: WriteNerdStatsStoreOptions = {},
): { writtenStatIds: string[] } {
  if (window === "season") {
    return writeNerdStatsStore(season, counters, processedGamePks, options);
  }
  return writeNerdStatsStoreAtPath(season, window, counters, processedGamePks, options);
}

function writeNerdStatsStoreAtPath(
  season: number,
  window: NerdStatWindowId,
  counters: SeasonNerdCounters,
  processedGamePks: number[],
  options: WriteNerdStatsStoreOptions = {},
): { writtenStatIds: string[] } {
  ensureSeasonDir(season);

  const statIds = options.statIds ?? NERD_STAT_DEFINITIONS.map((definition) => definition.id);
  const writtenStatIds: string[] = [];
  const indexedGameCount = options.indexedGameCount ?? processedGamePks.length;
  const summary = buildNerdStatsSummary(season, counters, indexedGameCount, window, "all");
  const summaryWithWindow: NerdStatsSummary = {
    ...summary,
    window,
    windowLabel: nerdStatWindowLabel(window),
  };

  if (window === "season") {
    const manifest: NerdStatsManifest = {
      season,
      processedGamePks: [...processedGamePks].sort((a, b) => a - b),
      generatedAt: new Date().toISOString(),
    };
    writeJson(manifestPath(season), manifest);
    writeJson(countersPath(season), counters);
    writeJson(summaryPath(season), summaryWithWindow);
  } else {
    mkdirSync(join(windowDir(season, window), "stats"), { recursive: true });
    writeJson(windowCountersPath(season, window), counters);
    writeJson(windowSummaryPath(season, window), summaryWithWindow);
  }

  for (const statId of statIds) {
    if (!NERD_STAT_DEFINITIONS.some((definition) => definition.id === statId)) continue;
    const detail = buildNerdStatDetail(season, statId, counters, window, "all");
    if (!detail) continue;
    const path =
      window === "season" ? statPath(season, statId) : windowStatPath(season, window, statId);
    writeJson(path, detail);
    writtenStatIds.push(statId);
  }

  if (!options.skipTeamCards && window === "season") {
    for (const card of buildAllTeamNerdCards(season, counters)) {
      writeJson(teamCardPath(season, card.teamId), card);
    }
  }

  return { writtenStatIds };
}

export function buildNerdStatsStoreFromGames(
  season: number,
  games: GameNerdSourceRow[],
  counters: SeasonNerdCounters,
  options: WriteNerdStatsStoreOptions = {},
): { writtenStatIds: string[] } {
  const processedGamePks = games.map((game) => game.game_pk).sort((a, b) => a - b);
  return writeNerdStatsStore(season, counters, processedGamePks, options);
}

export function buildWindowNerdStatsStoresFromGames(
  season: number,
  games: GameNerdSourceRow[],
  windowCounters: Array<{ window: NerdStatWindowId; counters: SeasonNerdCounters; games: GameNerdSourceRow[] }>,
  options: WriteNerdStatsStoreOptions = {},
): void {
  for (const entry of windowCounters) {
    writeWindowNerdStatsStore(
      season,
      entry.window,
      entry.counters,
      entry.games.map((game) => game.game_pk),
      options,
    );
  }
}

export function writeSplitNerdStatsStore(
  season: number,
  split: NerdStatSplitId,
  counters: SeasonNerdCounters,
  processedGamePks: number[],
  options: WriteNerdStatsStoreOptions = {},
): { writtenStatIds: string[] } {
  ensureSeasonDir(season);

  const statIds = options.statIds ?? NERD_STAT_DEFINITIONS.map((definition) => definition.id);
  const writtenStatIds: string[] = [];
  const indexedGameCount = options.indexedGameCount ?? processedGamePks.length;
  const summary = buildNerdStatsSummary(season, counters, indexedGameCount, "season", split);
  const summaryWithSplit: NerdStatsSummary = {
    ...summary,
    window: "season",
    windowLabel: nerdStatWindowLabel("season"),
    split,
    splitLabel: nerdStatSplitLabel(split) ?? undefined,
  };

  writeJson(splitCountersPath(season, split), counters);
  writeJson(splitSummaryPath(season, split), summaryWithSplit);

  for (const statId of statIds) {
    if (!NERD_STAT_DEFINITIONS.some((definition) => definition.id === statId)) continue;
    const detail = buildNerdStatDetail(season, statId, counters, "season", split);
    if (!detail) continue;
    writeJson(splitStatPath(season, split, statId), detail);
    writtenStatIds.push(statId);
  }

  return { writtenStatIds };
}

export function writeAllSplitNerdStatsStores(
  season: number,
  countersBySplit: Record<NerdStatSplitId, SeasonNerdCounters>,
  processedGamePks: number[],
  options: WriteNerdStatsStoreOptions = {},
): void {
  for (const split of NERD_STAT_SPLITS) {
    writeSplitNerdStatsStore(season, split.id, countersBySplit[split.id], processedGamePks, {
      ...options,
      skipTeamCards: true,
    });
  }
}

export function rebuildSplitStoresFromCounters(
  season: number,
  options: WriteNerdStatsStoreOptions = {},
): { rebuiltSplits: NerdStatSplitId[] } {
  const rebuiltSplits: NerdStatSplitId[] = [];
  const manifest = loadNerdStatsManifest(season);

  for (const split of NERD_STAT_SPLITS) {
    const counters = loadSplitCounters(season, split.id);
    const summary = loadNerdStatsSummary(season, "season", split.id);
    const indexedGameCount = summary?.indexedGameCount ?? manifest.processedGamePks.length;
    if (indexedGameCount === 0) continue;

    writeSplitNerdStatsStore(season, split.id, counters, manifest.processedGamePks, {
      ...options,
      indexedGameCount,
      skipTeamCards: true,
    });
    rebuiltSplits.push(split.id);
  }

  return { rebuiltSplits };
}

export function parseNerdStatsWindowParam(value: string | null | undefined): NerdStatWindowId {
  return parseNerdStatWindow(value);
}

export function parseNerdStatsSplitParam(value: string | null | undefined): NerdStatSplitFilter {
  return parseNerdStatSplit(value);
}

export function writeFullNerdStatsStore(
  season: number,
  counters: SeasonNerdCounters,
  processedGamePks: number[],
): void {
  writeNerdStatsStore(season, counters, processedGamePks);
}

export async function appendGameNerdStatsToStore(
  season: number,
  row: GameNerdSourceRow,
): Promise<void> {
  ensureSeasonDir(season);

  const manifest = loadNerdStatsManifest(season);
  if (manifest.processedGamePks.includes(row.game_pk)) return;

  const counters = loadSeasonCounters(season);
  const homeCounters = loadSplitCounters(season, "home");
  const awayCounters = loadSplitCounters(season, "away");

  const gameCounters = extractNerdCountersFromGame(row, "all");
  const gameHomeCounters = extractNerdCountersFromGame(row, "home");
  const gameAwayCounters = extractNerdCountersFromGame(row, "away");

  await enrichCountersWithSavantBatSpeed(gameCounters, row.game_pk, { row, split: "all" });
  await enrichCountersWithSavantBatSpeed(gameHomeCounters, row.game_pk, { row, split: "home" });
  await enrichCountersWithSavantBatSpeed(gameAwayCounters, row.game_pk, { row, split: "away" });

  mergeSeasonCounters(counters, gameCounters);
  mergeSeasonCounters(homeCounters, gameHomeCounters);
  mergeSeasonCounters(awayCounters, gameAwayCounters);

  writePerGameNerdCache(season, {
    gamePk: row.game_pk,
    gameDate: row.game_date,
    combined: gameCounters,
    home: gameHomeCounters,
    away: gameAwayCounters,
    extractedAt: new Date().toISOString(),
  });
  writeGameSourceRow(season, row);

  manifest.processedGamePks.push(row.game_pk);
  manifest.processedGamePks.sort((a, b) => a - b);

  writeNerdStatsStore(season, counters, manifest.processedGamePks);
  writeSplitNerdStatsStore(season, "home", homeCounters, manifest.processedGamePks, {
    skipTeamCards: true,
  });
  writeSplitNerdStatsStore(season, "away", awayCounters, manifest.processedGamePks, {
    skipTeamCards: true,
  });
}

export function getEmptyNerdStatsSummary(season: number): NerdStatsSummary {
  return buildNerdStatsSummary(season, createEmptySeasonCounters(), 0);
}

export function listStoredStatIds(season: number): string[] {
  const statsDir = join(seasonDir(season), "stats");
  if (!existsSync(statsDir)) return [];
  return readdirSync(statsDir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => file.replace(".json", ""));
}

/** Re-emit window summary + stat files from existing window counters (no game re-fetch). */
export function rebuildWindowStoresFromCounters(
  season: number,
  options: WriteNerdStatsStoreOptions = {},
): { rebuiltWindows: NerdStatWindowId[] } {
  const rebuiltWindows: NerdStatWindowId[] = [];

  for (const window of NERD_STAT_WINDOWS) {
    if (window.id === "season") continue;

    const counters = loadWindowCounters(season, window.id);
    const summary = loadNerdStatsSummary(season, window.id);
    const indexedGameCount = summary?.indexedGameCount ?? 0;
    if (indexedGameCount === 0) continue;

    writeWindowNerdStatsStore(season, window.id, counters, [], {
      ...options,
      indexedGameCount,
      skipTeamCards: true,
    });
    rebuiltWindows.push(window.id);
  }

  return { rebuiltWindows };
}
