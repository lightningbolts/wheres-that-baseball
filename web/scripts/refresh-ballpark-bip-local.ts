/**
 * Rebuild ballpark BIP + player BIP indexes from local game_state archives
 * (data/nerd-stats-local/{season}/sources/) — zero DB egress.
 *
 * Usage:
 *   npm run refresh-ballpark-bip-local -- --season=2026
 */
import { existsSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseStoredGameState } from "../lib/games/gameState";
import { extractVenueHitsFromStoredGame } from "../lib/mlb/ballparkHitsAggregate";
import { resolveBallparkVenueId } from "../lib/mlb/ballparkPaths";
import { writeFullBallparkHitsStore } from "../lib/mlb/ballparkHitsStore";
import { loadGameSourceRow } from "../lib/mlb/nerdStats/gameSourceCache";
import { rebuildPlayerBipStore } from "../lib/mlb/playerBipStore";

const WEB_ROOT = dirname(fileURLToPath(import.meta.url));

function readSeason(): number {
  const arg = process.argv.find((item) => item.startsWith("--season="));
  return Number.parseInt(arg?.split("=")[1] ?? String(new Date().getFullYear()), 10);
}

function main() {
  const season = readSeason();
  const sourcesDir = join(WEB_ROOT, "..", "data", "nerd-stats-local", String(season), "sources");
  if (!existsSync(sourcesDir)) {
    console.error(
      `No local sources at ${sourcesDir}. Run aggregate-nerd-stats with game fetch first, or use npm run aggregate-ballpark-hits.`,
    );
    process.exit(1);
  }

  process.chdir(join(WEB_ROOT, ".."));

  const pks = readdirSync(sourcesDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => Number.parseInt(f.replace(".json", ""), 10))
    .filter((pk) => Number.isFinite(pk));

  console.log(`Rebuilding ballpark BIP from ${pks.length} local sources (season ${season})…`);

  const venueDir = join(process.cwd(), "data", "ballpark-hits", String(season), "venues");
  if (existsSync(venueDir)) {
    rmSync(venueDir, { recursive: true, force: true });
  }

  const gameRows: Array<{
    gamePk: number;
    venueId: number | null;
    hits: ReturnType<typeof extractVenueHitsFromStoredGame>;
  }> = [];

  let hitCount = 0;
  let nonHitCount = 0;

  for (let i = 0; i < pks.length; i += 1) {
    const row = loadGameSourceRow(season, pks[i]!);
    if (!row?.game_state) continue;

    const state = parseStoredGameState(row.game_state, row.game_pk);
    const venueId = resolveBallparkVenueId(state?.venueId ?? null, row.home_team_id);
    const hits = extractVenueHitsFromStoredGame({
      game_pk: row.game_pk,
      game_date: row.game_date,
      season: row.season,
      venue_id: state?.venueId ?? null,
      home_team_id: row.home_team_id,
      away_team_abbrev: row.away_team_abbrev,
      home_team_abbrev: row.home_team_abbrev,
      game_state: row.game_state,
    });

    hitCount += hits.length;
    nonHitCount += hits.filter((h) => h.bipKind !== "hit").length;
    gameRows.push({ gamePk: row.game_pk, venueId, hits });

    if ((i + 1) % 100 === 0 || i + 1 === pks.length) {
      process.stdout.write(
        `\rProcessed ${i + 1}/${pks.length} games, ${hitCount} BIP (${nonHitCount} non-hits)…`,
      );
    }
  }

  process.stdout.write("\n");
  writeFullBallparkHitsStore(season, gameRows);
  const playerBip = rebuildPlayerBipStore(season);

  console.log(
    `Wrote ballpark-hits + player-bip for ${gameRows.length} games (${hitCount} BIP, ${playerBip.playerCount} players).`,
  );
}

main();
