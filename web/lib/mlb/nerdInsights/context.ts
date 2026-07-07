import { computeCallItGameStats } from "@/lib/mlb/callItGameStats";
import { isHalfInningBreak } from "@/lib/mlb/lineup";
import { classifyPitch, strikeoutKindFromPlay } from "@/lib/mlb/pitchClassification";
import {
  hasBattedBallData,
  isBarrel,
  isNoDoubterHr,
} from "@/lib/mlb/nerdStats/extractHelpers";
import type {
  ContactInsightContext,
  InsightTrigger,
  LiveInsightContext,
} from "@/lib/mlb/nerdInsights/types";
import { getTeamByAbbrev } from "@/lib/mlb/teams";
import type { LiveGameState, PlayByPlayEntry } from "@/types/mlb-live";

function foulsInAtBat(pitches: LiveGameState["atBatPitches"]): number {
  let count = 0;
  for (const pitch of pitches) {
    const kind = classifyPitch(pitch);
    if (kind?.isFoul) count += 1;
  }
  return count;
}

function teamIdsForGame(gameState: LiveGameState): {
  awayTeamId: number;
  homeTeamId: number;
} | null {
  const away = getTeamByAbbrev(gameState.awayAbbrev);
  const home = getTeamByAbbrev(gameState.homeAbbrev);
  if (!away || !home) return null;
  return { awayTeamId: away.id, homeTeamId: home.id };
}

function offenseDefenseFromHalfInning(
  halfInning: string,
  awayTeamId: number,
  homeTeamId: number,
): { offenseTeamId: number; defenseTeamId: number } {
  const top = halfInning.toLowerCase().startsWith("top");
  return top
    ? { offenseTeamId: awayTeamId, defenseTeamId: homeTeamId }
    : { offenseTeamId: homeTeamId, defenseTeamId: awayTeamId };
}

function offenseDefenseIds(
  gameState: LiveGameState,
  awayTeamId: number,
  homeTeamId: number,
): { offenseTeamId: number; defenseTeamId: number } {
  if (gameState.offenseTeamId != null) {
    const offenseTeamId = gameState.offenseTeamId;
    const defenseTeamId =
      offenseTeamId === awayTeamId ? homeTeamId : awayTeamId;
    return { offenseTeamId, defenseTeamId };
  }

  return offenseDefenseFromHalfInning(gameState.inningHalf, awayTeamId, homeTeamId);
}

function scoreFlags(awayRuns: number, homeRuns: number, awayTeamId: number, homeTeamId: number) {
  const runMargin = Math.abs(awayRuns - homeRuns);
  const awayLeading = awayRuns > homeRuns;
  const homeLeading = homeRuns > awayRuns;

  return {
    runMargin,
    isCloseGame: runMargin <= 1,
    isOneRunGame: runMargin === 1,
    leadingTeamId: awayLeading ? awayTeamId : homeLeading ? homeTeamId : null,
    trailingTeamId: awayLeading ? homeTeamId : homeLeading ? awayTeamId : null,
  };
}

