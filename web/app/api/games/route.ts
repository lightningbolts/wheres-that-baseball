import { NextResponse } from "next/server";

import { fetchSlateGames } from "@/lib/mlb/schedule";

export const dynamic = "force-dynamic";

/** Client polling endpoint — refreshes the live slate without a full reload. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const timeZone = searchParams.get("tz") ?? undefined;

  try {
    const games = await fetchSlateGames(undefined, timeZone);
    return NextResponse.json({ games });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch MLB schedule";
    return NextResponse.json({ error: message, games: [] }, { status: 502 });
  }
}
