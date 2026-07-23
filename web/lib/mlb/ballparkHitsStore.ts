import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { ballparkIndex, resolveBallparkVenueId } from "@/lib/mlb/ballparkPaths";
import {
  buildBallparkHitsAggregate,
  buildBallparkHitsDetail,
  emptyBallparkHitsAggregate,
  indexHitsByVenue,
  mergeVenueHits,
  type GameHitsSourceRow,
} from "@/lib/mlb/ballparkHitsAggregate";
import type {
  BallparkHitsAggregate,
  BallparkHitsDetail,
  VenueHit,
} from "@/lib/mlb/ballparkHits";
import { rebuildPlayerBipStore } from "@/lib/mlb/playerBipStore";

export interface BallparkHitsManifest {
  season: number;
  processedGamePks: number[];
  gamesByVenue: Record<string, number[]>;
  generatedAt: string;
}

function seasonDir(season: number): string {
  return join(process.cwd(), "data", "ballpark-hits", String(season));
}

function summaryPath(season: number): string {
  return join(seasonDir(season), "summary.json");
}

function manifestPath(season: number): string {
  return join(seasonDir(season), "manifest.json");
}

function venuePath(season: number, venueId: number): string {
  return join(seasonDir(season), "venues", `${venueId}.json`);
}

