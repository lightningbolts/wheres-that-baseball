/**
 * Scheduled MLB schedule + final-game feed sync (invoked by pg_cron via pg_net).
 *
 * Deploy: supabase functions deploy sync-schedule
 * Secrets are injected automatically (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const MLB_SCHEDULE_BASE = "https://statsapi.mlb.com/api/v1";
const MLB_FEED_BASE = "https://statsapi.mlb.com/api/v1.1";
const MLB_TIME_ZONE = "America/New_York";
const SCHEDULE_HYDRATE = "team,linescore,venue";
const DEFAULT_DAYS = 7;
const FEED_BATCH_LIMIT = 15;
const FEED_CONCURRENCY = 3;

interface ScheduleApiGame {
  gamePk: number;
  gameDate: string;
  season: string;
  gameType?: string;
  officialDate?: string;
  status?: { abstractGameState?: string; detailedState?: string };
  teams: {
    away: { team: { id: number; name: string; abbreviation: string }; score?: number };
    home: { team: { id: number; name: string; abbreviation: string }; score?: number };
  };
  venue?: { id?: number; name?: string };
}

interface GameRow {
  game_pk: number;
  game_date: string;
  season: number;
  game_type: string;
  status: string;
  status_detail: string | null;
  away_team_id: number;
  away_team_name: string;
  away_team_abbrev: string;
  home_team_id: number;
  home_team_name: string;
  home_team_abbrev: string;
  away_score: number | null;
  home_score: number | null;
  venue_id: number | null;
  venue_name: string | null;
  official_date: string;
}

function getMlbScheduleDate(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: MLB_TIME_ZONE }).format(date);
}

function addScheduleDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day));
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function recentScheduleDates(date: string, days: number): string[] {
  const count = Math.max(1, days);
  const dates: string[] = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    dates.push(addScheduleDays(date, -offset));
  }
  return dates;
}

function mapScheduleGameToRow(game: ScheduleApiGame): GameRow {
  const gameDate = game.officialDate ?? game.gameDate?.slice(0, 10) ?? getMlbScheduleDate();
  return {
    game_pk: game.gamePk,
    game_date: gameDate,
    season: Number.parseInt(game.season, 10),
    game_type: game.gameType ?? "R",
    status: game.status?.abstractGameState ?? "Unknown",
    status_detail: game.status?.detailedState ?? null,
    away_team_id: game.teams.away.team.id,
    away_team_name: game.teams.away.team.name,
    away_team_abbrev: game.teams.away.team.abbreviation,
    home_team_id: game.teams.home.team.id,
    home_team_name: game.teams.home.team.name,
    home_team_abbrev: game.teams.home.team.abbreviation,
    away_score: game.teams.away.score ?? null,
    home_score: game.teams.home.score ?? null,
    venue_id: game.venue?.id ?? null,
    venue_name: game.venue?.name ?? null,
    official_date: game.officialDate ?? gameDate,
  };
}

async function fetchScheduleForDate(date: string): Promise<ScheduleApiGame[]> {
  const url = new URL(`${MLB_SCHEDULE_BASE}/schedule`);
  url.searchParams.set("sportId", "1");
  url.searchParams.set("date", date);
  url.searchParams.set("gameTypes", "R");
  url.searchParams.set("hydrate", SCHEDULE_HYDRATE);

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`MLB schedule failed: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as { dates?: Array<{ games?: ScheduleApiGame[] }> };
  return data.dates?.flatMap((day) => day.games ?? []) ?? [];
}

function isFeedComplete(row: {
  status: string;
  feed_synced_at: string | null;
  game_state: unknown;
  away_score: number | null;
  home_score: number | null;
}): boolean {
  if (row.status !== "Final" || !row.feed_synced_at) return false;
  if (!row.game_state || typeof row.game_state !== "object") return false;

  const wrapper = row.game_state as { mlbFeed?: Record<string, unknown> };
  const feed = wrapper.mlbFeed;
  if (!feed) return false;

  const gameData = feed.gameData as { status?: { abstractGameState?: string } } | undefined;
  if (gameData?.status?.abstractGameState !== "Final") return false;

  const linescore = (feed.liveData as {
    linescore?: { teams?: { away?: { runs?: number }; home?: { runs?: number } } };
  })?.linescore?.teams;

  if (row.away_score != null && linescore?.away?.runs != null && linescore.away.runs !== row.away_score) {
    return false;
  }
  if (row.home_score != null && linescore?.home?.runs != null && linescore.home.runs !== row.home_score) {
    return false;
  }

  const plays = (feed.liveData as { plays?: { allPlays?: unknown[] } })?.plays?.allPlays ?? [];
  return plays.length >= 15;
}

async function cacheFinalGameFeed(
  supabase: ReturnType<typeof createClient>,
  gamePk: number,
): Promise<boolean> {
  const response = await fetch(`${MLB_FEED_BASE}/game/${gamePk}/feed/live`);
  if (!response.ok) {
    console.warn(`feed fetch failed for ${gamePk}: ${response.status}`);
    return false;
  }

  const raw = await response.json();
  const status = (raw as { gameData?: { status?: { abstractGameState?: string } } }).gameData?.status
    ?.abstractGameState;
  if (status !== "Final") return false;

  const linescore = (raw as {
    liveData?: { linescore?: { teams?: { away?: { runs?: number }; home?: { runs?: number } } } };
  }).liveData?.linescore?.teams;

  const syncedAt = new Date().toISOString();
  const { error } = await supabase
    .from("games")
    .update({
      game_state: { mlbFeed: raw },
      status,
      away_score: linescore?.away?.runs ?? null,
      home_score: linescore?.home?.runs ?? null,
      feed_synced_at: syncedAt,
      updated_at: syncedAt,
    })
    .eq("game_pk", gamePk);

  if (error) {
    console.warn(`feed persist failed for ${gamePk}: ${error.message}`);
    return false;
  }

  return true;
}

async function reconcileFeeds(
  supabase: ReturnType<typeof createClient>,
  gamePks: number[],
): Promise<number> {
  let archived = 0;
  for (let i = 0; i < gamePks.length; i += FEED_CONCURRENCY) {
    const batch = gamePks.slice(i, i + FEED_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (gamePk) => {
        const { data } = await supabase
          .from("games")
          .select("game_pk, status, away_score, home_score, feed_synced_at, game_state")
          .eq("game_pk", gamePk)
          .maybeSingle();

        if (data && isFeedComplete(data)) return false;
        return cacheFinalGameFeed(supabase, gamePk);
      }),
    );
    archived += results.filter(Boolean).length;
  }
  return archived;
}

async function syncRecentScheduleAndFeeds(days = DEFAULT_DAYS) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const today = getMlbScheduleDate();
  const dates = recentScheduleDates(today, days);

  const byPk = new Map<number, GameRow>();
  for (const date of dates) {
    const games = await fetchScheduleForDate(date);
    for (const game of games) {
      byPk.set(game.gamePk, mapScheduleGameToRow(game));
    }
  }

  const rows = [...byPk.values()];
  const syncedAt = new Date().toISOString();
  const payload = rows.map((row) => ({ ...row, updated_at: syncedAt }));

  if (payload.length > 0) {
    const { error } = await supabase.from("games").upsert(payload, { onConflict: "game_pk" });
    if (error) throw new Error(`schedule upsert failed: ${error.message}`);
  }

  const finalGamesSeen = rows.filter((row) => row.status === "Final").length;

  const { data: pendingRows, error: pendingError } = await supabase
    .from("games")
    .select("game_pk, status, away_score, home_score, feed_synced_at, game_state")
    .eq("status", "Final")
    .gte("game_date", dates[0])
    .is("feed_synced_at", null)
    .order("game_date", { ascending: true })
    .limit(FEED_BATCH_LIMIT);

  if (pendingError) {
    console.warn("pending feed query failed:", pendingError.message);
  }

  const feedTargets = (pendingRows ?? []).map((row) => row.game_pk);
  const feedsArchived = await reconcileFeeds(supabase, feedTargets);

  return {
    ok: true,
    synced: payload.length,
    dates,
    finalGamesSeen,
    feedsArchived,
    feedTargets: feedTargets.length,
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST" && req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  try {
    const result = await syncRecentScheduleAndFeeds();
    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Schedule sync failed";
    console.error(message);
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
});
