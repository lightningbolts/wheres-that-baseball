import { NextResponse } from "next/server";

import { syncRecentScheduleAndFeeds } from "@/lib/games/scheduleSync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";

  const auth = request.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

/** Optional manual trigger — production sync runs via Supabase Cron + Edge Function. */
export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncRecentScheduleAndFeeds();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Schedule sync failed";
    return NextResponse.json({ error: message, ok: false }, { status: 502 });
  }
}
