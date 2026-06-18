import { createClient } from "@supabase/supabase-js";

import { parseBoxScore } from "@/lib/mlb/boxScore";
import { parseLiveFeed, wrapMlbFeedForStorage } from "@/lib/mlb/liveFeed";
import type { MLBLiveFeedResponse } from "@/types/mlb-live";

/** Persist raw MLB feed so future loads re-parse with the latest play-by-play logic. */
export async function persistGameFeedCache(
  gamePk: number,
  feed: MLBLiveFeedResponse,
): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return;

  const gameState = parseLiveFeed(gamePk, feed);
  const boxScore = parseBoxScore(gamePk, feed);
  const syncedAt = new Date().toISOString();

  const supabase = createClient(url, key);
  const { error } = await supabase
    .from("games")
    .update({
      game_state: wrapMlbFeedForStorage(feed),
      box_score: boxScore,
      feed_synced_at: syncedAt,
      away_score: gameState.awayRuns,
      home_score: gameState.homeRuns,
      status: gameState.gameStatus,
      venue_id: gameState.venueId,
      venue_name: gameState.venueName,
      updated_at: syncedAt,
    })
    .eq("game_pk", gamePk);

  if (error) {
    console.warn(`Failed to persist feed cache for game ${gamePk}:`, error.message);
  }
}
