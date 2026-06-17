import { isHalfInningBreak } from "@/lib/mlb/lineup";
import type { LiveGameState } from "@/types/mlb-live";

/**
 * True when a full inning just ended with an untied score from the 9th on —
 * the game is over even if MLB has not yet flipped abstractGameState to Final.
 */
export function isDecisiveInningEnd(
  inning: number,
  inningState: string,
  awayRuns: number,
  homeRuns: number,
): boolean {
  if (inningState.toLowerCase() !== "end") return false;
  if (inning < 9) return false;
  return awayRuns !== homeRuns;
}

export function isGameOver(state: Pick<
  LiveGameState,
  "gameStatus" | "inning" | "inningState" | "awayRuns" | "homeRuns"
>): boolean {
  if (state.gameStatus === "Final") return true;
  return isDecisiveInningEnd(
    state.inning,
    state.inningState,
    state.awayRuns,
    state.homeRuns,
  );
}

/** True when the feed is between half-innings but the game will continue. */
export function isBetweenHalfInnings(state: Pick<
  LiveGameState,
  "inning" | "inningState" | "awayRuns" | "homeRuns" | "gameStatus"
>): boolean {
  if (isGameOver(state)) return false;
  return isHalfInningBreak(state.inningState);
}
