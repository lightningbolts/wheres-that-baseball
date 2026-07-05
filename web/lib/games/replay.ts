import {
  computeAbsChallengesRemaining,
  countAbsChallengesUsedFromPlays,
  type AbsChallengeCountOptions,
  type AbsChallengePlay,
} from "@/lib/mlb/absChallenges";
import type { LiveGameState, PlayByPlayEntry } from "@/types/mlb-live";

function playEntryToAbsChallengePlay(entry: PlayByPlayEntry): AbsChallengePlay {
  return {
    about: { halfInning: entry.halfInning },
    matchup: {
      batter: { fullName: entry.batterName },
      pitcher: { fullName: entry.detail.pitcherName },
    },
    result: { description: entry.description },
    reviewDetails: entry.detail.playReview
      ? {
          inProgress: false,
          isOverturned: entry.detail.playReview.isOverturned,
          reviewType: entry.detail.playReview.reviewType,
          challengeTeamId: entry.detail.playReview.challengeTeamId,
        }
      : undefined,
    playEvents: (entry.detail?.pitches ?? []).map((pitch) => ({
      isPitch: pitch.isPitch,
      details: { description: pitch.callDescription },
      reviewDetails: pitch.review
        ? {
            inProgress: false,
            isOverturned: pitch.review.isOverturned,
            reviewType: pitch.review.reviewType,
            challengeTeamId: pitch.review.challengeTeamId,
          }
        : undefined,
    })),
  };
}

/** All play-by-play rows through a selected plate appearance (inclusive). */
export function playsThroughAtBat(
  plays: PlayByPlayEntry[],
  atBatIndex: number,
): PlayByPlayEntry[] {
  const result: PlayByPlayEntry[] = [];
  for (const entry of plays) {
    result.push(entry);
    if (entry.isAtBat !== false && entry.atBatIndex === atBatIndex) break;
  }
  return result;
}

export function absChallengesRemainingAtReplayPoint(
  plays: PlayByPlayEntry[],
  throughPlay: PlayByPlayEntry,
  options?: AbsChallengeCountOptions,
): { away: number; home: number } {
  const slice = playsThroughAtBat(plays, throughPlay.atBatIndex);
  const used = countAbsChallengesUsedFromPlays(
    slice.map(playEntryToAbsChallengePlay),
    options,
  );
  return {
    away: computeAbsChallengesRemaining(used.away, throughPlay.inning),
    home: computeAbsChallengesRemaining(used.home, throughPlay.inning),
  };
}

/** Reconstruct scorebug / at-bat panel state for a selected play in replay mode. */
export function gameStateForAtBat(
  base: LiveGameState,
  play: PlayByPlayEntry,
  options?: { awayTeamId?: number; homeTeamId?: number },
): LiveGameState {
  const lastPitch = play.detail.pitches.at(-1);

  let awayAbsChallengesRemaining = base.awayAbsChallengesRemaining;
  let homeAbsChallengesRemaining = base.homeAbsChallengesRemaining;

  if (
    play.awayAbsChallengesRemaining != null &&
    play.homeAbsChallengesRemaining != null
  ) {
    awayAbsChallengesRemaining = play.awayAbsChallengesRemaining;
    homeAbsChallengesRemaining = play.homeAbsChallengesRemaining;
  } else if (base.plays.length > 0) {
    const abs = absChallengesRemainingAtReplayPoint(base.plays, play, {
      awayTeamId: options?.awayTeamId,
      homeTeamId: options?.homeTeamId,
      awayTeamName: base.awayTeam,
      homeTeamName: base.homeTeam,
      awayAbbrev: base.awayAbbrev,
      homeAbbrev: base.homeAbbrev,
    });
    awayAbsChallengesRemaining = abs.away;
    homeAbsChallengesRemaining = abs.home;
  }

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
    awayAbsChallengesRemaining,
    homeAbsChallengesRemaining,
  };
}

export function findPlayByAtBatIndex(
  plays: PlayByPlayEntry[],
  atBatIndex: number,
): PlayByPlayEntry | undefined {
  return plays.find(
    (play) => play.atBatIndex === atBatIndex && play.isAtBat !== false,
  );
}
