import { isGameBoxScore, parseBoxScore } from "@/lib/mlb/boxScore";
import { isMlbFeedWrapper, isParsedStateWrapper } from "@/lib/games/gameStorage";
import { parseLiveFeed } from "@/lib/mlb/liveFeed";
import type { GameBoxScore } from "@/types/mlb-boxscore";
import type { LiveGameState } from "@/types/mlb-live";

export { isMlbFeedWrapper, isParsedStateWrapper };

/** Validates and normalizes game_state JSON from Supabase. */
export function parseStoredGameState(raw: unknown, gamePk: number): LiveGameState | null {
  if (
    raw != null &&
    typeof raw === "object" &&
    "parsed" in raw &&
    typeof (raw as { parsed: unknown }).parsed === "object" &&
    (raw as { parsed: unknown }).parsed != null
  ) {
    const state = (raw as { parsed: LiveGameState }).parsed;
    return state.gamePk === gamePk ? state : { ...state, gamePk };
  }

  if (isMlbFeedWrapper(raw)) {
    return parseLiveFeed(gamePk, raw.mlbFeed);
  }

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
