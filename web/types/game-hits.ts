import type { HitType } from "@/lib/mlb/gameHits";
import type { HitData, PlayDetail } from "@/types/mlb-live";

/** Row from the `game_hits` table. */
export interface GameHitRow {
  game_pk: number;
  at_bat_index: number;
  season: number;
  game_date: string;
  venue_id: number;
  away_team_abbrev: string;
  home_team_abbrev: string;
  batter_name: string;
  event: HitType;
  inning: number;
  half_inning: string;
  away_score: number;
  home_score: number;
  hit_data: HitData;
  play_detail: PlayDetail;
  synced_at?: string;
}
