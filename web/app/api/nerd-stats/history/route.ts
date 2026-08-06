import { NextResponse } from "next/server";

import { publicApiCacheHeaders } from "@/lib/apiCacheHeaders";
import { getNerdStatDefinition } from "@/lib/mlb/nerdStats/definitions";
import { loadNerdStatHistory } from "@/lib/mlb/nerdStats/historyStore";

export const dynamic = "force-dynamic";

const HISTORY_CACHE_VARY = ["season", "statId"] as const;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const seasonParam = searchParams.get("season");
  const statId = searchParams.get("statId");
  const season = seasonParam ? Number.parseInt(seasonParam, 10) : new Date().getFullYear();

  if (!Number.isFinite(season) || season < 2000) {
    return NextResponse.json({ error: "Invalid season" }, { status: 400 });
  }

  if (!statId) {
    return NextResponse.json({ error: "statId is required" }, { status: 400 });
  }

  if (!getNerdStatDefinition(statId)) {
    return NextResponse.json({ error: "Unknown stat" }, { status: 404 });
  }

  try {
    const history = loadNerdStatHistory(season, statId);
    if (!history) {
      return NextResponse.json(
        { available: false, error: "History not found" },
        { status: 404, headers: publicApiCacheHeaders(120, [...HISTORY_CACHE_VARY]) },
      );
    }

    return NextResponse.json(history, {
      headers: publicApiCacheHeaders(120, [...HISTORY_CACHE_VARY]),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load nerd stat history";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
