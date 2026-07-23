import { NextResponse } from "next/server";

import { searchPlayerBipIndex } from "@/lib/mlb/playerBipStore";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") ?? "";
  const seasonParam = searchParams.get("season");
  const season = seasonParam ? Number.parseInt(seasonParam, 10) : new Date().getFullYear();
  const limitParam = searchParams.get("limit");
  const limit = limitParam ? Number.parseInt(limitParam, 10) : 10;

  if (!Number.isFinite(season) || season < 2000) {
    return NextResponse.json({ error: "Invalid season" }, { status: 400 });
  }

  const players = searchPlayerBipIndex(
    season,
    q,
    Number.isFinite(limit) && limit > 0 ? Math.min(limit, 25) : 10,
  );

  return NextResponse.json(
    { season, players },
    { headers: { "Cache-Control": "public, max-age=60" } },
  );
}
