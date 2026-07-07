/**
 * Aggregate nerd stats from archived games into web/data/nerd-stats/.
 *
 * Usage:
 *   npm run aggregate-nerd-stats -- --season=2026
 *   npm run aggregate-nerd-stats -- --season=2026 --since=2026-06-30
 *   npm run aggregate-nerd-stats -- --season=2026 --rebuild-store
 *
 * After adding new PBP-derived stat fields (re-extract from game_state):
 *   npm run aggregate-nerd-stats -- --season=2026 --backfill-counters --skip-savant
 *   (re-extracts from data/nerd-stats-local/{season}/sources/ when present — zero DB egress)
 *   npm run aggregate-nerd-stats -- --season=2026 --backfill-counters --force-refetch
 *   (one-time DB fetch; stores game_state under nerd-stats-local/ for future backfills)
 *
 * Rewrite stat JSON from existing season counters only (no DB fetch):
 *   npm run aggregate-nerd-stats -- --season=2026 --rebuild-store --stats=errors-committed
 *
 * Rebuild rolling window / split stat files from existing counters (no DB fetch):
 *   npm run aggregate-nerd-stats -- --season=2026 --rebuild-windows
 *   npm run aggregate-nerd-stats -- --season=2026 --rebuild-history
 *
 * Egress: bulk game_state reads over Supabase REST count against the 5 GB free tier.
 * Prefer DATABASE_URL (Session pooler) in ingestor/.env, or pass --require-postgres to fail
 * instead of falling back to REST.
 *
 * Flags:
 *   --backfill-counters   Re-extract counters for manifest games (cache-first)
 *   --force-refetch       Ignore per-game cache and re-download game_state from DB
 *   --require-postgres    Fail when Postgres is unreachable (do not use REST)
 *   --skip-savant         Skip Baseball Savant bat-speed fetches
 *   --stats=id1,id2       Only write these stat detail files
 *   --full-store          Write every stat file + team cards
 *   --team-cards          Also rewrite team nerd card JSON files
 *   --rebuild-windows     Re-emit rolling window + split stores from counters
 *   --rebuild-history     Rebuild daily history JSON from per-game caches (no DB)
 *   --backfill-savant     Re-fetch Savant bat speed for manifest games (Savant API + local game_state only; no Supabase)
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

import { createEmptySeasonCounters, mergeSeasonCounters } from "../lib/mlb/nerdStats/counters";
import { enrichCountersWithSavantBatSpeed, preserveBatSpeedCounters, refreshSavantBatSpeedForGame, resetBatSpeedCounters } from "../lib/mlb/nerdStats/savantBatSpeed";
import { extractNerdCountersFromGame } from "../lib/mlb/nerdStats/extractGame";
import {
  countPerGameCachesInWindow,
  loadPerGameNerdCache,
  loadPerGameNerdCaches,
  mergePerGameCaches,
  mergePerGameCachesForWindow,
  type PerGameNerdCacheEntry,
  writePerGameNerdCache,
} from "../lib/mlb/nerdStats/gameCache";
import {
  hasGameSourceRow,
  loadGameSourceRow,
  writeGameSourceRow,
} from "../lib/mlb/nerdStats/gameSourceCache";
import type { GameNerdSourceRow, SeasonNerdCounters } from "../lib/mlb/nerdStats/types";
import {
  appendGameNerdStatsToStore,
  listMissingStatIds,
  loadNerdStatsManifest,
  loadNerdStatsSummary,
  loadSeasonCounters,
  loadSplitCounters,
  loadWindowCounters,
  rebuildSplitStoresFromCounters,
  rebuildWindowStoresFromCounters,
  type WriteNerdStatsStoreOptions,
  writeNerdStatsStore,
  writeSplitNerdStatsStore,
  writeWindowNerdStatsStore,
} from "../lib/mlb/nerdStats/store";
import {
  buildNerdStatHistory,
} from "../lib/mlb/nerdStats/history";
import {
  writeNerdStatHistories,
} from "../lib/mlb/nerdStats/historyStore";
import type { NerdStatSplitId } from "../lib/mlb/nerdStats/splits";
import { gameDateInNerdWindow, NERD_STAT_WINDOWS } from "../lib/mlb/nerdStats/windows";

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = join(WEB_ROOT, "..");

function loadEnvFile(path: string) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile(join(WEB_ROOT, ".env.local"));
loadEnvFile(join(REPO_ROOT, "ingestor", ".env"));

const require = createRequire(join(WEB_ROOT, "package.json"));
const {
  resolveDbCredentials,
  testPostgresConnection,
} = require(join(REPO_ROOT, "scripts/lib/db.mjs")) as typeof import("../../scripts/lib/db.mjs");
const WEB_PKG = join(WEB_ROOT, "package.json");

const PK_PAGE_SIZE = 500;
const FULL_ROW_BATCH_SIZE = 12;
const SAVANT_BATCH_SIZE = 10;

const GAME_COLUMNS =
  "game_pk,game_date,season,away_team_id,home_team_id,away_team_abbrev,home_team_abbrev,away_score,home_score,game_state,box_score,feed_synced_at" as const;

const FULL_ROW_SELECT_SQL = `SELECT game_pk, game_date, season, away_team_id, home_team_id,
              away_team_abbrev, home_team_abbrev, away_score, home_score,
              game_state, box_score, feed_synced_at
       FROM games`;

function readArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function readCsvArg(name: string): string[] | undefined {
  const value = readArg(name);
  if (!value) return undefined;
  const ids = value.split(",").map((part) => part.trim()).filter(Boolean);
  return ids.length > 0 ? ids : undefined;
}

function readDateRange(): { since?: string; until?: string } {
  return { since: readArg("since"), until: readArg("until") };
}

function resolveStoreOptions(
  season: number,
  explicitStatIds?: string[],
  options?: { fullStore?: boolean; teamCards?: boolean },
): WriteNerdStatsStoreOptions {
  const onlyNewStats = !options?.fullStore && !explicitStatIds;

  return {
    statIds: explicitStatIds ?? (onlyNewStats ? listMissingStatIds(season) : undefined),
    skipTeamCards: !options?.teamCards && !options?.fullStore,
  };
}

async function extractAndCacheGame(
  season: number,
  game: GameNerdSourceRow,
  skipSavant: boolean,
): Promise<PerGameNerdCacheEntry> {
  const combined = extractNerdCountersFromGame(game, "all");
  const home = extractNerdCountersFromGame(game, "home");
  const away = extractNerdCountersFromGame(game, "away");

  if (!skipSavant) {
    await enrichCountersWithSavantBatSpeed(combined, game.game_pk, { row: game, split: "all" });
    await enrichCountersWithSavantBatSpeed(home, game.game_pk, { row: game, split: "home" });
    await enrichCountersWithSavantBatSpeed(away, game.game_pk, { row: game, split: "away" });
  }

  const entry: PerGameNerdCacheEntry = {
    gamePk: game.game_pk,
    gameDate: game.game_date,
    combined,
    home,
    away,
    extractedAt: new Date().toISOString(),
  };
  writePerGameNerdCache(season, entry);
  writeGameSourceRow(season, game);
  return entry;
}

async function extractAndCacheGames(
  season: number,
  games: GameNerdSourceRow[],
  skipSavant: boolean,
): Promise<PerGameNerdCacheEntry[]> {
  const entries: PerGameNerdCacheEntry[] = [];
  for (let i = 0; i < games.length; i += SAVANT_BATCH_SIZE) {
    const batch = games.slice(i, i + SAVANT_BATCH_SIZE);
    const batchEntries = await Promise.all(
      batch.map((game) => extractAndCacheGame(season, game, skipSavant)),
    );
    entries.push(...batchEntries);
    const done = Math.min(i + SAVANT_BATCH_SIZE, games.length);
    process.stdout.write(`\rCached ${done}/${games.length} games…`);
  }
  process.stdout.write("\n");
  return entries;
}

function countersByScopeFromCaches(
  caches: PerGameNerdCacheEntry[],
): Record<"combined" | NerdStatSplitId, SeasonNerdCounters> {
  return {
    combined: mergePerGameCaches(caches, "combined"),
    home: mergePerGameCaches(caches, "home"),
    away: mergePerGameCaches(caches, "away"),
  };
}

async function processGamesIntoCounters(
  season: number,
  games: GameNerdSourceRow[],
  skipSavant: boolean,
): Promise<SeasonNerdCounters> {
  const { combined } = await processGamesIntoAllCounters(season, games, skipSavant);
  return combined;
}

async function processGamesIntoAllCounters(
  season: number,
  games: GameNerdSourceRow[],
  skipSavant: boolean,
): Promise<Record<"combined" | NerdStatSplitId, SeasonNerdCounters>> {
  const combined = createEmptySeasonCounters();
  const home = createEmptySeasonCounters();
  const away = createEmptySeasonCounters();

  for (let i = 0; i < games.length; i += SAVANT_BATCH_SIZE) {
    const batch = games.slice(i, i + SAVANT_BATCH_SIZE);
    const batchCounters = await Promise.all(
      batch.map(async (game) => {
        const entry = await extractAndCacheGame(season, game, skipSavant);
        return {
          gameCombined: entry.combined,
          gameHome: entry.home,
          gameAway: entry.away,
        };
      }),
    );

    for (const { gameCombined, gameHome, gameAway } of batchCounters) {
      mergeSeasonCounters(combined, gameCombined);
      mergeSeasonCounters(home, gameHome);
      mergeSeasonCounters(away, gameAway);
    }

    const done = Math.min(i + SAVANT_BATCH_SIZE, games.length);
    process.stdout.write(`\rProcessed ${done}/${games.length} games…`);
  }

  process.stdout.write("\n");
  return { combined, home, away };
}

function writeSeasonAndSplitStores(
  season: number,
  countersByScope: Record<"combined" | NerdStatSplitId, SeasonNerdCounters>,
  processedGamePks: number[],
  options: WriteNerdStatsStoreOptions,
): { writtenStatIds: string[] } {
  const { writtenStatIds } = writeNerdStatsStore(
    season,
    countersByScope.combined,
    processedGamePks,
    options,
  );
  const splitOptions: WriteNerdStatsStoreOptions = {
    ...options,
    skipTeamCards: true,
  };
  writeSplitNerdStatsStore(season, "home", countersByScope.home, processedGamePks, splitOptions);
  writeSplitNerdStatsStore(season, "away", countersByScope.away, processedGamePks, splitOptions);
  return { writtenStatIds };
}

function buildHistoryStores(
  season: number,
  caches: PerGameNerdCacheEntry[],
  statIds?: string[],
): number {
  if (caches.length === 0) {
    console.log("Skipping history — no per-game caches.");
    return 0;
  }

  console.log(`Building daily history from ${caches.length} per-game cache(s)…`);
  const histories = buildNerdStatHistory(season, caches, statIds);
  const written = writeNerdStatHistories(season, histories.values());
  console.log(`  Wrote ${written} history file(s).`);
  return written;
}

async function buildRollingWindowStores(
  season: number,
  caches: PerGameNerdCacheEntry[],
  storeOptions: WriteNerdStatsStoreOptions,
): Promise<void> {
  for (const window of NERD_STAT_WINDOWS) {
    if (window.id === "season") continue;

    const gameCount = countPerGameCachesInWindow(caches, window.id);
    if (gameCount === 0) {
      console.log(`Skipping ${window.label} — no games in range.`);
      continue;
    }

    console.log(`Building ${window.label} from ${gameCount} game(s)…`);
    const counters = mergePerGameCachesForWindow(caches, window.id);
    const gamePks = caches
      .filter((entry) => gameDateInNerdWindow(entry.gameDate, window.id))
      .map((entry) => entry.gamePk);
    const { writtenStatIds } = writeWindowNerdStatsStore(season, window.id, counters, gamePks, {
      ...storeOptions,
      indexedGameCount: gameCount,
      skipTeamCards: true,
    });
    console.log(`  Wrote window summary + ${writtenStatIds.length} stat file(s).`);
  }
}

async function refreshRollingWindowStoresIncremental(
  season: number,
  newCaches: PerGameNerdCacheEntry[],
): Promise<void> {
  const manifest = loadNerdStatsManifest(season);

  for (const window of NERD_STAT_WINDOWS) {
    if (window.id === "season") continue;

    const inWindow = newCaches.filter((entry) => gameDateInNerdWindow(entry.gameDate, window.id));
    if (inWindow.length === 0) continue;

    const counters = loadWindowCounters(season, window.id);
    for (const entry of inWindow) {
      mergeSeasonCounters(counters, entry.combined);
    }

    const existing = loadNerdStatsSummary(season, window.id);
    const indexedGameCount = (existing?.indexedGameCount ?? 0) + inWindow.length;
    writeWindowNerdStatsStore(season, window.id, counters, manifest.processedGamePks, {
      indexedGameCount,
      skipTeamCards: true,
    });
    console.log(`  Updated ${window.label} (+${inWindow.length} game(s)).`);
  }
}

async function reextractCacheEntry(
  season: number,
  entry: PerGameNerdCacheEntry,
  skipSavant: boolean,
): Promise<PerGameNerdCacheEntry> {
  const sourceRow = loadGameSourceRow(season, entry.gamePk);
  if (!sourceRow) return entry;
  return extractAndCacheGame(season, sourceRow, skipSavant);
}

async function backfillCountersFromManifest(
  season: number,
  creds: BulkCreds,
  options: {
    skipSavant: boolean;
    storeOptions: WriteNerdStatsStoreOptions;
    forceRefetch: boolean;
  },
): Promise<void> {
  const manifest = loadNerdStatsManifest(season);
  if (manifest.processedGamePks.length === 0) {
    console.log("No processed games in manifest — run a full aggregate first.");
    return;
  }

  console.log(
    `Backfilling counters for ${manifest.processedGamePks.length} manifest game(s)…`,
  );
  if (options.skipSavant) {
    console.log("Skipping Baseball Savant bat-speed enrichment.");
  }

  let allCaches: PerGameNerdCacheEntry[];
  if (options.forceRefetch) {
    console.log("Force refetch — downloading all manifest games from DB.");
    const games = await fetchGamesForPks(creds, manifest.processedGamePks);
    allCaches = await extractAndCacheGames(season, games, options.skipSavant);
  } else {
    const { cached, missing } = loadPerGameNerdCaches(season, manifest.processedGamePks);
    const withSource = cached.filter((entry) => hasGameSourceRow(season, entry.gamePk));
    const withoutSource = cached.filter((entry) => !hasGameSourceRow(season, entry.gamePk));

    if (withoutSource.length > 0) {
      console.log(
        `${withoutSource.length} cache file(s) lack stored game_state — fetching from DB…`,
      );
      const games = await fetchGamesForPks(
        creds,
        [...withoutSource.map((entry) => entry.gamePk), ...missing],
      );
      const fetched = await extractAndCacheGames(season, games, options.skipSavant);
      const fetchedByPk = new Map(fetched.map((entry) => [entry.gamePk, entry]));
      const refreshed = await Promise.all(
        withSource.map((entry) => reextractCacheEntry(season, entry, options.skipSavant)),
      );
      allCaches = [
        ...refreshed,
        ...withoutSource.map((entry) => fetchedByPk.get(entry.gamePk) ?? entry),
        ...missing.map((gamePk) => fetchedByPk.get(gamePk)).filter((entry) => entry != null),
      ];
    } else if (missing.length > 0) {
      console.log(
        `${cached.length} game(s) in local cache; fetching ${missing.length} missing from DB…`,
      );
      const games = await fetchGamesForPks(creds, missing);
      const fetched = await extractAndCacheGames(season, games, options.skipSavant);
      const refreshed = await Promise.all(
        cached.map((entry) => reextractCacheEntry(season, entry, options.skipSavant)),
      );
      allCaches = [...refreshed, ...fetched];
    } else {
      console.log(`Re-extracting ${cached.length} per-game cache file(s) from stored game_state.`);
      allCaches = await Promise.all(
        cached.map((entry) => reextractCacheEntry(season, entry, options.skipSavant)),
      );
    }
  }

  const countersByScope = countersByScopeFromCaches(allCaches);
  if (options.skipSavant) {
    const previousCombined = loadSeasonCounters(season);
    const previousHome = loadSplitCounters(season, "home");
    const previousAway = loadSplitCounters(season, "away");
    preserveBatSpeedCounters(countersByScope.combined, previousCombined);
    preserveBatSpeedCounters(countersByScope.home, previousHome);
    preserveBatSpeedCounters(countersByScope.away, previousAway);
    console.log("Preserved existing Savant bat-speed counters (--skip-savant).");
  }

  const { writtenStatIds } = writeSeasonAndSplitStores(
    season,
    countersByScope,
    manifest.processedGamePks,
    options.storeOptions,
  );

  console.log(`Updated counters.json and summary.json`);
  if (writtenStatIds.length > 0) {
    console.log(`Wrote ${writtenStatIds.length} stat file(s): ${writtenStatIds.join(", ")}`);
  } else {
    console.log("No stat detail files rewritten (use --stats= or --full-store to force).");
  }
  if (options.storeOptions.skipTeamCards) {
    console.log("Skipped team cards (pass --team-cards to include).");
  }

  await buildRollingWindowStores(season, allCaches, options.storeOptions);
  buildHistoryStores(season, allCaches, options.storeOptions.statIds);
}

async function refreshWindowBatSpeedFromSavant(
  season: number,
  caches: PerGameNerdCacheEntry[],
): Promise<void> {
  for (const window of NERD_STAT_WINDOWS) {
    if (window.id === "season") continue;

    const inWindow = caches.filter((entry) => gameDateInNerdWindow(entry.gameDate, window.id));
    if (inWindow.length === 0) continue;

    const counters = loadWindowCounters(season, window.id);
    resetBatSpeedCounters(counters);

    const gamePks = inWindow.map((entry) => entry.gamePk);
    for (let i = 0; i < gamePks.length; i += SAVANT_BATCH_SIZE) {
      const batch = gamePks.slice(i, i + SAVANT_BATCH_SIZE);
      await Promise.all(batch.map((gamePk) => enrichCountersWithSavantBatSpeed(counters, gamePk)));
    }

    const existing = loadNerdStatsSummary(season, window.id);
    writeWindowNerdStatsStore(season, window.id, counters, gamePks, {
      skipTeamCards: true,
      indexedGameCount: existing?.indexedGameCount ?? gamePks.length,
    });
    console.log(`  Updated ${window.label} bat speed (${gamePks.length} games).`);
  }
}

async function backfillSavantBatSpeedFromManifest(
  season: number,
  storeOptions: WriteNerdStatsStoreOptions,
): Promise<void> {
  const manifest = loadNerdStatsManifest(season);
  if (manifest.processedGamePks.length === 0) {
    console.log("No processed games in manifest — run a full aggregate first.");
    return;
  }

  const counters = loadSeasonCounters(season);
  const homeCounters = loadSplitCounters(season, "home");
  const awayCounters = loadSplitCounters(season, "away");
  resetBatSpeedCounters(counters);
  resetBatSpeedCounters(homeCounters);
  resetBatSpeedCounters(awayCounters);

  const gamePks = manifest.processedGamePks;
  const perGameCaches: PerGameNerdCacheEntry[] = [];
  console.log(
    `Backfilling Savant bat speed for ${gamePks.length} game(s) via Savant API + local game_state only…`,
  );

  for (let i = 0; i < gamePks.length; i += SAVANT_BATCH_SIZE) {
    const batch = gamePks.slice(i, i + SAVANT_BATCH_SIZE);
    const batchCaches = await Promise.all(
      batch.map(async (gamePk) => {
        const source = loadGameSourceRow(season, gamePk);
        await enrichCountersWithSavantBatSpeed(counters, gamePk, {
          row: source ?? undefined,
          split: "all",
        });
        if (source) {
          await enrichCountersWithSavantBatSpeed(homeCounters, gamePk, {
            row: source,
            split: "home",
          });
          await enrichCountersWithSavantBatSpeed(awayCounters, gamePk, {
            row: source,
            split: "away",
          });
        }
        return refreshSavantBatSpeedForGame(season, gamePk);
      }),
    );
    perGameCaches.push(...batchCaches.filter((entry): entry is PerGameNerdCacheEntry => entry != null));
    const done = Math.min(i + SAVANT_BATCH_SIZE, gamePks.length);
    process.stdout.write(`\rFetched Savant bat speed for ${done}/${gamePks.length} games…`);
  }
  process.stdout.write("\n");

  const { writtenStatIds } = writeNerdStatsStore(season, counters, gamePks, {
    ...storeOptions,
    skipTeamCards: storeOptions.skipTeamCards ?? false,
  });
  writeSplitNerdStatsStore(season, "home", homeCounters, gamePks, {
    ...storeOptions,
    skipTeamCards: true,
  });
  writeSplitNerdStatsStore(season, "away", awayCounters, gamePks, {
    ...storeOptions,
    skipTeamCards: true,
  });
  console.log(`Updated season counters with Savant bat speed (${writtenStatIds.length} stat file(s)).`);

  if (perGameCaches.length > 0) {
    buildHistoryStores(season, perGameCaches, storeOptions.statIds ?? ["avg-bat-speed"]);
  } else {
    console.log("Skipping history — no per-game caches could be built from local game_state.");
  }

  console.log("Refreshing rolling window bat speed from Savant…");
  await refreshWindowBatSpeedFromSavant(season, perGameCaches);
}

type BulkCreds =
  | { mode: "postgres"; databaseUrl: string }
  | { mode: "rest"; supabaseUrl: string; serviceRoleKey: string };

function resolveBulkReadCredentials(): BulkCreds {
  return resolveDbCredentials(REPO_ROOT, { preferPostgres: false });
}

async function resolveBulkReadCredentialsAsync(): Promise<BulkCreds> {
  const requirePostgres = hasFlag("require-postgres");
  const databaseUrl = process.env.DATABASE_URL;

  if (databaseUrl) {
    try {
      await testPostgresConnection(databaseUrl, WEB_PKG);
      return { mode: "postgres", databaseUrl };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (requirePostgres) {
        throw new Error(`Postgres unreachable (--require-postgres): ${message}`);
      }
      console.warn(`Postgres unreachable (${message}); falling back to Supabase REST.`);
    }
  } else if (requirePostgres) {
    throw new Error("--require-postgres set but DATABASE_URL is missing in ingestor/.env.");
  }

  const creds = resolveBulkReadCredentials();
  if (creds.mode !== "rest" && requirePostgres) {
    throw new Error("--require-postgres requires a working Postgres connection.");
  }
  return creds;
}

function warnEgressIfRest(creds: BulkCreds): void {
  if (creds.mode !== "rest") return;
  console.warn(
    "Using Supabase REST for bulk game_state reads counts against egress limits.\n" +
      "Add DATABASE_URL to ingestor/.env (Session pooler URI) to read via Postgres instead.",
  );
}

function buildDateConditions(
  dateRange: { since?: string; until?: string },
  params: Array<string | number>,
): string[] {
  const conditions: string[] = [];
  if (dateRange.since) {
    params.push(dateRange.since);
    conditions.push(`game_date >= $${params.length}`);
  }
  if (dateRange.until) {
    params.push(dateRange.until);
    conditions.push(`game_date <= $${params.length}`);
  }
  return conditions;
}

async function listFinalGamePksViaPostgres(
  season: number,
  databaseUrl: string,
  dateRange: { since?: string; until?: string },
): Promise<number[]> {
  const Pool = require("pg").Pool;
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const params: Array<string | number> = [season];
    const conditions = ["season = $1", "status = 'Final'", ...buildDateConditions(dateRange, params)];

    const { rows } = await pool.query(
      `SELECT game_pk FROM games WHERE ${conditions.join(" AND ")} ORDER BY game_pk`,
      params,
    );
    return rows.map((row: { game_pk: number }) => row.game_pk);
  } finally {
    await pool.end();
  }
}

async function fetchGamesByPksViaPostgres(
  databaseUrl: string,
  gamePks: number[],
): Promise<GameNerdSourceRow[]> {
  if (gamePks.length === 0) return [];

  const Pool = require("pg").Pool;
  const pool = new Pool({ connectionString: databaseUrl });
  const rows: GameNerdSourceRow[] = [];

  try {
    for (let i = 0; i < gamePks.length; i += FULL_ROW_BATCH_SIZE) {
      const batch = gamePks.slice(i, i + FULL_ROW_BATCH_SIZE);
      const placeholders = batch.map((_, index) => `$${index + 1}`).join(", ");
      const { rows: batchRows } = await pool.query(
        `${FULL_ROW_SELECT_SQL} WHERE game_pk IN (${placeholders}) ORDER BY game_pk`,
        batch,
      );
      rows.push(...(batchRows as GameNerdSourceRow[]));
      process.stdout.write(`\rLoaded ${rows.length}/${gamePks.length} games…`);
    }
  } finally {
    await pool.end();
  }

  process.stdout.write("\n");
  return rows;
}

async function listFinalGamePksViaSupabase(
  season: number,
  dateRange: { since?: string; until?: string },
): Promise<number[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Missing Supabase credentials in web/.env.local");

  const supabase = createClient(url, key);
  const gamePks: number[] = [];
  let offset = 0;

  while (true) {
    let query = supabase
      .from("games")
      .select("game_pk")
      .eq("season", season)
      .eq("status", "Final")
      .order("game_pk", { ascending: true });

    if (dateRange.since) query = query.gte("game_date", dateRange.since);
    if (dateRange.until) query = query.lte("game_date", dateRange.until);

    const { data, error } = await query.range(offset, offset + PK_PAGE_SIZE - 1);
    if (error) throw new Error(error.message);

    const page = (data ?? []) as Array<{ game_pk: number }>;
    gamePks.push(...page.map((row) => row.game_pk));
    if (page.length < PK_PAGE_SIZE) break;
    offset += PK_PAGE_SIZE;
    process.stdout.write(`\rIndexed ${gamePks.length} final game PKs…`);
  }

  process.stdout.write("\n");
  return gamePks;
}

async function fetchGamesByPksViaSupabase(gamePks: number[]): Promise<GameNerdSourceRow[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Missing Supabase credentials in web/.env.local");

  const supabase = createClient(url, key);
  const rows: GameNerdSourceRow[] = [];

  for (let i = 0; i < gamePks.length; i += FULL_ROW_BATCH_SIZE) {
    const batch = gamePks.slice(i, i + FULL_ROW_BATCH_SIZE);
    const { data, error } = await supabase
      .from("games")
      .select(GAME_COLUMNS)
      .in("game_pk", batch)
      .order("game_pk", { ascending: true });

    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as GameNerdSourceRow[]));
    process.stdout.write(`\rLoaded ${rows.length}/${gamePks.length} games…`);
  }

  process.stdout.write("\n");
  return rows;
}

async function fetchGamesForPks(
  creds: BulkCreds,
  gamePks: number[],
): Promise<GameNerdSourceRow[]> {
  if (gamePks.length === 0) return [];
  return creds.mode === "postgres"
    ? fetchGamesByPksViaPostgres(creds.databaseUrl, gamePks)
    : fetchGamesByPksViaSupabase(gamePks);
}

async function listFinalGamePks(
  season: number,
  creds: BulkCreds,
  dateRange: { since?: string; until?: string },
): Promise<number[]> {
  return creds.mode === "postgres"
    ? listFinalGamePksViaPostgres(season, creds.databaseUrl, dateRange)
    : listFinalGamePksViaSupabase(season, dateRange);
}

async function main() {
  const season = Number.parseInt(readArg("season") ?? String(new Date().getFullYear()), 10);
  const dateRange = readDateRange();
  const incremental = Boolean(dateRange.since || dateRange.until);
  const rebuildStore = hasFlag("rebuild-store");
  const rebuildWindows = hasFlag("rebuild-windows");
  const backfillSavant = hasFlag("backfill-savant");
  const backfillCounters = hasFlag("backfill-counters");
  const skipSavant = hasFlag("skip-savant");
  const fullStore = hasFlag("full-store");
  const teamCards = hasFlag("team-cards");
  const explicitStatIds = readCsvArg("stats");
  const storeOptions = resolveStoreOptions(season, explicitStatIds, {
    fullStore,
    teamCards,
  });

  if (backfillCounters) {
    const creds = await resolveBulkReadCredentialsAsync();
    warnEgressIfRest(creds);
    await backfillCountersFromManifest(season, creds, {
      skipSavant,
      storeOptions,
      forceRefetch: hasFlag("force-refetch"),
    });
    return;
  }

  if (backfillSavant) {
    await backfillSavantBatSpeedFromManifest(season, storeOptions);
    return;
  }

  if (rebuildWindows) {
    const { rebuiltWindows } = rebuildWindowStoresFromCounters(season, storeOptions);
    const { rebuiltSplits } = rebuildSplitStoresFromCounters(season, storeOptions);
    if (rebuiltWindows.length === 0 && rebuiltSplits.length === 0) {
      console.log("No rolling window or split data to rebuild — run a full aggregate first.");
    } else {
      if (rebuiltWindows.length > 0) {
        console.log(`Rebuilt nerd stats for windows: ${rebuiltWindows.join(", ")}`);
      }
      if (rebuiltSplits.length > 0) {
        console.log(`Rebuilt nerd stats for splits: ${rebuiltSplits.join(", ")}`);
      }
    }
    return;
  }

  if (hasFlag("rebuild-history")) {
    const manifest = loadNerdStatsManifest(season);
    if (manifest.processedGamePks.length === 0) {
      console.log("No processed games in manifest — run a full aggregate first.");
      return;
    }
    const { cached, missing } = loadPerGameNerdCaches(season, manifest.processedGamePks);
    if (missing.length > 0) {
      console.warn(
        `Missing ${missing.length} per-game cache file(s) — history will omit those games.`,
      );
    }
    buildHistoryStores(season, cached, explicitStatIds ?? undefined);
    return;
  }

  if (rebuildStore) {
    const manifest = loadNerdStatsManifest(season);
    const counters = loadSeasonCounters(season);
    const homeCounters = loadSplitCounters(season, "home");
    const awayCounters = loadSplitCounters(season, "away");
    if (manifest.processedGamePks.length === 0) {
      console.log("No processed games in manifest — run a full aggregate first.");
      return;
    }

    const { writtenStatIds } = writeSeasonAndSplitStores(
      season,
      { combined: counters, home: homeCounters, away: awayCounters },
      manifest.processedGamePks,
      storeOptions,
    );
    console.log(
      `Rebuilt nerd stats store from counters for ${manifest.processedGamePks.length} games.`,
    );
    if (writtenStatIds.length > 0) {
      console.log(`Wrote ${writtenStatIds.length} stat file(s).`);
    }
    if (storeOptions.skipTeamCards) {
      console.log("Skipped team cards (pass --team-cards to include).");
    }
    return;
  }

  const creds = await resolveBulkReadCredentialsAsync();
  warnEgressIfRest(creds);

  if (incremental) {
    console.log(
      `Incremental nerd stats since ${dateRange.since ?? "…"}${dateRange.until ? ` until ${dateRange.until}` : ""}`,
    );
  } else {
    console.log(`Full nerd stats rebuild for season ${season}`);
  }

  const gamePks = await listFinalGamePks(season, creds, dateRange);
  console.log(`Found ${gamePks.length} final game(s) in range`);

  if (incremental) {
    const processed = new Set(loadNerdStatsManifest(season).processedGamePks);
    const pendingPks = gamePks.filter((gamePk) => !processed.has(gamePk));

    if (pendingPks.length === 0) {
      console.log("No new games to process.");
    } else {
      console.log(`Fetching ${pendingPks.length} new game(s)…`);
      const pending = await fetchGamesForPks(creds, pendingPks);

      console.log(`Processing ${pending.length} new game(s)…`);
      const newCaches: PerGameNerdCacheEntry[] = [];
      for (let i = 0; i < pending.length; i += 1) {
        const game = pending[i]!;
        await appendGameNerdStatsToStore(season, game);
        const cached = loadPerGameNerdCache(season, game.game_pk);
        if (cached) newCaches.push(cached);
        if ((i + 1) % 10 === 0 || i + 1 === pending.length) {
          process.stdout.write(`\rProcessed ${i + 1}/${pending.length} games…`);
        }
      }

      process.stdout.write("\n");
      console.log(`Updated nerd stats with ${pending.length} game(s) in data/nerd-stats/${season}/`);

      if (newCaches.length > 0) {
        console.log("Refreshing rolling window stores…");
        await refreshRollingWindowStoresIncremental(season, newCaches);
        const manifest = loadNerdStatsManifest(season);
        const allCaches = loadPerGameNerdCaches(season, manifest.processedGamePks).cached;
        buildHistoryStores(season, allCaches, explicitStatIds ?? undefined);
      }
    }

    return;
  }

  console.log(`Fetching full game payloads in batches of ${FULL_ROW_BATCH_SIZE}…`);
  const games = await fetchGamesForPks(creds, gamePks);
  const countersByScope = await processGamesIntoAllCounters(season, games, skipSavant);
  const processed = games.map((game) => game.game_pk);

  const fullRebuildStoreOptions = resolveStoreOptions(season, explicitStatIds, {
    fullStore: true,
    teamCards: true,
  });
  writeSeasonAndSplitStores(season, countersByScope, processed, fullRebuildStoreOptions);
  console.log(`Wrote nerd stats for ${processed.length} games to data/nerd-stats/${season}/`);
  const allCaches = loadPerGameNerdCaches(season, processed).cached;
  await buildRollingWindowStores(season, allCaches, fullRebuildStoreOptions);
  buildHistoryStores(season, allCaches, explicitStatIds ?? undefined);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
