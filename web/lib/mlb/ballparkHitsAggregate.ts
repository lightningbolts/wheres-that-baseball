import { parseStoredGameState } from "@/lib/games/gameState";
import { ballparkIndex } from "@/lib/mlb/ballparkPaths";
import {
  computeGameHitStats,
  extractGameHits,
  HIT_TYPE_COLORS,
  type GameHitStats,
} from "@/lib/mlb/gameHits";
import type {
  BallparkHitsAggregate,
  BallparkHitsDetail,
  BallparkHitsSummary,
  SprayPreviewHit,
  VenueHit,
} from "@/lib/mlb/ballparkHits";
import { parseLiveFeed } from "@/lib/mlb/liveFeed";
import type { MLBLiveFeedResponse } from "@/types/mlb-live";

export interface GameHitsSourceRow {
  game_pk: number;
  game_date: string;
  season: number;
  venue_id: number | null;
  away_team_abbrev: string;
  home_team_abbrev: string;
  game_state: unknown;
}

function toVenueHit(
  row: Pick<
    GameHitsSourceRow,
    "game_pk" | "game_date" | "away_team_abbrev" | "home_team_abbrev" | "venue_id"
  >,
  hit: ReturnType<typeof extractGameHits>[number],
): VenueHit {
  return {
    ...hit,
    hitKey: `${row.game_pk}-${hit.atBatIndex}`,
    gamePk: row.game_pk,
    gameDate: row.game_date,
    awayAbbrev: row.away_team_abbrev,
    homeAbbrev: row.home_team_abbrev,
  };
}

const PREVIEW_HIT_LIMIT = 150;

function samplePreviewHits(hits: VenueHit[], limit: number): VenueHit[] {
  if (hits.length <= limit) return hits;
  const step = hits.length / limit;
  const sampled: VenueHit[] = [];
  for (let i = 0; i < limit; i += 1) {
    sampled.push(hits[Math.floor(i * step)]!);
  }
  return sampled;
}

function toSprayPreview(hit: VenueHit): SprayPreviewHit {
  return {
    atBatIndex: hit.atBatIndex,
    event: hit.event,
    hit: hit.hit,
    color: hit.color,
    hitKey: hit.hitKey,
  };
}

export function extractVenueHitsFromStoredGame(row: GameHitsSourceRow): VenueHit[] {
  if (row.venue_id == null) return [];

  const state = parseStoredGameState(row.game_state, row.game_pk);
  if (!state?.plays?.length) return [];

  return extractGameHits(state.plays).map((hit) => toVenueHit(row, hit));
}

export function extractVenueHitsFromFeed(
  row: Pick<
    GameHitsSourceRow,
    "game_pk" | "game_date" | "venue_id" | "away_team_abbrev" | "home_team_abbrev"
  >,
  feed: MLBLiveFeedResponse,
): VenueHit[] {
  if (row.venue_id == null) return [];

  const state = parseLiveFeed(row.game_pk, feed);
  return extractGameHits(state.plays).map((hit) => toVenueHit(row, hit));
}

export function buildBallparkHitsAggregate(
  season: number,
  hitsByVenue: Map<number, VenueHit[]>,
  gamesByVenue: Map<number, Set<number>>,
  options?: { indexedGameCount?: number; backfillPending?: boolean },
): BallparkHitsAggregate {
  const parks: BallparkHitsSummary[] = Object.values(ballparkIndex.parks).map((park) => {
    const hits = hitsByVenue.get(park.venueId) ?? [];
    return {
      venueId: park.venueId,
      venueName: park.venueName,
      teamId: park.teamId,
      teamAbbrev: park.teamAbbrev,
      teamName: park.teamName,
      stadiumSlug: park.stadiumSlug,
      stats: computeGameHitStats(hits),
      gameCount: gamesByVenue.get(park.venueId)?.size ?? 0,
      previewHits: samplePreviewHits(hits, PREVIEW_HIT_LIMIT).map(toSprayPreview),
    };
  });

  parks.sort((a, b) => a.venueName.localeCompare(b.venueName));

  const indexedHitCount = parks.reduce((sum, park) => sum + park.stats.total, 0);

  return {
    season,
    parks,
    generatedAt: new Date().toISOString(),
    indexedHitCount,
    indexedGameCount: options?.indexedGameCount ?? 0,
    ballparksWithHits: parks.filter((park) => park.stats.total > 0).length,
    backfillPending: options?.backfillPending ?? false,
  };
}

export function buildBallparkHitsDetail(
  season: number,
  venueId: number,
  hits: VenueHit[],
): BallparkHitsDetail {
  const park = ballparkIndex.parks[String(venueId)];
  if (!park) {
    throw new Error("Unknown venue");
  }

  const sorted = [...hits].sort((a, b) => {
    const dateCmp = a.gameDate.localeCompare(b.gameDate);
    if (dateCmp !== 0) return dateCmp;
    if (a.gamePk !== b.gamePk) return a.gamePk - b.gamePk;
    return a.atBatIndex - b.atBatIndex;
  });

  return {
    season,
    park,
    hits: sorted,
    stats: computeGameHitStats(sorted),
    gameCount: new Set(sorted.map((hit) => hit.gamePk)).size,
    generatedAt: new Date().toISOString(),
  };
}

export function indexHitsByVenue(
  rows: Array<{ venueId: number; gamePk: number; hits: VenueHit[] }>,
): { hitsByVenue: Map<number, VenueHit[]>; gamesByVenue: Map<number, Set<number>> } {
  const hitsByVenue = new Map<number, VenueHit[]>();
  const gamesByVenue = new Map<number, Set<number>>();

  for (const row of rows) {
    const gameSet = gamesByVenue.get(row.venueId) ?? new Set<number>();
    gameSet.add(row.gamePk);
    gamesByVenue.set(row.venueId, gameSet);

    if (row.hits.length === 0) continue;

    const existing = hitsByVenue.get(row.venueId) ?? [];
    hitsByVenue.set(row.venueId, existing.concat(row.hits));
  }

  return { hitsByVenue, gamesByVenue };
}

export function mergeVenueHits(existing: VenueHit[], incoming: VenueHit[]): VenueHit[] {
  const byKey = new Map<string, VenueHit>();
  for (const hit of existing) {
    byKey.set(hit.hitKey, hit);
  }
  for (const hit of incoming) {
    byKey.set(hit.hitKey, hit);
  }
  return [...byKey.values()];
}

export function emptyBallparkHitsAggregate(season: number): BallparkHitsAggregate {
  return buildBallparkHitsAggregate(season, new Map(), new Map(), { indexedGameCount: 0 });
}
