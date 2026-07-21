import { NextResponse } from "next/server";

import { resolveHighlightByPlayId } from "@/lib/mlb/gameHighlights";
import {
  isValidPlayId,
  resolvePlayVideo,
  savantSportyVideosUrl,
  type ResolvedPlayVideo,
} from "@/lib/mlb/playVideo";

export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
/** Live misses clear quickly — clips often appear minutes later. */
const NEGATIVE_TTL_MS = 2 * 60 * 1000;

interface CacheEntry {
  value: ResolvedPlayVideo | null;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function cacheKey(playId: string, gamePk: number | null): string {
  return gamePk != null ? `${playId}|${gamePk}` : playId;
}

async function resolveWithContentFallback(
  playId: string,
  gamePk: number | null,
): Promise<ResolvedPlayVideo | null> {
  if (gamePk != null) {
    try {
      const clip = await resolveHighlightByPlayId(gamePk, playId);
      if (clip) {
        return {
          playId,
          url: clip.url,
          title: clip.title,
          savantUrl: savantSportyVideosUrl(playId),
        };
      }
    } catch {
      // Content is best-effort; fall through to Savant.
    }
  }
  return resolvePlayVideo(playId);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const playId = url.searchParams.get("playId")?.trim() ?? "";
  const gamePkRaw = url.searchParams.get("gamePk");
  const gamePkNum = gamePkRaw != null && gamePkRaw !== "" ? Number(gamePkRaw) : null;
  const gamePk =
    gamePkNum != null && Number.isFinite(gamePkNum) && gamePkNum > 0 ? gamePkNum : null;

  if (!playId || !isValidPlayId(playId)) {
    return NextResponse.json({ error: "Invalid playId" }, { status: 400 });
  }

  const key = cacheKey(playId, gamePk);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    if (!cached.value) {
      return NextResponse.json({ error: "Video not found" }, { status: 404 });
    }
    return NextResponse.json(cached.value, {
      headers: { "Cache-Control": "public, max-age=300" },
    });
  }

  try {
    const resolved = await resolveWithContentFallback(playId, gamePk);
    cache.set(key, {
      value: resolved,
      expiresAt: Date.now() + (resolved ? CACHE_TTL_MS : NEGATIVE_TTL_MS),
    });

    if (!resolved) {
      return NextResponse.json({ error: "Video not found" }, { status: 404 });
    }

    return NextResponse.json(resolved, {
      headers: { "Cache-Control": "public, max-age=300" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Resolve failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
