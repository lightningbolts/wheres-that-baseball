import type { BatterBoxLine } from "@/types/mlb-boxscore";
import type { PlayByPlayEntry } from "@/types/mlb-live";
import { formatInning, formatInningHalf } from "@/lib/utils";

export interface DueUpBatter {
  order: number;
  playerId: number;
  name: string;
  positions: string;
  seasonAvg: string;
}

export interface DueUpContext {
  breakKey: string;
  teamName: string;
  teamAbbrev: string;
  subtitle: string;
  batters: DueUpBatter[];
}

/** True when the feed is between half-innings (top ended or inning ended). */
export function isHalfInningBreak(inningState: string): boolean {
  const normalized = inningState.toLowerCase();
  return normalized === "middle" || normalized === "end";
}

function battingHalfForSide(side: "away" | "home"): string {
  return side === "home" ? "bottom" : "top";
}

function findLastBatterId(
  plays: PlayByPlayEntry[],
  battingHalf: string,
): number | null {
  for (let i = plays.length - 1; i >= 0; i -= 1) {
    const play = plays[i];
    if (play.halfInning.toLowerCase() === battingHalf) {
      return play.batterId;
    }
  }
  return null;
}

function lineupStartIndex(batters: BatterBoxLine[], lastBatterId: number | null): number {
  if (lastBatterId == null) return 0;
  const index = batters.findIndex((batter) => batter.playerId === lastBatterId);
  if (index < 0) return 0;
  return (index + 1) % batters.length;
}

function isLineupPitcher(batter: BatterBoxLine): boolean {
  const parts = batter.positions
    .split("-")
    .map((part) => part.trim().toUpperCase())
    .filter(Boolean);
  return parts.length > 0 && parts.every((part) => part === "P");
}

function lineupSlot(batters: BatterBoxLine[], playerId: number): number | null {
  const index = batters.findIndex((batter) => batter.playerId === playerId);
  return index >= 0 ? index + 1 : null;
}

/** 1-based batting order slot offset from a starting slot (wraps 9 → 1). */
export function lineupSlotAfter(startSlot: number, offset: number): number {
  return ((startSlot - 1 + offset) % 9) + 1;
}

export function lineupSlotForPlayer(
  batters: BatterBoxLine[],
  playerId: number | null,
): number | null {
  if (playerId == null) return null;
  return lineupSlot(batters, playerId);
}

/** Next three batters due up for a team, based on play-by-play and box order. */
export function getDueUpBatters(
  batters: BatterBoxLine[],
  plays: PlayByPlayEntry[],
  side: "away" | "home",
  count = 3,
): DueUpBatter[] {
  if (batters.length === 0) return [];

  const startIndex = lineupStartIndex(
    batters,
    findLastBatterId(plays, battingHalfForSide(side)),
  );

  const dueUp: DueUpBatter[] = [];
  let scanned = 0;
  let index = startIndex;

  while (dueUp.length < count && scanned < batters.length) {
    const lineupIndex = index % batters.length;
    const batter = batters[lineupIndex];
    index += 1;
    scanned += 1;
    if (isLineupPitcher(batter)) continue;

    dueUp.push({
      order: (lineupIndex % 9) + 1,
      playerId: batter.playerId,
      name: batter.name,
      positions: batter.positions,
      seasonAvg: batter.seasonAvg,
    });
  }

  return dueUp;
}

export function buildDueUpContext(
  inning: number,
  inningState: string,
  awayRuns: number,
  homeRuns: number,
  awayTeam: string,
  homeTeam: string,
  awayAbbrev: string,
  homeAbbrev: string,
  awayBatters: BatterBoxLine[],
  homeBatters: BatterBoxLine[],
  plays: PlayByPlayEntry[],
): DueUpContext | null {
  if (!isHalfInningBreak(inningState)) return null;

  const normalized = inningState.toLowerCase();
  if (normalized === "end" && inning >= 9 && awayRuns !== homeRuns) {
    return null;
  }

  const side: "away" | "home" = normalized === "middle" ? "home" : "away";
  const teamBatters = side === "home" ? homeBatters : awayBatters;
  const batters = getDueUpBatters(teamBatters, plays, side);

  if (batters.length === 0) return null;

  const breakKey = `${inning}-${normalized}`;
  const teamName = side === "home" ? homeTeam : awayTeam;
  const teamAbbrev = side === "home" ? homeAbbrev : awayAbbrev;

  const subtitle =
    normalized === "middle"
      ? `${formatInning(inning)} ${formatInningHalf("bottom")}`
      : `${formatInning(inning + 1)} ${formatInningHalf("top")}`;

  return {
    breakKey,
    teamName,
    teamAbbrev,
    subtitle,
    batters,
  };
}
