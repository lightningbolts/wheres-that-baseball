/**
 * TypeScript definitions mirroring the Supabase `predictions` table schema.
 * JSONB keys use snake_case to match the Go ingestor persistence layer.
 */

import type { GameBoxScore } from "@/types/mlb-boxscore";
import type { LiveGameState } from "@/types/mlb-live";

/** Terminal at-bat outcome probability distribution (sums to ~1.0). */
export interface OutcomeProbabilities {
  strikeout: number;
  walk: number;
  hit_by_pitch: number;
  single: number;
  double: number;
  triple: number;
  home_run: number;
  field_out: number;
  gidp: number;
  sac_fly: number;
  sac_bunt: number;
}

/** Steal attempt/success probabilities for the current base situation. */
export interface StealProbabilities {
  steal_attempt: number;
  steal_success: number;
}

/** A single row from the `predictions` table. */
export interface Prediction {
  id: string;
  game_pk: number;
  timestamp: string;
  batter_name: string;
  pitcher_name: string;
  inning: number;
  balls: number;
  strikes: number;
  outs: number;
  on_first: boolean;
  on_second: boolean;
  on_third: boolean;
  outcome_probabilities: OutcomeProbabilities;
  steal_probabilities?: StealProbabilities | null;
}

/** A single row from the `games` table. */
export interface Game {
  game_pk: number;
  game_date: string;
  season: number;
  game_type: string;
  status: string;
  status_detail: string | null;
  away_team_id: number;
  away_team_name: string;
  away_team_abbrev: string;
  home_team_id: number;
  home_team_name: string;
  home_team_abbrev: string;
  away_score: number | null;
  home_score: number | null;
  venue_id: number | null;
  venue_name: string | null;
  official_date: string | null;
  game_state: LiveGameState | null;
  box_score: GameBoxScore | null;
  feed_synced_at: string | null;
  updated_at: string;
}

/** Columns for list/browse queries — excludes heavy game_state JSONB. */
export const GAME_LIST_COLUMNS =
  "game_pk,game_date,season,game_type,status,status_detail,away_team_id,away_team_name,away_team_abbrev,home_team_id,home_team_name,home_team_abbrev,away_score,home_score,venue_id,venue_name,official_date,feed_synced_at,updated_at" as const;

/** Supabase Database type map for typed client usage. */
export interface Database {
  public: {
    Tables: {
      predictions: {
        Row: Prediction;
        Insert: Omit<Prediction, "id" | "timestamp"> & {
          id?: string;
          timestamp?: string;
        };
        Update: Partial<Prediction>;
        Relationships: [];
      };
      games: {
        Row: Game;
        Insert: Omit<Game, "updated_at"> & { updated_at?: string };
        Update: Partial<Game>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

/** Display-friendly outcome key used in UI components. */
export type OutcomeKey = keyof OutcomeProbabilities;

/** Human-readable labels for each outcome probability key. */
export const OUTCOME_LABELS: Record<OutcomeKey, string> = {
  home_run: "Home Run",
  triple: "Triple",
  double: "Double",
  single: "Single",
  walk: "Walk",
  hit_by_pitch: "HBP",
  field_out: "Field Out",
  gidp: "GIDP",
  sac_fly: "Sac Fly",
  sac_bunt: "Sac Bunt",
  strikeout: "Strikeout",
};

/** Default zeroed probabilities — safe fallback when payload fields are missing. */
export const DEFAULT_OUTCOME_PROBABILITIES: OutcomeProbabilities = {
  strikeout: 0,
  walk: 0,
  hit_by_pitch: 0,
  single: 0,
  double: 0,
  triple: 0,
  home_run: 0,
  field_out: 0,
  gidp: 0,
  sac_fly: 0,
  sac_bunt: 0,
};

/** Display order for the probability matrix (most exciting outcomes first). */
export const OUTCOME_DISPLAY_ORDER: OutcomeKey[] = [
  "home_run",
  "triple",
  "double",
  "single",
  "walk",
  "hit_by_pitch",
  "sac_fly",
  "sac_bunt",
  "gidp",
  "field_out",
  "strikeout",
];

/** Normalize legacy 7-key ingestor payloads into the expanded outcome shape. */
export function normalizeOutcomeProbabilities(
  probs: Partial<OutcomeProbabilities> | Record<string, number> | null | undefined,
): OutcomeProbabilities {
  const base = { ...DEFAULT_OUTCOME_PROBABILITIES };
  if (!probs) return base;
  for (const key of OUTCOME_DISPLAY_ORDER) {
    const value = probs[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      base[key] = value;
    }
  }
  return base;
}
