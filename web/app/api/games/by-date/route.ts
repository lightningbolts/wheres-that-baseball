import { NextResponse } from "next/server";

import { scheduleBackgroundSlateSync } from "@/lib/games/backgroundSync";
import {
  isLiveScheduleDate,
  loadGamesForDate,
} from "@/lib/games/scheduleSync";

export const dynamic = "force-dynamic";

/** Today's slate — MLB schedule is source of truth for scores/status. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");
  const timeZone = searchParams.get("tz") ?? undefined;

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date query param required (YYYY-MM-DD)" }, { status: 400 });
  }

  if (!isLiveScheduleDate(date, timeZone)) {
    return NextResponse.json(
      { error: "Live MLB schedule fetch is only used for today's slate" },
      { status: 400 },
    );
  }

  try {
    const games = await loadGamesForDate(date, timeZone);

    void scheduleBackgroundSlateSync(date, games, timeZone);

    return NextResponse.json({ games, source: "mlb" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load games";
    return NextResponse.json({ error: message, games: [] }, { status: 502 });
  }
}
