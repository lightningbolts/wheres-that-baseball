import { parseStoredGameState } from "@/lib/games/gameState";
import { ballparkIndex, resolveBallparkVenueId } from "@/lib/mlb/ballparkPaths";
import {
  computeGameHitStats,
  extractGameHits,
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

/** Cap spray previews on the ballparks index to keep summary.json mobile-friendly. */
export const PREVIEW_HITS_PER_PARK = 80;

function slimVenueHit(hit: VenueHit): VenueHit {
  const { detail: _detail, ...rest } = hit;
  return rest as VenueHit;
}

export interface GameHitsSourceRow {
  game_pk: number;
  game_date: string;
  season: number;
  venue_id: number | null;
  home_team_id?: number | null;
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

function toSprayPreview(hit: VenueHit): SprayPreviewHit {
  return {
    atBatIndex: hit.atBatIndex,
    event: hit.event,
    bipKind: hit.bipKind,
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

export function extractVenueHitsFromStoredGame(row: GameHitsSourceRow): VenueHit[] {
  const state = parseStoredGameState(row.game_state, row.game_pk);
  if (!state?.plays?.length) return [];

  const venueId = resolveBallparkVenueId(row.venue_id ?? state.venueId, row.home_team_id);
  if (venueId == null) return [];

  const resolvedRow = { ...row, venue_id: venueId };
  return extractGameHits(state.plays).map((hit) => toVenueHit(resolvedRow, hit));
}

export function extractVenueHitsFromFeed(
  row: Pick<
    GameHitsSourceRow,
    "game_pk" | "game_date" | "venue_id" | "home_team_id" | "away_team_abbrev" | "home_team_abbrev"
  >,
  feed: MLBLiveFeedResponse,
): VenueHit[] {
  const venueId = resolveBallparkVenueId(row.venue_id, row.home_team_id);
  if (venueId == null) return [];

  const state = parseLiveFeed(row.game_pk, feed);
  const resolvedRow = { ...row, venue_id: venueId };
  return extractGameHits(state.plays).map((hit) => toVenueHit(resolvedRow, hit));
}

export function selectPreviewHits(hits: VenueHit[], limit = PREVIEW_HITS_PER_PARK): SprayPreviewHit[] {
  if (hits.length === 0 || limit <= 0) return [];
  const sorted = [...hits].sort(
    (a, b) => b.gameDate.localeCompare(a.gameDate) || b.atBatIndex - a.atBatIndex,
  );
  return sorted.slice(0, limit).map(toSprayPreview);
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
      previewHits: selectPreviewHits(hits),
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
    // Persist list rows without play detail — detail is loaded on demand via hitKey.
    hits: sorted.map(slimVenueHit),
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
