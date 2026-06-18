import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { enqueueArchiveFinishedGame } from "@/lib/games/archiveGame";
import { persistGameFeedCache } from "@/lib/games/feedCache";
import { isMlbFeedWrapper, parseStoredGameState } from "@/lib/games/gameState";
import { isExplicitlyNotStarted } from "@/lib/games/format";
import { parseLiveFeed } from "@/lib/mlb/liveFeed";
import { getCachedLiveFeed } from "@/lib/mlb/liveFeedServer";
import type { Game } from "@/types/database";
import { createClient } from "@/utils/supabase/server";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ gamePk: string }>;
}

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
      .select("game_pk, game_state, feed_synced_at, status")
      .eq("game_pk", gamePk)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }

    const row = data as Pick<Game, "game_pk" | "game_state" | "feed_synced_at" | "status"> | null;

    const stored = parseStoredGameState(row?.game_state, gamePk);
    if (stored) {
      return NextResponse.json({
        state: stored,
        source: "supabase",
        feedSyncedAt: row?.feed_synced_at ?? null,
      });
    }

    if (row && isExplicitlyNotStarted(row.status)) {
      return NextResponse.json({ error: "Game has not started" }, { status: 404 });
    }

    const feed = await getCachedLiveFeed(gamePk);
    const state = parseLiveFeed(gamePk, feed);

    if (row?.game_state != null && !isMlbFeedWrapper(row.game_state)) {
      void persistGameFeedCache(gamePk, feed);
    } else if (
      state.gameStatus === "Final" &&
      (!row?.feed_synced_at || !isMlbFeedWrapper(row?.game_state))
    ) {
      enqueueArchiveFinishedGame(gamePk);
    }

    return NextResponse.json({
      state,
      source: "mlb",
      feedSyncedAt: null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load game state";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
