import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { listJsonBasenames, readDataJson } from "@/lib/dataFile";
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
import { mergeAndWritePlayerNerdStore } from "@/lib/mlb/nerdStats/playerNerdStore";
import type { SeasonPlayerNerdCounters } from "@/lib/mlb/nerdStats/types";
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
import {
  isPostseasonGameType,
  nerdSeasonTypeLabel,
  type NerdSeasonType,
} from "@/lib/mlb/nerdStats/seasonTypes";

function seasonDir(season: number): string {
  return join(process.cwd(), "data", "nerd-stats", String(season));
}

function seasonTypeDir(season: number, seasonType: NerdSeasonType): string {
  return seasonType === "postseason"
    ? join(seasonDir(season), "postseason")
    : seasonDir(season);
}

function summaryPath(season: number, seasonType: NerdSeasonType = "regular"): string {
  return join(seasonTypeDir(season, seasonType), "summary.json");
}

function manifestPath(season: number, seasonType: NerdSeasonType = "regular"): string {
  return join(seasonTypeDir(season, seasonType), "manifest.json");
}

function countersPath(season: number, seasonType: NerdSeasonType = "regular"): string {
  return join(seasonTypeDir(season, seasonType), "counters.json");
}

function statPath(season: number, statId: string, seasonType: NerdSeasonType = "regular"): string {
  return join(seasonTypeDir(season, seasonType), "stats", `${statId}.json`);
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

function ensureSeasonDir(season: number, seasonType: NerdSeasonType = "regular"): void {
  mkdirSync(join(seasonTypeDir(season, seasonType), "stats"), { recursive: true });
  if (seasonType === "postseason") return;
  mkdirSync(join(seasonDir(season), "teams"), { recursive: true });
  mkdirSync(join(seasonDir(season), "windows"), { recursive: true });
  mkdirSync(join(seasonDir(season), "splits"), { recursive: true });
  for (const split of NERD_STAT_SPLITS) {
    mkdirSync(join(splitDir(season, split.id), "stats"), { recursive: true });
  }
}

function readJson<T>(path: string): T | null {
  return readDataJson<T>(path);
}

function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data)}\n`, "utf8");
}

export function loadNerdStatsManifest(
  season: number,
  seasonType: NerdSeasonType = "regular",
): NerdStatsManifest {
  return (
    readJson<NerdStatsManifest>(manifestPath(season, seasonType)) ?? {
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
  seasonType: NerdSeasonType = "regular",
): NerdStatsSummary | null {
  if (split !== "all" && window !== "season") return null;
  if (seasonType === "postseason" && (window !== "season" || split !== "all")) return null;

  const path =
    seasonType === "postseason"
      ? summaryPath(season, seasonType)
      : split !== "all"
      ? splitSummaryPath(season, split)
      : window === "season"
        ? summaryPath(season, seasonType)
        : windowSummaryPath(season, window);
  const summary = readJson<NerdStatsSummary>(path);
  if (!summary) return null;
  return {
    ...summary,
    window: summary.window ?? window,
    windowLabel: summary.windowLabel ?? nerdStatWindowLabel(window),
    split: summary.split ?? (split === "all" ? undefined : split),
    splitLabel: summary.splitLabel ?? nerdStatSplitLabel(split) ?? undefined,
    seasonType,
    seasonTypeLabel: nerdSeasonTypeLabel(seasonType),
  };
}

export function loadNerdStatDetail(
  season: number,
  statId: string,
  window: NerdStatWindowId = "season",
  split: NerdStatSplitFilter = "all",
  seasonType: NerdSeasonType = "regular",
): NerdStatDetail | null {
  if (split !== "all" && window !== "season") return null;
  if (seasonType === "postseason" && (window !== "season" || split !== "all")) return null;

  // Always derive from counters so detail matches summary cards (rolling-window
  // updates rewrite summary.json but may skip stale per-stat JSON on disk).
  const counters = loadCountersForStore(season, window, split, seasonType);
  return buildNerdStatDetail(season, statId, counters, window, split);
}

function loadCountersForStore(
  season: number,
  window: NerdStatWindowId,
  split: NerdStatSplitFilter,
  seasonType: NerdSeasonType,
): SeasonNerdCounters {
  if (seasonType === "postseason") return loadSeasonCounters(season, seasonType);
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

export function loadSeasonCounters(
  season: number,
  seasonType: NerdSeasonType = "regular",
): SeasonNerdCounters {
  const raw = readJson<SeasonNerdCounters>(countersPath(season, seasonType));
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
  seasonType?: NerdSeasonType;
}

export function listMissingStatIds(
  season: number,
  seasonType: NerdSeasonType = "regular",
): string[] {
  const stored = new Set(listStoredStatIds(season, seasonType));
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
  const seasonType = options.seasonType ?? "regular";
  ensureSeasonDir(season, seasonType);

  const statIds = options.statIds ?? NERD_STAT_DEFINITIONS.map((definition) => definition.id);
  const writtenStatIds: string[] = [];
  const indexedGameCount = options.indexedGameCount ?? processedGamePks.length;
  const summary = buildNerdStatsSummary(season, counters, indexedGameCount, window, "all");
  const summaryWithWindow: NerdStatsSummary = {
    ...summary,
    window,
    windowLabel: nerdStatWindowLabel(window),
    seasonType,
    seasonTypeLabel: nerdSeasonTypeLabel(seasonType),
  };

  if (window === "season") {
    const manifest: NerdStatsManifest = {
      season,
      processedGamePks: [...processedGamePks].sort((a, b) => a - b),
      generatedAt: new Date().toISOString(),
    };
    writeJson(manifestPath(season, seasonType), manifest);
    writeJson(countersPath(season, seasonType), counters);
    writeJson(summaryPath(season, seasonType), summaryWithWindow);
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
      window === "season" ? statPath(season, statId, seasonType) : windowStatPath(season, window, statId);
    writeJson(path, detail);
    writtenStatIds.push(statId);
  }

  if (!options.skipTeamCards && window === "season" && seasonType === "regular") {
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
  const seasonType: NerdSeasonType = isPostseasonGameType(row.game_type) ? "postseason" : "regular";
  ensureSeasonDir(season, seasonType);

  const manifest = loadNerdStatsManifest(season, seasonType);
  if (manifest.processedGamePks.includes(row.game_pk)) return;

  const counters = loadSeasonCounters(season, seasonType);
  if (seasonType === "postseason") {
    const gameCounters = extractNerdCountersFromGame(row, "all");
    await enrichCountersWithSavantBatSpeed(gameCounters, row.game_pk, { row, split: "all" });
    mergeSeasonCounters(counters, gameCounters);
    writePerGameNerdCache(season, {
      gamePk: row.game_pk,
      gameDate: row.game_date,
      gameType: row.game_type,
      combined: gameCounters,
      home: createEmptySeasonCounters(),
      away: createEmptySeasonCounters(),
      extractedAt: new Date().toISOString(),
    });
    writeGameSourceRow(season, row);
    manifest.processedGamePks.push(row.game_pk);
    manifest.processedGamePks.sort((a, b) => a - b);
    writeNerdStatsStore(season, counters, manifest.processedGamePks, {
      seasonType,
      skipTeamCards: true,
    });
    return;
  }

  const homeCounters = loadSplitCounters(season, "home");
  const awayCounters = loadSplitCounters(season, "away");

  const playerDelta: SeasonPlayerNerdCounters = {};
  const gameCounters = extractNerdCountersFromGame(row, "all", playerDelta);
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
    gameType: row.game_type,
    combined: gameCounters,
    home: gameHomeCounters,
    away: gameAwayCounters,
    players: playerDelta,
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

  try {
    mergeAndWritePlayerNerdStore(season, playerDelta, counters);
  } catch (err) {
    console.warn(`player nerd store ${row.game_pk} failed:`, err);
  }
}

export function getEmptyNerdStatsSummary(
  season: number,
  seasonType: NerdSeasonType = "regular",
): NerdStatsSummary {
  return {
    ...buildNerdStatsSummary(season, createEmptySeasonCounters(), 0),
    seasonType,
    seasonTypeLabel: nerdSeasonTypeLabel(seasonType),
  };
}

export function listStoredStatIds(
  season: number,
  seasonType: NerdSeasonType = "regular",
): string[] {
  return listJsonBasenames(join(seasonTypeDir(season, seasonType), "stats"));
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
