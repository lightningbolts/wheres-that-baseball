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

  const top = gameState.inningHalf.toLowerCase().startsWith("top");
  return top
    ? { offenseTeamId: awayTeamId, defenseTeamId: homeTeamId }
    : { offenseTeamId: homeTeamId, defenseTeamId: awayTeamId };
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
  const runMargin = Math.abs(gameState.awayRuns - gameState.homeRuns);
  const awayLeading = gameState.awayRuns > gameState.homeRuns;
  const homeLeading = gameState.homeRuns > gameState.awayRuns;

  return {
    gamePk: gameState.gamePk,
    trigger,
    inning: gameState.inning,
    inningHalf: gameState.inningHalf,
    inningState: gameState.inningState,
    outs: gameState.outs,
    balls: gameState.balls,
    strikes: gameState.strikes,
    awayRuns: gameState.awayRuns,
    homeRuns: gameState.homeRuns,
    awayAbbrev: gameState.awayAbbrev,
    homeAbbrev: gameState.homeAbbrev,
    awayTeamId,
    homeTeamId,
    offenseTeamId,
    defenseTeamId,
    offenseAbbrev,
    defenseAbbrev,
    onFirst: gameState.onFirst,
    onSecond: gameState.onSecond,
    onThird: gameState.onThird,
    batterName: gameState.batterName,
    pitcherName: gameState.pitcherName,
    pitchCount: gameState.atBatPitches.length,
    foulsThisAb: foulsInAtBat(gameState.atBatPitches),
    isHalfInningBreak: isHalfInningBreak(gameState.inningState),
    isLateInning: gameState.inning >= 7,
    isCloseGame: runMargin <= 1,
    isExtraInnings: gameState.inning > 9,
    runnersInScoringPosition: gameState.onSecond || gameState.onThird,
    twoOuts: gameState.outs >= 2,
    basesLoaded: gameState.onFirst && gameState.onSecond && gameState.onThird,
    runMargin,
    leadingTeamId: awayLeading
      ? awayTeamId
      : homeLeading
        ? homeTeamId
        : null,
    trailingTeamId: awayLeading
      ? homeTeamId
      : homeLeading
        ? awayTeamId
        : null,
    liveStats: computeCallItGameStats(gameState),
    strikeoutKind: (() => {
      const play = completedAtBatPlay(gameState, trigger);
      return play ? strikeoutKindFromPlay(play) : null;
    })(),
    contact: buildContactContext(gameState, trigger),
  };
}
