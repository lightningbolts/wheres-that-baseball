import type { GameHitStats } from "@/lib/mlb/gameHits";
import type { SprayPreviewHit, VenueHit } from "@/lib/mlb/ballparkHits";

export type PlayerProfileRole = "batter" | "pitcher";

export interface PlayerBipIndexEntry {
  playerId: number;
  name: string;
  /** Most recent / modal team abbrev seen on BIP. */
  teamAbbrev: string | null;
  teamId: number | null;
  bipCount: number;
  hitCount: number;
  venueCount: number;
  /** Present on merged search results (batter and/or pitcher indexes). */
  roles?: PlayerProfileRole[];
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

/** Season pitching line from MLB Stats API (official counting stats). */
export interface PlayerPitchingSeasonLine {
  playerId: number;
  season: number;
  name: string | null;
  throwHand: string | null;
  wins: number | null;
  losses: number | null;
  era: string | null;
  /** Fielding Independent Pitching (MLB sabermetrics). */
  fip: string | null;
  /** Expected ERA from Baseball Savant. */
  xEra: string | null;
  /** Expected FIP (MLB sabermetrics). */
  xFip: string | null;
  inningsPitched: string | null;
  strikeOuts: number | null;
  baseOnBalls: number | null;
  homeRuns: number | null;
  whip: string | null;
  hits: number | null;
  earnedRuns: number | null;
  gamesPlayed: number | null;
  gamesStarted: number | null;
  source: "mlb" | "empty";
}
