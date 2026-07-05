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

function ensureSeasonDir(season: number): void {
  mkdirSync(join(seasonDir(season), "stats"), { recursive: true });
  mkdirSync(join(seasonDir(season), "teams"), { recursive: true });
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

export function loadNerdStatsSummary(season: number): NerdStatsSummary | null {
  return readJson<NerdStatsSummary>(summaryPath(season));
}

export function loadNerdStatDetail(season: number, statId: string): NerdStatDetail | null {
  return readJson<NerdStatDetail>(statPath(season, statId));
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
  ensureSeasonDir(season);

  const manifest: NerdStatsManifest = {
    season,
    processedGamePks: [...processedGamePks].sort((a, b) => a - b),
    generatedAt: new Date().toISOString(),
  };

  const summary = buildNerdStatsSummary(season, counters, manifest.processedGamePks.length);
  const statIds = options.statIds ?? NERD_STAT_DEFINITIONS.map((definition) => definition.id);
  const writtenStatIds: string[] = [];

  writeJson(manifestPath(season), manifest);
  writeJson(countersPath(season), counters);
  writeJson(summaryPath(season), summary);

  for (const statId of statIds) {
    if (!NERD_STAT_DEFINITIONS.some((definition) => definition.id === statId)) continue;
    const detail = buildNerdStatDetail(season, statId, counters);
    if (!detail) continue;
    writeJson(statPath(season, statId), detail);
    writtenStatIds.push(statId);
  }

  if (!options.skipTeamCards) {
    for (const card of buildAllTeamNerdCards(season, counters)) {
      writeJson(teamCardPath(season, card.teamId), card);
    }
  }

  return { writtenStatIds };
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
