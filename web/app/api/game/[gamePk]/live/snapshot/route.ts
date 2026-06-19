import { NextResponse } from "next/server";

import { getCachedLiveFeed } from "@/lib/mlb/liveFeedServer";
import { buildLiveFeedSnapshot } from "@/lib/mlb/liveFeed";

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

    if (playsFrom != null && Number.isFinite(playsFrom) && playsFrom >= 0) {
      const allPlays = feed.liveData.plays.allPlays ?? [];
      return NextResponse.json({
        ...snapshot,
        plays: { from: playsFrom, total: allPlays.length, plays: allPlays.slice(playsFrom) },
      });
    }

    return NextResponse.json(snapshot);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch live snapshot";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
