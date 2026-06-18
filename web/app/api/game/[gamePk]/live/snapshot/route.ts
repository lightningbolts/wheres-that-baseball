import { NextResponse } from "next/server";

import { getCachedLiveFeed } from "@/lib/mlb/liveFeedServer";
import { buildLiveFeedSnapshot } from "@/lib/mlb/liveFeed";

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
    const feed = await getCachedLiveFeed(gamePk);
    return NextResponse.json(buildLiveFeedSnapshot(gamePk, feed));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch live snapshot";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
