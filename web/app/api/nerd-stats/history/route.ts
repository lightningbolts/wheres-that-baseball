import { NextResponse } from "next/server";

import { getNerdStatDefinition } from "@/lib/mlb/nerdStats/definitions";
import { loadNerdStatHistory } from "@/lib/mlb/nerdStats/history";

export const dynamic = "force-dynamic";

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
        { status: 404, headers: { "Cache-Control": "public, max-age=120" } },
      );
    }

    return NextResponse.json(history, {
      headers: { "Cache-Control": "public, max-age=120" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load nerd stat history";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
