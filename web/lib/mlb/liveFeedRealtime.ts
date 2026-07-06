"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";

import {
  isMlbFeedWrapper,
  isParsedStateWrapper,
  parseStoredBoxScore,
  parseStoredGameState,
} from "@/lib/games/gameState";
import { buildLiveFeedSnapshot } from "@/lib/mlb/liveFeed";
import type { GameBoxScore } from "@/types/mlb-boxscore";
import type { LiveGameState, MLBLiveFeedResponse } from "@/types/mlb-live";
import { createClient } from "@/utils/supabase/client";

export type GameStateRealtimeStatus = "connecting" | "connected" | "disconnected" | "error";

export interface GameStateRealtimePayload {
  gameState: LiveGameState;
  boxScore: GameBoxScore | null;
  feed: MLBLiveFeedResponse | null;
  updatedAt: string;
}

export interface GameStateRealtimeSubscription {
  unsubscribe: () => void;
}

/**
 * Push path for live game_state JSON written by the ingestor.
 * Polling remains the fallback when Realtime is unavailable.
 */
export function subscribeGameStateRealtime(
  gamePk: number,
  onUpdate: (payload: GameStateRealtimePayload) => void,
  onStatus?: (status: GameStateRealtimeStatus) => void,
): GameStateRealtimeSubscription {
  const supabase = createClient();
  let cancelled = false;

  const applyRow = (raw: Record<string, unknown>) => {
    const gameStateRaw = raw.game_state;
    const updatedAt =
      typeof raw.updated_at === "string" ? raw.updated_at : new Date().toISOString();

    if (isParsedStateWrapper(gameStateRaw)) {
      const gameState =
        gameStateRaw.parsed.gamePk === gamePk
          ? gameStateRaw.parsed
          : { ...gameStateRaw.parsed, gamePk };
      const boxScore = parseStoredBoxScore(raw.box_score, gamePk);
      onUpdate({
        gameState,
        boxScore,
        feed: null,
        updatedAt,
      });
      return;
    }

    if (!isMlbFeedWrapper(gameStateRaw)) return;

    const feed = gameStateRaw.mlbFeed;
    const gameState = parseStoredGameState(gameStateRaw, gamePk);
    if (!gameState) return;

    const boxScore = parseStoredBoxScore(gameStateRaw, gamePk);
    onUpdate({ gameState, boxScore, feed, updatedAt });
  };

  void (async () => {
    onStatus?.("connecting");
    const { data, error } = await supabase
      .from("games")
      .select("game_pk, game_state, box_score, updated_at")
      .eq("game_pk", gamePk)
      .maybeSingle();

    if (cancelled) return;
    if (error) {
      onStatus?.("error");
      return;
    }
    if (data) {
      applyRow(data as Record<string, unknown>);
    }
  })();

  const channel = supabase
    .channel(`games:game_pk=${gamePk}`)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "games",
        filter: `game_pk=eq.${gamePk}`,
      },
      (payload) => {
        if (payload.new) {
          applyRow(payload.new as Record<string, unknown>);
          onStatus?.("connected");
        }
      },
    )
    .subscribe((status) => {
      if (cancelled) return;
      if (status === "SUBSCRIBED") onStatus?.("connected");
      else if (status === "CHANNEL_ERROR") onStatus?.("error");
      else if (status === "TIMED_OUT" || status === "CLOSED") onStatus?.("disconnected");
    });

  return {
    unsubscribe: () => {
      cancelled = true;
      void supabase.removeChannel(channel);
      onStatus?.("disconnected");
    },
  };
}

/** Build snapshot metadata from a full realtime feed push. */
export function snapshotFromRealtimeFeed(
  gamePk: number,
  feed: MLBLiveFeedResponse,
) {
  return buildLiveFeedSnapshot(gamePk, feed);
}
