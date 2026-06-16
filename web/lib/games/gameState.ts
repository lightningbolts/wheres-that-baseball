import type { LiveGameState } from "@/types/mlb-live";

/** Validates and normalizes game_state JSON from Supabase. */
export function parseStoredGameState(raw: unknown, gamePk: number): LiveGameState | null {
  if (!raw || typeof raw !== "object") return null;

  const state = raw as Record<string, unknown>;
  if (typeof state.gamePk !== "number") {
    state.gamePk = gamePk;
  }

  if (!Array.isArray(state.plays)) return null;

  return state as unknown as LiveGameState;
}
