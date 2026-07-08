import { classifyPitch } from "@/lib/mlb/pitchClassification";
import type { CallItGameStats } from "@/lib/mlb/callItGameStats";
import type { LiveInsightContext } from "@/lib/mlb/nerdInsights/types";
import type { PlayByPlayEntry } from "@/types/mlb-live";

export function normalizeHalfInning(halfInning: string): string {
  const normalized = halfInning.toLowerCase();
  if (normalized.startsWith("top")) return "top";
  if (normalized.startsWith("bot")) return "bottom";
  return normalized;
}

export function offenseDefenseFromHalfInning(
  halfInning: string,
  awayTeamId: number,
  homeTeamId: number,
): { offenseTeamId: number; defenseTeamId: number } {
  const top = normalizeHalfInning(halfInning).startsWith("top");
  return top
    ? { offenseTeamId: awayTeamId, defenseTeamId: homeTeamId }
    : { offenseTeamId: homeTeamId, defenseTeamId: awayTeamId };
}

export function parseHalfKey(halfKey: string): { inning: number; halfInning: string } | null {
  const dash = halfKey.indexOf("-");
  if (dash === -1) return null;
  const inning = Number(halfKey.slice(0, dash));
  const halfInning = halfKey.slice(dash + 1);
  if (!Number.isFinite(inning) || !halfInning) return null;
  return { inning, halfInning: normalizeHalfInning(halfInning) };
}

export function runsScoredByTeam(ctx: LiveInsightContext, teamId: number): number {
  return teamId === ctx.awayTeamId ? ctx.awayRuns : ctx.homeRuns;
}

export function runsAllowedByTeam(ctx: LiveInsightContext, teamId: number): number {
  return teamId === ctx.awayTeamId ? ctx.homeRuns : ctx.awayRuns;
}

export function foulsInPitches(pitches: PlayByPlayEntry["detail"]["pitches"]): number {
  let count = 0;
  for (const pitch of pitches) {
    const kind = classifyPitch(pitch);
    if (kind?.isFoul) count += 1;
  }
  return count;
}

export function situationFromCompletedPlay(
  play: PlayByPlayEntry,
  awayTeamId: number,
  homeTeamId: number,
  awayAbbrev: string,
  homeAbbrev: string,
): Pick<
  LiveInsightContext,
  | "offenseTeamId"
  | "defenseTeamId"
  | "offenseAbbrev"
  | "defenseAbbrev"
  | "batterName"
  | "pitcherName"
  | "inning"
  | "inningHalf"
  | "outs"
  | "onFirst"
  | "onSecond"
  | "onThird"
  | "awayRuns"
  | "homeRuns"
  | "runMargin"
  | "isCloseGame"
  | "isOneRunGame"
  | "leadingTeamId"
  | "trailingTeamId"
  | "runnersInScoringPosition"
  | "twoOuts"
  | "basesLoaded"
  | "foulsThisAb"
  | "pitchCount"
> {
  const before = play.situationBefore;
  const { offenseTeamId, defenseTeamId } = offenseDefenseFromHalfInning(
    play.halfInning,
    awayTeamId,
    homeTeamId,
  );
  const runMargin = Math.abs(play.awayScore - play.homeScore);
  const awayLeading = play.awayScore > play.homeScore;
  const homeLeading = play.homeScore > play.awayScore;

  return {
    offenseTeamId,
    defenseTeamId,
    offenseAbbrev: offenseTeamId === awayTeamId ? awayAbbrev : homeAbbrev,
    defenseAbbrev: defenseTeamId === awayTeamId ? awayAbbrev : homeAbbrev,
    batterName: play.batterName,
    pitcherName: play.detail.pitcherName,
    inning: play.inning,
    inningHalf: play.halfInning,
    outs: before.outs,
    onFirst: before.onFirst,
    onSecond: before.onSecond,
    onThird: before.onThird,
    awayRuns: play.awayScore,
    homeRuns: play.homeScore,
    runMargin,
    isCloseGame: runMargin <= 1,
    isOneRunGame: runMargin === 1,
    leadingTeamId: awayLeading ? awayTeamId : homeLeading ? homeTeamId : null,
    trailingTeamId: awayLeading ? homeTeamId : homeLeading ? awayTeamId : null,
    runnersInScoringPosition: before.onSecond || before.onThird,
    twoOuts: before.outs >= 2,
    basesLoaded: before.onFirst && before.onSecond && before.onThird,
    foulsThisAb: foulsInPitches(play.detail.pitches),
    pitchCount: play.detail.pitches.length,
  };
}

export function situationFromHalfKey(
  halfKey: string,
  awayTeamId: number,
  homeTeamId: number,
  awayAbbrev: string,
  homeAbbrev: string,
): Pick<
  LiveInsightContext,
  "inning" | "inningHalf" | "offenseTeamId" | "defenseTeamId" | "offenseAbbrev" | "defenseAbbrev"
> | null {
  const parsed = parseHalfKey(halfKey);
  if (!parsed) return null;

  const { offenseTeamId, defenseTeamId } = offenseDefenseFromHalfInning(
    parsed.halfInning,
    awayTeamId,
    homeTeamId,
  );

  return {
    inning: parsed.inning,
    inningHalf: parsed.halfInning,
    offenseTeamId,
    defenseTeamId,
    offenseAbbrev: offenseTeamId === awayTeamId ? awayAbbrev : homeAbbrev,
    defenseAbbrev: defenseTeamId === awayTeamId ? awayAbbrev : homeAbbrev,
  };
}

/** Season-stat callouts that describe the game shape, not a single plate appearance. */
export function isEstablishedGameShape(ctx: LiveInsightContext): boolean {
  return ctx.inning >= 5;
}

/** True when a half-inning just ended on nine pitches and three strikeouts. */
export function isImmaculateInningComplete(
  play: PlayByPlayEntry,
  halfPlays: PlayByPlayEntry[],
  liveStats: CallItGameStats | null,
): boolean {
  if (play.event !== "Strikeout" || play.situationBefore.outs !== 2) return false;

  const halfKey = `${play.inning}-${normalizeHalfInning(play.halfInning)}`;
  if (liveStats?.pitchesByHalf[halfKey] !== 9) return false;

  const atBatsInHalf = halfPlays.filter((entry) => entry.isAtBat);
  const strikeoutsInHalf = atBatsInHalf.filter((entry) => entry.event === "Strikeout");
  return strikeoutsInHalf.length === 3 && atBatsInHalf.length === 3;
}
