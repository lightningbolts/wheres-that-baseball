import { NextResponse } from "next/server";

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

  const fromParam = new URL(request.url).searchParams.get("from");
  const from = fromParam == null ? 0 : Number.parseInt(fromParam, 10);
  if (!Number.isFinite(from) || from < 0) {
    return NextResponse.json({ error: "Invalid from index" }, { status: 400 });
  }

  try {
    const feed = await getCachedLiveFeed(gamePk);
    const allPlays = feed.liveData.plays.allPlays ?? [];
    return NextResponse.json({
      from,
      total: allPlays.length,
      plays: allPlays.slice(from),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch play chunk";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
