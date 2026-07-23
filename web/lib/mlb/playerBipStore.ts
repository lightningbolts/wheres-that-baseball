import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { ballparkIndex } from "@/lib/mlb/ballparkPaths";
import type { BallparkHitsDetail, SprayPreviewHit, VenueHit } from "@/lib/mlb/ballparkHits";
import { classifyBipKind, computeGameHitStats } from "@/lib/mlb/gameHits";
import type {
  PlayerBipDetail,
  PlayerBipIndex,
  PlayerBipIndexEntry,
  PlayerVenueBip,
} from "@/lib/mlb/playerBip";

function seasonDir(season: number): string {
  return join(process.cwd(), "data", "player-bip", String(season));
}

function indexPath(season: number): string {
  return join(seasonDir(season), "index.json");
}

function playerPath(season: number, playerId: number): string {
  return join(seasonDir(season), "players", `${playerId}.json`);
}

function ballparkVenueDir(season: number): string {
  return join(process.cwd(), "data", "ballpark-hits", String(season), "venues");
}

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data)}\n`, "utf8");
}

function toSprayPreview(hit: VenueHit): SprayPreviewHit {
  return {
    atBatIndex: hit.atBatIndex,
    event: hit.event,
    bipKind: hit.bipKind ?? classifyBipKind(hit.event),
    hit: hit.hit,
    color: hit.color,
    hitKey: hit.hitKey,
    batterId: hit.batterId,
    batterName: hit.batterName,
    inning: hit.inning,
    halfInning: hit.halfInning,
    awayScore: hit.awayScore,
    homeScore: hit.homeScore,
    gamePk: hit.gamePk,
    gameDate: hit.gameDate,
    awayAbbrev: hit.awayAbbrev,
    homeAbbrev: hit.homeAbbrev,
  };
}

function normalizeHit(hit: VenueHit): VenueHit {
  const bipKind = hit.bipKind ?? classifyBipKind(hit.event);
  return {
    ...hit,
    batterId: hit.batterId ?? hit.detail?.batterId ?? 0,
    bipKind,
  };
}

function inferTeamAbbrev(hit: VenueHit, venueId: number): string | null {
  const park = ballparkIndex.parks[String(venueId)];
  if (!park) return hit.homeAbbrev ?? hit.awayAbbrev ?? null;
  // Prefer the park's home team when the hit was at that park for that club.
  if (hit.homeAbbrev === park.teamAbbrev) return park.teamAbbrev;
  if (hit.awayAbbrev === park.teamAbbrev) return hit.awayAbbrev;
  return hit.homeAbbrev ?? hit.awayAbbrev ?? park.teamAbbrev;
}

export function loadPlayerBipIndex(season: number): PlayerBipIndex | null {
  return readJson<PlayerBipIndex>(indexPath(season));
}

export function loadPlayerBipDetail(season: number, playerId: number): PlayerBipDetail | null {
  return readJson<PlayerBipDetail>(playerPath(season, playerId));
}

export function searchPlayerBipIndex(
  season: number,
  query: string,
  limit = 10,
): PlayerBipIndexEntry[] {
  const index = loadPlayerBipIndex(season);
  if (!index?.players?.length) return [];

  const q = query.trim().toLowerCase();
  if (!q) {
    return [...index.players]
      .sort((a, b) => b.bipCount - a.bipCount)
      .slice(0, limit);
  }

  const tokens = q.split(/\s+/).filter(Boolean);
  const scored: Array<{ entry: PlayerBipIndexEntry; score: number }> = [];

  for (const entry of index.players) {
    const name = entry.name.toLowerCase();
    if (!tokens.every((t) => name.includes(t))) continue;

    let score = 0;
    if (name.startsWith(q)) score += 100;
    else if (name.split(/\s+/).some((part) => part.startsWith(tokens[0]!))) score += 50;
    score += Math.min(entry.bipCount, 40);
    scored.push({ entry, score });
  }

  scored.sort((a, b) => b.score - a.score || b.entry.bipCount - a.entry.bipCount);
  return scored.slice(0, limit).map((s) => s.entry);
}

/** Rebuild player-bip index + per-player files from ballpark-hits venue JSON. */
export function rebuildPlayerBipStore(season: number): { playerCount: number; bipCount: number } {
  const venueDir = ballparkVenueDir(season);
  const byPlayer = new Map<
    number,
    {
      name: string;
      teamCounts: Map<string, number>;
      teamIdCounts: Map<number, number>;
      byVenue: Map<number, VenueHit[]>;
    }
  >();

  if (existsSync(venueDir)) {
    for (const file of readdirSync(venueDir)) {
      if (!file.endsWith(".json")) continue;
      const venueId = Number.parseInt(file.replace(".json", ""), 10);
      if (!Number.isFinite(venueId)) continue;
      const detail = readJson<BallparkHitsDetail>(join(venueDir, file));
      if (!detail?.hits?.length) continue;

      for (const raw of detail.hits) {
        const hit = normalizeHit(raw);
        if (!hit.batterId) continue;

        let bucket = byPlayer.get(hit.batterId);
        if (!bucket) {
          bucket = {
            name: hit.batterName,
            teamCounts: new Map(),
            teamIdCounts: new Map(),
            byVenue: new Map(),
          };
          byPlayer.set(hit.batterId, bucket);
        } else if (hit.batterName) {
          bucket.name = hit.batterName;
        }

        const teamAbbrev = inferTeamAbbrev(hit, venueId);
        if (teamAbbrev) {
          bucket.teamCounts.set(teamAbbrev, (bucket.teamCounts.get(teamAbbrev) ?? 0) + 1);
        }
        const park = ballparkIndex.parks[String(venueId)];
        if (park) {
          const battingAbbrev = hit.halfInning === "top" ? hit.awayAbbrev : hit.homeAbbrev;
          if (battingAbbrev === park.teamAbbrev) {
            bucket.teamIdCounts.set(park.teamId, (bucket.teamIdCounts.get(park.teamId) ?? 0) + 1);
          }
        }

        const list = bucket.byVenue.get(venueId) ?? [];
        list.push(hit);
        bucket.byVenue.set(venueId, list);
      }
    }
  }

  const playersDir = join(seasonDir(season), "players");
  if (existsSync(playersDir)) {
    rmSync(playersDir, { recursive: true, force: true });
  }
  mkdirSync(playersDir, { recursive: true });

  const indexEntries: PlayerBipIndexEntry[] = [];
  let bipCount = 0;
  const generatedAt = new Date().toISOString();

  for (const [playerId, bucket] of byPlayer) {
    const parks: PlayerVenueBip[] = [];
    const allHits: VenueHit[] = [];

    for (const [venueId, hits] of bucket.byVenue) {
      hits.sort((a, b) => b.gameDate.localeCompare(a.gameDate) || b.atBatIndex - a.atBatIndex);
      const park = ballparkIndex.parks[String(venueId)];
      const chartHits = hits.map(toSprayPreview);
      parks.push({
        venueId,
        venueName: park?.venueName ?? `Venue ${venueId}`,
        teamAbbrev: park?.teamAbbrev ?? "",
        stats: computeGameHitStats(hits),
        hits,
        chartHits,
      });
      allHits.push(...hits);
    }

    parks.sort((a, b) => b.stats.total - a.stats.total || a.venueName.localeCompare(b.venueName));
    bipCount += allHits.length;

    let topTeamAbbrev: string | null = null;
    let topTeamCount = 0;
    for (const [abbrev, count] of bucket.teamCounts) {
      if (count > topTeamCount) {
        topTeamCount = count;
        topTeamAbbrev = abbrev;
      }
    }

    let topTeamId: number | null = null;
    let topTeamIdCount = 0;
    for (const [teamId, count] of bucket.teamIdCounts) {
      if (count > topTeamIdCount) {
        topTeamIdCount = count;
        topTeamId = teamId;
      }
    }
    if (topTeamId == null && topTeamAbbrev) {
      const match = Object.values(ballparkIndex.parks).find((p) => p.teamAbbrev === topTeamAbbrev);
      topTeamId = match?.teamId ?? null;
    }

    const hitCount = allHits.filter((h) => (h.bipKind ?? classifyBipKind(h.event)) === "hit").length;

    const detail: PlayerBipDetail = {
      season,
      playerId,
      name: bucket.name,
      teamAbbrev: topTeamAbbrev,
      teamId: topTeamId,
      stats: computeGameHitStats(allHits),
      bipCount: allHits.length,
      parks,
      generatedAt,
      source: "file",
    };

    writeJson(playerPath(season, playerId), detail);

    indexEntries.push({
      playerId,
      name: bucket.name,
      teamAbbrev: topTeamAbbrev,
      teamId: topTeamId,
      bipCount: allHits.length,
      hitCount,
      venueCount: parks.length,
    });
  }

  indexEntries.sort((a, b) => b.bipCount - a.bipCount || a.name.localeCompare(b.name));

  const index: PlayerBipIndex = {
    season,
    generatedAt,
    players: indexEntries,
  };
  writeJson(indexPath(season), index);

  return { playerCount: indexEntries.length, bipCount };
}
