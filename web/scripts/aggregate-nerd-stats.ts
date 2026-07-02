/**
 * Aggregate nerd stats from archived games into web/data/nerd-stats/.
 *
 * Usage: npm run aggregate-nerd-stats -- --season=2026 [--since=2026-06-30]
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

import { createEmptySeasonCounters, mergeSeasonCounters } from "../lib/mlb/nerdStats/counters";
import { extractNerdCountersFromGame } from "../lib/mlb/nerdStats/extractGame";
import type { GameNerdSourceRow } from "../lib/mlb/nerdStats/types";
import {
  appendGameNerdStatsToStore,
  loadNerdStatsManifest,
  writeFullNerdStatsStore,
} from "../lib/mlb/nerdStats/store";

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

const PAGE_SIZE = 20;
const GAME_COLUMNS =
  "game_pk,game_date,season,away_team_id,home_team_id,away_team_abbrev,home_team_abbrev,away_score,home_score,game_state,box_score,feed_synced_at" as const;

function readArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function readDateRange(): { since?: string; until?: string } {
  return { since: readArg("since"), until: readArg("until") };
}

async function fetchGamesViaSupabase(
  season: number,
  dateRange: { since?: string; until?: string },
): Promise<GameNerdSourceRow[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Missing Supabase credentials in web/.env.local");

  const supabase = createClient(url, key);
  const rows: GameNerdSourceRow[] = [];
  let offset = 0;

  while (true) {
    let query = supabase
      .from("games")
      .select(GAME_COLUMNS)
      .eq("season", season)
      .eq("status", "Final")
      .order("game_pk", { ascending: true });

    if (dateRange.since) {
      query = query.gte("game_date", dateRange.since);
    }
    if (dateRange.until) {
      query = query.lte("game_date", dateRange.until);
    }

    const { data, error } = await query.range(offset, offset + PAGE_SIZE - 1);

    if (error) throw new Error(error.message);

    const page = (data ?? []) as GameNerdSourceRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
    process.stdout.write(`\rFetched ${rows.length} final games…`);
  }

  process.stdout.write("\n");
  return rows;
}

async function fetchGamesViaPostgres(
  season: number,
  databaseUrl: string,
  dateRange: { since?: string; until?: string },
): Promise<GameNerdSourceRow[]> {
  const Pool = require("pg").Pool;
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const params: Array<string | number> = [season];
    const conditions = ["season = $1", "status = 'Final'"];

    if (dateRange.since) {
      params.push(dateRange.since);
      conditions.push(`game_date >= $${params.length}`);
    }
    if (dateRange.until) {
      params.push(dateRange.until);
      conditions.push(`game_date <= $${params.length}`);
    }

    const { rows } = await pool.query(
      `SELECT game_pk, game_date, season, away_team_id, home_team_id,
              away_team_abbrev, home_team_abbrev, away_score, home_score,
              game_state, box_score, feed_synced_at
       FROM games WHERE ${conditions.join(" AND ")} ORDER BY game_pk`,
      params,
    );
    return rows as GameNerdSourceRow[];
  } finally {
    await pool.end();
  }
}

async function main() {
  const season = Number.parseInt(readArg("season") ?? String(new Date().getFullYear()), 10);
  const dateRange = readDateRange();
  const incremental = Boolean(dateRange.since || dateRange.until);
  const creds = resolveDbCredentials(REPO_ROOT);

  if (incremental) {
    console.log(`Incremental nerd stats since ${dateRange.since ?? "…"}${dateRange.until ? ` until ${dateRange.until}` : ""}`);
  }

  const games =
    creds.mode === "postgres"
      ? await fetchGamesViaPostgres(season, creds.databaseUrl, dateRange)
      : await fetchGamesViaSupabase(season, dateRange);

  if (incremental) {
    const processed = new Set(loadNerdStatsManifest(season).processedGamePks);
    const pending = games.filter((game) => !processed.has(game.game_pk));

    if (pending.length === 0) {
      console.log("No new games to process.");
      return;
    }

    console.log(`Processing ${pending.length} new game(s)…`);
    for (let i = 0; i < pending.length; i += 1) {
      appendGameNerdStatsToStore(season, pending[i]!);
      if ((i + 1) % 10 === 0 || i + 1 === pending.length) {
        process.stdout.write(`\rProcessed ${i + 1}/${pending.length} games…`);
      }
    }

    process.stdout.write("\n");
    console.log(`Updated nerd stats with ${pending.length} game(s) in data/nerd-stats/${season}/`);
    return;
  }

  const counters = createEmptySeasonCounters();
  const processed: number[] = [];

  for (let i = 0; i < games.length; i += 1) {
    const game = games[i]!;
    mergeSeasonCounters(counters, extractNerdCountersFromGame(game));
    processed.push(game.game_pk);
    if ((i + 1) % 50 === 0) {
      process.stdout.write(`\rProcessed ${i + 1}/${games.length} games…`);
    }
  }

  process.stdout.write("\n");
  writeFullNerdStatsStore(season, counters, processed);
  console.log(`Wrote nerd stats for ${processed.length} games to data/nerd-stats/${season}/`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
