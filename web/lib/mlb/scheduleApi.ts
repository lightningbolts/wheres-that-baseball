/**
 * Shared MLB Stats API schedule client used by slate UI and DB sync.
 *
 * Contract parity with ingestor (`ingestor/internal/mlb/schedule.go`):
 * - sportId=1, gameTypes=R
 * - hydrate presets documented in SCHEDULE_HYDRATE
 * - officialDate preferred for game_date when present
 */

import { cachedScheduleFetch } from "@/lib/mlb/scheduleCache";
import type { MLBScheduleGame } from "@/types/mlb";

export const MLB_SCHEDULE_BASE = "https://statsapi.mlb.com/api/v1";

/** Hydrate strings aligned with ingestor schedule discovery. */
export const SCHEDULE_HYDRATE = {
  /** Live slate cards — probable pitchers + linescore. */
  slate: "probablePitcher,linescore,team",
  /** DB row upsert — venue + linescore scores. */
  row: "team,linescore,venue",
} as const;

export type ScheduleHydratePreset = keyof typeof SCHEDULE_HYDRATE;

/** Raw game object returned by MLB /schedule (superset for slate + row mappers). */
export interface ScheduleApiRawGame {
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
      probablePitcher?: MLBScheduleGame["teams"]["away"]["probablePitcher"];
    };
    home: {
      team: { id: number; name: string; abbreviation: string };
      score?: number;
      probablePitcher?: MLBScheduleGame["teams"]["home"]["probablePitcher"];
    };
  };
  linescore?: MLBScheduleGame["linescore"];
  venue?: { id?: number; name?: string };
}

function cacheKey(date: string, hydrate: string, suffix = ""): string {
  return `schedule:${hydrate}:${date}${suffix}`;
}

async function fetchScheduleJson(
  params: Record<string, string>,
  cacheKeyValue: string,
): Promise<ScheduleApiRawGame[]> {
  return cachedScheduleFetch(cacheKeyValue, async () => {
    const url = new URL(`${MLB_SCHEDULE_BASE}/schedule`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const response = await fetch(url.toString(), { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`MLB schedule failed: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as {
      dates?: Array<{ games?: ScheduleApiRawGame[] }>;
    };

    return data.dates?.flatMap((day) => day.games ?? []) ?? [];
  });
}

/** Fetch regular-season games for a calendar date with a shared hydrate preset. */
export async function fetchScheduleGamesForDate(
  date: string,
  preset: ScheduleHydratePreset = "row",
): Promise<ScheduleApiRawGame[]> {
  const hydrate = SCHEDULE_HYDRATE[preset];
  return fetchScheduleJson(
    {
      sportId: "1",
      date,
      gameTypes: "R",
      hydrate,
    },
    cacheKey(date, hydrate, `:${preset}`),
  );
}

/** Slate UI — games with probable pitcher + linescore hydrated. */
export async function fetchSlateScheduleGames(date: string): Promise<MLBScheduleGame[]> {
  const games = await fetchScheduleGamesForDate(date, "slate");
  return games.map(toSlateScheduleGame);
}

function toSlateScheduleGame(raw: ScheduleApiRawGame): MLBScheduleGame {
  const status = raw.status?.abstractGameState ?? "Unknown";
  return {
    gamePk: raw.gamePk,
    gameDate: raw.gameDate,
    status: {
      abstractGameState: status,
      detailedState: raw.status?.detailedState,
    },
    teams: {
      away: {
        team: {
          name: raw.teams.away.team.name,
          abbreviation: raw.teams.away.team.abbreviation,
        },
        score: raw.teams.away.score,
        probablePitcher: raw.teams.away.probablePitcher,
      },
      home: {
        team: {
          name: raw.teams.home.team.name,
          abbreviation: raw.teams.home.team.abbreviation,
        },
        score: raw.teams.home.score,
        probablePitcher: raw.teams.home.probablePitcher,
      },
    },
    linescore: raw.linescore,
  };
}

/** Lookup a single game by PK (uncached — used for one-off repair flows). */
export async function fetchScheduleGameByPkRaw(
  gamePk: number,
  preset: ScheduleHydratePreset = "row",
): Promise<ScheduleApiRawGame | null> {
  const hydrate = SCHEDULE_HYDRATE[preset];
  const games = await fetchScheduleJson(
    {
      gamePk: String(gamePk),
      hydrate,
    },
    cacheKey(`pk-${gamePk}`, hydrate),
  );
  return games.find((g) => g.gamePk === gamePk) ?? null;
}
