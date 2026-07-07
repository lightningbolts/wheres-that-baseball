import type { CallItGameStats } from "@/lib/mlb/callItGameStats";
import type { StrikeoutKind } from "@/lib/mlb/pitchClassification";
import type { HitData } from "@/types/mlb-live";

export type InsightAnchor =
  | { type: "at-bat"; atBatIndex: number }
  | { type: "half"; halfKey: string }
  | { type: "inning"; inning: number }
  | { type: "live" };

export interface NerdInsight {
  id: string;
  variant: "full" | "mini";
  eyebrow: string;
  title: string;
  message: string;
  teamId?: number;
  statId?: string;
  durationMs?: number;
  anchor: InsightAnchor;
}

/** @deprecated Use NerdInsight */
export type NerdInsightToast = NerdInsight;

export function anchorFromTrigger(trigger: InsightTrigger): InsightAnchor {
  switch (trigger.type) {
    case "at-bat-end":
      return { type: "at-bat", atBatIndex: trigger.atBatIndex };
    case "at-bat-start":
    case "pitch-thrown":
      return { type: "live" };
    case "half-break":
      return { type: "half", halfKey: trigger.halfKey };
    case "inning-change":
      return { type: "inning", inning: trigger.inning };
  }
}

export function statThemeKey(statId: string, teamId: number): string {
  return `${statId}:${teamId}`;
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

export interface ContactInsightContext {
  hit: HitData;
  exitVelo: number;
  launchAngle: number;
  distance: number;
  batSpeed: number | null;
  isBarrel: boolean;
  isChop: boolean;
  isPopup: boolean;
  isNoDoubterHr: boolean;
  isMoonshot: boolean;
  isWallScraper: boolean;
}

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
  /** Tied or one-run margin — used for late-inning walk-off / nailbiter context. */
  isCloseGame: boolean;
  /** Exactly one run separates the teams (excludes 0-0 ties). */
  isOneRunGame: boolean;
  isExtraInnings: boolean;
  runnersInScoringPosition: boolean;
  twoOuts: boolean;
  basesLoaded: boolean;
  runMargin: number;
  trailingTeamId: number | null;
  leadingTeamId: number | null;
  liveStats: CallItGameStats | null;
  /** Terminal strike type for a just-completed strikeout, when known. */
  strikeoutKind: StrikeoutKind | null;
  /** Statcast-style data from the just-completed ball in play, when available. */
  contact: ContactInsightContext | null;
}
