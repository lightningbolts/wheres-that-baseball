import type { PlayPitch } from "@/types/mlb-live";

export interface PitchClassification {
  isInPlay: boolean;
  isBall: boolean;
  isStrike: boolean;
  isFoul: boolean;
  isSwingingStrike: boolean;
  isCalledStrike: boolean;
}

function isFoulPitch(pitch: PlayPitch): boolean {
  if (pitch.isInPlay || pitch.isBall) return false;
  if (pitch.callCode === "F" || pitch.callCode === "L") return true;
  return /foul/i.test(pitch.callDescription);
}

/** Classify a Statcast pitch event for counting (balls, strikes, fouls, contact). */
export function classifyPitch(pitch: PlayPitch): PitchClassification | null {
  if (!pitch.isPitch) return null;

  const isInPlay = pitch.isInPlay;
  const isBall = pitch.isBall;
  const isFoul = isFoulPitch(pitch);
  const isStrike = pitch.isStrike && !isBall && !isFoul;
  const isSwingingStrike = isStrike && /swinging/i.test(pitch.callDescription);
  const isCalledStrike = isStrike && /called/i.test(pitch.callDescription);

  return {
    isInPlay,
    isBall,
    isStrike,
    isFoul,
    isSwingingStrike,
    isCalledStrike,
  };
}
