import { isHalfInningBreak } from "@/lib/mlb/lineup";
import type { LiveGameState } from "@/types/mlb-live";

type InningScoreState = Pick<
  LiveGameState,
  "inning" | "inningState" | "awayRuns" | "homeRuns"
>;

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

/**
 * Home team is ahead after the top of the 9th (or top of an extra inning) —
 * they do not bat the bottom half, so the game is over.
 */
export function isHomeWinAfterTopHalf(
  inning: number,
  inningState: string,
  awayRuns: number,
  homeRuns: number,
): boolean {
  if (inningState.toLowerCase() !== "middle") return false;
  if (inning < 9) return false;
  return homeRuns > awayRuns;
}

export function isGameOver(
  state: Pick<LiveGameState, "gameStatus" | "inning" | "inningState" | "awayRuns" | "homeRuns">,
): boolean {
  if (state.gameStatus === "Final") return true;
  return (
    isDecisiveInningEnd(
      state.inning,
      state.inningState,
      state.awayRuns,
      state.homeRuns,
    ) ||
    isHomeWinAfterTopHalf(
      state.inning,
      state.inningState,
      state.awayRuns,
      state.homeRuns,
    )
  );
}

/** True when the feed is between half-innings but the game will continue. */
export function isBetweenHalfInnings(state: InningScoreState & Pick<LiveGameState, "gameStatus">): boolean {
  if (isGameOver(state)) return false;
  return isHalfInningBreak(state.inningState);
}
