/**
 * Compact stored game_state JSONB in-place (no MLB re-fetch).
 *
 * Final games -> pre-parsed LiveGameState (smaller + faster reads).
 * Live / in-progress games -> stripped mlbFeed (plays + linescore only).
 *
 * Usage:
 *   npm run compact-game-feeds
 *   npm run compact-game-feeds -- --dry-run
 *   npm run compact-game-feeds -- --via-rest     # when DATABASE_URL is unreachable
 *   npm run compact-game-feeds -- --vacuum       # Postgres only
 *
 * Auth: DATABASE_URL in ingestor/.env, or SUPABASE_SERVICE_ROLE_KEY in web/.env.local
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

import { compactStoredGameState } from "../lib/games/gameStorage";

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = join(WEB_ROOT, "..");
const WEB_PKG = join(WEB_ROOT, "package.json");
const BATCH_SIZE = 12;
const PAGE_SIZE = 500;

const require = createRequire(WEB_PKG);
const {
  fetchDatabaseSizeReport,
  listGamesForCompaction,
  resolvePostgresCredentials,
  testPostgresConnection,
  updateCompactedGameState,
  vacuumGamesTable,
} = require(join(REPO_ROOT, "scripts/lib/db.mjs")) as typeof import("../../scripts/lib/db.mjs");

interface PostgresCompactionRow {
  game_pk: number;
  status: string;
  game_state: unknown;
}

interface GameIndexRow {
  game_pk: number;
  status: string;
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

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function restCredentials(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in web/.env.local",
    );
  }
  return { url, key };
}

function isDirectDbHostUnreachable(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  return (
    code === "ENOTFOUND" ||
    code === "ECONNREFUSED" ||
    code === "EHOSTUNREACH" ||
    code === "ENETUNREACH" ||
    /no route to host/i.test(error.message)
  );
}

async function listGameIndexViaRest(): Promise<GameIndexRow[]> {
  const { url, key } = restCredentials();
  const supabase = createClient(url, key);
  const rows: GameIndexRow[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from("games")
      .select("game_pk, status")
      .not("game_state", "is", null)
      .order("game_pk", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw new Error(error.message);

    const page = (data ?? []) as GameIndexRow[];
    rows.push(...page);
    process.stdout.write(`\rIndexed ${rows.length} game(s)…`);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  process.stdout.write("\n");
  return rows;
}

async function fetchGameStateViaRest(gamePk: number): Promise<unknown | null> {
  const { url, key } = restCredentials();
  const supabase = createClient(url, key);
  const { data, error } = await supabase
    .from("games")
    .select("game_state")
    .eq("game_pk", gamePk)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as { game_state?: unknown } | null)?.game_state ?? null;
}

async function updateCompactedGameStateViaRest(
  gamePk: number,
  payload: unknown,
): Promise<void> {
  const { url, key } = restCredentials();
  const supabase = createClient(url, key);
  const { error } = await supabase
    .from("games")
    .update({ game_state: payload, updated_at: new Date().toISOString() })
    .eq("game_pk", gamePk);

  if (error) throw new Error(error.message);
}

async function printSizeReport(databaseUrl: string, label: string) {
  const report = await fetchDatabaseSizeReport(databaseUrl, WEB_PKG);
  console.log(`\n${label}`);
  console.log(`  Database: ${report.database.database_size}`);
  for (const table of report.tables.slice(0, 5)) {
    console.log(`  ${table.table_name}: ${table.total_size}`);
  }
}

async function resolveMode(forceRest: boolean): Promise<"postgres" | "rest"> {
  if (forceRest) return "rest";

  try {
    const creds = resolvePostgresCredentials(REPO_ROOT);
    await testPostgresConnection(creds.databaseUrl, WEB_PKG);
    return "postgres";
  } catch (error) {
    if (isDirectDbHostUnreachable(error)) {
      console.warn(
        "DATABASE_URL is unreachable from this network (db.*.supabase.co is often IPv6-only).\n" +
          "Falling back to Supabase REST. Use --via-rest to skip the Postgres probe.\n" +
          "For scripts/ingestor, set the Session pooler URI from Supabase Dashboard → Database → Connect.\n",
      );
      return "rest";
    }
    throw error;
  }
}

async function compactRows(
  index: GameIndexRow[],
  dryRun: boolean,
  write: (gamePk: number, payload: unknown) => Promise<void>,
  loadState: (gamePk: number) => Promise<unknown | null>,
) {
  let updated = 0;
  let skipped = 0;
  let savedBytes = 0;
  const formatCounts = { parsed: 0, mlbFeed: 0, unchanged: 0 };

  for (let i = 0; i < index.length; i += BATCH_SIZE) {
    const batch = index.slice(i, i + BATCH_SIZE);

    for (const row of batch) {
      const gameState = await loadState(row.game_pk);
      if (gameState == null) {
        skipped += 1;
        continue;
      }

      const compact = compactStoredGameState(gameState, row.game_pk, row.status);
      if (!compact) {
        skipped += 1;
        continue;
      }

      const delta = compact.beforeBytes - compact.afterBytes;
      if (delta <= 0 || compact.format === "unchanged") {
        skipped += 1;
        formatCounts.unchanged += 1;
        continue;
      }

      if (!dryRun) {
        await write(row.game_pk, compact.payload);
      }

      updated += 1;
      savedBytes += delta;
      if (compact.format === "parsed" || compact.format === "mlbFeed") {
        formatCounts[compact.format] += 1;
      }

      process.stdout.write(
        `\r${dryRun ? "Would update" : "Updated"} ${updated}/${index.length} — saved ${formatBytes(savedBytes)}…`,
      );
    }
  }

  process.stdout.write("\n");
  console.log(
    `${dryRun ? "Would compact" : "Compacted"} ${updated} game(s), skipped ${skipped}.`,
  );
  console.log(
    `  Final -> parsed: ${formatCounts.parsed}, live -> stripped feed: ${formatCounts.mlbFeed}`,
  );
  console.log(`  Estimated JSONB reduction: ${formatBytes(savedBytes)}`);

  return updated;
}

async function main() {
  loadEnvFile(join(WEB_ROOT, ".env.local"));
  loadEnvFile(join(REPO_ROOT, "ingestor", ".env"));

  const dryRun = hasFlag("dry-run");
  const runVacuum = hasFlag("vacuum");
  const forceRest = hasFlag("via-rest");

  const mode = await resolveMode(forceRest);
  console.log(
    dryRun
      ? `Dry run — no writes (${mode}).`
      : `Compacting game_state via ${mode === "postgres" ? "Postgres" : "Supabase REST"}…`,
  );

  if (mode === "postgres") {
    const creds = resolvePostgresCredentials(REPO_ROOT);
    const databaseUrl = creds.databaseUrl;

    await printSizeReport(databaseUrl, "Before");
    const rows = (await listGamesForCompaction(databaseUrl, WEB_PKG)) as PostgresCompactionRow[];
    console.log(`\nScanning ${rows.length} game(s) with stored feeds…`);

    const index: GameIndexRow[] = rows.map((row) => ({ game_pk: row.game_pk, status: row.status }));
    const stateByPk = new Map(rows.map((row) => [row.game_pk, row.game_state]));

    const updated = await compactRows(
      index,
      dryRun,
      (gamePk, payload) => updateCompactedGameState(databaseUrl, WEB_PKG, gamePk, payload),
      async (gamePk) => stateByPk.get(gamePk) ?? null,
    );

    if (!dryRun && runVacuum) {
      console.log("\nRunning VACUUM (VERBOSE, ANALYZE) games…");
      await vacuumGamesTable(databaseUrl, WEB_PKG);
    } else if (!dryRun && updated > 0) {
      console.log(
        "\nRun with --vacuum to reclaim disk space after compaction:\n" +
          "  npm run compact-game-feeds -- --vacuum",
      );
    }

    if (!dryRun) {
      await printSizeReport(databaseUrl, "After");
    }
    return;
  }

  if (runVacuum) {
    console.warn("--vacuum requires a working DATABASE_URL (Session pooler URI). Skipping vacuum.");
  }

  const index = await listGameIndexViaRest();
  console.log(`\nScanning ${index.length} game(s) with stored feeds…`);

  await compactRows(
    index,
    dryRun,
    (gamePk, payload) => updateCompactedGameStateViaRest(gamePk, payload),
    (gamePk) => fetchGameStateViaRest(gamePk),
  );

  if (!dryRun) {
    console.log(
      "\nCheck database size in Supabase Dashboard → Database → Disk usage.\n" +
        "To reclaim dead tuple space, run VACUUM from the SQL editor after enabling Session pooler.",
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
