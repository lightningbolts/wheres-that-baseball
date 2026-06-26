import {
  formatPitchHand,
  formatSeasonPitcherLine,
} from "@/lib/mlb/cardPitchers";
import {
  LIVE_GAME_STATUSES,
  TRACKED_GAME_STATUSES,
  type ActiveGame,
  type CardPitcher,
  type MLBScheduleGame,
  type MLBScheduleResponse,
  type SlateGame,
} from "@/types/mlb";

import { cachedScheduleFetch } from "@/lib/mlb/scheduleCache";

const MLB_SCHEDULE_BASE = "https://statsapi.mlb.com/api/v1";
const MLB_TIME_ZONE = "America/New_York";

/** MLB schedule dates use US Eastern (league local) calendar days. */
export function getMLBScheduleDate(date = new Date()): string {
  return getCalendarDateInTimeZone(date, MLB_TIME_ZONE);
}

/** Calendar date (YYYY-MM-DD) in an IANA timezone. */
export function getCalendarDateInTimeZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(date);
}

/** Browser-local calendar date (YYYY-MM-DD) for history browsing defaults. */
export function getLocalCalendarDate(date = new Date()): string {
  return getCalendarDateInTimeZone(date, getBrowserTimeZone());
}

/** Resolved browser IANA timezone (client-only; falls back to Eastern on the server). */
export function getBrowserTimeZone(): string {
  if (typeof Intl === "undefined") return MLB_TIME_ZONE;
  return Intl.DateTimeFormat().resolvedOptions().timeZone || MLB_TIME_ZONE;
}

