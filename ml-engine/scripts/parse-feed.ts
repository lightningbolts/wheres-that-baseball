/**
 * Parse a cached MLB live feed JSON into the `parsed` LiveGameState wrapper
 * used by ml-engine extraction. Invoked from Python via `tsx`.
 *
 * Usage:
 *   npx tsx scripts/parse-feed.ts <gamePk> <feed.json> <out.json>
 */
import { readFileSync, writeFileSync } from "node:fs";

import { parseLiveFeed } from "../../web/lib/mlb/liveFeed";

const [gamePkArg, feedPath, outPath] = process.argv.slice(2);
if (!gamePkArg || !feedPath || !outPath) {
  console.error("usage: parse-feed.ts <gamePk> <feed.json> <out.json>");
  process.exit(1);
}

const gamePk = Number.parseInt(gamePkArg, 10);
const feed = JSON.parse(readFileSync(feedPath, "utf8"));
const parsed = parseLiveFeed(gamePk, feed);
writeFileSync(outPath, JSON.stringify({ parsed }));
