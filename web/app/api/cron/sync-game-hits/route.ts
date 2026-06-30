import { NextResponse } from "next/server";

import { backfillGameHitsBatch } from "@/lib/games/syncGameHits";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";

  const auth = request.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

/** Backfill game_hits rows from archived game_state (cron / manual). */
export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const seasonParam = searchParams.get("season");
  const limitParam = searchParams.get("limit");
  const season = seasonParam ? Number.parseInt(seasonParam, 10) : new Date().getFullYear();
  const limit = limitParam ? Number.parseInt(limitParam, 10) : 40;

  if (!Number.isFinite(season) || season < 2000) {
    return NextResponse.json({ error: "Invalid season" }, { status: 400 });
  }

  try {
    const result = await backfillGameHitsBatch({
      season,
      limit: Number.isFinite(limit) ? limit : 40,
    });
    return NextResponse.json({ ok: true, season, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Hit backfill failed";
    return NextResponse.json({ error: message, ok: false }, { status: 502 });
  }
}
