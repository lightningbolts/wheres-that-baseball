import { parseLiveFeed, stripMlbFeedForStorage } from "@/lib/mlb/liveFeed";
import type { LiveGameState, MLBLiveFeedResponse } from "@/types/mlb-live";

export type StoredGameState =
  | { parsed: LiveGameState }
  | { mlbFeed: MLBLiveFeedResponse };

export function isMlbFeedWrapper(raw: unknown): raw is { mlbFeed: MLBLiveFeedResponse } {
  return (
    raw != null &&
    typeof raw === "object" &&
    "mlbFeed" in raw &&
    typeof (raw as { mlbFeed: unknown }).mlbFeed === "object" &&
    (raw as { mlbFeed: unknown }).mlbFeed != null
  );
}

export function isParsedStateWrapper(raw: unknown): raw is { parsed: LiveGameState } {
  return (
    raw != null &&
    typeof raw === "object" &&
    "parsed" in raw &&
    typeof (raw as { parsed: unknown }).parsed === "object" &&
    (raw as { parsed: unknown }).parsed != null &&
    Array.isArray((raw as { parsed: LiveGameState }).parsed.plays)
  );
}

function isFinalStatus(status: string | null | undefined): boolean {
  return status === "Final";
}

/** Choose the smallest durable storage shape for a synced game feed. */
export function wrapGameStateForStorage(
  gamePk: number,
  feed: MLBLiveFeedResponse,
  status: string,
): StoredGameState {
  if (isFinalStatus(status)) {
    return { parsed: parseLiveFeed(gamePk, feed) };
  }
  return { mlbFeed: stripMlbFeedForStorage(feed) };
}

export interface CompactGameStateResult {
  payload: StoredGameState;
  beforeBytes: number;
  afterBytes: number;
  format: "parsed" | "mlbFeed" | "unchanged";
}

/** Compact an existing stored game_state row without re-fetching MLB. */
export function compactStoredGameState(
  raw: unknown,
  gamePk: number,
  status: string,
): CompactGameStateResult | null {
  const beforeBytes = JSON.stringify(raw ?? null).length;

  if (isParsedStateWrapper(raw)) {
    const normalized: StoredGameState = {
      parsed: raw.parsed.gamePk === gamePk ? raw.parsed : { ...raw.parsed, gamePk },
    };
    const afterBytes = JSON.stringify(normalized).length;
    if (afterBytes >= beforeBytes) {
      return { payload: normalized, beforeBytes, afterBytes, format: "unchanged" };
    }
    return { payload: normalized, beforeBytes, afterBytes, format: "parsed" };
  }

  if (!isMlbFeedWrapper(raw)) {
    return null;
  }

  if (isFinalStatus(status)) {
    const parsed = parseLiveFeed(gamePk, raw.mlbFeed);
    const payload: StoredGameState = { parsed };
    const afterBytes = JSON.stringify(payload).length;
    return { payload, beforeBytes, afterBytes, format: "parsed" };
  }

  const payload: StoredGameState = { mlbFeed: stripMlbFeedForStorage(raw.mlbFeed) };
  const afterBytes = JSON.stringify(payload).length;
  if (afterBytes >= beforeBytes) {
    return { payload, beforeBytes, afterBytes, format: "unchanged" };
  }
  return { payload, beforeBytes, afterBytes, format: "mlbFeed" };
}

export function storedGameStatePlayCount(raw: unknown): number {
  if (isParsedStateWrapper(raw)) {
    return raw.parsed.plays.length;
  }
  if (isMlbFeedWrapper(raw)) {
    return raw.mlbFeed.liveData?.plays?.allPlays?.length ?? 0;
  }
  return 0;
}
