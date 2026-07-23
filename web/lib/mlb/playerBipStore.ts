import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { stripHitDetail } from "@/lib/mlb/ballparkHitsApi";
import { ballparkIndex } from "@/lib/mlb/ballparkPaths";
import type { BallparkHitsDetail, VenueHit } from "@/lib/mlb/ballparkHits";
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

function slimHit(hit: VenueHit): VenueHit {
  return { ...stripHitDetail(hit) } as VenueHit;
}

function normalizeHit(hit: VenueHit): VenueHit {
  const bipKind = hit.bipKind ?? classifyBipKind(hit.event);
  return slimHit({
    ...hit,
    batterId: hit.batterId ?? hit.detail?.batterId ?? 0,
    bipKind,
  });
}

function inferTeamAbbrev(hit: VenueHit, venueId: number): string | null {
  const park = ballparkIndex.parks[String(venueId)];
  if (!park) return hit.homeAbbrev ?? hit.awayAbbrev ?? null;
  // Prefer the park's home team when the hit was at that park for that club.
  if (hit.homeAbbrev === park.teamAbbrev) return park.teamAbbrev;
  if (hit.awayAbbrev === park.teamAbbrev) return hit.awayAbbrev;
  return hit.homeAbbrev ?? hit.awayAbbrev ?? park.teamAbbrev;
}

function mergeHitsByKey(existing: VenueHit[], incoming: VenueHit[]): VenueHit[] {
  const byKey = new Map<string, VenueHit>();
  for (const hit of existing) {
    byKey.set(hit.hitKey, slimHit(hit));
  }
  for (const hit of incoming) {
    byKey.set(hit.hitKey, slimHit(hit));
  }
  return [...byKey.values()];
}

function pickModalTeam(
  teamCounts: Map<string, number>,
  teamIdCounts: Map<number, number>,
): { teamAbbrev: string | null; teamId: number | null } {
  let topTeamAbbrev: string | null = null;
  let topTeamCount = 0;
  for (const [abbrev, count] of teamCounts) {
    if (count > topTeamCount) {
      topTeamCount = count;
      topTeamAbbrev = abbrev;
    }
  }

  let topTeamId: number | null = null;
  let topTeamIdCount = 0;
  for (const [teamId, count] of teamIdCounts) {
    if (count > topTeamIdCount) {
      topTeamIdCount = count;
      topTeamId = teamId;
    }
  }
  if (topTeamId == null && topTeamAbbrev) {
    const match = Object.values(ballparkIndex.parks).find((p) => p.teamAbbrev === topTeamAbbrev);
    topTeamId = match?.teamId ?? null;
  }

  return { teamAbbrev: topTeamAbbrev, teamId: topTeamId };
}

function buildPlayerDetailFromVenues(
  season: number,
  playerId: number,
  name: string,
  byVenue: Map<number, VenueHit[]>,
  teamCounts: Map<string, number>,
  teamIdCounts: Map<number, number>,
  generatedAt: string,
): PlayerBipDetail {
  const parks: PlayerVenueBip[] = [];
  const allHits: VenueHit[] = [];

  for (const [venueId, hits] of byVenue) {
    const sorted = [...hits].sort(
      (a, b) => b.gameDate.localeCompare(a.gameDate) || b.atBatIndex - a.atBatIndex,
    );
    const slimHits = sorted.map(slimHit);
    const park = ballparkIndex.parks[String(venueId)];
    parks.push({
      venueId,
      venueName: park?.venueName ?? `Venue ${venueId}`,
      teamAbbrev: park?.teamAbbrev ?? "",
      stats: computeGameHitStats(slimHits),
      hits: slimHits,
      // Charts use `hits` — avoid duplicating every BIP row on disk / in deploys.
      chartHits: [],
    });
    allHits.push(...slimHits);
  }

  parks.sort((a, b) => b.stats.total - a.stats.total || a.venueName.localeCompare(b.venueName));
  const { teamAbbrev, teamId } = pickModalTeam(teamCounts, teamIdCounts);

  return {
    season,
    playerId,
    name,
    teamAbbrev,
    teamId,
    stats: computeGameHitStats(allHits),
    bipCount: allHits.length,
    parks,
    generatedAt,
    source: "file",
  };
}

function recountTeamsFromParks(parks: PlayerVenueBip[]): {
  teamCounts: Map<string, number>;
  teamIdCounts: Map<number, number>;
} {
  const teamCounts = new Map<string, number>();
  const teamIdCounts = new Map<number, number>();

  for (const park of parks) {
    for (const hit of park.hits) {
      const teamAbbrev = inferTeamAbbrev(hit, park.venueId);
      if (teamAbbrev) {
        teamCounts.set(teamAbbrev, (teamCounts.get(teamAbbrev) ?? 0) + 1);
      }
      const parkMeta = ballparkIndex.parks[String(park.venueId)];
      if (parkMeta) {
        const battingAbbrev = hit.halfInning === "top" ? hit.awayAbbrev : hit.homeAbbrev;
        if (battingAbbrev === parkMeta.teamAbbrev) {
          teamIdCounts.set(parkMeta.teamId, (teamIdCounts.get(parkMeta.teamId) ?? 0) + 1);
        }
      }
    }
  }

  return { teamCounts, teamIdCounts };
}

