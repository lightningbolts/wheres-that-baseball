import type { AllPlayRaw, MLBLiveFeedResponse } from "@/types/mlb-live";

/** Active at-bat — fast pitch updates. */
export const POLL_ACTIVE_MS = 100;

/** Live game between plays / pitching changes. */
export const POLL_IDLE_MS = 500;

/** Inning break or end/middle state. */
export const POLL_BREAK_MS = 800;

/** Background tab. */
export const POLL_HIDDEN_MS = 2_000;

export const MAX_IN_FLIGHT = 2;

/** Choose poll gap from linescore / current play shape. */
export function adaptivePollIntervalMs(
  feed: Pick<MLBLiveFeedResponse, "liveData"> | null,
  hidden: boolean,
): number {
  if (hidden) return POLL_HIDDEN_MS;
  if (!feed) return POLL_ACTIVE_MS;

  const linescore = feed.liveData.linescore;
  const currentPlay = feed.liveData.plays.currentPlay as AllPlayRaw | undefined;
  const inningState = (linescore.inningState ?? "").toLowerCase();

  if (/^(middle|end)$/.test(inningState)) {
    const hasActiveBatter =
      currentPlay?.about?.isComplete !== true &&
      Boolean(currentPlay?.matchup?.batter?.id);
    if (!hasActiveBatter) return POLL_BREAK_MS;
  }

  const isComplete = currentPlay?.about?.isComplete === true;
  const hasResult = Boolean(currentPlay?.result?.event?.trim());
  if (!isComplete && !hasResult && currentPlay?.matchup?.batter?.id) {
    return POLL_ACTIVE_MS;
  }

  return POLL_IDLE_MS;
}
