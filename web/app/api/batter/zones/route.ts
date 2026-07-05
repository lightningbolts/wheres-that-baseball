import { NextResponse } from "next/server";

import { fetchBatterHotZones } from "@/lib/mlb/batterHotZones";

export const dynamic = "force-dynamic";
export const revalidate = 3600;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const batterId = Number(searchParams.get("batterId"));
  const season = Number(searchParams.get("season") ?? new Date().getFullYear());

  if (!Number.isFinite(batterId) || batterId <= 0) {
    return NextResponse.json({ error: "Invalid batter ID" }, { status: 400 });
  }

  try {
    const zones = await fetchBatterHotZones(batterId, season);
    return NextResponse.json(
      { zones },
      {
        headers: {
          "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=600",
        },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch batter zones";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
