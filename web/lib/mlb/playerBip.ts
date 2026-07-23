import type { GameHitStats } from "@/lib/mlb/gameHits";
import type { SprayPreviewHit, VenueHit } from "@/lib/mlb/ballparkHits";

export interface PlayerBipIndexEntry {
  playerId: number;
  name: string;
  /** Most recent / modal team abbrev seen on BIP. */
  teamAbbrev: string | null;
  teamId: number | null;
  bipCount: number;
  hitCount: number;
  venueCount: number;
}

export interface PlayerBipIndex {
  season: number;
  generatedAt: string;
  players: PlayerBipIndexEntry[];
}

export interface PlayerVenueBip {
  venueId: number;
  venueName: string;
  teamAbbrev: string;
  stats: GameHitStats;
  hits: VenueHit[];
  /** Optional; APIs may omit this and clients should fall back to `hits`. */
  chartHits?: SprayPreviewHit[];
}

export interface PlayerBipDetail {
  season: number;
  playerId: number;
  name: string;
  teamAbbrev: string | null;
  teamId: number | null;
  stats: GameHitStats;
  bipCount: number;
  parks: PlayerVenueBip[];
  generatedAt: string;
  source?: "file" | "empty";
}
