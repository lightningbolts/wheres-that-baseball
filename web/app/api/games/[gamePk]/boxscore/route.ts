import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { parseStoredBoxScore } from "@/lib/games/gameState";
import { isExplicitlyNotStarted } from "@/lib/games/format";
import { fetchGameFeed } from "@/lib/mlb/liveFeed";
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
      .select("game_pk, box_score, feed_synced_at, status")
      .eq("game_pk", gamePk)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }

    const row = data as Pick<Game, "game_pk" | "box_score" | "feed_synced_at" | "status"> | null;

    const stored = parseStoredBoxScore(row?.box_score, gamePk);
    if (stored) {
      return NextResponse.json({
        boxScore: stored,
        source: "supabase",
        feedSyncedAt: row?.feed_synced_at ?? null,
      });
    }

    if (row && isExplicitlyNotStarted(row.status)) {
      return NextResponse.json({ error: "Game has not started" }, { status: 404 });
    }

    const { boxScore } = await fetchGameFeed(gamePk);
    if (!boxScore) {
      return NextResponse.json({ error: "Box score not available" }, { status: 404 });
    }

    return NextResponse.json({
      boxScore,
      source: "mlb",
      feedSyncedAt: null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load box score";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
