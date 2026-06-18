import { isGameBoxScore, parseBoxScore } from "@/lib/mlb/boxScore";
import { normalizePlayByPlay, parseLiveFeed } from "@/lib/mlb/liveFeed";
import type { GameBoxScore } from "@/types/mlb-boxscore";
import type { LiveGameState, MLBLiveFeedResponse, PlayByPlayEntry } from "@/types/mlb-live";

function isMlbFeedWrapper(raw: unknown): raw is { mlbFeed: MLBLiveFeedResponse } {
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

  if (!raw || typeof raw !== "object") return null;

  const state = raw as Record<string, unknown>;
  if (typeof state.gamePk !== "number") {
    state.gamePk = gamePk;
  }

  if (!Array.isArray(state.plays)) return null;

  const plays = state.plays as PlayByPlayEntry[];
  const isLegacyCache = plays.some((play) => play != null && !("isAtBat" in play));
  if (isLegacyCache) {
    // Parsed-only cache from before game-event support — re-fetch from MLB.
    return null;
  }

  return {
    ...(state as unknown as LiveGameState),
    plays: normalizePlayByPlay(plays),
  };
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