/** Which local calendar day a scheduled first pitch falls on. */
export function gameLocalCalendarDate(gameDateIso: string, timeZone: string): string {
  return getCalendarDateInTimeZone(new Date(gameDateIso), timeZone);
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

function toSlateGame(
  game: MLBScheduleGame,
  pitcherStats: Map<number, PitcherSeasonSnapshot>,
): SlateGame {
  const base = toActiveGame(game);
  const linescore = game.linescore;
  const awayTeam = game.teams.away;
  const homeTeam = game.teams.home;

  return {
    ...base,
    awayAbbrev:
      awayTeam.team.abbreviation ?? awayTeam.team.name.slice(0, 3).toUpperCase(),
    homeAbbrev:
      homeTeam.team.abbreviation ?? homeTeam.team.name.slice(0, 3).toUpperCase(),
    awayScore: awayTeam.score ?? linescore?.teams?.away?.runs ?? null,
    homeScore: homeTeam.score ?? linescore?.teams?.home?.runs ?? null,
    awayHits: linescore?.teams?.away?.hits ?? null,
    homeHits: linescore?.teams?.home?.hits ?? null,
    awayErrors: linescore?.teams?.away?.errors ?? null,
    homeErrors: linescore?.teams?.home?.errors ?? null,
    currentInning: linescore?.currentInning ?? null,
    inningHalf: linescore?.inningHalf ?? linescore?.inningState ?? null,
    inningState: linescore?.inningState ?? null,
    awayPitcher: probableCardPitcher(awayTeam.probablePitcher, pitcherStats),
    homePitcher: probableCardPitcher(homeTeam.probablePitcher, pitcherStats),
  };
}

interface PitcherSeasonSnapshot {
  throwHand: string | null;
  wins: number | null;
  losses: number | null;
  era: string | null;
}

function probableCardPitcher(
  probable: MLBScheduleGame["teams"]["away"]["probablePitcher"],
  stats: Map<number, PitcherSeasonSnapshot>,
): CardPitcher | null {
  const playerId = probable?.id;
  const name = probable?.fullName?.trim();
  if (!playerId || !name) return null;

  const season = stats.get(playerId);
  const throwHand =
    formatPitchHand(probable?.pitchHand?.code) ?? season?.throwHand ?? null;

  return {
    playerId,
    name,
    throwHand,
    line: formatSeasonPitcherLine(
      season?.wins ?? null,
      season?.losses ?? null,
      season?.era ?? null,
    ),
  };
}

async function fetchPitcherSeasonStats(
  personIds: number[],
): Promise<Map<number, PitcherSeasonSnapshot>> {
  const unique = [...new Set(personIds.filter((id) => id > 0))];
  if (unique.length === 0) return new Map();

  const url = new URL(`${MLB_SCHEDULE_BASE}/people`);
  url.searchParams.set("personIds", unique.join(","));
  url.searchParams.set("hydrate", "stats(group=pitching,type=season)");

  const response = await fetch(url.toString(), { cache: "no-store" });
  if (!response.ok) return new Map();

  const data = (await response.json()) as {
    people?: Array<{
      id?: number;
      pitchHand?: { code?: string };
      stats?: Array<{
        splits?: Array<{ stat?: { wins?: number; losses?: number; era?: string } }>;
      }>;
    }>;
  };

  const result = new Map<number, PitcherSeasonSnapshot>();
  for (const person of data.people ?? []) {
    if (!person.id) continue;
    const stat = person.stats?.[0]?.splits?.[0]?.stat;
    result.set(person.id, {
      throwHand: formatPitchHand(person.pitchHand?.code),
      wins: stat?.wins ?? null,
      losses: stat?.losses ?? null,
      era: stat?.era ?? null,
    });
  }

  return result;
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

function isTrackedNow(
  game: MLBScheduleGame,
  options: {
    now?: number;
    localToday?: string;
    timeZone?: string;
    isTodaySlate?: boolean;
  } = {},
): boolean {
  const {
    now = Date.now(),
    localToday,
    timeZone = MLB_TIME_ZONE,
    isTodaySlate = true,
  } = options;
  const status = game.status.abstractGameState;
  if (!TRACKED_GAME_STATUSES.has(status)) return false;

  if (localToday) {
    const gameDay = gameLocalCalendarDate(game.gameDate, timeZone);
    const prevLocalDay = addScheduleDays(localToday, -1);
    const isLocalToday = gameDay === localToday;
    const isPrevLocalCarryover = gameDay === prevLocalDay;

    if (LIVE_GAME_STATUSES.has(status)) {
      return isLocalToday || isPrevLocalCarryover;
    }
    if (status === "Warmup" || status === "Pre-Game" || status === "Delayed") {
      return isLocalToday || isPrevLocalCarryover;
    }
    if (status === "Preview") {
      return isLocalToday;
    }
    return false;
  }

  if (LIVE_GAME_STATUSES.has(status)) return true;
  if (status === "Warmup" || status === "Pre-Game" || status === "Delayed") return true;

  if (status === "Preview") {
    // Legacy ET-slate path: today's full slate is always visible; only apply the
    // preview window to carryover games from yesterday's ET date.
    if (isTodaySlate) return true;
    const startMs = new Date(game.gameDate).getTime();
    return startMs - now <= PREVIEW_WINDOW_MS;
  }

  return false;
}

async function fetchScheduleForDate(date: string): Promise<MLBScheduleGame[]> {
  return cachedScheduleFetch(`schedule:${date}`, async () => {
    const url = new URL(`${MLB_SCHEDULE_BASE}/schedule`);
    url.searchParams.set("sportId", "1");
    url.searchParams.set("date", date);
    url.searchParams.set("gameTypes", "R");
    url.searchParams.set("hydrate", "probablePitcher,linescore,team");

    const response = await fetch(url.toString(), {
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`MLB schedule request failed: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as MLBScheduleResponse;
    return data.dates?.flatMap((d) => d.games ?? []) ?? [];
  });
}

/**
 * Fetches today's regular-season schedule and returns games that are live
 * or about to start. Includes carryover west-coast games from yesterday's ET
 * slate after midnight Eastern, and hides Preview games far in the future.
 */
export async function fetchActiveGames(scheduleDate?: string): Promise<ActiveGame[]> {
  const slate = await fetchSlateGames(scheduleDate);
  return slate;
}

/** Today's slate with linescore summary for game cards. */
export async function fetchSlateGames(
  scheduleDate?: string,
  timeZone?: string,
): Promise<SlateGame[]> {
  const tz = timeZone ?? MLB_TIME_ZONE;
  const localToday = scheduleDate ?? getCalendarDateInTimeZone(new Date(), tz);
  const etToday = getMLBScheduleDate();
  const etDates = [
    addScheduleDays(etToday, -1),
    etToday,
    addScheduleDays(etToday, 1),
  ];

  const byPk = new Map<number, MLBScheduleGame>();
  const slateBatches = await Promise.all(etDates.map((date) => fetchScheduleForDate(date)));
  for (const batch of slateBatches) {
    for (const game of batch) {
      byPk.set(game.gamePk, game);
    }
  }

  const tracked = [...byPk.values()].filter((game) =>
    isTrackedNow(game, { localToday, timeZone: tz }),
  );

  const probableIds = tracked.flatMap((game) => [
    game.teams.away.probablePitcher?.id ?? 0,
    game.teams.home.probablePitcher?.id ?? 0,
  ]);
  const pitcherStats = await fetchPitcherSeasonStats(probableIds);

  return tracked.map((game) => toSlateGame(game, pitcherStats)).sort(sortGames);
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

/** Build a Season History URL that preserves browse position. */
export function buildSeasonHistoryHref(options: {
  date?: string;
  view?: "date" | "team";
  teamId?: number | null;
}): string {
  const params = new URLSearchParams();
  if (options.view === "team" && options.teamId) {
    params.set("teamId", String(options.teamId));
    params.set("view", "team");
  } else if (options.date) {
    params.set("date", options.date);
    params.set("view", "date");
  }
  const qs = params.toString();
  return qs ? `/games?${qs}` : "/games";
}

/** Build a game detail URL that carries Season History context for back navigation. */
export function buildGameDetailHref(
  gamePk: number,
  history?: { date?: string; view?: "date" | "team"; teamId?: number | null },
): string {
  const params = new URLSearchParams();
  if (history?.view === "team" && history.teamId) {
    params.set("teamId", String(history.teamId));
    params.set("view", "team");
  } else if (history?.date) {
    params.set("date", history.date);
    params.set("view", "date");
  }
  const qs = params.toString();
  return qs ? `/games/${gamePk}?${qs}` : `/games/${gamePk}`;
}
