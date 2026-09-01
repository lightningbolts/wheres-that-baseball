import { NextResponse } from "next/server";

import { withNetlifyQueryVary } from "@/lib/apiCacheHeaders";
import { fetchSlateGames } from "@/lib/mlb/schedule";

const SLATE_CACHE_HEADERS = withNetlifyQueryVary(
  { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=30" },
  ["tz"],
);

/** Client polling endpoint — refreshes the live slate without a full reload. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const timeZone = searchParams.get("tz") ?? undefined;

  try {
    const games = await fetchSlateGames(undefined, timeZone);
    return NextResponse.json({ games }, { headers: SLATE_CACHE_HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch MLB schedule";
    return NextResponse.json({ error: message, games: [] }, { status: 502 });
  }
}
