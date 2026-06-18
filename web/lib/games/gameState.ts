import { isGameBoxScore, parseBoxScore } from "@/lib/mlb/boxScore";
import { parseLiveFeed } from "@/lib/mlb/liveFeed";
import type { GameBoxScore } from "@/types/mlb-boxscore";
import type { LiveGameState, MLBLiveFeedResponse } from "@/types/mlb-live";

export function isMlbFeedWrapper(raw: unknown): raw is { mlbFeed: MLBLiveFeedResponse } {
  return (
    raw != null &&
    typeof raw === "object" &&
    "mlbFeed" in raw &&
    typeof (raw as { mlbFeed: unknown }).mlbFeed === "object" &&
    (raw as { mlbFeed: unknown }).mlbFeed != null
  );
}

/** Validates and normalizes game_state JSON from Supabase. */
export function parseStoredGameState(raw: unknown, gamePk: number): LiveGameState | null {
  if (isMlbFeedWrapper(raw)) {
    return parseLiveFeed(gamePk, raw.mlbFeed);
  }

  // Parsed-only snapshots omit game events — always re-fetch from MLB.
  return null;
}

/** Validates and normalizes box_score JSON from Supabase. */
export function parseStoredBoxScore(raw: unknown, gamePk: number): GameBoxScore | null {
  if (isMlbFeedWrapper(raw)) {
    return parseBoxScore(gamePk, raw.mlbFeed);
  }

  if (!isGameBoxScore(raw)) return null;

  if (raw.gamePk !== gamePk) {
    return { ...raw, gamePk };
  }

  return raw;
}
