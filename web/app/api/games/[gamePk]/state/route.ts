import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { archiveFinishedGame } from "@/lib/games/archiveGame";
import { isStoredFeedComplete } from "@/lib/games/feedComplete";
import { parseStoredGameState } from "@/lib/games/gameState";
import { isExplicitlyNotStarted } from "@/lib/games/format";
import { parseLiveFeed } from "@/lib/mlb/liveFeed";
import { clearLiveFeedCache, getCachedLiveFeed } from "@/lib/mlb/liveFeedServer";
import type { Game } from "@/types/database";
import { createClient } from "@/utils/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

interface RouteParams {
  params: Promise<{ gamePk: string }>;
}

type GameStateRow = Pick<
  Game,
  "game_pk" | "game_state" | "feed_synced_at" | "status" | "away_score" | "home_score"
>;

export async function GET(_request: Request, { params }: RouteParams) {
  const { gamePk: gamePkParam } = await params;
  const gamePk = Number(gamePkParam);

  if (!Number.isFinite(gamePk) || gamePk <= 0) {
    return NextResponse.json({ error: "Invalid game PK" }, { status: 400 });
  }

  try {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    const { data, error } = await supabase
      .from("games")
      .select("game_pk, game_state, feed_synced_at, status, away_score, home_score")
      .eq("game_pk", gamePk)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }

    const row = data as GameStateRow | null;
    const stored = parseStoredGameState(row?.game_state, gamePk);

    if (stored && isStoredFeedComplete(row)) {
      return NextResponse.json({
        state: stored,
        source: "supabase",
        feedSyncedAt: row?.feed_synced_at ?? null,
      });
    }

    if (row && isExplicitlyNotStarted(row.status)) {
      return NextResponse.json({ error: "Game has not started" }, { status: 404 });
    }

    clearLiveFeedCache(gamePk);
    const feed = await getCachedLiveFeed(gamePk);
    const state = parseLiveFeed(gamePk, feed);

    let feedSyncedAt: string | null = null;
    if (state.gameStatus === "Final") {
      const archiveResult = await archiveFinishedGame(gamePk, {
        maxAttempts: 4,
        retryDelayMs: 8_000,
        force: true,
      });
      feedSyncedAt = archiveResult.feedSyncedAt ?? null;
    }

    return NextResponse.json({
      state,
      source: "mlb",
      feedSyncedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load game state";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
