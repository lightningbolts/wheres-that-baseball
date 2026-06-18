import { getMLBScheduleDate } from "@/lib/mlb/schedule";
import type { Game } from "@/types/database";

export function getSeasonStartDate(endDate = getMLBScheduleDate()): string {
  const year = endDate.slice(0, 4);
  return `${year}-03-01`;
}

export function formatGameDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

export function formatMatchup(game: Game): string {
  return `${game.away_team_abbrev} @ ${game.home_team_abbrev}`;
}

export function formatScore(game: Game): string | null {
  if (game.away_score == null || game.home_score == null) return null;
  return `${game.away_score} – ${game.home_score}`;
}

export function isLiveStatus(status: string): boolean {
  return status === "Live" || status === "In Progress";
}

/** MLB statuses that mean the game definitely has not begun yet. */
export function isExplicitlyNotStarted(status: string | null | undefined): boolean {
  const normalized = (status ?? "").trim().toLowerCase();
  return (
    normalized === "preview" ||
    normalized === "scheduled" ||
    normalized === "pre-game" ||
    normalized === "pregame" ||
    normalized === "warmup"
  );
}

/** Games with play-by-play replay (completed or in progress). */
export function isReplayableGame(game: Pick<Game, "status">): boolean {
  const status = (game.status ?? "").trim();
  if (!status) return false;
  return status === "Final" || isLiveStatus(status);
}

export function gameStatusLabel(game: Game): string {
  if (isLiveStatus(game.status)) return "Live";
  return game.status_detail ?? game.status;
}
