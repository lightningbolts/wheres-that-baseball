/**
 * Apply the game_hits migration via Supabase service role (pg_meta SQL) or DATABASE_URL.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

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

async function applyViaPostgres(databaseUrl: string, sql: string) {
  const Pool = require("pg").Pool;
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query(sql);
  } finally {
    await pool.end();
  }
}

async function applyViaSupabaseSql(supabaseUrl: string, serviceRoleKey: string, sql: string) {
  const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase SQL API failed (${response.status}): ${body}`);
  }
}

async function main() {
  const sqlPath = join(REPO_ROOT, "supabase/migrations/20250630120000_game_hits.sql");
  const sql = readFileSync(sqlPath, "utf8");
  const creds = resolveDbCredentials(REPO_ROOT);

  if (creds.mode === "postgres") {
    await applyViaPostgres(creds.databaseUrl, sql);
    console.log("Applied game_hits migration via DATABASE_URL.");
    return;
  }

  try {
    await applyViaSupabaseSql(creds.supabaseUrl, creds.serviceRoleKey, sql);
    console.log("Applied game_hits migration via Supabase API.");
  } catch {
    console.error(
      "Could not apply migration automatically. Paste this file into the Supabase SQL editor:\n",
      sqlPath,
    );
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
