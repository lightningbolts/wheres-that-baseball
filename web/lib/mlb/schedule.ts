import {
  LIVE_GAME_STATUSES,
  TRACKED_GAME_STATUSES,
  type ActiveGame,
  type MLBScheduleGame,
  type MLBScheduleResponse,
} from "@/types/mlb";

const MLB_SCHEDULE_BASE = "https://statsapi.mlb.com/api/v1";

/** MLB schedule dates use US Eastern (league local) calendar days. */
export function getMLBScheduleDate(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
  }).format(date);
}

/** Browser-local calendar date (YYYY-MM-DD) for history browsing defaults. */
export function getLocalCalendarDate(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA").format(date);
}

export function addScheduleDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day));
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

const CARRYOVER_STATUSES = new Set([
  "Live",
  "In Progress",
  "Warmup",
  "Pre-Game",
  "Delayed",
]);

/** Preview games only appear when first pitch is within this window. */
const PREVIEW_WINDOW_MS = 4 * 60 * 60 * 1000;

function toActiveGame(game: MLBScheduleGame): ActiveGame {
  const away = game.teams.away.team.name;
  const home = game.teams.home.team.name;

  return {
    gamePk: game.gamePk,
    awayTeam: away,
    homeTeam: home,
    label: `${away} @ ${home}`,
    status: game.status.abstractGameState,
    gameDate: game.gameDate,
  };
}

function statusRank(status: string): number {
  if (LIVE_GAME_STATUSES.has(status)) return 0;
  if (status === "Warmup" || status === "Pre-Game") return 1;
  if (status === "Preview") return 2;
  if (status === "Delayed") return 3;
  return 4;
}

function sortGames(a: ActiveGame, b: ActiveGame): number {
  const rankDiff = statusRank(a.status) - statusRank(b.status);
  if (rankDiff !== 0) return rankDiff;
  return new Date(a.gameDate).getTime() - new Date(b.gameDate).getTime();
}

function isTrackedNow(game: MLBScheduleGame, now = Date.now()): boolean {
  const status = game.status.abstractGameState;
  if (!TRACKED_GAME_STATUSES.has(status)) return false;
  if (LIVE_GAME_STATUSES.has(status)) return true;
  if (status === "Warmup" || status === "Pre-Game" || status === "Delayed") return true;

  if (status === "Preview") {
    const startMs = new Date(game.gameDate).getTime();
    return startMs - now <= PREVIEW_WINDOW_MS;
  }

  return false;
}

async function fetchScheduleForDate(date: string): Promise<MLBScheduleGame[]> {
  const url = new URL(`${MLB_SCHEDULE_BASE}/schedule`);
  url.searchParams.set("sportId", "1");
  url.searchParams.set("date", date);
  url.searchParams.set("gameTypes", "R");

  const response = await fetch(url.toString(), {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`MLB schedule request failed: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as MLBScheduleResponse;
  return data.dates?.flatMap((d) => d.games ?? []) ?? [];
}

/**
 * Fetches today's regular-season schedule and returns games that are live
 * or about to start. Includes carryover west-coast games from yesterday's ET
 * slate after midnight Eastern, and hides Preview games far in the future.
 */
export async function fetchActiveGames(scheduleDate?: string): Promise<ActiveGame[]> {
  const date = scheduleDate ?? getMLBScheduleDate();
  const prevDate = addScheduleDays(date, -1);

  const [todayGames, yesterdayGames] = await Promise.all([
    fetchScheduleForDate(date),
    fetchScheduleForDate(prevDate),
  ]);

  const byPk = new Map<number, MLBScheduleGame>();

  for (const game of yesterdayGames) {
    if (CARRYOVER_STATUSES.has(game.status.abstractGameState)) {
      byPk.set(game.gamePk, game);
    }
  }

  for (const game of todayGames) {
    byPk.set(game.gamePk, game);
  }

  return [...byPk.values()]
    .filter(isTrackedNow)
    .map(toActiveGame)
    .sort(sortGames);
}

/** Returns only game PKs with Live / In Progress status (for ingestor parity). */
export async function fetchLiveGamePks(scheduleDate?: string): Promise<number[]> {
  const games = await fetchActiveGames(scheduleDate);
  return games.filter((g) => LIVE_GAME_STATUSES.has(g.status)).map((g) => g.gamePk);
}

/** Previous calendar day for carryover game queries. */
export function previousScheduleDate(date: string): string {
  return addScheduleDays(date, -1);
}

/** Statuses still active on a prior slate that should appear on the next day. */
export const ACTIVE_CARRYOVER_STATUSES = CARRYOVER_STATUSES;
