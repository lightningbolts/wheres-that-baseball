/**
 * Save / resume: a game is its setup plus the recorded inputs; GameSession.replay
 * rebuilds the exact state deterministically. One slot in localStorage.
 */
import type { GameSetup, PitchInput } from "@/lib/game/session/session";

const KEY = "wtbb.playball.save.v1";

export interface SavedGame {
  version: 2;
  savedAt: number;
  setup: GameSetup;
  inputs: PitchInput[];
}

export function saveGame(setup: GameSetup, inputs: PitchInput[]): void {
  try {
    const data: SavedGame = { version: 2, savedAt: Date.now(), setup, inputs };
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Storage full or unavailable: the game keeps running, it just can't resume.
  }
}

export function loadSave(): SavedGame | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as SavedGame;
    if (d?.version !== 2 || !d.setup || !Array.isArray(d.inputs)) return null;
    return d;
  } catch {
    return null;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
