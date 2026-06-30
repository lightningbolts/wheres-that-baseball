import { parseStoredGameState } from "@/lib/games/gameState";
import type { GameScheduleRow } from "@/lib/games/scheduleRow";
import { getServiceSupabase } from "@/lib/games/supabaseAdmin";
import { extractGameHits } from "@/lib/mlb/gameHits";
import { parseLiveFeed } from "@/lib/mlb/liveFeed";
import type { HitType } from "@/lib/mlb/gameHits";
import type { HitData, MLBLiveFeedResponse, PlayDetail } from "@/types/mlb-live";

export interface GameHitInsertRow {
  game_pk: number;
  at_bat_index: number;
  season: number;
  game_date: string;
  venue_id: number;
  away_team_abbrev: string;
  home_team_abbrev: string;
  batter_name: string;
  event: HitType;
  inning: number;
  half_inning: string;
  away_score: number;
  home_score: number;
  hit_data: HitData;
  play_detail: PlayDetail;
}

function buildHitRows(
  row: Pick<
    GameScheduleRow,
    | "game_pk"
    | "game_date"
    | "season"
    | "venue_id"
    | "away_team_abbrev"
    | "home_team_abbrev"
  >,
  plays: Parameters<typeof extractGameHits>[0],
): GameHitInsertRow[] {
  if (row.venue_id == null) return [];

  return extractGameHits(plays).map((hit) => ({
    game_pk: row.game_pk,
    at_bat_index: hit.atBatIndex,
    season: row.season,
    game_date: row.game_date,
    venue_id: row.venue_id!,
    away_team_abbrev: row.away_team_abbrev,
    home_team_abbrev: row.home_team_abbrev,
    batter_name: hit.batterName,
    event: hit.event,
    inning: hit.inning,
    half_inning: hit.halfInning,
    away_score: hit.awayScore,
    home_score: hit.homeScore,
    hit_data: hit.hit,
    play_detail: hit.detail,
  }));
}

async function replaceGameHits(gamePk: number, rows: GameHitInsertRow[]): Promise<void> {
  const supabase = getServiceSupabase();
  if (!supabase) return;

  const { error: deleteError } = await supabase.from("game_hits").delete().eq("game_pk", gamePk);
  if (deleteError) {
    throw new Error(deleteError.message);
  }

  if (rows.length === 0) return;

  const syncedAt = new Date().toISOString();
  const payload = rows.map((row) => ({ ...row, synced_at: syncedAt }));

  const { error: insertError } = await supabase.from("game_hits").insert(payload);
  if (insertError) {
    throw new Error(insertError.message);
  }
}

/** Extract hits from a live feed and upsert into game_hits (called when archiving). */
export async function syncGameHitsFromFeed(
  row: GameScheduleRow,
  feed: MLBLiveFeedResponse,
): Promise<void> {
  const state = parseLiveFeed(row.game_pk, feed);
  const rows = buildHitRows(row, state.plays);
  await replaceGameHits(row.game_pk, rows);
}

/** Re-index hits for one archived game from stored game_state. */
export async function syncGameHitsFromStoredGame(gamePk: number): Promise<boolean> {
  const supabase = getServiceSupabase();
  if (!supabase) return false;

  const { data, error } = await supabase
    .from("games")
    .select(
      "game_pk, game_date, season, venue_id, away_team_abbrev, home_team_abbrev, game_state, feed_synced_at",
    )
    .eq("game_pk", gamePk)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data?.feed_synced_at || data.venue_id == null || !data.game_state) {
    return false;
  }

  const state = parseStoredGameState(data.game_state, gamePk);
  if (!state?.plays?.length) {
    await replaceGameHits(gamePk, []);
    return true;
  }

  const rows = buildHitRows(
    {
      game_pk: data.game_pk,
      game_date: data.game_date,
      season: data.season,
      venue_id: data.venue_id,
      away_team_abbrev: data.away_team_abbrev,
      home_team_abbrev: data.home_team_abbrev,
    },
    state.plays,
  );

  await replaceGameHits(gamePk, rows);
  return true;
}

/** Backfill hit index for archived games missing rows in game_hits. */
export async function backfillGameHitsBatch(options?: {
  season?: number;
  limit?: number;
}): Promise<{ processed: number; gamePks: number[] }> {
  const supabase = getServiceSupabase();
  if (!supabase) return { processed: 0, gamePks: [] };

  const season = options?.season ?? new Date().getFullYear();
  const limit = options?.limit ?? 20;

  const gamePks = await listGamesMissingHitIndex(supabase, season, limit);
  let processed = 0;

  for (const gamePk of gamePks) {
    try {
      const ok = await syncGameHitsFromStoredGame(gamePk);
      if (ok) processed += 1;
    } catch (err) {
      console.warn(`backfill game_hits ${gamePk} failed:`, err);
    }
  }

  return { processed, gamePks };
}

async function listGamesMissingHitIndex(
  supabase: NonNullable<ReturnType<typeof getServiceSupabase>>,
  season: number,
  limit: number,
): Promise<number[]> {
  const scanBatch = Math.max(limit * 4, 40);
  let offset = 0;
  const missing: number[] = [];

  while (missing.length < limit) {
    const { data: games, error } = await supabase
      .from("games")
      .select("game_pk")
      .eq("season", season)
      .not("feed_synced_at", "is", null)
      .not("venue_id", "is", null)
      .order("game_pk", { ascending: true })
      .range(offset, offset + scanBatch - 1);

    if (error) {
      throw new Error(error.message);
    }

    const candidates = (games ?? []).map((row) => row.game_pk);
    if (candidates.length === 0) {
      break;
    }

    const { data: indexed, error: indexedError } = await supabase
      .from("game_hits")
      .select("game_pk")
      .in("game_pk", candidates);

    if (indexedError) {
      throw new Error(indexedError.message);
    }

    const indexedSet = new Set((indexed ?? []).map((row) => row.game_pk));

    for (const gamePk of candidates) {
      if (!indexedSet.has(gamePk)) {
        missing.push(gamePk);
        if (missing.length >= limit) {
          return missing;
        }
      }
    }

    if (candidates.length < scanBatch) {
      break;
    }

    offset += scanBatch;
  }

  return missing;
}
