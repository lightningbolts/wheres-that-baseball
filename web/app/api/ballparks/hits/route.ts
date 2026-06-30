import { NextResponse } from "next/server";

import type { BallparkHitsAggregate, BallparkHitsDetail } from "@/lib/mlb/ballparkHits";
import {
  getEmptyBallparkHitsDetail,
  getEmptyBallparkHitsSummary,
  loadBallparkHitsDetail,
  loadBallparkHitsSummary,
} from "@/lib/mlb/ballparkHitsStore";

export const dynamic = "force-dynamic";

function loadSummary(season: number): BallparkHitsAggregate {
  const summary = loadBallparkHitsSummary(season);
  if (summary) {
    return { ...summary, source: "file" };
  }

  return {
    ...getEmptyBallparkHitsSummary(season),
    source: "empty",
    backfillPending: true,
  };
}

function loadDetail(season: number, venueId: number): BallparkHitsDetail {
  const detail = loadBallparkHitsDetail(season, venueId);
  if (detail) {
    return { ...detail, source: "file" };
  }

  try {
    return { ...getEmptyBallparkHitsDetail(season, venueId), source: "empty" };
  } catch {
    throw new Error("Unknown venue");
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const seasonParam = searchParams.get("season");
  const venueIdParam = searchParams.get("venueId");
  const season = seasonParam ? Number.parseInt(seasonParam, 10) : new Date().getFullYear();
  const venueId = venueIdParam ? Number.parseInt(venueIdParam, 10) : undefined;

  if (!Number.isFinite(season) || season < 2000) {
    return NextResponse.json({ error: "Invalid season" }, { status: 400 });
  }

  if (venueIdParam != null && (!Number.isFinite(venueId) || venueId! <= 0)) {
    return NextResponse.json({ error: "Invalid venueId" }, { status: 400 });
  }

  try {
    const result = venueId != null ? loadDetail(season, venueId) : loadSummary(season);

    return NextResponse.json(result, {
      headers: { "Cache-Control": "public, max-age=120" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load ballpark hits";
    const status = message === "Unknown venue" ? 404 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
