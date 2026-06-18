import { archiveFinishedGame } from "@/lib/games/archiveGame";
import type { MLBLiveFeedResponse } from "@/types/mlb-live";

/** Backfill or refresh a stored game feed (upserts when the row is missing). */
export async function persistGameFeedCache(
  gamePk: number,
  feed: MLBLiveFeedResponse,
): Promise<void> {
  const status = feed.gameData.status.abstractGameState;
  if (status !== "Final") return;

  const result = await archiveFinishedGame(gamePk, { maxAttempts: 1 });
  if (!result.archived && result.reason !== "already archived") {
    console.warn(`Failed to persist feed cache for game ${gamePk}:`, result.reason);
  }
}