function upsertIndexEntry(season: number, entry: PlayerBipIndexEntry, generatedAt: string): void {
  const existing = loadPlayerBipIndex(season);
  const players = [...(existing?.players ?? [])];
  const idx = players.findIndex((p) => p.playerId === entry.playerId);
  if (idx >= 0) {
    players[idx] = entry;
  } else {
    players.push(entry);
  }
  players.sort((a, b) => b.bipCount - a.bipCount || a.name.localeCompare(b.name));
  writeJson(indexPath(season), {
    season,
    generatedAt,
    players,
  } satisfies PlayerBipIndex);
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

/**
 * Incrementally merge new venue hits into per-player BIP files + index.
 * Called whenever ballpark hits are appended so player pages stay in sync.
 */
export function appendHitsToPlayerBipStore(
  season: number,
  venueId: number,
  hits: VenueHit[],
): { playersUpdated: number; hitsAdded: number } {
  if (!hits.length || !ballparkIndex.parks[String(venueId)]) {
    return { playersUpdated: 0, hitsAdded: 0 };
  }

  const byPlayer = new Map<number, VenueHit[]>();
  for (const raw of hits) {
    const hit = normalizeHit(raw);
    if (!hit.batterId) continue;
    const list = byPlayer.get(hit.batterId) ?? [];
    list.push(hit);
    byPlayer.set(hit.batterId, list);
  }

  if (byPlayer.size === 0) {
    return { playersUpdated: 0, hitsAdded: 0 };
  }

  mkdirSync(join(seasonDir(season), "players"), { recursive: true });
  const generatedAt = new Date().toISOString();
  let playersUpdated = 0;
  let hitsAdded = 0;

  for (const [playerId, incoming] of byPlayer) {
    const existing = loadPlayerBipDetail(season, playerId);
    const byVenue = new Map<number, VenueHit[]>();

    if (existing?.parks) {
      for (const park of existing.parks) {
        byVenue.set(park.venueId, park.hits.map(slimHit));
      }
    }

    const beforeCount = byVenue.get(venueId)?.length ?? 0;
    const merged = mergeHitsByKey(byVenue.get(venueId) ?? [], incoming);
    byVenue.set(venueId, merged);
    hitsAdded += Math.max(0, merged.length - beforeCount);

    const name =
      incoming.find((h) => h.batterName)?.batterName ||
      existing?.name ||
      `Player ${playerId}`;

    // Rebuild team tallies from the full merged set (simple + correct for modal team).
    const parksForCount: PlayerVenueBip[] = [...byVenue.entries()].map(([vid, venueHits]) => ({
      venueId: vid,
      venueName: "",
      teamAbbrev: "",
      stats: computeGameHitStats(venueHits),
      hits: venueHits,
      chartHits: [],
    }));
    const { teamCounts, teamIdCounts } = recountTeamsFromParks(parksForCount);

    const detail = buildPlayerDetailFromVenues(
      season,
      playerId,
      name,
      byVenue,
      teamCounts,
      teamIdCounts,
      generatedAt,
    );
    writeJson(playerPath(season, playerId), detail);

    const hitCount = detail.parks
      .flatMap((p) => p.hits)
      .filter((h) => (h.bipKind ?? classifyBipKind(h.event)) === "hit").length;

    upsertIndexEntry(
      season,
      {
        playerId,
        name: detail.name,
        teamAbbrev: detail.teamAbbrev,
        teamId: detail.teamId,
        bipCount: detail.bipCount,
        hitCount,
        venueCount: detail.parks.length,
      },
      generatedAt,
    );
    playersUpdated += 1;
  }

  return { playersUpdated, hitsAdded };
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
    const detail = buildPlayerDetailFromVenues(
      season,
      playerId,
      bucket.name,
      bucket.byVenue,
      bucket.teamCounts,
      bucket.teamIdCounts,
      generatedAt,
    );
    bipCount += detail.bipCount;
    writeJson(playerPath(season, playerId), detail);

    const hitCount = detail.parks
      .flatMap((p) => p.hits)
      .filter((h) => (h.bipKind ?? classifyBipKind(h.event)) === "hit").length;

    indexEntries.push({
      playerId,
      name: detail.name,
      teamAbbrev: detail.teamAbbrev,
      teamId: detail.teamId,
      bipCount: detail.bipCount,
      hitCount,
      venueCount: detail.parks.length,
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
