/**
 * Slim season ballpark-hits + player-bip JSON for Vercel function size / mobile payloads.
 *
 * - Strips embedded play `detail` from venue and player hit lists
 * - Regenerates count-only summary.json (empty previewHits)
 * - Rebuilds player-bip from slimmed venues
 *
 * Usage:
 *   npx tsx scripts/slim-bip-json.ts [--season=2026]
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { BallparkHitsDetail, VenueHit } from "../lib/mlb/ballparkHits";
import { rebuildBallparkHitsSummary } from "../lib/mlb/ballparkHitsStore";
import { rebuildPlayerBipStore } from "../lib/mlb/playerBipStore";

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv: string[]) {
  let season = new Date().getFullYear();
  for (const arg of argv) {
    if (arg.startsWith("--season=")) {
      season = Number.parseInt(arg.slice("--season=".length), 10);
    }
  }
  if (!Number.isFinite(season) || season < 2000) {
    throw new Error(`Invalid season: ${season}`);
  }
  return { season };
}

function slimHit(hit: VenueHit): VenueHit {
  const { detail: _detail, ...rest } = hit;
  return rest as VenueHit;
}

function slimVenueFile(path: string): { before: number; after: number; hits: number } {
  const before = Buffer.byteLength(readFileSync(path));
  const detail = JSON.parse(readFileSync(path, "utf8")) as BallparkHitsDetail;
  const hits = (detail.hits ?? []).map(slimHit);
  const next: BallparkHitsDetail = {
    ...detail,
    hits,
    generatedAt: new Date().toISOString(),
  };
  const text = `${JSON.stringify(next)}\n`;
  writeFileSync(path, text, "utf8");
  return { before, after: Buffer.byteLength(text), hits: hits.length };
}

function main() {
  const { season } = parseArgs(process.argv.slice(2));
  process.chdir(WEB_ROOT);

  const venueDir = join(WEB_ROOT, "data", "ballpark-hits", String(season), "venues");
  if (!existsSync(venueDir)) {
    throw new Error(`Missing venue dir: ${venueDir}`);
  }

  let venueBefore = 0;
  let venueAfter = 0;
  let hitCount = 0;

  const files = readdirSync(venueDir).filter((f) => f.endsWith(".json"));
  console.log(`Slimming ${files.length} venue files for ${season}…`);
  for (const file of files) {
    const result = slimVenueFile(join(venueDir, file));
    venueBefore += result.before;
    venueAfter += result.after;
    hitCount += result.hits;
  }

  console.log(
    `Venues: ${(venueBefore / 1e6).toFixed(1)}MB → ${(venueAfter / 1e6).toFixed(1)}MB (${hitCount} hits)`,
  );

  rebuildBallparkHitsSummary(season);
  const summaryPath = join(WEB_ROOT, "data", "ballpark-hits", String(season), "summary.json");
  const summaryBytes = existsSync(summaryPath) ? Buffer.byteLength(readFileSync(summaryPath)) : 0;
  console.log(`Summary: ${(summaryBytes / 1e6).toFixed(2)}MB (count-only, no previewHits)`);

  const playerBip = rebuildPlayerBipStore(season);
  console.log(
    `Rebuilt player-bip: ${playerBip.playerCount} players, ${playerBip.bipCount} BIP`,
  );
}

main();
