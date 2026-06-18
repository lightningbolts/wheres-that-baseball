/**
 * Fetches full play-by-play feeds and box scores for games in Supabase.
 *
 * Auth (from web/.env.local + ingestor/.env):
 *   - SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL, or
 *   - DATABASE_URL (same as ingestor)
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import { createClient } from "@supabase/supabase-js";

import { fetchGameFeed } from "../lib/mlb/liveFeed";
import type { GameBoxScore } from "../types/mlb-boxscore";
import type { LiveGameState } from "../types/mlb-live";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WEB_PKG = join(ROOT, "web/package.json");
const CONCURRENCY = 4;

const require = createRequire(WEB_PKG);
const {
  resolveDbCredentials,
  listGamesForFeedSync,
  updateGameFeedViaPostgres,
} = require("../scripts/lib/db.mjs") as typeof import("../../scripts/lib/db.mjs");

interface GameTarget {
  game_pk: number;
  status: string;
  feed_synced_at: string | null;
}

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

interface SyncArgs {
  force: boolean;
  gamePk: number | null;
  since: string | null;
  until: string | null;
}

function parseArgs(): SyncArgs {
  const force = process.argv.includes("--force");
  const gamePkArg = process.argv.find((arg) => arg.startsWith("--game-pk="));
  const sinceArg = process.argv.find((arg) => arg.startsWith("--since="));
  const untilArg = process.argv.find((arg) => arg.startsWith("--until="));
  const gamePk = gamePkArg ? Number.parseInt(gamePkArg.split("=")[1] ?? "", 10) : null;
  return {
    force,
    gamePk: Number.isFinite(gamePk) ? gamePk : null,
    since: sinceArg?.split("=")[1] ?? null,
    until: untilArg?.split("=")[1] ?? null,
  };
}

async function mapPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      await worker(items[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker()),
  );
}

async function listGamesRest(
  supabaseUrl: string,
  serviceRoleKey: string,
  onlyGamePk: number | null,
  force: boolean,
  dateRange: { since?: string; until?: string },
): Promise<GameTarget[]> {
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const pageSize = 1000;
  const games: GameTarget[] = [];
  let from = 0;

  while (true) {
    let query = supabase
      .from("games")
      .select("game_pk, status, feed_synced_at")
      .order("game_date", { ascending: true })
      .range(from, from + pageSize - 1);

    if (onlyGamePk != null) {
      query = query.eq("game_pk", onlyGamePk);
    } else if (!force) {
      query = query.or("feed_synced_at.is.null,status.eq.Live,status.eq.In Progress");
    }

    if (dateRange.since) {
      query = query.gte("game_date", dateRange.since);
    }
    if (dateRange.until) {
      query = query.lte("game_date", dateRange.until);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    const batch = (data ?? []) as GameTarget[];
    games.push(...batch);

    if (onlyGamePk != null || batch.length < pageSize) {
      break;
    }
    from += pageSize;
  }

  return games;
}

async function updateGameFeedRest(
  supabaseUrl: string,
  serviceRoleKey: string,
  gamePk: number,
  state: LiveGameState,
  boxScore: GameBoxScore | null,
): Promise<void> {
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { error } = await supabase
    .from("games")
    .update({
      game_state: state,
      box_score: boxScore,
      feed_synced_at: new Date().toISOString(),
      away_score: state.awayRuns,
      home_score: state.homeRuns,
      status: state.gameStatus,
      venue_id: state.venueId,
      venue_name: state.venueName,
    })
    .eq("game_pk", gamePk);

  if (error) throw new Error(error.message);
}

async function main() {
  loadEnvFile(join(ROOT, "web", ".env.local"));
  loadEnvFile(join(ROOT, "ingestor", ".env"));

  const { force, gamePk: onlyGamePk, since, until } = parseArgs();
  const dateRange = { since: since ?? undefined, until: until ?? undefined };

  let creds;
  try {
    creds = resolveDbCredentials(ROOT);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }

  console.log(
    `Using ${creds.mode === "postgres" ? "DATABASE_URL (Postgres)" : "Supabase REST"} for writes.`,
  );

  if (since || until) {
    console.log(`Date range: ${since ?? "…"} → ${until ?? "…"}`);
  }

  const games: GameTarget[] =
    creds.mode === "postgres"
      ? ((await listGamesForFeedSync(creds, WEB_PKG, onlyGamePk, force, dateRange)) ?? [])
      : await listGamesRest(
          creds.supabaseUrl,
          creds.serviceRoleKey,
          onlyGamePk,
          force,
          dateRange,
        );

  const targets = games.filter((game) => {
    if (force) return true;
    if (!game.feed_synced_at) return true;
    return game.status === "Live" || game.status === "In Progress";
  });

  if (targets.length === 0) {
    console.log("No games need feed sync. Use --force to refresh all feeds.");
    return;
  }

  console.log(`Syncing full feeds for ${targets.length} game(s)…`);

  let synced = 0;
  let failed = 0;

  await mapPool(targets, CONCURRENCY, async (game) => {
    try {
      const { gameState, boxScore } = await fetchGameFeed(game.game_pk);

      if (creds.mode === "postgres") {
        await updateGameFeedViaPostgres(creds, WEB_PKG, game.game_pk, gameState, boxScore);
      } else {
        await updateGameFeedRest(creds.supabaseUrl, creds.serviceRoleKey, game.game_pk, gameState, boxScore);
      }

      synced += 1;
      console.log(
        `  ✓ ${game.game_pk} — ${gameState.awayAbbrev} @ ${gameState.homeAbbrev} (${gameState.plays.length} plays, box score ${boxScore ? "yes" : "no"})`,
      );
    } catch (err) {
      failed += 1;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ ${game.game_pk} — ${message}`);
    }
  });

  console.log(`\nDone. ${synced} synced, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
