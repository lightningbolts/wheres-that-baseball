import { reconcileFinalFeedsForGames } from "@/lib/games/reconcileFeeds";
import { syncScheduleDates } from "@/lib/games/scheduleSync";
import type { Game } from "@/types/database";

const DEBOUNCE_MS = 60_000;

let lastRunAt = 0;
let pending: { date: string; timeZone?: string; games: Pick<Game, "game_pk" | "status">[] } | null =
  null;
let timer: ReturnType<typeof setTimeout> | null = null;

async function flush(): Promise<void> {
  const job = pending;
  pending = null;
  timer = null;
  if (!job) return;

  lastRunAt = Date.now();
  await syncScheduleDates([job.date], job.timeZone);
  await reconcileFinalFeedsForGames(job.games);
}

/** Debounce expensive schedule + feed reconciliation on rapid slate polls. */
export function scheduleBackgroundSlateSync(
  date: string,
  games: Pick<Game, "game_pk" | "status">[],
  timeZone?: string,
): void {
  if (Date.now() - lastRunAt < DEBOUNCE_MS) {
    pending = { date, games, timeZone };
    if (timer == null) {
      timer = setTimeout(() => {
        void flush().catch((error) => {
          console.warn("background schedule/feed sync failed", error);
        });
      }, DEBOUNCE_MS);
    }
    return;
  }

  pending = { date, games, timeZone };
  void flush().catch((error) => {
    console.warn("background schedule/feed sync failed", error);
  });
}

/** Test helper — reset debounce state. */
export function resetBackgroundSlateSyncForTest(): void {
  lastRunAt = 0;
  pending = null;
  if (timer != null) {
    clearTimeout(timer);
    timer = null;
  }
}
