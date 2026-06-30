import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { backfillGameHitsBatch } from "@/lib/games/syncGameHits";
import { getServiceSupabase } from "@/lib/games/supabaseAdmin";
import {
  aggregateBallparkHits,
  type BallparkHitsAggregate,
  type BallparkHitsDetail,
} from "@/lib/mlb/ballparkHits";
import { countIndexedGameHits, fetchIndexedGameHits } from "@/lib/mlb/ballparkHitsQuery";
import { createClient } from "@/utils/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CACHE_TTL_MS = 5 * 60 * 1000;
const BACKFILL_BATCH_SIZE = 15;

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

function isMissingRelationError(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes("game_hits") && (lower.includes("does not exist") || lower.includes("schema cache"));
}

async function maybeBackfill(season: number, indexedCount: number): Promise<boolean> {
  if (indexedCount > 0 || !getServiceSupabase()) {
    return false;
  }

  const { processed } = await backfillGameHitsBatch({ season, limit: BACKFILL_BATCH_SIZE });
  return processed > 0;
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

    let indexedCount = await countIndexedGameHits(supabase, season);
    let backfillRan = false;

    if (indexedCount === 0) {
      backfillRan = await maybeBackfill(season, indexedCount);
      if (backfillRan) {
        indexedCount = await countIndexedGameHits(supabase, season);
      }
    }

    let rows = await fetchIndexedGameHits(supabase, season, venueId);
    const result =
      venueId != null
        ? aggregateBallparkHits(season, rows, venueId)
        : aggregateBallparkHits(season, rows, undefined, {
            backfillPending: indexedCount === 0 && getServiceSupabase() != null,
          });

    setCachedResponse(key, result);

    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, max-age=300" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load ballpark hits";

    if (isMissingRelationError(message)) {
      return NextResponse.json(
        {
          error:
            "Ballpark hits index is not set up yet. Apply the game_hits migration in Supabase, then run the hit backfill.",
        },
        { status: 503 },
      );
    }

    const status = message === "Unknown venue" ? 404 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
