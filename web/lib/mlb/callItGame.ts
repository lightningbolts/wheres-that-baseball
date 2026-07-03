import type { PlayPitch } from "@/types/mlb-live";

export type CallItMode = "umpire" | "predictor";
export type CallItPhase = "idle" | "awaiting_pre" | "awaiting_post" | "revealed";

export interface CallItScore {
  correct: number;
  total: number;
  streak: number;
  bestStreak: number;
}

export function isScoreablePitch(pitch: PlayPitch): boolean {
  return pitch.isPitch && !pitch.isInPlay && (pitch.isBall || pitch.isStrike);
}

/** Short label for fouls, HBP, in-play events, etc. */
export function pitchEventLabel(pitch: PlayPitch): string {
  if (pitch.isInPlay) return pitch.callDescription || "Ball in play";
  if (pitch.isBall) return pitch.callDescription || "Ball";
  if (pitch.isStrike) return pitch.callDescription || "Strike";
  return pitch.callDescription || pitch.typeDescription || "Pitch";
}

export function endsAtBat(pitch: PlayPitch): boolean {
  return pitch.isInPlay;
}

export function pitchActual(pitch: PlayPitch): "strike" | "ball" {
  return pitch.isStrike ? "strike" : "ball";
}

export function pitchKey(batterId: number | null, pitchNumber: number): string {
  return `${batterId ?? 0}:${pitchNumber}`;
}

export const CALL_IT_MODE_STORAGE_KEY = "call-it-mode";
export const CALL_IT_ZONE_STORAGE_KEY = "call-it-show-zone";
export const CALL_IT_REVEAL_MS = 1500;

export function callItScoreStorageKey(gamePk: number) {
  return `call-it-score-${gamePk}`;
}
