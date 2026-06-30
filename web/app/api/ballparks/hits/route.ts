import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import {
  aggregateBallparkHits,
  type BallparkHitsAggregate,
  type BallparkHitsDetail,
} from "@/lib/mlb/ballparkHits";
import { fetchSeasonGameHitRows } from "@/lib/mlb/ballparkHitsQuery";
import { createClient } from "@/utils/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CACHE_TTL_MS = 5 * 60 * 1000;

const responseCache = new Map<string, { expiresAt: number; payload: unknown }>();

function cacheKey(season: number, venueId?: number): string {
  return venueId != null ? `${season}:venue:${venueId}` : `${season}:summary`;
}

function getCachedResponse<T>(key: string): T | null {
  const entry = responseCache.get(key);
  if (!entry || entry.expiresAt <= Date.now()) {
    if (entry) responseCache.delete(key);
    return null;
  }
  return entry.payload as T;
}

function setCachedResponse(key: string, payload: unknown): void {
  responseCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, payload });
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

  const key = cacheKey(season, venueId);
  const cached = getCachedResponse<BallparkHitsAggregate | BallparkHitsDetail>(key);
  if (cached) {
    return NextResponse.json(cached, {
      headers: { "Cache-Control": "private, max-age=300" },
    });
  }

  try {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);
    const rows = await fetchSeasonGameHitRows(supabase, season, venueId);
    const result = aggregateBallparkHits(season, rows, venueId);
    setCachedResponse(key, result);

    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, max-age=300" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load ballpark hits";
    const status = message === "Unknown venue" ? 404 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
