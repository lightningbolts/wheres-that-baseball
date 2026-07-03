import type { PlayPitch } from "@/types/mlb-live";

export interface PitchClassification {
  isInPlay: boolean;
  isBall: boolean;
  isStrike: boolean;
  isFoul: boolean;
  isSwingingStrike: boolean;
  isCalledStrike: boolean;
}

/** Classify a Statcast pitch event for counting (balls, strikes, fouls, contact). */
export function classifyPitch(pitch: PlayPitch): PitchClassification | null {
  if (!pitch.isPitch) return null;

  const isInPlay = pitch.isInPlay;
  const isBall = pitch.isBall;
  const isStrike = pitch.isStrike && !isBall;
  const isFoul = !isInPlay && !isBall && !isStrike;
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
