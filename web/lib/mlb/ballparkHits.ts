import { ballparkIndex } from "@/lib/mlb/ballparkPaths";
import {
  computeGameHitStats,
  HIT_TYPE_COLORS,
  type GameHit,
  type GameHitStats,
} from "@/lib/mlb/gameHits";
import type { BallparkData } from "@/types/ballpark";

export interface VenueHit extends GameHit {
  hitKey: string;
  gamePk: number;
  gameDate: string;
  awayAbbrev: string;
  homeAbbrev: string;
}

/** Lightweight hit for spray-chart previews on the index page. */
export type SprayPreviewHit = Pick<
  GameHit,
  | "atBatIndex"
  | "event"
  | "bipKind"
  | "hit"
  | "color"
  | "batterId"
  | "batterName"
  | "inning"
  | "halfInning"
  | "awayScore"
  | "homeScore"
> & {
  hitKey: string;
  gamePk?: number;
  gameDate?: string;
  awayAbbrev?: string;
  homeAbbrev?: string;
};

export interface BallparkHitsSummary {
  venueId: number;
  venueName: string;
  teamId: number;
  teamAbbrev: string;
  teamName: string;
  stadiumSlug: string;
  stats: GameHitStats;
  gameCount: number;
  previewHits: SprayPreviewHit[];
}

export interface BallparkHitsAggregate {
  season: number;
  parks: BallparkHitsSummary[];
  generatedAt: string;
  indexedHitCount: number;
  indexedGameCount: number;
  ballparksWithHits: number;
  backfillPending: boolean;
  source?: "file" | "empty";
}

export interface BallparkHitsDetail {
  season: number;
  park: BallparkData;
  hits: VenueHit[];
  stats: GameHitStats;
  gameCount: number;
  generatedAt: string;
  source?: "file" | "empty";
  /** Lightweight hits for spray/3D charts (no play detail payload). */
  chartHits?: SprayPreviewHit[];
  hitsTotal?: number;
  hasMore?: boolean;
}

/** Hit list row without heavy play detail — detail loaded on demand. */
export type VenueHitListItem = Omit<VenueHit, "detail"> & { detail?: VenueHit["detail"] };

export { ballparkIndex };
