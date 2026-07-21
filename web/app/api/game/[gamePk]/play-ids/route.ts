import { NextResponse } from "next/server";

import { getCachedLiveFeed } from "@/lib/mlb/liveFeedServer";
import { extractPlayIdMapFromFeed } from "@/lib/mlb/playVideo";

export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 60 * 60 * 1000;

interface CacheEntry {
  playIds: Record<string, string>;
  expiresAt: number;
}

const cache = new Map<number, CacheEntry>();

interface RouteParams {
  params: Promise<{ gamePk: string }>;
}

export async function GET(_request: Request, { params }: RouteParams) {
  const { gamePk: raw } = await params;
  const gamePk = Number(raw);
  if (!Number.isFinite(gamePk) || gamePk <= 0) {
    return NextResponse.json({ error: "Invalid gamePk" }, { status: 400 });
  }

  const cached = cache.get(gamePk);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(
      { gamePk, playIds: cached.playIds },
      { headers: { "Cache-Control": "public, max-age=300" } },
    );
  }

  try {
    const feed = await getCachedLiveFeed(gamePk);
    const playIds = extractPlayIdMapFromFeed(feed);
    cache.set(gamePk, { playIds, expiresAt: Date.now() + CACHE_TTL_MS });

    return NextResponse.json(
      { gamePk, playIds },
      { headers: { "Cache-Control": "public, max-age=300" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Fetch failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
