export interface LineScoreInning {
  num: number;
  awayRuns: number | null;
  homeRuns: number | null;
  /** Home half not played (e.g. walk-off or home team ahead after top 9th). */
  homeSkipped: boolean;
}

export interface LineScoreTeamTotals {
  runs: number;
  hits: number;
  errors: number;
}

export interface LineScore {
  scheduledInnings: number;
  away: LineScoreTeamTotals;
  home: LineScoreTeamTotals;
  innings: LineScoreInning[];
}

export interface BatterBoxLine {
  playerId: number;
  name: string;
  note: string;
  positions: string;
  batSide: string;
  atBats: number;
  runs: number;
  hits: number;
  rbi: number;
  walks: number;
  strikeOuts: number;
  seasonAvg: string;
  seasonOps: string;
}

export interface PitcherBoxLine {
  playerId: number;
  name: string;
  note: string;
  inningsPitched: string;
  hits: number;
  runs: number;
  earnedRuns: number;
  walks: number;
  strikeOuts: number;
  homeRuns: number;
  seasonEra: string;
}

export interface PitchingTotals {
  inningsPitched: string;
  hits: number;
  runs: number;
  earnedRuns: number;
  walks: number;
  strikeOuts: number;
  homeRuns: number;
}

export interface BenchPlayerLine {
  playerId: number;
  name: string;
  batSide: string;
  position: string;
  avg: string;
  games: number;
  runs: number;
  hits: number;
  homeRuns: number;
  rbi: number;
}

export interface BullpenPlayerLine {
  playerId: number;
  name: string;
  throwHand: string;
  era: string;
  inningsPitched: string;
  hits: number;
  walks: number;
  strikeOuts: number;
}

export interface GameInfoItem {
  label: string;
  value: string;
}

export interface PitchingDecisions {
  winner: string | null;
  loser: string | null;
  save: string | null;
}

export interface TeamBoxScore {
  teamId: number;
  abbrev: string;
  name: string;
  batters: BatterBoxLine[];
  pitchers: PitcherBoxLine[];
  pitchingTotals: PitchingTotals | null;
  bench: BenchPlayerLine[];
  bullpen: BullpenPlayerLine[];
}

export interface GameBoxScore {
  gamePk: number;
  awayAbbrev: string;
  homeAbbrev: string;
  lineScore: LineScore;
  away: TeamBoxScore;
  home: TeamBoxScore;
  decisions: PitchingDecisions;
  info: GameInfoItem[];
  observedAt: string;
}
