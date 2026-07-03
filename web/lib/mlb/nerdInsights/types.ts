import type { CallItGameStats } from "@/lib/mlb/callItGameStats";

export interface NerdInsightToast {
  id: string;
  eyebrow: string;
  title: string;
  message: string;
  teamId?: number;
  statId?: string;
  durationMs?: number;
}

export interface TeamNerdStatEntry {
  rank: number;
  displayValue: string;
  value: number;
  title: string;
  sort: "asc" | "desc";
}

export interface TeamNerdProfile {
  teamId: number;
  abbrev: string;
  stats: Map<string, TeamNerdStatEntry>;
}

export type InsightTrigger =
  | { type: "half-break"; halfKey: string }
  | { type: "at-bat-start"; atBatIndex: number }
  | { type: "pitch-thrown"; atBatIndex: number; pitchNumber: number }
  | { type: "at-bat-end"; atBatIndex: number; event: string }
  | { type: "inning-change"; inning: number };

export interface LiveInsightContext {
  gamePk: number;
  trigger: InsightTrigger;
  inning: number;
  inningHalf: string;
  inningState: string;
  outs: number;
  balls: number;
  strikes: number;
  awayRuns: number;
  homeRuns: number;
  awayAbbrev: string;
  homeAbbrev: string;
  awayTeamId: number;
  homeTeamId: number;
  offenseTeamId: number;
  defenseTeamId: number;
  offenseAbbrev: string;
  defenseAbbrev: string;
  onFirst: boolean;
  onSecond: boolean;
  onThird: boolean;
  batterName: string;
  pitcherName: string;
  pitchCount: number;
  foulsThisAb: number;
  isHalfInningBreak: boolean;
  isLateInning: boolean;
  isCloseGame: boolean;
  isExtraInnings: boolean;
  runnersInScoringPosition: boolean;
  twoOuts: boolean;
  basesLoaded: boolean;
  runMargin: number;
  trailingTeamId: number | null;
  leadingTeamId: number | null;
  liveStats: CallItGameStats | null;
}
