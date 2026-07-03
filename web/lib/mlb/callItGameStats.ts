import type { LiveGameState } from "@/types/mlb-live";

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

  for (const play of gameState.plays) {
    if (!play.isAtBat) continue;

    const top = isTopHalf(play.halfInning);
    const halfKey = `${play.inning}-${play.halfInning}`;
    if (top) awayHalves.add(halfKey);
    else homeHalves.add(halfKey);

    for (const pitch of play.detail.pitches) {
      if (!pitch.isPitch) continue;
      total += 1;
      if (top) awaySeen += 1;
      else homeSeen += 1;

      if (pitch.isInPlay) inPlay += 1;
      else if (pitch.isBall || pitch.isStrike) scoreable += 1;
      else fouls += 1;
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
      if (!pitch.isPitch) continue;
      total += 1;
      if (top) awaySeen += 1;
      else homeSeen += 1;

      if (pitch.isInPlay) inPlay += 1;
      else if (pitch.isBall || pitch.isStrike) scoreable += 1;
      else fouls += 1;
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
  };
}