function ensureSeasonDir(season: number): void {
  mkdirSync(join(seasonDir(season), "venues"), { recursive: true });
}

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data)}\n`, "utf8");
}

function gamesByVenueFromManifest(manifest: BallparkHitsManifest): Map<number, Set<number>> {
  const map = new Map<number, Set<number>>();
  for (const [venueKey, gamePks] of Object.entries(manifest.gamesByVenue ?? {})) {
    map.set(Number.parseInt(venueKey, 10), new Set(gamePks));
  }
  return map;
}

function manifestGamesByVenue(map: Map<number, Set<number>>): Record<string, number[]> {
  const record: Record<string, number[]> = {};
  for (const [venueId, gamePks] of map) {
    record[String(venueId)] = [...gamePks].sort((a, b) => a - b);
  }
  return record;
}

export function loadBallparkHitsManifest(season: number): BallparkHitsManifest {
  return (
    readJson<BallparkHitsManifest>(manifestPath(season)) ?? {
      season,
      processedGamePks: [],
      gamesByVenue: {},
      generatedAt: new Date(0).toISOString(),
    }
  );
}

export function loadBallparkHitsSummary(season: number): BallparkHitsAggregate | null {
  return readJson<BallparkHitsAggregate>(summaryPath(season));
}

export function loadBallparkHitsDetail(season: number, venueId: number): BallparkHitsDetail | null {
  return readJson<BallparkHitsDetail>(venuePath(season, venueId));
}

export function hasBallparkHitsData(season: number): boolean {
  return existsSync(summaryPath(season));
}

function loadAllVenueHits(season: number): Map<number, VenueHit[]> {
  const venueDir = join(seasonDir(season), "venues");
  const hitsByVenue = new Map<number, VenueHit[]>();

  if (!existsSync(venueDir)) {
    return hitsByVenue;
  }

  for (const file of readdirSync(venueDir)) {
    if (!file.endsWith(".json")) continue;
    const venueId = Number.parseInt(file.replace(".json", ""), 10);
    const detail = readJson<BallparkHitsDetail>(join(venueDir, file));
    if (detail?.hits?.length) {
      hitsByVenue.set(venueId, detail.hits);
    }
  }

  return hitsByVenue;
}

export function saveBallparkHitsBundle(
  season: number,
  manifest: BallparkHitsManifest,
  summary: BallparkHitsAggregate,
  venueDetails: Map<number, BallparkHitsDetail>,
): void {
  ensureSeasonDir(season);
  writeJson(manifestPath(season), manifest);
  writeJson(summaryPath(season), summary);

  for (const [venueId, detail] of venueDetails) {
    writeJson(venuePath(season, venueId), detail);
  }
}

/** Append hits from one archived game into on-disk season aggregates. */
export function appendGameHitsToStore(
  season: number,
  row: Pick<GameHitsSourceRow, "game_pk" | "game_date" | "venue_id" | "home_team_id" | "away_team_abbrev" | "home_team_abbrev">,
  hits: VenueHit[],
): void {
  ensureSeasonDir(season);

  const manifest = loadBallparkHitsManifest(season);
  const venueId = resolveBallparkVenueId(row.venue_id, row.home_team_id);
  const alreadyProcessed = manifest.processedGamePks.includes(row.game_pk);

  if (alreadyProcessed) {
    // Repair path: game was marked processed with 0 hits (incomplete archive).
    if (hits.length === 0 || venueId == null) return;
    if (!ballparkIndex.parks[String(venueId)]) return;

    const existingHits = loadBallparkHitsDetail(season, venueId)?.hits ?? [];
    if (existingHits.some((hit) => hit.gamePk === row.game_pk)) return;

    const hitsByVenue = loadAllVenueHits(season);
    const gamesByVenue = gamesByVenueFromManifest(manifest);
    const gameSet = gamesByVenue.get(venueId) ?? new Set<number>();
    gameSet.add(row.game_pk);
    gamesByVenue.set(venueId, gameSet);

    const merged = mergeVenueHits(existingHits, hits);
    hitsByVenue.set(venueId, merged);
    writeJson(venuePath(season, venueId), buildBallparkHitsDetail(season, venueId, merged));

    manifest.gamesByVenue = manifestGamesByVenue(gamesByVenue);
    manifest.generatedAt = new Date().toISOString();
    const summary = buildBallparkHitsAggregate(season, hitsByVenue, gamesByVenue, {
      indexedGameCount: manifest.processedGamePks.length,
    });
    writeJson(manifestPath(season), manifest);
    writeJson(summaryPath(season), summary);
    return;
  }

  const hitsByVenue = loadAllVenueHits(season);
  const gamesByVenue = gamesByVenueFromManifest(manifest);

  if (venueId != null && ballparkIndex.parks[String(venueId)]) {
    const gameSet = gamesByVenue.get(venueId) ?? new Set<number>();
    gameSet.add(row.game_pk);
    gamesByVenue.set(venueId, gameSet);

    if (hits.length > 0) {
      const merged = mergeVenueHits(hitsByVenue.get(venueId) ?? [], hits);
      hitsByVenue.set(venueId, merged);
      writeJson(
        venuePath(season, venueId),
        buildBallparkHitsDetail(season, venueId, merged),
      );
    }
  }

  // Only mark processed when we stored hits, or when the game truly had none
  // after a complete extract — still record the game so gameCount stays honest,
  // but repair path above can fill hits later if this was premature.
  manifest.processedGamePks.push(row.game_pk);
  manifest.processedGamePks.sort((a, b) => a - b);
  manifest.gamesByVenue = manifestGamesByVenue(gamesByVenue);
  manifest.generatedAt = new Date().toISOString();

  const summary = buildBallparkHitsAggregate(season, hitsByVenue, gamesByVenue, {
    indexedGameCount: manifest.processedGamePks.length,
  });

  writeJson(manifestPath(season), manifest);
  writeJson(summaryPath(season), summary);
}

/** Game pks marked processed that have no hits in venue files (incomplete archive). */
export function listEmptyProcessedBallparkGames(season: number): number[] {
  const manifest = loadBallparkHitsManifest(season);
  const hitsByVenue = loadAllVenueHits(season);
  const gamesWithHits = new Set<number>();
  for (const hits of hitsByVenue.values()) {
    for (const hit of hits) gamesWithHits.add(hit.gamePk);
  }
  return manifest.processedGamePks.filter((gamePk) => !gamesWithHits.has(gamePk));
}

/** Full rebuild from extracted per-game hit batches. */
export function writeFullBallparkHitsStore(
  season: number,
  gameRows: Array<{ gamePk: number; venueId: number | null; hits: VenueHit[] }>,
): void {
  ensureSeasonDir(season);

  const indexed = indexHitsByVenue(
    gameRows
      .filter((row) => row.venueId != null)
      .map((row) => ({
        venueId: row.venueId!,
        gamePk: row.gamePk,
        hits: row.hits,
      })),
  );

  const manifest: BallparkHitsManifest = {
    season,
    processedGamePks: gameRows.map((row) => row.gamePk).sort((a, b) => a - b),
    gamesByVenue: manifestGamesByVenue(indexed.gamesByVenue),
    generatedAt: new Date().toISOString(),
  };

  const summary = buildBallparkHitsAggregate(season, indexed.hitsByVenue, indexed.gamesByVenue, {
    indexedGameCount: manifest.processedGamePks.length,
  });

  const venueDetails = new Map<number, BallparkHitsDetail>();
  for (const park of summary.parks) {
    if (park.stats.total > 0) {
      const hits = indexed.hitsByVenue.get(park.venueId) ?? [];
      venueDetails.set(park.venueId, buildBallparkHitsDetail(season, park.venueId, hits));
    }
  }

  saveBallparkHitsBundle(season, manifest, summary, venueDetails);
  rebuildPlayerBipStore(season);
}

export function getEmptyBallparkHitsSummary(season: number): BallparkHitsAggregate {
  return emptyBallparkHitsAggregate(season);
}

export function getEmptyBallparkHitsDetail(season: number, venueId: number): BallparkHitsDetail {
  return buildBallparkHitsDetail(season, venueId, []);
}

/** Rebuild summary.json from existing venue files (e.g. after changing preview limits). */
export function rebuildBallparkHitsSummary(season: number): void {
  const manifest = loadBallparkHitsManifest(season);
  const hitsByVenue = loadAllVenueHits(season);
  const gamesByVenue = gamesByVenueFromManifest(manifest);
  const summary = buildBallparkHitsAggregate(season, hitsByVenue, gamesByVenue, {
    indexedGameCount: manifest.processedGamePks.length,
  });
  writeJson(summaryPath(season), summary);
}
