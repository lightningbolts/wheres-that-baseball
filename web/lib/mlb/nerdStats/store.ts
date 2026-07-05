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

function ensureSeasonDir(season: number): void {
  mkdirSync(join(seasonDir(season), "stats"), { recursive: true });
  mkdirSync(join(seasonDir(season), "teams"), { recursive: true });
  mkdirSync(join(seasonDir(season), "windows"), { recursive: true });
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
): NerdStatsSummary | null {
  const path = window === "season" ? summaryPath(season) : windowSummaryPath(season, window);
  const summary = readJson<NerdStatsSummary>(path);
  if (!summary) return null;
  return {
    ...summary,
    window: summary.window ?? window,
    windowLabel: summary.windowLabel ?? nerdStatWindowLabel(window),
  };
}

export function loadNerdStatDetail(
  season: number,
  statId: string,
  window: NerdStatWindowId = "season",
): NerdStatDetail | null {
  const path = window === "season" ? statPath(season, statId) : windowStatPath(season, window, statId);
  const cached = readJson<NerdStatDetail>(path);
  if (cached) return cached;

  const counters =
    window === "season" ? loadSeasonCounters(season) : loadWindowCounters(season, window);
  const detail = buildNerdStatDetail(season, statId, counters, window);
  return detail;
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
  const summary = buildNerdStatsSummary(season, counters, indexedGameCount, window);
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
    const detail = buildNerdStatDetail(season, statId, counters, window);
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

export function parseNerdStatsWindowParam(value: string | null | undefined): NerdStatWindowId {
  return parseNerdStatWindow(value);
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
  const gameCounters = extractNerdCountersFromGame(row);
  await enrichCountersWithSavantBatSpeed(gameCounters, row.game_pk);
  mergeSeasonCounters(counters, gameCounters);

  manifest.processedGamePks.push(row.game_pk);
  manifest.processedGamePks.sort((a, b) => a - b);

  writeNerdStatsStore(season, counters, manifest.processedGamePks);
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
