import {
  fetchScheduleGamesRawForDate,
  mapScheduleGameToRow,
  type GameScheduleRow,
} from "@/lib/games/scheduleRow";
import { getServiceSupabase } from "@/lib/games/supabaseAdmin";
import {
  reconcileFinalFeedsForGames,
  reconcileMissingFeedsSince,
} from "@/lib/games/reconcileFeeds";
import {
  ACTIVE_CARRYOVER_STATUSES,
  addScheduleDays,
  gameLocalCalendarDate,
  getBrowserTimeZone,
  getCalendarDateInTimeZone,
  getMLBScheduleDate,
  previousScheduleDate,
  recentScheduleDates,
} from "@/lib/mlb/schedule";
import { GAME_LIST_COLUMNS, type Game } from "@/types/database";

type DbOverlay = Pick<Game, "game_pk" | "feed_synced_at" | "updated_at">;

function toListGame(row: GameScheduleRow, overlay?: DbOverlay): Game {
  const now = new Date().toISOString();
  return {
    ...row,
    game_state: null,
    box_score: null,
    feed_synced_at: overlay?.feed_synced_at ?? null,
    updated_at: overlay?.updated_at ?? now,
  };
}

async function fetchDbOverlays(gamePks: number[]): Promise<Map<number, DbOverlay>> {
  const map = new Map<number, DbOverlay>();
  if (gamePks.length === 0) return map;

  const supabase = getServiceSupabase();
  if (!supabase) return map;

  const { data, error } = await supabase
    .from("games")
    .select("game_pk, feed_synced_at, updated_at")
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

/** MLB schedule for a browse date, including carryover games still active from the prior day. */
export async function fetchMlbGamesForBrowseDate(
  date: string,
  timeZone?: string,
): Promise<GameScheduleRow[]> {
  const tz = timeZone ?? getBrowserTimeZone();
  const prevLocalDate = previousScheduleDate(date);
  const carryoverStatuses = new Set(ACTIVE_CARRYOVER_STATUSES);

  const candidateDates = [
    previousScheduleDate(date),
    date,
    addScheduleDays(date, 1),
  ];
  const byPk = new Map<number, ReturnType<typeof mapScheduleGameToRow>>();

  const batches = await Promise.all(candidateDates.map((d) => fetchScheduleGamesRawForDate(d)));
  for (const batch of batches) {
    for (const game of batch) {
      const localDate = gameLocalCalendarDate(game.gameDate, tz);
      const status = game.status?.abstractGameState ?? "";
      const onBrowseDay = localDate === date;
      const isCarryover =
        localDate === prevLocalDate && carryoverStatuses.has(status);

      if (onBrowseDay || isCarryover) {
        byPk.set(game.gamePk, mapScheduleGameToRow(game));
      }
    }
  }

  return [...byPk.values()].sort((a, b) =>
    a.away_team_name.localeCompare(b.away_team_name),
  );
}

/** Fast path — historical dates served entirely from Supabase. */
export async function loadHistoricalGamesFromDb(date: string): Promise<Game[]> {
  const supabase = getServiceSupabase();
  if (!supabase) return [];

  const carryoverStatuses = [...ACTIVE_CARRYOVER_STATUSES];
  const prevDate = previousScheduleDate(date);

  const [primaryResult, carryoverResult] = await Promise.all([
    supabase
      .from("games")
      .select(GAME_LIST_COLUMNS)
      .eq("game_date", date)
      .order("away_team_name", { ascending: true }),
    supabase
      .from("games")
      .select(GAME_LIST_COLUMNS)
      .eq("game_date", prevDate)
      .in("status", carryoverStatuses)
      .order("away_team_name", { ascending: true }),
  ]);

  const fetchError = primaryResult.error ?? carryoverResult.error;
  if (fetchError) {
    throw new Error(fetchError.message);
  }

  const byPk = new Map<number, Game>();
  for (const game of (carryoverResult.data ?? []) as Game[]) {
    byPk.set(game.game_pk, game);
  }
  for (const game of (primaryResult.data ?? []) as Game[]) {
    byPk.set(game.game_pk, game);
  }

  return [...byPk.values()].sort((a, b) =>
    a.away_team_name.localeCompare(b.away_team_name),
  );
}

/** Live slate — MLB scores/status merged with lightweight Supabase feed metadata. */
export async function loadGamesForDate(date: string, timeZone?: string): Promise<Game[]> {
  const mlbGames = await fetchMlbGamesForBrowseDate(date, timeZone);
  const overlays = await fetchDbOverlays(mlbGames.map((game) => game.game_pk));
  return mlbGames.map((game) => toListGame(game, overlays.get(game.game_pk)));
}

export function isLiveScheduleDate(date: string, timeZone?: string): boolean {
  const tz = timeZone ?? getBrowserTimeZone();
  return date === getCalendarDateInTimeZone(new Date(), tz);
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
export async function syncScheduleDates(
  dates: string[],
  timeZone?: string,
): Promise<{ synced: number }> {
  const uniqueDates = [...new Set(dates.filter(Boolean))];
  if (uniqueDates.length === 0) return { synced: 0 };

  const byPk = new Map<number, GameScheduleRow>();
  for (const date of uniqueDates) {
    const games = await fetchMlbGamesForBrowseDate(date, timeZone);
    for (const game of games) {
      byPk.set(game.game_pk, game);
    }
  }

  const synced = await upsertScheduleRows([...byPk.values()]);
  return { synced };
}

export interface RecentScheduleSyncResult {
  synced: number;
  dates: string[];
  finalGamesSeen: number;
  missingFeedsReconciled: number;
}

/**
 * Sync recent ET slates into Supabase and archive final-game feeds.
 * Primary scheduler: Supabase pg_cron → sync-schedule Edge Function.
 */
export async function syncRecentScheduleAndFeeds(options?: {
  days?: number;
  feedBatchLimit?: number;
}): Promise<RecentScheduleSyncResult> {
  const days = options?.days ?? 7;
  const feedBatchLimit = options?.feedBatchLimit ?? 20;
  const today = getMLBScheduleDate();
  const dates = recentScheduleDates(today, days);

  const byPk = new Map<number, GameScheduleRow>();
  for (const date of dates) {
    const games = await fetchMlbGamesForBrowseDate(date);
    for (const game of games) {
      byPk.set(game.game_pk, game);
    }
  }

  const synced = await upsertScheduleRows([...byPk.values()]);
  const gamesForFeeds = [...byPk.values()].map((game) => ({
    game_pk: game.game_pk,
    status: game.status,
  }));

  await reconcileFinalFeedsForGames(gamesForFeeds);
  const missingFeedsReconciled = await reconcileMissingFeedsSince(dates[0], feedBatchLimit);

  return {
    synced,
    dates,
    finalGamesSeen: gamesForFeeds.filter((g) => g.status === "Final").length,
    missingFeedsReconciled,
  };
}
