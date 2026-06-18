#!/usr/bin/env node
/**
 * Fetches all regular-season MLB games from season start through today and
 * upserts them into Supabase `games` table.
 *
 * Prerequisites:
 *   1. Apply ingestor/internal/database/schema.sql in Supabase (games table + RLS).
 *   2. Set SUPABASE_SERVICE_ROLE_KEY (Dashboard → Project Settings → API).
 *
 * Usage:
 *   node scripts/fetch-season-games.mjs
 *   node scripts/fetch-season-games.mjs --with-feeds
 *   npm run fetch-season-games   (from web/)
 *
 * Env (loaded from web/.env.local and ingestor/.env):
 *   NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, or
 *   DATABASE_URL (from ingestor/.env)
 */

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

import { resolveDbCredentials, upsertGames } from "./lib/db.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const MLB_SCHEDULE_BASE = "https://statsapi.mlb.com/api/v1/schedule";
const UPSERT_BATCH_SIZE = 200;

/** @param {string} path */
async function loadEnvFile(path) {
  try {
    const text = await readFile(path, "utf8");
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
  } catch {
    // optional file
  }
}

function getMLBScheduleDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
  }).format(date);
}

function getSeasonStartDate(endDate) {
  const year = endDate.slice(0, 4);
  return `${year}-03-01`;
}

/** @param {string} startDate @param {string} endDate */
async function fetchScheduleRange(startDate, endDate) {
  const url = new URL(MLB_SCHEDULE_BASE);
  url.searchParams.set("sportId", "1");
  url.searchParams.set("gameTypes", "R");
  url.searchParams.set("startDate", startDate);
  url.searchParams.set("endDate", endDate);
  url.searchParams.set("hydrate", "team,linescore,venue");

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`MLB schedule failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data.dates?.flatMap((d) => d.games ?? []) ?? [];
}

/** @param {object} game */
function mapGameRow(game) {
  const gameDate = game.officialDate ?? game.gameDate?.slice(0, 10);

  return {
    game_pk: game.gamePk,
    game_date: gameDate,
    season: Number.parseInt(game.season, 10),
    game_type: game.gameType ?? "R",
    status: game.status?.abstractGameState ?? "Unknown",
    status_detail: game.status?.detailedState ?? null,
    away_team_id: game.teams.away.team.id,
    away_team_name: game.teams.away.team.name,
    away_team_abbrev: game.teams.away.team.abbreviation,
    home_team_id: game.teams.home.team.id,
    home_team_name: game.teams.home.team.name,
    home_team_abbrev: game.teams.home.team.abbreviation,
    away_score: game.teams.away.score ?? null,
    home_score: game.teams.home.score ?? null,
    venue_id: game.venue?.id ?? null,
    venue_name: game.venue?.name ?? null,
    official_date: game.officialDate ?? gameDate,
    updated_at: new Date().toISOString(),
  };
}

/** @param {object[]} rows */
function dedupeByGamePk(rows) {
  const byPk = new Map();
  for (const row of rows) {
    byPk.set(row.game_pk, row);
  }
  return [...byPk.values()];
}

/** @param {string} supabaseUrl @param {string} serviceRoleKey @param {object[]} rows */
async function main() {
  const withFeeds = process.argv.includes("--with-feeds");

  await loadEnvFile(join(ROOT, "web", ".env.local"));
  await loadEnvFile(join(ROOT, "ingestor", ".env"));

  let creds;
  try {
    creds = resolveDbCredentials(ROOT);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }

  console.log(`Using ${creds.mode === "postgres" ? "DATABASE_URL (Postgres)" : "Supabase REST"} for writes.`);

  const endDate = getMLBScheduleDate();
  const startDate = getSeasonStartDate(endDate);

  console.log(`Fetching MLB regular-season games ${startDate} → ${endDate}…`);
  const apiGames = await fetchScheduleRange(startDate, endDate);
  console.log(`  ${apiGames.length} games from MLB API`);

  if (apiGames.length === 0) {
    console.log("Nothing to sync.");
    return;
  }

  const rows = dedupeByGamePk(apiGames.map(mapGameRow));

  console.log("Upserting into Supabase games table…");
  await upsertGames(creds, ROOT, rows, UPSERT_BATCH_SIZE);

  const finalCount = rows.filter((r) => r.status === "Final").length;
  const liveCount = rows.filter((r) => r.status === "Live" || r.status === "In Progress").length;
  console.log(
    `\nDone. ${rows.length} games synced (${finalCount} final, ${liveCount} live/in progress).`,
  );

  if (withFeeds) {
    console.log(`\nSyncing play-by-play and box scores for ${startDate} → ${endDate}…`);
    await new Promise((resolve, reject) => {
      const child = spawn(
        "npm",
        ["run", "sync-game-feeds", "--", `--since=${startDate}`, `--until=${endDate}`, "--force"],
        { cwd: join(ROOT, "web"), stdio: "inherit", shell: true },
      );
      child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`sync-game-feeds exited ${code}`))));
    });
    return;
  }

  console.log(
    "\nNext: npm run sync-game-feeds  (from web/) to store play-by-play and box scores in Supabase.",
  );
  console.log("     Or re-run with --with-feeds to sync feeds automatically.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
