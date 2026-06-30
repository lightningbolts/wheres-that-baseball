import { ballparkIndex } from "@/lib/mlb/ballparkPaths";
import {
  computeGameHitStats,
  HIT_TYPE_COLORS,
  type GameHit,
  type GameHitStats,
} from "@/lib/mlb/gameHits";
import type { BallparkData } from "@/types/ballpark";
import type { GameHitRow } from "@/types/game-hits";

export interface VenueHit extends GameHit {
  hitKey: string;
  gamePk: number;
  gameDate: string;
  awayAbbrev: string;
  homeAbbrev: string;
}

export interface BallparkHitsSummary {
  venueId: number;
  venueName: string;
  teamId: number;
  teamAbbrev: string;
  teamName: string;
  stadiumSlug: string;
  stats: GameHitStats;
  gameCount: number;
  previewHits: VenueHit[];
}

export interface BallparkHitsAggregate {
  season: number;
  parks: BallparkHitsSummary[];
  generatedAt: string;
  indexedHitCount: number;
  backfillPending: boolean;
}

export interface BallparkHitsDetail {
  season: number;
  park: BallparkData;
  hits: VenueHit[];
  stats: GameHitStats;
  gameCount: number;
  generatedAt: string;
}

function rowToVenueHit(row: GameHitRow): VenueHit {
  return {
    atBatIndex: row.at_bat_index,
    batterName: row.batter_name,
    event: row.event,
    inning: row.inning,
    halfInning: row.half_inning,
    awayScore: row.away_score,
    homeScore: row.home_score,
    hit: row.hit_data,
    color: HIT_TYPE_COLORS[row.event],
    detail: row.play_detail,
    hitKey: `${row.game_pk}-${row.at_bat_index}`,
    gamePk: row.game_pk,
    gameDate: row.game_date,
    awayAbbrev: row.away_team_abbrev,
    homeAbbrev: row.home_team_abbrev,
  };
}

export function aggregateBallparkHits(
  season: number,
  rows: GameHitRow[],
  venueIdFilter?: number,
  options?: { backfillPending?: boolean },
): BallparkHitsAggregate | BallparkHitsDetail {
  const hitsByVenue = new Map<number, VenueHit[]>();
  const gamesByVenue = new Map<number, Set<number>>();

  for (const row of rows) {
    if (venueIdFilter != null && row.venue_id !== venueIdFilter) continue;

    const hit = rowToVenueHit(row);
    const existing = hitsByVenue.get(row.venue_id) ?? [];
    existing.push(hit);
    hitsByVenue.set(row.venue_id, existing);

    const gameSet = gamesByVenue.get(row.venue_id) ?? new Set<number>();
    gameSet.add(row.game_pk);
    gamesByVenue.set(row.venue_id, gameSet);
  }

  const generatedAt = new Date().toISOString();

  if (venueIdFilter != null) {
    const park = ballparkIndex.parks[String(venueIdFilter)];
    if (!park) {
      throw new Error("Unknown venue");
    }

    const hits = hitsByVenue.get(venueIdFilter) ?? [];
    hits.sort((a, b) => {
      const dateCmp = a.gameDate.localeCompare(b.gameDate);
      if (dateCmp !== 0) return dateCmp;
      if (a.gamePk !== b.gamePk) return a.gamePk - b.gamePk;
      return a.atBatIndex - b.atBatIndex;
    });

    return {
      season,
      park,
      hits,
      stats: computeGameHitStats(hits),
      gameCount: gamesByVenue.get(venueIdFilter)?.size ?? 0,
      generatedAt,
    };
  }

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
      previewHits: hits,
    };
  });

  parks.sort((a, b) => a.venueName.localeCompare(b.venueName));

  return {
    season,
    parks,
    generatedAt,
    indexedHitCount: rows.length,
    backfillPending: options?.backfillPending ?? false,
  };
}
