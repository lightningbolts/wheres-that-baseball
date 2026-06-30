import {
  fetchScheduleGamesForDate as fetchMlbScheduleRaw,
  fetchScheduleGameByPkRaw,
  type ScheduleApiRawGame,
} from "@/lib/mlb/scheduleApi";

import { getMLBScheduleDate } from "@/lib/mlb/schedule";
import type { Game } from "@/types/database";

export type ScheduleApiGameRaw = ScheduleApiRawGame;

/** Schedule metadata for games table upsert (feed fields added at archive time). */
export type GameScheduleRow = Omit<
  Game,
  "game_state" | "box_score" | "feed_synced_at" | "updated_at"
>;

export function mapScheduleGameToRow(game: ScheduleApiRawGame): GameScheduleRow {
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
export async function fetchScheduleGamesRawForDate(date: string): Promise<ScheduleApiRawGame[]> {
  return fetchMlbScheduleRaw(date, "row");
}

/** All regular-season games on an MLB calendar date (scores + status hydrated). */
export async function fetchScheduleGamesForDate(date: string): Promise<GameScheduleRow[]> {
  const games = await fetchScheduleGamesRawForDate(date);
  return games.map(mapScheduleGameToRow);
}

export async function fetchScheduleGameByPk(
  gamePk: number,
): Promise<GameScheduleRow | null> {
  const game = await fetchScheduleGameByPkRaw(gamePk, "row");
  return game ? mapScheduleGameToRow(game) : null;
}
