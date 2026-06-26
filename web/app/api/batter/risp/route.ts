import { NextResponse } from "next/server";

import { fetchBatterRispStats } from "@/lib/mlb/batterStats";

export const dynamic = "force-dynamic";
export const revalidate = 3600;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const batterId = Number(searchParams.get("batterId"));

  if (!Number.isFinite(batterId) || batterId <= 0) {
    return NextResponse.json({ error: "Invalid batter ID" }, { status: 400 });
  }

  try {
    const stats = await fetchBatterRispStats(batterId);
    return NextResponse.json(
      { stats },
      {
        headers: {
          "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=600",
        },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch RISP stats";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
