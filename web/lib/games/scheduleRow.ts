import { getMLBScheduleDate } from "@/lib/mlb/schedule";
import type { Game } from "@/types/database";

const MLB_SCHEDULE_BASE = "https://statsapi.mlb.com/api/v1/schedule";

interface ScheduleApiGame {
  gamePk: number;
  gameDate: string;
  season: string;
  gameType?: string;
  officialDate?: string;
  status?: { abstractGameState?: string; detailedState?: string };
  teams: {
    away: {
      team: { id: number; name: string; abbreviation: string };
      score?: number;
    };
    home: {
      team: { id: number; name: string; abbreviation: string };
      score?: number;
    };
  };
  venue?: { id?: number; name?: string };
}

export type ScheduleApiGameRaw = ScheduleApiGame;

/** Schedule metadata for games table upsert (feed fields added at archive time). */
export type GameScheduleRow = Omit<Game, "game_state" | "box_score" | "feed_synced_at" | "updated_at">;

export function mapScheduleGameToRow(game: ScheduleApiGame): GameScheduleRow {
  const gameDate = game.officialDate ?? game.gameDate?.slice(0, 10) ?? getMLBScheduleDate();

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

/** All regular-season games on an MLB calendar date (scores + status hydrated). */
export async function fetchScheduleGamesRawForDate(date: string): Promise<ScheduleApiGame[]> {
  const url = new URL(MLB_SCHEDULE_BASE);
  url.searchParams.set("sportId", "1");
  url.searchParams.set("date", date);
  url.searchParams.set("gameTypes", "R");
  url.searchParams.set("hydrate", "team,linescore,venue");

  const response = await fetch(url.toString(), { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`MLB schedule failed: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as {
    dates?: Array<{ games?: ScheduleApiGame[] }>;
  };

  return data.dates?.flatMap((day) => day.games ?? []) ?? [];
}

/** All regular-season games on an MLB calendar date (scores + status hydrated). */
export async function fetchScheduleGamesForDate(date: string): Promise<GameScheduleRow[]> {
  const games = await fetchScheduleGamesRawForDate(date);
  return games.map(mapScheduleGameToRow);
}

export async function fetchScheduleGameByPk(
  gamePk: number,
): Promise<GameScheduleRow | null> {
  const url = new URL(MLB_SCHEDULE_BASE);
  url.searchParams.set("gamePk", String(gamePk));
  url.searchParams.set("hydrate", "team,linescore,venue");

  const response = await fetch(url.toString(), { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`MLB schedule failed: ${response.status}`);
  }

  const data = (await response.json()) as {
    dates?: Array<{ games?: ScheduleApiGame[] }>;
  };

  const game = data.dates?.flatMap((day) => day.games ?? []).find((g) => g.gamePk === gamePk);
  return game ? mapScheduleGameToRow(game) : null;
}
