import { isMlbFeedWrapper } from "@/lib/games/gameState";
import type { Game } from "@/types/database";

/** Minimum play count expected in a completed nine-inning game feed. */
const MIN_FINAL_PLAYS = 15;

export type FeedCheckRow = Pick<
  Game,
  "status" | "away_score" | "home_score" | "feed_synced_at" | "game_state"
>;

/** True when Supabase holds a complete final-game MLB feed suitable for replay. */
export function isStoredFeedComplete(row: FeedCheckRow | null | undefined): boolean {
  if (!row || row.status !== "Final") return false;
  if (!row.feed_synced_at || !isMlbFeedWrapper(row.game_state)) return false;

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

  const plays = feed.liveData?.plays?.allPlays ?? [];
  if (plays.length < MIN_FINAL_PLAYS) return false;

  return true;
}
