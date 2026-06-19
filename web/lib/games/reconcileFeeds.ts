import { archiveFinishedGame } from "@/lib/games/archiveGame";
import { isStoredFeedComplete } from "@/lib/games/feedComplete";
import { getServiceSupabase } from "@/lib/games/supabaseAdmin";
import type { Game } from "@/types/database";

/** Re-archive one final game from MLB when the stored feed is missing or stale. */
export async function reconcileFinalGameFeed(
  gamePk: number,
  options?: { maxAttempts?: number; retryDelayMs?: number },
): Promise<void> {
  const supabase = getServiceSupabase();
  if (supabase) {
    const { data } = await supabase
      .from("games")
      .select("status, away_score, home_score, feed_synced_at, game_state")
      .eq("game_pk", gamePk)
      .maybeSingle();

    if (isStoredFeedComplete(data as Parameters<typeof isStoredFeedComplete>[0])) {
      return;
    }
  }

  await archiveFinishedGame(gamePk, {
    maxAttempts: options?.maxAttempts ?? 3,
    retryDelayMs: options?.retryDelayMs ?? 8_000,
    force: true,
  });
}

/** Background refresh for final games on a slate (skips feeds already complete). */
export async function reconcileFinalFeedsForGames(
  games: Pick<Game, "game_pk" | "status">[],
): Promise<void> {
  const finalPks = games.filter((g) => g.status === "Final").map((g) => g.game_pk);
  if (finalPks.length === 0) return;

  const concurrency = 3;
  for (let i = 0; i < finalPks.length; i += concurrency) {
    const batch = finalPks.slice(i, i + concurrency);
    await Promise.all(
      batch.map((gamePk) =>
        reconcileFinalGameFeed(gamePk).catch((error) => {
          console.warn(`reconcile feed ${gamePk} failed:`, error);
        }),
      ),
    );
  }
}
