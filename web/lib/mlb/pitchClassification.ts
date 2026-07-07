import type { PlayByPlayEntry, PlayPitch } from "@/types/mlb-live";

export type StrikeoutKind = "swinging" | "called";

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

/** Classify a completed strikeout by the terminal pitch (or play description). */
export function strikeoutKindFromPlay(play: PlayByPlayEntry): StrikeoutKind | null {
  if (play.event !== "Strikeout") return null;

  const pitches = play.detail?.pitches ?? [];
  for (let i = pitches.length - 1; i >= 0; i--) {
    const classification = classifyPitch(pitches[i]);
    if (!classification?.isStrike) continue;
    if (classification.isSwingingStrike) return "swinging";
    if (classification.isCalledStrike) return "called";
    if (/swinging/i.test(pitches[i].callDescription)) return "swinging";
    if (/called/i.test(pitches[i].callDescription)) return "called";
    break;
  }

  const description = play.description || play.detail?.description || "";
  if (/called out on strikes/i.test(description)) return "called";
  if (/swings? and miss|swinging strike/i.test(description)) return "swinging";

  return null;
}
