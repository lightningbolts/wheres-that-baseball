import { parseStoredGameState } from "@/lib/games/gameState";
import { ballparkIndex, resolveBallparkVenueId } from "@/lib/mlb/ballparkPaths";
import {
  computeGameHitStats,
  extractGameHits,
  classifyBipKind,
  officialHitCount,
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

/**
 * Safety cap for index spray previews. Previews are hit-only and strip pitch
 * metrics so a full-season card stays dense without a 50MB summary.json.
 */
export const PREVIEW_HITS_PER_PARK = 2000;

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
  // Index cards only need spray geometry + color — omit play metadata entirely.
  return {
    atBatIndex: hit.atBatIndex,
    event: hit.event,
    bipKind: hit.bipKind,
    hit: {
      launchSpeed: 0,
      launchAngle: 0,
      totalDistance: hit.hit.totalDistance,
      trajectory: "",
      hardness: "",
      location: "",
      coordX: hit.hit.coordX,
      coordY: hit.hit.coordY,
    },
    color: hit.color,
    hitKey: hit.hitKey,
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
  // Index cards default to hit dots (not every BIP / out), matching the detail
  // page's default "Hits" filter.
  const officialHits = hits.filter(
    (hit) => (hit.bipKind ?? classifyBipKind(hit.event)) === "hit",
  );
  const source = officialHits.length > 0 ? officialHits : hits;
  const sorted = [...source].sort(
    (a, b) => b.gameDate.localeCompare(a.gameDate) || b.atBatIndex - a.atBatIndex,
  );

  if (sorted.length <= limit) {
    return sorted.map(toSprayPreview);
  }

  // Stratify when capped so the spray covers the whole season, not only latest games.
  const picked: VenueHit[] = [];
  const step = sorted.length / limit;
  for (let i = 0; i < limit; i += 1) {
    picked.push(sorted[Math.min(sorted.length - 1, Math.floor(i * step))]!);
  }
  return picked.map(toSprayPreview);
}

export function buildBallparkHitsAggregate(
  season: number,
  hitsByVenue: Map<number, VenueHit[]>,
  gamesByVenue: Map<number, Set<number>>,
  options?: { indexedGameCount?: number; backfillPending?: boolean },
): BallparkHitsAggregate {
  const parks: BallparkHitsSummary[] = Object.values(ballparkIndex.parks).map((park) => {
    const hits = hitsByVenue.get(park.venueId) ?? [];
    const stats = computeGameHitStats(hits);
    return {
      venueId: park.venueId,
      venueName: park.venueName,
      teamId: park.teamId,
      teamAbbrev: park.teamAbbrev,
      teamName: park.teamName,
      stadiumSlug: park.stadiumSlug,
      stats,
      gameCount: gamesByVenue.get(park.venueId)?.size ?? 0,
      previewHits: selectPreviewHits(hits),
    };
  });

  parks.sort((a, b) => a.venueName.localeCompare(b.venueName));

  const indexedHitCount = parks.reduce(
    (sum, park) => sum + officialHitCount(park.stats),
    0,
  );

  return {
    season,
    parks,
    generatedAt: new Date().toISOString(),
    indexedHitCount,
    indexedGameCount: options?.indexedGameCount ?? 0,
    ballparksWithHits: parks.filter((park) => officialHitCount(park.stats) > 0).length,
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
