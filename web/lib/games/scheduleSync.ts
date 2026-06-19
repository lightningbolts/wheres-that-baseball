import {
  fetchScheduleGamesForDate,
  type GameScheduleRow,
} from "@/lib/games/scheduleRow";
import { isStoredFeedComplete } from "@/lib/games/feedComplete";
import { getServiceSupabase } from "@/lib/games/supabaseAdmin";
import { ACTIVE_CARRYOVER_STATUSES, previousScheduleDate } from "@/lib/mlb/schedule";
import type { Game } from "@/types/database";

type DbOverlay = Pick<
  Game,
  "game_pk" | "feed_synced_at" | "updated_at" | "status" | "away_score" | "home_score" | "game_state"
>;

function mergeGamesByPk(primary: GameScheduleRow[], secondary: GameScheduleRow[]): GameScheduleRow[] {
  const byPk = new Map<number, GameScheduleRow>();
  for (const game of secondary) {
    byPk.set(game.game_pk, game);
  }
  for (const game of primary) {
    byPk.set(game.game_pk, game);
  }
  return [...byPk.values()].sort((a, b) =>
    a.away_team_name.localeCompare(b.away_team_name),
  );
}

function toListGame(row: GameScheduleRow, overlay?: DbOverlay): Game {
  const now = new Date().toISOString();
  const merged: Game = {
    ...row,
    game_state: overlay?.game_state ?? null,
    box_score: null,
    feed_synced_at: overlay?.feed_synced_at ?? null,
    updated_at: overlay?.updated_at ?? now,
  };

  if (!isStoredFeedComplete(merged)) {
    merged.feed_synced_at = null;
  }

  return {
    ...merged,
    game_state: null,
  };
}

async function fetchDbOverlays(gamePks: number[]): Promise<Map<number, DbOverlay>> {
  const map = new Map<number, DbOverlay>();
  if (gamePks.length === 0) return map;

  const supabase = getServiceSupabase();
  if (!supabase) return map;

  const { data, error } = await supabase
    .from("games")
    .select("game_pk, feed_synced_at, updated_at, status, away_score, home_score, game_state")
    .in("game_pk", gamePks);

  if (error) {
    console.warn("schedule sync: failed to load feed overlays", error.message);
    return map;
  }

  for (const row of data ?? []) {
    map.set(row.game_pk, row as DbOverlay);
  }
  return map;
}

/** MLB schedule for a date, including carryover games still active from the prior ET slate. */
export async function fetchMlbGamesForBrowseDate(date: string): Promise<GameScheduleRow[]> {
  const prevDate = previousScheduleDate(date);
  const carryoverStatuses = new Set(ACTIVE_CARRYOVER_STATUSES);

  const [todayGames, yesterdayGames] = await Promise.all([
    fetchScheduleGamesForDate(date),
    fetchScheduleGamesForDate(prevDate),
  ]);

  const carryover = yesterdayGames.filter((game) => carryoverStatuses.has(game.status));
  return mergeGamesByPk(todayGames, carryover);
}

/** Source-of-truth game list for Season History — MLB scores/status + DB replay metadata. */
export async function loadGamesForDate(date: string): Promise<Game[]> {
  const mlbGames = await fetchMlbGamesForBrowseDate(date);
  const overlays = await fetchDbOverlays(mlbGames.map((game) => game.game_pk));
  return mlbGames.map((game) => toListGame(game, overlays.get(game.game_pk)));
}

/** Upsert schedule metadata without overwriting stored play-by-play or box scores. */
export async function upsertScheduleRows(rows: GameScheduleRow[]): Promise<number> {
  if (rows.length === 0) return 0;

  const supabase = getServiceSupabase();
  if (!supabase) return 0;

  const syncedAt = new Date().toISOString();
  const payload = rows.map((row) => ({
    ...row,
    updated_at: syncedAt,
  }));

  const { error } = await supabase.from("games").upsert(payload, {
    onConflict: "game_pk",
    ignoreDuplicates: false,
  });

  if (error) {
    throw new Error(`schedule upsert failed: ${error.message}`);
  }

  return rows.length;
}

/** Sync one or more calendar dates from MLB into Supabase (metadata only). */
export async function syncScheduleDates(dates: string[]): Promise<{ synced: number }> {
  const uniqueDates = [...new Set(dates.filter(Boolean))];
  if (uniqueDates.length === 0) return { synced: 0 };

  const byPk = new Map<number, GameScheduleRow>();
  for (const date of uniqueDates) {
    const games = await fetchMlbGamesForBrowseDate(date);
    for (const game of games) {
      byPk.set(game.game_pk, game);
    }
  }

  const synced = await upsertScheduleRows([...byPk.values()]);
  return { synced };
}
