import type { LiveGameState, PlayByPlayEntry } from "@/types/mlb-live";

/** Reconstruct scorebug / at-bat panel state for a selected play in replay mode. */
export function gameStateForAtBat(
  base: LiveGameState,
  play: PlayByPlayEntry,
): LiveGameState {
  const lastPitch = play.detail.pitches.at(-1);

  return {
    ...base,
    batterId: play.batterId,
    batterName: play.batterName,
    pitcherId: play.detail.pitcherId,
    pitcherName: play.detail.pitcherName,
    inning: play.inning,
    inningHalf: play.halfInning,
    balls: lastPitch?.balls ?? 0,
    strikes: lastPitch?.strikes ?? 0,
    outs: play.outs,
    onFirst: play.onFirst,
    onSecond: play.onSecond,
    onThird: play.onThird,
    awayRuns: play.awayScore,
    homeRuns: play.homeScore,
    atBatPitches: play.detail.pitches,
  };
}

export function findPlayByAtBatIndex(
  plays: PlayByPlayEntry[],
  atBatIndex: number,
): PlayByPlayEntry | undefined {
  return plays.find((play) => play.atBatIndex === atBatIndex);
}
