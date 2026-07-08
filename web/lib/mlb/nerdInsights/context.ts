import { computeCallItGameStats } from "@/lib/mlb/callItGameStats";
import { isHalfInningBreak } from "@/lib/mlb/lineup";
import { classifyPitch, strikeoutKindFromPlay } from "@/lib/mlb/pitchClassification";
import {
  hasBattedBallData,
  isBarrel,
  isNoDoubterHr,
} from "@/lib/mlb/nerdStats/extractHelpers";
import {
  offenseDefenseFromHalfInning,
  isImmaculateInningComplete,
  situationFromCompletedPlay,
  situationFromHalfKey,
} from "@/lib/mlb/nerdInsights/situational";
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
  const halfSituation =
    trigger.type === "half-break"
      ? situationFromHalfKey(
          trigger.halfKey,
          awayTeamId,
          homeTeamId,
          gameState.awayAbbrev,
          gameState.homeAbbrev,
        )
      : null;

  const situationalOffenseId = playSituation?.offenseTeamId ?? halfSituation?.offenseTeamId;
  const situationalDefenseId = playSituation?.defenseTeamId ?? halfSituation?.defenseTeamId;

  return {
    gamePk: gameState.gamePk,
    trigger,
    inning: playSituation?.inning ?? halfSituation?.inning ?? gameState.inning,
    inningHalf:
      playSituation?.inningHalf ?? halfSituation?.inningHalf ?? gameState.inningHalf,
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
    offenseTeamId: situationalOffenseId ?? offenseTeamId,
    defenseTeamId: situationalDefenseId ?? defenseTeamId,
    offenseAbbrev:
      playSituation?.offenseAbbrev ??
      halfSituation?.offenseAbbrev ??
      offenseAbbrev,
    defenseAbbrev:
      playSituation?.defenseAbbrev ??
      halfSituation?.defenseAbbrev ??
      defenseAbbrev,
    onFirst: playSituation?.onFirst ?? gameState.onFirst,
    onSecond: playSituation?.onSecond ?? gameState.onSecond,
    onThird: playSituation?.onThird ?? gameState.onThird,
    batterName: playSituation?.batterName ?? gameState.batterName,
    pitcherName: playSituation?.pitcherName ?? gameState.pitcherName,
    pitchCount: playSituation?.pitchCount ?? gameState.atBatPitches.length,
    foulsThisAb:
      playSituation?.foulsThisAb ?? foulsInAtBat(gameState.atBatPitches),
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
    immaculateInningComplete: (() => {
      if (!completedPlay) return false;
      const halfPlays = gameState.plays.filter(
        (entry) =>
          entry.isAtBat &&
          entry.inning === completedPlay.inning &&
          entry.halfInning.toLowerCase() === completedPlay.halfInning.toLowerCase(),
      );
      return isImmaculateInningComplete(
        completedPlay,
        halfPlays,
        computeCallItGameStats(gameState),
      );
    })(),
    contact: buildContactContext(gameState, trigger),
  };
}
