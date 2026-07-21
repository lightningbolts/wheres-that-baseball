import { NextResponse } from "next/server";

import {
  fetchGameHighlightClips,
  type GameHighlightClip,
} from "@/lib/mlb/gameHighlights";

export const dynamic = "force-dynamic";

/** Live games publish clips continuously — keep cache short. */
const LIVE_TTL_MS = 45 * 1000;
const FINAL_TTL_MS = 30 * 60 * 1000;

interface CacheEntry {
  clips: GameHighlightClip[];
  expiresAt: number;
}

const cache = new Map<number, CacheEntry>();

interface RouteParams {
  params: Promise<{ gamePk: string }>;
}

export async function GET(request: Request, { params }: RouteParams) {
  const { gamePk: raw } = await params;
  const gamePk = Number(raw);
  if (!Number.isFinite(gamePk) || gamePk <= 0) {
    return NextResponse.json({ error: "Invalid gamePk" }, { status: 400 });
  }

  const isLive = new URL(request.url).searchParams.get("live") === "1";
  const ttl = isLive ? LIVE_TTL_MS : FINAL_TTL_MS;

  const cached = cache.get(gamePk);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(
      { gamePk, clips: cached.clips },
      {
        headers: {
          "Cache-Control": isLive
            ? "public, max-age=30, stale-while-revalidate=30"
            : "public, max-age=300, stale-while-revalidate=600",
        },
      },
    );
  }

  try {
    const clips = await fetchGameHighlightClips(gamePk);
    cache.set(gamePk, { clips, expiresAt: Date.now() + ttl });
    return NextResponse.json(
      { gamePk, clips },
      {
        headers: {
          "Cache-Control": isLive
            ? "public, max-age=30, stale-while-revalidate=30"
            : "public, max-age=300, stale-while-revalidate=600",
        },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Fetch failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
