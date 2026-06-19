import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { archiveFinishedGame } from "@/lib/games/archiveGame";
import { isStoredFeedComplete } from "@/lib/games/feedComplete";
import { parseStoredBoxScore } from "@/lib/games/gameState";
import { isExplicitlyNotStarted, isLiveStatus } from "@/lib/games/format";
import { parseBoxScore } from "@/lib/mlb/boxScore";
import { clearLiveFeedCache, getCachedLiveFeed } from "@/lib/mlb/liveFeedServer";
import type { Game } from "@/types/database";
import { createClient } from "@/utils/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

interface RouteParams {
  params: Promise<{ gamePk: string }>;
}

type BoxScoreRow = Pick<
  Game,
  "game_pk" | "box_score" | "feed_synced_at" | "status" | "away_score" | "home_score" | "game_state"
>;

function shouldFetchLiveBoxScore(
  status: string | null | undefined,
  liveQuery: boolean,
): boolean {
  if (liveQuery) return true;
  return isLiveStatus(status ?? "");
}

export async function GET(request: Request, { params }: RouteParams) {
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
      .select("game_pk, box_score, feed_synced_at, status, away_score, home_score, game_state")
      .eq("game_pk", gamePk)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }

    const row = data as BoxScoreRow | null;
    const liveQuery = new URL(request.url).searchParams.get("live") === "1";

    if (shouldFetchLiveBoxScore(row?.status, liveQuery)) {
      const feed = await getCachedLiveFeed(gamePk);
      const boxScore = parseBoxScore(gamePk, feed);
      if (!boxScore) {
        return NextResponse.json({ error: "Box score not available" }, { status: 404 });
      }
      return NextResponse.json({ boxScore, source: "mlb", feedSyncedAt: null });
    }

    const stored = parseStoredBoxScore(row?.box_score, gamePk);
    if (stored && isStoredFeedComplete(row)) {
      return NextResponse.json({
        boxScore: stored,
        source: "supabase",
        feedSyncedAt: row?.feed_synced_at ?? null,
      });
    }

    if (row && isExplicitlyNotStarted(row.status)) {
      return NextResponse.json({ error: "Game has not started" }, { status: 404 });
    }

    clearLiveFeedCache(gamePk);
    const feed = await getCachedLiveFeed(gamePk);
    const boxScore = parseBoxScore(gamePk, feed);
    if (!boxScore) {
      return NextResponse.json({ error: "Box score not available" }, { status: 404 });
    }

    let feedSyncedAt: string | null = null;
    const status = feed.gameData.status.abstractGameState;
    if (status === "Final") {
      const archiveResult = await archiveFinishedGame(gamePk, {
        maxAttempts: 4,
        retryDelayMs: 8_000,
        force: true,
      });
      feedSyncedAt = archiveResult.feedSyncedAt ?? null;
    }

    return NextResponse.json({
      boxScore,
      source: "mlb",
      feedSyncedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load box score";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
