import { NextResponse } from "next/server";

import { publicApiCacheHeaders } from "@/lib/apiCacheHeaders";
import { fetchPlayerHittingSeasonLine } from "@/lib/mlb/playerHitting";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ playerId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { playerId: playerIdParam } = await context.params;
  const playerId = Number.parseInt(playerIdParam, 10);
  const { searchParams } = new URL(request.url);
  const seasonParam = searchParams.get("season");
  const season = seasonParam ? Number.parseInt(seasonParam, 10) : new Date().getFullYear();

  if (!Number.isFinite(playerId) || playerId <= 0) {
    return NextResponse.json({ error: "Invalid playerId" }, { status: 400 });
  }
  if (!Number.isFinite(season) || season < 2000) {
    return NextResponse.json({ error: "Invalid season" }, { status: 400 });
  }

  const line = await fetchPlayerHittingSeasonLine(playerId, season);

  return NextResponse.json(line, {
    headers: publicApiCacheHeaders(300, ["season"]),
  });
}
