/**
 * Backfill game_hits from archived games.game_state.
 * Requires SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY) in env.
 *
 * Usage: npm run backfill-game-hits [-- --season=2026 --limit=50 --batches=20]
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { backfillGameHitsBatch } from "../lib/games/syncGameHits";

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

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
loadEnvFile(join(WEB_ROOT, "..", "ingestor", ".env"));

function readArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  const season = Number.parseInt(readArg("season") ?? String(new Date().getFullYear()), 10);
  const limit = Number.parseInt(readArg("limit") ?? "40", 10);
  const batches = Number.parseInt(readArg("batches") ?? "10", 10);

  let totalProcessed = 0;

  for (let batch = 0; batch < batches; batch += 1) {
    const { processed, gamePks } = await backfillGameHitsBatch({ season, limit });
    totalProcessed += processed;
    console.log(`batch ${batch + 1}: indexed ${processed} games`, gamePks);

    if (processed === 0) {
      break;
    }
  }

  console.log(`Done. Indexed ${totalProcessed} games for season ${season}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
