/** MLB Stats API schedule response (subset used by the dashboard). */

/** Pitcher shown on a slate game card. */
export interface CardPitcher {
  playerId: number;
  name: string;
  throwHand: string | null;
  line: string;
}

export interface MLBScheduleTeam {
  team: {
    name: string;
    abbreviation?: string;
  };
  score?: number;
  leagueRecord?: { wins: number; losses: number; pct?: string };
  probablePitcher?: {
    id?: number;
    fullName?: string;
    pitchHand?: { code?: string };
  };
}

export interface MLBScheduleGame {
  gamePk: number;
  gameDate: string;
  gameType?: string;
  seriesDescription?: string;
  gamesInSeries?: number;
  seriesStatus?: {
    result?: string;
  };
  status: {
    abstractGameState: string;
    detailedState?: string;
  };
  teams: {
    away: MLBScheduleTeam;
    home: MLBScheduleTeam;
  };
  linescore?: {
    currentInning?: number;
    inningState?: string;
    inningHalf?: string;
    teams?: {
      away?: { runs?: number; hits?: number; errors?: number };
      home?: { runs?: number; hits?: number; errors?: number };
    };
    innings?: Array<{
      num: number;
      away?: { runs?: number };
      home?: { runs?: number };
    }>;
  };
}

export interface MLBScheduleResponse {
  dates: Array<{
    date: string;
    games: MLBScheduleGame[];
  }>;
}

/** Game row shown in the sidebar and mobile picker. */
export interface ActiveGame {
  gamePk: number;
  awayTeam: string;
  homeTeam: string;
  label: string;
  status: string;
  gameDate: string;
}

/** Extended game row for the live slate cards (includes linescore summary). */
export interface SlateGame extends ActiveGame {
  gameType: string;
  seriesDescription: string | null;
  seriesBestOf: number | null;
  seriesStatus: string | null;
  awayAbbrev: string;
  homeAbbrev: string;
  awayScore: number | null;
  homeScore: number | null;
  awayHits: number | null;
  homeHits: number | null;
  awayErrors: number | null;
  homeErrors: number | null;
  currentInning: number | null;
  inningHalf: string | null;
  inningState: string | null;
  awayPitcher: CardPitcher | null;
  homePitcher: CardPitcher | null;
}

/** Statuses we surface in the active-games list (live first, then upcoming). */
export const TRACKED_GAME_STATUSES = new Set([
  "Live",
  "In Progress",
  "Warmup",
  "Preview",
  "Pre-Game",
  "Delayed",
]);

export const LIVE_GAME_STATUSES = new Set(["Live", "In Progress"]);
