/**
 * Compact stored game_state JSONB in-place (no MLB re-fetch).
 *
 * Final games -> pre-parsed LiveGameState (smaller + faster reads).
 * Live / in-progress games -> stripped mlbFeed (plays + linescore only).
 *
 * Usage:
 *   npm run compact-game-feeds
 *   npm run compact-game-feeds -- --dry-run
 *   npm run compact-game-feeds -- --vacuum
 *
 * Requires DATABASE_URL in ingestor/.env (direct Postgres).
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { compactStoredGameState } from "../lib/games/gameStorage";

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = join(WEB_ROOT, "..");
const WEB_PKG = join(WEB_ROOT, "package.json");
const BATCH_SIZE = 24;

const require = createRequire(WEB_PKG);
const {
  fetchDatabaseSizeReport,
  listGamesForCompaction,
  resolvePostgresCredentials,
  updateCompactedGameState,
  vacuumGamesTable,
} = require(join(REPO_ROOT, "scripts/lib/db.mjs")) as typeof import("../../scripts/lib/db.mjs");

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

async function printSizeReport(databaseUrl: string, label: string) {
  const report = await fetchDatabaseSizeReport(databaseUrl, WEB_PKG);
  console.log(`\n${label}`);
  console.log(`  Database: ${report.database.database_size}`);
  for (const table of report.tables.slice(0, 5)) {
    console.log(`  ${table.table_name}: ${table.total_size}`);
  }
}

async function main() {
  loadEnvFile(join(WEB_ROOT, ".env.local"));
  loadEnvFile(join(REPO_ROOT, "ingestor", ".env"));

  const dryRun = hasFlag("dry-run");
  const runVacuum = hasFlag("vacuum");

  let creds;
  try {
    creds = resolvePostgresCredentials(REPO_ROOT);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }

  const databaseUrl = creds.databaseUrl;
  console.log(dryRun ? "Dry run — no writes." : "Compacting game_state via Postgres…");

  await printSizeReport(databaseUrl, "Before");

  const rows = await listGamesForCompaction(databaseUrl, WEB_PKG);
  console.log(`\nScanning ${rows.length} game(s) with stored feeds…`);

  let updated = 0;
  let skipped = 0;
  let savedBytes = 0;
  const formatCounts = { parsed: 0, mlbFeed: 0, unchanged: 0 };

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);

    for (const row of batch) {
      const compact = compactStoredGameState(row.game_state, row.game_pk, row.status);
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
        await updateCompactedGameState(databaseUrl, WEB_PKG, row.game_pk, compact.payload);
      }

      updated += 1;
      savedBytes += delta;
      if (compact.format === "parsed" || compact.format === "mlbFeed") {
        formatCounts[compact.format] += 1;
      }

      process.stdout.write(
        `\r${dryRun ? "Would update" : "Updated"} ${updated}/${rows.length} — saved ${formatBytes(savedBytes)}…`,
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
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
