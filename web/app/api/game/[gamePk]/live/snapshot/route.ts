import { NextResponse } from "next/server";

import { parseBoxScore } from "@/lib/mlb/boxScore";
import { buildLiveFeedSnapshot, mergeCurrentPlayTail } from "@/lib/mlb/liveFeed";
import type { AllPlayRaw } from "@/types/mlb-live";
import { getCachedLiveFeed } from "@/lib/mlb/liveFeedServer";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ gamePk: string }>;
}

export async function GET(request: Request, { params }: RouteParams) {
  const { gamePk: gamePkParam } = await params;
  const gamePk = Number(gamePkParam);

  if (!Number.isFinite(gamePk) || gamePk <= 0) {
    return NextResponse.json({ error: "Invalid game PK" }, { status: 400 });
  }

  const fromParam = new URL(request.url).searchParams.get("playsFrom");
  const playsFrom = fromParam == null ? null : Number.parseInt(fromParam, 10);

  try {
    const feed = await getCachedLiveFeed(gamePk);
    const snapshot = buildLiveFeedSnapshot(gamePk, feed);
    const boxScore = parseBoxScore(gamePk, feed);

    if (playsFrom != null && Number.isFinite(playsFrom) && playsFrom >= 0) {
      const allPlays = feed.liveData.plays.allPlays ?? [];
      const currentPlay = feed.liveData.plays.currentPlay;
      const merged = mergeCurrentPlayTail(
        allPlays,
        currentPlay as AllPlayRaw | undefined,
        playsFrom,
      );
      return NextResponse.json({
        ...snapshot,
        boxScore,
        plays: { from: playsFrom, total: allPlays.length, plays: merged },
      });
    }

    return NextResponse.json({ ...snapshot, boxScore });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch live snapshot";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
