import { classifyPitch } from "@/lib/mlb/pitchClassification";
import type { TeamNerdCounters } from "@/lib/mlb/nerdStats/types";
import type { PlayPitch } from "@/types/mlb-live";

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