function situationFromCompletedPlay(
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
> {
  const { offenseTeamId, defenseTeamId } = offenseDefenseFromHalfInning(
    play.halfInning,
    awayTeamId,
    homeTeamId,
  );
  const scores = scoreFlags(play.awayScore, play.homeScore, awayTeamId, homeTeamId);

  return {
    offenseTeamId,
    defenseTeamId,
    offenseAbbrev: offenseTeamId === awayTeamId ? awayAbbrev : homeAbbrev,
    defenseAbbrev: defenseTeamId === awayTeamId ? awayAbbrev : homeAbbrev,
    batterName: play.batterName,
    pitcherName: play.detail.pitcherName,
    inning: play.inning,
    inningHalf: play.halfInning,
    outs: play.outs,
    onFirst: play.onFirst,
    onSecond: play.onSecond,
    onThird: play.onThird,
    awayRuns: play.awayScore,
    homeRuns: play.homeScore,
    ...scores,
    runnersInScoringPosition: play.onSecond || play.onThird,
    twoOuts: play.outs >= 2,
    basesLoaded: play.onFirst && play.onSecond && play.onThird,
  };
}

function completedAtBatPlay(
  gameState: LiveGameState,
  trigger: InsightTrigger,
): PlayByPlayEntry | null {
  if (trigger.type !== "at-bat-end") return null;
  return (
    gameState.plays.find(
      (play) => play.isAtBat && play.atBatIndex === trigger.atBatIndex,
    ) ?? null
  );
}

function buildContactContext(
  gameState: LiveGameState,
  trigger: InsightTrigger,
): ContactInsightContext | null {
  const play = completedAtBatPlay(gameState, trigger);
  if (!play || !hasBattedBallData(play)) return null;

  const hit = play.detail.hit!;
  const isHomeRun = play.event === "Home Run";

  return {
    hit,
    exitVelo: hit.launchSpeed,
    launchAngle: hit.launchAngle,
    distance: hit.totalDistance,
    batSpeed: hit.batSpeed != null && hit.batSpeed > 0 ? hit.batSpeed : null,
    isBarrel: isBarrel(hit),
    isChop: hit.launchAngle < 5,
    isPopup: hit.launchAngle > 50,
    isNoDoubterHr: isHomeRun && isNoDoubterHr(hit),
    isMoonshot: isHomeRun && hit.launchAngle > 45,
    isWallScraper: isHomeRun && hit.totalDistance > 0 && hit.totalDistance < 340,
  };
}

export function buildLiveInsightContext(
  gameState: LiveGameState,
  trigger: InsightTrigger,
): LiveInsightContext | null {
  const ids = teamIdsForGame(gameState);
  if (!ids) return null;

  const { awayTeamId, homeTeamId } = ids;
  const { offenseTeamId, defenseTeamId } = offenseDefenseIds(
    gameState,
    awayTeamId,
    homeTeamId,
  );
  const offenseAbbrev =
    offenseTeamId === awayTeamId ? gameState.awayAbbrev : gameState.homeAbbrev;
  const defenseAbbrev =
    defenseTeamId === awayTeamId ? gameState.awayAbbrev : gameState.homeAbbrev;
  const scores = scoreFlags(
    gameState.awayRuns,
    gameState.homeRuns,
    awayTeamId,
    homeTeamId,
  );

  const completedPlay =
    trigger.type === "at-bat-end" ? completedAtBatPlay(gameState, trigger) : null;
  const playSituation =
    completedPlay != null
      ? situationFromCompletedPlay(
          completedPlay,
          awayTeamId,
          homeTeamId,
          gameState.awayAbbrev,
          gameState.homeAbbrev,
        )
      : null;

  return {
    gamePk: gameState.gamePk,
    trigger,
    inning: playSituation?.inning ?? gameState.inning,
    inningHalf: playSituation?.inningHalf ?? gameState.inningHalf,
    inningState: gameState.inningState,
    outs: playSituation?.outs ?? gameState.outs,
    balls: gameState.balls,
    strikes: gameState.strikes,
    awayRuns: playSituation?.awayRuns ?? gameState.awayRuns,
    homeRuns: playSituation?.homeRuns ?? gameState.homeRuns,
    awayAbbrev: gameState.awayAbbrev,
    homeAbbrev: gameState.homeAbbrev,
    awayTeamId,
    homeTeamId,
    offenseTeamId: playSituation?.offenseTeamId ?? offenseTeamId,
    defenseTeamId: playSituation?.defenseTeamId ?? defenseTeamId,
    offenseAbbrev: playSituation?.offenseAbbrev ?? offenseAbbrev,
    defenseAbbrev: playSituation?.defenseAbbrev ?? defenseAbbrev,
    onFirst: playSituation?.onFirst ?? gameState.onFirst,
    onSecond: playSituation?.onSecond ?? gameState.onSecond,
    onThird: playSituation?.onThird ?? gameState.onThird,
    batterName: playSituation?.batterName ?? gameState.batterName,
    pitcherName: playSituation?.pitcherName ?? gameState.pitcherName,
    pitchCount: gameState.atBatPitches.length,
    foulsThisAb: foulsInAtBat(gameState.atBatPitches),
    isHalfInningBreak: isHalfInningBreak(gameState.inningState),
    isLateInning: gameState.inning >= 7,
    isCloseGame: playSituation?.isCloseGame ?? scores.isCloseGame,
    isOneRunGame: playSituation?.isOneRunGame ?? scores.isOneRunGame,
    isExtraInnings: gameState.inning > 9,
    runnersInScoringPosition:
      playSituation?.runnersInScoringPosition ??
      (gameState.onSecond || gameState.onThird),
    twoOuts: playSituation?.twoOuts ?? gameState.outs >= 2,
    basesLoaded:
      playSituation?.basesLoaded ??
      (gameState.onFirst && gameState.onSecond && gameState.onThird),
    runMargin: playSituation?.runMargin ?? scores.runMargin,
    leadingTeamId: playSituation?.leadingTeamId ?? scores.leadingTeamId,
    trailingTeamId: playSituation?.trailingTeamId ?? scores.trailingTeamId,
    liveStats: computeCallItGameStats(gameState),
    strikeoutKind: (() => {
      const play = completedPlay ?? completedAtBatPlay(gameState, trigger);
      return play ? strikeoutKindFromPlay(play) : null;
    })(),
    contact: buildContactContext(gameState, trigger),
  };
}
