import { classifyPitch } from "@/lib/mlb/pitchClassification";
import { hitTotalBases, isHitEvent } from "@/lib/mlb/nerdStats/extractHelpers";
import type { TeamNerdCounters } from "@/lib/mlb/nerdStats/types";
import type { PlayByPlayEntry, PlayPitch } from "@/types/mlb-live";

export function recordPitchCounters(
  offense: TeamNerdCounters,
  defense: TeamNerdCounters,
  pitch: PlayPitch,
): void {
  const kind = classifyPitch(pitch);
  if (!kind) return;

  offense.pitchesSeen += 1;
  defense.pitchesThrown += 1;

  if (kind.isInPlay) {
    offense.ballsInPlay += 1;
    defense.ballsInPlayAllowed += 1;
    return;
  }

  if (kind.isBall) {
    offense.pitchBalls += 1;
    defense.pitchBallsThrown += 1;
    return;
  }

  if (kind.isStrike) {
    offense.pitchStrikes += 1;
    defense.pitchStrikesThrown += 1;
    if (kind.isSwingingStrike) {
      offense.swingingStrikes += 1;
      defense.swingingStrikesInduced += 1;
    }
    if (kind.isCalledStrike) {
      offense.calledStrikes += 1;
      defense.calledStrikesInduced += 1;
    }
    return;
  }

  if (kind.isFoul) {
    offense.foulBalls += 1;
    defense.foulsInduced += 1;
  }
}

/**
 * Record detailed first-pitch outcome buckets for batting (offense) and
 * pitching (defense). Traditional first-pitch strikes include called strikes,
 * swinging strikes, fouls, and balls in play.
 */
export function recordFirstPitchCounters(
  offense: TeamNerdCounters,
  defense: TeamNerdCounters,
  pitch: PlayPitch,
  play: PlayByPlayEntry,
): void {
  const kind = classifyPitch(pitch);
  if (!kind) return;

  offense.firstPitchesSeen += 1;
  defense.firstPitchesThrown += 1;

  const isTraditionalStrike = kind.isStrike || kind.isFoul || kind.isInPlay;
  if (isTraditionalStrike) {
    offense.firstPitchStrikes += 1;
    defense.firstPitchStrikesThrown += 1;
  }

  if (kind.isBall) {
    offense.firstPitchBalls += 1;
    defense.firstPitchBallsThrown += 1;
  }

  if (kind.isCalledStrike) {
    offense.firstPitchCalledStrikes += 1;
    defense.firstPitchCalledStrikesInduced += 1;
  }

  if (kind.isSwingingStrike) {
    offense.firstPitchSwingingStrikes += 1;
    defense.firstPitchSwingingStrikesInduced += 1;
  }

  if (kind.isFoul) {
    offense.firstPitchFouls += 1;
    defense.firstPitchFoulsInduced += 1;
  }

  const isSwing = kind.isSwingingStrike || kind.isFoul || kind.isInPlay;
  if (isSwing) {
    offense.firstPitchSwings += 1;
    defense.firstPitchSwingsInduced += 1;
  }

  if (!kind.isInPlay) return;

  offense.firstPitchInPlay += 1;
  defense.firstPitchInPlayAllowed += 1;

  if (isHitEvent(play.event)) {
    const bases = hitTotalBases(play.event);
    offense.firstPitchHits += 1;
    defense.firstPitchHitsAllowed += 1;
    offense.firstPitchTotalBases += bases;
    defense.firstPitchTotalBasesAllowed += bases;
  }

  if (play.event === "Home Run") {
    offense.firstPitchHomeRuns += 1;
    defense.firstPitchHomeRunsAllowed += 1;
  }
}
