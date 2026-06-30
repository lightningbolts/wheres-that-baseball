/**
 * Aggregate ballpark hits from archived games.game_state into web/data/ballpark-hits/.
 * Does not write to Supabase — keeps the database small on the free tier.
 *
 * Usage: npm run aggregate-ballpark-hits -- --season=2026
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

import {
  extractVenueHitsFromStoredGame,
  type GameHitsSourceRow,
} from "../lib/mlb/ballparkHitsAggregate";
import { writeFullBallparkHitsStore } from "../lib/mlb/ballparkHitsStore";

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
  "game_pk,game_date,season,venue_id,away_team_abbrev,home_team_abbrev,game_state" as const;

function readArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

async function fetchGamesViaSupabase(season: number): Promise<GameHitsSourceRow[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error("Missing Supabase credentials in web/.env.local");
  }

  const supabase = createClient(url, key);
  const rows: GameHitsSourceRow[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from("games")
      .select(GAME_COLUMNS)
      .eq("season", season)
      .not("feed_synced_at", "is", null)
      .not("venue_id", "is", null)
      .order("game_pk", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      throw new Error(error.message);
    }

    const page = (data ?? []) as GameHitsSourceRow[];
    rows.push(...page);

    if (page.length < PAGE_SIZE) {
      break;
    }

    offset += PAGE_SIZE;
    process.stdout.write(`\rFetched ${rows.length} archived games…`);
  }

  process.stdout.write("\n");
  return rows;
}

async function fetchGamesViaPostgres(season: number, databaseUrl: string): Promise<GameHitsSourceRow[]> {
  const Pool = require("pg").Pool;
  const pool = new Pool({ connectionString: databaseUrl });

  try {
    const { rows } = await pool.query(
      `SELECT game_pk, game_date, season, venue_id, away_team_abbrev, home_team_abbrev, game_state
       FROM games
       WHERE season = $1 AND feed_synced_at IS NOT NULL AND venue_id IS NOT NULL
       ORDER BY game_pk`,
      [season],
    );
    return rows as GameHitsSourceRow[];
  } finally {
    await pool.end();
  }
}

async function main() {
  const season = Number.parseInt(readArg("season") ?? String(new Date().getFullYear()), 10);

  const creds = resolveDbCredentials(REPO_ROOT);
  const games =
    creds.mode === "postgres"
      ? await fetchGamesViaPostgres(season, creds.databaseUrl)
      : await fetchGamesViaSupabase(season);

  const gameRows: Array<{
    gamePk: number;
    venueId: number | null;
    hits: ReturnType<typeof extractVenueHitsFromStoredGame>;
  }> = [];

  let hitCount = 0;
  for (const game of games) {
    const hits = extractVenueHitsFromStoredGame(game);
    hitCount += hits.length;
    gameRows.push({ gamePk: game.game_pk, venueId: game.venue_id, hits });

    if (gameRows.length % 25 === 0) {
      process.stdout.write(`\rProcessed ${gameRows.length}/${games.length} games, ${hitCount} hits…`);
    }
  }

  process.stdout.write(`\n`);

  writeFullBallparkHitsStore(season, gameRows);

  const venuesWithHits = new Set(
    gameRows.filter((row) => row.hits.length > 0).map((row) => row.venueId),
  ).size;

  console.log(
    `Wrote ballpark hits for ${gameRows.length} games (${hitCount} hits, ${venuesWithHits} venues) to data/ballpark-hits/${season}/`,
  );
  console.log("Run the drop migration in Supabase SQL editor to reclaim game_hits table space.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
