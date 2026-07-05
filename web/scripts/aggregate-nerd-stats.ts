/**
 * Aggregate nerd stats from archived games into web/data/nerd-stats/.
 *
 * Usage:
 *   npm run aggregate-nerd-stats -- --season=2026
 *   npm run aggregate-nerd-stats -- --season=2026 --since=2026-06-30
 *   npm run aggregate-nerd-stats -- --season=2026 --rebuild-store
 *
 * After adding new stat definitions (fast path — manifest games only):
 *   npm run aggregate-nerd-stats -- --season=2026 --backfill-counters --skip-savant
 *
 * Rewrite specific stat JSON files from existing counters (no DB fetch):
 *   npm run aggregate-nerd-stats -- --season=2026 --rebuild-store --stats=errors-committed,fielding-errors
 *
 * Flags:
 *   --backfill-counters   Re-extract counters for games already in manifest.json
 *   --skip-savant         Skip Baseball Savant bat-speed fetches (fine for PBP-only stats)
 *   --stats=id1,id2       Only write these stat detail files (default with backfill: new stats only)
 *   --full-store          Write every stat file + team cards (default backfill skips existing stat files)
 *   --team-cards          Also rewrite team nerd card JSON files
 *   --rebuild-windows     Re-emit rolling window stat files from existing window counters
 *   --backfill-savant     Re-fetch Baseball Savant bat speed for manifest games + windows
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

import { createEmptySeasonCounters, mergeSeasonCounters } from "../lib/mlb/nerdStats/counters";
import { enrichCountersWithSavantBatSpeed } from "../lib/mlb/nerdStats/savantBatSpeed";
import { extractNerdCountersFromGame } from "../lib/mlb/nerdStats/extractGame";
import type { GameNerdSourceRow, SeasonNerdCounters } from "../lib/mlb/nerdStats/types";
import {
  appendGameNerdStatsToStore,
  listMissingStatIds,
  loadNerdStatsManifest,
  loadNerdStatsSummary,
  loadSeasonCounters,
  loadWindowCounters,
  rebuildWindowStoresFromCounters,
  type WriteNerdStatsStoreOptions,
  writeNerdStatsStore,
  writeWindowNerdStatsStore,
} from "../lib/mlb/nerdStats/store";
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
const { resolveDbCredentials } = require(join(REPO_ROOT, "scripts/lib/db.mjs")) as typeof import("../../scripts/lib/db.mjs");

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

async function processGamesIntoCounters(
  games: GameNerdSourceRow[],
  skipSavant: boolean,
): Promise<SeasonNerdCounters> {
  const counters = createEmptySeasonCounters();

  for (let i = 0; i < games.length; i += SAVANT_BATCH_SIZE) {
    const batch = games.slice(i, i + SAVANT_BATCH_SIZE);
    const batchCounters = await Promise.all(
      batch.map(async (game) => {
        const gameCounters = extractNerdCountersFromGame(game);
        if (!skipSavant) {
          await enrichCountersWithSavantBatSpeed(gameCounters, game.game_pk);
        }
        return gameCounters;
      }),
    );

    for (const gameCounters of batchCounters) {
      mergeSeasonCounters(counters, gameCounters);
    }

    const done = Math.min(i + SAVANT_BATCH_SIZE, games.length);
    process.stdout.write(`\rProcessed ${done}/${games.length} games…`);
  }

  process.stdout.write("\n");
  return counters;
}

async function buildRollingWindowStores(
  season: number,
  games: GameNerdSourceRow[],
  skipSavant: boolean,
  storeOptions: WriteNerdStatsStoreOptions,
): Promise<void> {
  for (const window of NERD_STAT_WINDOWS) {
    if (window.id === "season") continue;

    const filtered = games.filter((game) => gameDateInNerdWindow(game.game_date, window.id));
    if (filtered.length === 0) {
      console.log(`Skipping ${window.label} — no games in range.`);
      continue;
    }

    console.log(`Building ${window.label} from ${filtered.length} game(s)…`);
    const counters = await processGamesIntoCounters(filtered, skipSavant);
    const { writtenStatIds } = writeWindowNerdStatsStore(
      season,
      window.id,
      counters,
      filtered.map((game) => game.game_pk),
      { ...storeOptions, skipTeamCards: true },
    );
    console.log(`  Wrote window summary + ${writtenStatIds.length} stat file(s).`);
  }
}

async function backfillCountersFromManifest(
  season: number,
  creds: BulkCreds,
  options: {
    skipSavant: boolean;
    storeOptions: WriteNerdStatsStoreOptions;
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

  const games = await fetchGamesForPks(creds, manifest.processedGamePks);
  const counters = await processGamesIntoCounters(games, options.skipSavant);
  const { writtenStatIds } = writeNerdStatsStore(
    season,
    counters,
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

  await buildRollingWindowStores(season, games, options.skipSavant, options.storeOptions);
}

async function refreshWindowBatSpeedFromSavant(
  season: number,
  games: GameNerdSourceRow[],
  storeOptions: WriteNerdStatsStoreOptions,
): Promise<void> {
  for (const window of NERD_STAT_WINDOWS) {
    if (window.id === "season") continue;

    const filtered = games.filter((game) => gameDateInNerdWindow(game.game_date, window.id));
    if (filtered.length === 0) continue;

    const counters = loadWindowCounters(season, window.id);
    resetBatSpeedCounters(counters);

    const gamePks = filtered.map((game) => game.game_pk);
    for (let i = 0; i < gamePks.length; i += SAVANT_BATCH_SIZE) {
      const batch = gamePks.slice(i, i + SAVANT_BATCH_SIZE);
      await Promise.all(batch.map((gamePk) => enrichCountersWithSavantBatSpeed(counters, gamePk)));
    }

    const existing = loadNerdStatsSummary(season, window.id);
    writeWindowNerdStatsStore(season, window.id, counters, gamePks, {
      ...storeOptions,
      skipTeamCards: true,
      indexedGameCount: existing?.indexedGameCount ?? gamePks.length,
    });
    console.log(`  Updated ${window.label} bat speed (${gamePks.length} games).`);
  }
}

function resetBatSpeedCounters(counters: SeasonNerdCounters): void {
  for (const team of Object.values(counters)) {
    if (!team || typeof team !== "object") continue;
    team.batSpeedSum = 0;
    team.batSpeedCount = 0;
  }
}

async function backfillSavantBatSpeedFromManifest(
  season: number,
  creds: BulkCreds,
  storeOptions: WriteNerdStatsStoreOptions,
): Promise<void> {
  const manifest = loadNerdStatsManifest(season);
  if (manifest.processedGamePks.length === 0) {
    console.log("No processed games in manifest — run a full aggregate first.");
    return;
  }

  const counters = loadSeasonCounters(season);
  resetBatSpeedCounters(counters);

  const gamePks = manifest.processedGamePks;
  console.log(`Backfilling Savant bat speed for ${gamePks.length} game(s)…`);

  for (let i = 0; i < gamePks.length; i += SAVANT_BATCH_SIZE) {
    const batch = gamePks.slice(i, i + SAVANT_BATCH_SIZE);
    await Promise.all(batch.map((gamePk) => enrichCountersWithSavantBatSpeed(counters, gamePk)));
    const done = Math.min(i + SAVANT_BATCH_SIZE, gamePks.length);
    process.stdout.write(`\rFetched Savant bat speed for ${done}/${gamePks.length} games…`);
  }
  process.stdout.write("\n");

  const { writtenStatIds } = writeNerdStatsStore(season, counters, gamePks, {
    ...storeOptions,
    skipTeamCards: storeOptions.skipTeamCards ?? false,
  });
  console.log(`Updated season counters with Savant bat speed (${writtenStatIds.length} stat file(s)).`);

  console.log("Refreshing rolling window bat speed from Savant…");
  const games = await fetchGamesForPks(creds, gamePks);
  await refreshWindowBatSpeedFromSavant(season, games, storeOptions);
}

type BulkCreds =
  | { mode: "postgres"; databaseUrl: string }
  | { mode: "rest"; supabaseUrl: string; serviceRoleKey: string };

function resolveBulkReadCredentials(): BulkCreds {
  return resolveDbCredentials(REPO_ROOT);
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
    const creds = resolveBulkReadCredentials();
    await backfillCountersFromManifest(season, creds, {
      skipSavant,
      storeOptions,
    });
    return;
  }

  if (backfillSavant) {
    const creds = resolveBulkReadCredentials();
    await backfillSavantBatSpeedFromManifest(season, creds, storeOptions);
    return;
  }

  if (rebuildWindows) {
    const { rebuiltWindows } = rebuildWindowStoresFromCounters(season, storeOptions);
    if (rebuiltWindows.length === 0) {
      console.log("No rolling window data to rebuild — run a full aggregate first.");
    } else {
      console.log(`Rebuilt nerd stats for windows: ${rebuiltWindows.join(", ")}`);
    }
    return;
  }

  if (rebuildStore) {
    const manifest = loadNerdStatsManifest(season);
    const counters = loadSeasonCounters(season);
    if (manifest.processedGamePks.length === 0) {
      console.log("No processed games in manifest — run a full aggregate first.");
      return;
    }

    const { writtenStatIds } = writeNerdStatsStore(
      season,
      counters,
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

  const creds = resolveBulkReadCredentials();

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
      for (let i = 0; i < pending.length; i += 1) {
        await appendGameNerdStatsToStore(season, pending[i]!);
        if ((i + 1) % 10 === 0 || i + 1 === pending.length) {
          process.stdout.write(`\rProcessed ${i + 1}/${pending.length} games…`);
        }
      }

      process.stdout.write("\n");
      console.log(`Updated nerd stats with ${pending.length} game(s) in data/nerd-stats/${season}/`);
    }

    const manifest = loadNerdStatsManifest(season);
    if (manifest.processedGamePks.length > 0) {
      console.log("Refreshing rolling window stores…");
      const allGames = await fetchGamesForPks(creds, manifest.processedGamePks);
      await buildRollingWindowStores(season, allGames, skipSavant, storeOptions);
    }
    return;
  }

  console.log(`Fetching full game payloads in batches of ${FULL_ROW_BATCH_SIZE}…`);
  const games = await fetchGamesForPks(creds, gamePks);
  const counters = await processGamesIntoCounters(games, skipSavant);
  const processed = games.map((game) => game.game_pk);

  const fullRebuildStoreOptions = resolveStoreOptions(season, explicitStatIds, {
    fullStore: true,
    teamCards: true,
  });
  writeNerdStatsStore(season, counters, processed, fullRebuildStoreOptions);
  console.log(`Wrote nerd stats for ${processed.length} games to data/nerd-stats/${season}/`);
  await buildRollingWindowStores(season, games, skipSavant, fullRebuildStoreOptions);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
