import { isMlbFeedWrapper, isParsedStateWrapper } from "@/lib/games/gameState";
import { storedGameStatePlayCount } from "@/lib/games/gameStorage";
import type { Game } from "@/types/database";
import { getMLBScheduleDate } from "@/lib/mlb/schedule";

/** Minimum play count expected in a completed nine-inning game feed. */
const MIN_FINAL_PLAYS = 15;

export type FeedCheckRow = Pick<
  Game,
  "status" | "away_score" | "home_score" | "feed_synced_at" | "game_state" | "game_date"
>;

/** Past slates with a cached feed can be served without re-validating against MLB. */
export function isSettledArchiveDate(gameDate: string): boolean {
  return gameDate < getMLBScheduleDate();
}

/** True when Supabase holds a complete final-game feed suitable for replay. */
export function isStoredFeedComplete(row: FeedCheckRow | null | undefined): boolean {
  if (!row || row.status !== "Final") return false;
  if (!row.feed_synced_at) return false;
  if (!isParsedStateWrapper(row.game_state) && !isMlbFeedWrapper(row.game_state)) {
    return false;
  }

  if (isParsedStateWrapper(row.game_state)) {
    const state = row.game_state.parsed;
    if (state.gameStatus !== "Final") return false;
    if (row.away_score != null && state.awayRuns !== row.away_score) return false;
    if (row.home_score != null && state.homeRuns !== row.home_score) return false;
    return state.plays.length >= MIN_FINAL_PLAYS;
  }

  const feed = row.game_state.mlbFeed;
  const feedStatus = feed.gameData?.status?.abstractGameState;
  if (feedStatus !== "Final") return false;

  const awayRuns = feed.liveData?.linescore?.teams?.away?.runs;
  const homeRuns = feed.liveData?.linescore?.teams?.home?.runs;

  if (row.away_score != null && awayRuns != null && awayRuns !== row.away_score) {
    return false;
  }
  if (row.home_score != null && homeRuns != null && homeRuns !== row.home_score) {
    return false;
  }

  return storedGameStatePlayCount(row.game_state) >= MIN_FINAL_PLAYS;
}
