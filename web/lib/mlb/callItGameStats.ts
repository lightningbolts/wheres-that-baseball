import type { LiveGameState } from "@/types/mlb-live";
import { classifyPitch } from "@/lib/mlb/pitchClassification";
import { runsScoredOnPlay } from "@/lib/mlb/nerdStats/extractHelpers";

export interface TeamPitchPace {
  abbrev: string;
  pitchesSeen: number;
  pitchesThrown: number;
  halfInnings: number;
  pitchesSeenPerInning: number | null;
  pitchesThrownPerInning: number | null;
}

export interface CallItGameStats {
  away: TeamPitchPace;
  home: TeamPitchPace;
  totalPitches: number;
  scoreablePitches: number;
  foulBalls: number;
  ballsInPlay: number;
  /** Runs scored per half-inning key (e.g. "7-top"). */
  runsByHalf: Record<string, number>;
  /** Offense pitch count per half-inning key (e.g. "7-top"). */
  pitchesByHalf: Record<string, number>;
}

function isTopHalf(halfInning: string): boolean {
  return halfInning.toLowerCase().startsWith("top");
}

function countPitchesInPlays(gameState: LiveGameState) {
  let awaySeen = 0;
  let homeSeen = 0;
  let awayHalves = new Set<string>();
  let homeHalves = new Set<string>();
  let total = 0;
  let scoreable = 0;
  let fouls = 0;
  let inPlay = 0;
  const pitchesByHalf: Record<string, number> = {};
  const runsByHalf: Record<string, number> = {};

  for (const play of gameState.plays) {
    if (!play.isAtBat) continue;

    const top = isTopHalf(play.halfInning);
    const halfKey = `${play.inning}-${play.halfInning}`;
    if (top) awayHalves.add(halfKey);
    else homeHalves.add(halfKey);

    const playRuns = runsScoredOnPlay(play);
    const halfRuns = top ? playRuns.away : playRuns.home;
    if (halfRuns > 0) {
      runsByHalf[halfKey] = (runsByHalf[halfKey] ?? 0) + halfRuns;
    }

    for (const pitch of play.detail.pitches) {
      const kind = classifyPitch(pitch);
      if (!kind) continue;
      total += 1;
      pitchesByHalf[halfKey] = (pitchesByHalf[halfKey] ?? 0) + 1;
      if (top) awaySeen += 1;
      else homeSeen += 1;

      if (kind.isInPlay) inPlay += 1;
      else if (kind.isBall || kind.isStrike) scoreable += 1;
      else if (kind.isFoul) fouls += 1;
    }
  }

  const currentAb = gameState.atBatPitches;
  const currentAbAlreadyLogged =
    gameState.plays.at(-1)?.isAtBat === true &&
    gameState.plays.at(-1)?.batterId === gameState.batterId;

  if (currentAb.length > 0 && !currentAbAlreadyLogged) {
    const top = gameState.inningHalf.toLowerCase().startsWith("top");
    const halfKey = `${gameState.inning}-${gameState.inningHalf}`;
    if (top) awayHalves.add(halfKey);
    else homeHalves.add(halfKey);

    for (const pitch of currentAb) {
      const kind = classifyPitch(pitch);
      if (!kind) continue;
      total += 1;
      pitchesByHalf[halfKey] = (pitchesByHalf[halfKey] ?? 0) + 1;
      if (top) awaySeen += 1;
      else homeSeen += 1;

      if (kind.isInPlay) inPlay += 1;
      else if (kind.isBall || kind.isStrike) scoreable += 1;
      else if (kind.isFoul) fouls += 1;
    }
  }

  return {
    awaySeen,
    homeSeen,
    awayThrown: homeSeen,
    homeThrown: awaySeen,
    awayHalves: Math.max(awayHalves.size, 1),
    homeHalves: Math.max(homeHalves.size, 1),
    total,
    scoreable,
    fouls,
    inPlay,
    pitchesByHalf,
    runsByHalf,
  };
}

export function computeCallItGameStats(gameState: LiveGameState | null): CallItGameStats | null {
  if (!gameState) return null;

  const counts = countPitchesInPlays(gameState);

  const away: TeamPitchPace = {
    abbrev: gameState.awayAbbrev,
    pitchesSeen: counts.awaySeen,
    pitchesThrown: counts.awayThrown,
    halfInnings: counts.awayHalves,
    pitchesSeenPerInning: counts.awaySeen / counts.awayHalves,
    pitchesThrownPerInning: counts.awayThrown / counts.awayHalves,
  };

  const home: TeamPitchPace = {
    abbrev: gameState.homeAbbrev,
    pitchesSeen: counts.homeSeen,
    pitchesThrown: counts.homeThrown,
    halfInnings: counts.homeHalves,
    pitchesSeenPerInning: counts.homeSeen / counts.homeHalves,
    pitchesThrownPerInning: counts.homeThrown / counts.homeHalves,
  };

  return {
    away,
    home,
    totalPitches: counts.total,
    scoreablePitches: counts.scoreable,
    foulBalls: counts.fouls,
    ballsInPlay: counts.inPlay,
    pitchesByHalf: counts.pitchesByHalf,
    runsByHalf: counts.runsByHalf,
  };
}
