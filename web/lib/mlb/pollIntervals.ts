import type { AllPlayRaw, MLBLiveFeedResponse } from "@/types/mlb-live";

/**
 * Live pitch polling must go browser → statsapi.mlb.com (or Gameday WS), never
 * through a Netlify function. Proxying the hot path exhausts free-tier quota
 * and adds a round trip vs MLB Gameday. Keep POLL_ACTIVE_MS at 100ms to match
 * or beat Gameday when the websocket is quiet.
 */
export const POLL_ACTIVE_MS = 100;

/** Live game between plays / pitching changes. */
export const POLL_IDLE_MS = 500;

/** Inning break or end/middle state. */
export const POLL_BREAK_MS = 800;

/** Background tab. */
export const POLL_HIDDEN_MS = 2_000;

/**
 * Safety-net poll when push is connected *and* we are not in an active at-bat.
 * Never stretch an incomplete PA — that is the 1–2s Reddit gap.
 */
export const POLL_REALTIME_FALLBACK_MS = 3_000;

export const MAX_IN_FLIGHT = 2;

/**
 * Choose poll gap. Push channels accelerate via immediate fetch; they must not
 * slow active at-bats below POLL_ACTIVE_MS. Idle/break may stretch to the
 * safety-net interval when WS/Realtime is connected. Hidden tabs stay slow.
 * Netlify CORS fallback is floored separately in the coordinator.
 */
export function effectivePollIntervalMs(
  feed: Pick<MLBLiveFeedResponse, "liveData"> | null,
  hidden: boolean,
  pushConnected: boolean,
): number {
  const adaptive = adaptivePollIntervalMs(feed, hidden);
  if (hidden) return adaptive;
  if (adaptive === POLL_ACTIVE_MS) return POLL_ACTIVE_MS;
  if (pushConnected) return POLL_REALTIME_FALLBACK_MS;
  return adaptive;
}

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
