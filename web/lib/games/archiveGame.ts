import { isStoredFeedComplete } from "@/lib/games/feedComplete";
import { isMlbFeedWrapper } from "@/lib/games/gameState";
import { fetchScheduleGameByPk, type GameScheduleRow } from "@/lib/games/scheduleRow";
import { getServiceSupabase } from "@/lib/games/supabaseAdmin";
import { extractVenueHitsFromFeed } from "@/lib/mlb/ballparkHitsAggregate";
import { appendGameHitsToStore } from "@/lib/mlb/ballparkHitsStore";
import { parseBoxScore } from "@/lib/mlb/boxScore";
import { parseLiveFeed, wrapMlbFeedForStorage } from "@/lib/mlb/liveFeed";
import { clearLiveFeedCache, getCachedLiveFeed } from "@/lib/mlb/liveFeedServer";
import type { MLBLiveFeedResponse } from "@/types/mlb-live";

export interface ArchiveGameResult {
  archived: boolean;
  pending?: boolean;
  reason?: string;
  feedSyncedAt?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchFreshFeed(gamePk: number): Promise<MLBLiveFeedResponse> {
  clearLiveFeedCache(gamePk);
  return getCachedLiveFeed(gamePk);
}

function mergeScheduleWithFeed(
  schedule: GameScheduleRow | null,
  gamePk: number,
  feed: MLBLiveFeedResponse,
): GameScheduleRow {
  const parsed = parseLiveFeed(gamePk, feed);
  const teams = feed.gameData.teams;
  const gameDate =
    schedule?.game_date ??
    schedule?.official_date ??
    new Date().toISOString().slice(0, 10);

  return {
    game_pk: gamePk,
    game_date: gameDate,
    season: schedule?.season ?? Number.parseInt(gameDate.slice(0, 4), 10),
    game_type: schedule?.game_type ?? "R",
    status: parsed.gameStatus,
    status_detail: schedule?.status_detail ?? parsed.gameStatus,
    away_team_id: schedule?.away_team_id ?? teams.away.id ?? 0,
    away_team_name: schedule?.away_team_name ?? teams.away.name,
    away_team_abbrev:
      schedule?.away_team_abbrev ?? teams.away.abbreviation ?? teams.away.name.slice(0, 3).toUpperCase(),
    home_team_id: schedule?.home_team_id ?? teams.home.id ?? 0,
    home_team_name: schedule?.home_team_name ?? teams.home.name,
    home_team_abbrev:
      schedule?.home_team_abbrev ?? teams.home.abbreviation ?? teams.home.name.slice(0, 3).toUpperCase(),
    away_score: parsed.awayRuns,
    home_score: parsed.homeRuns,
    venue_id: schedule?.venue_id ?? parsed.venueId,
    venue_name: schedule?.venue_name ?? parsed.venueName,
    official_date: schedule?.official_date ?? gameDate,
  };
}

async function isAlreadyArchived(gamePk: number, force: boolean): Promise<boolean> {
  if (force) return false;

  const supabase = getServiceSupabase();
  if (!supabase) return false;

  const { data } = await supabase
    .from("games")
    .select("status, away_score, home_score, feed_synced_at, game_state")
    .eq("game_pk", gamePk)
    .maybeSingle();

  return isStoredFeedComplete(data as Parameters<typeof isStoredFeedComplete>[0]);
}

async function persistArchivedGame(
  row: GameScheduleRow,
  feed: MLBLiveFeedResponse,
): Promise<string> {
  const supabase = getServiceSupabase();
  if (!supabase) {
    throw new Error("Missing Supabase service credentials for game archive");
  }

  const boxScore = parseBoxScore(row.game_pk, feed);
  const syncedAt = new Date().toISOString();

  const { error } = await supabase.from("games").upsert(
    {
      ...row,
      game_state: wrapMlbFeedForStorage(feed),
      box_score: boxScore,
      feed_synced_at: syncedAt,
      updated_at: syncedAt,
    },
    { onConflict: "game_pk" },
  );

  if (error) {
    throw new Error(error.message);
  }

  try {
    const hits = extractVenueHitsFromFeed(row, feed);
    appendGameHitsToStore(row.season, row, hits);
  } catch (err) {
    console.warn(`append ballpark hits ${row.game_pk} failed:`, err);
  }

  return syncedAt;
}

/**
 * Fetch the MLB live feed and upsert the game into season history with full
 * play-by-play, box score, and final metadata.
 */
export async function archiveFinishedGame(
  gamePk: number,
  options?: { maxAttempts?: number; retryDelayMs?: number; force?: boolean },
): Promise<ArchiveGameResult> {
  if (!Number.isFinite(gamePk) || gamePk <= 0) {
    return { archived: false, reason: "invalid game pk" };
  }

  const force = options?.force ?? false;

  if (await isAlreadyArchived(gamePk, force)) {
    return { archived: true, reason: "already archived" };
  }

  const supabase = getServiceSupabase();
  if (!supabase) {
    return { archived: false, reason: "missing service credentials" };
  }

  const maxAttempts = options?.maxAttempts ?? 1;
  const retryDelayMs = options?.retryDelayMs ?? 12_000;

  let feed: MLBLiveFeedResponse | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    feed = await fetchFreshFeed(gamePk);
    const status = feed.gameData.status.abstractGameState;
    if (status === "Final" || attempt === maxAttempts) {
      break;
    }
    await sleep(retryDelayMs);
  }

  if (!feed) {
    return { archived: false, reason: "failed to fetch feed" };
  }

  const status = feed.gameData.status.abstractGameState;
  if (status !== "Final") {
    return { archived: false, pending: true, reason: `status is ${status}` };
  }

  const schedule = await fetchScheduleGameByPk(gamePk);
  const row = mergeScheduleWithFeed(schedule, gamePk, feed);
  const feedSyncedAt = await persistArchivedGame(row, feed);

  return { archived: true, feedSyncedAt };
}

/** Fire-and-forget archive used by live polling paths. */
export function enqueueArchiveFinishedGame(gamePk: number): void {
  void archiveFinishedGame(gamePk, { maxAttempts: 5, retryDelayMs: 12_000 }).catch((err) => {
    console.warn(`Archive game ${gamePk} failed:`, err);
  });
}
