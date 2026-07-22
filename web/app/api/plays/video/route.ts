import { NextResponse } from "next/server";

import {
  resolveFastballClip,
  resolveFilmroomClipByPlayId,
} from "@/lib/mlb/fastballClips";
import { resolveHighlightByPlayIds } from "@/lib/mlb/gameHighlights";
import {
  isValidPlayId,
  resolvePlayVideo,
  savantSportyVideosUrl,
  type ResolvedPlayVideo,
} from "@/lib/mlb/playVideo";

export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
/** Misses clear fast — Gameday clips often appear within seconds of the PA. */
const NEGATIVE_TTL_MS = 8 * 1000;

interface CacheEntry {
  value: ResolvedPlayVideo | null;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function parsePlayIds(requestUrl: URL): string[] {
  const primary = requestUrl.searchParams.get("playId")?.trim() ?? "";
  const alts = requestUrl.searchParams.get("playIds")?.split(",") ?? [];
  const ids = [primary, ...alts.map((id) => id.trim())].filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!isValidPlayId(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function cacheKey(playIds: string[], gamePk: number | null): string {
  const idKey = playIds.join(",");
  return gamePk != null ? `${idKey}|${gamePk}` : idKey;
}

async function resolveWithFallbacks(
  playIds: string[],
  gamePk: number | null,
): Promise<ResolvedPlayVideo | null> {
  const primary = playIds[0];
  if (!primary) return null;

  // 1) Fastball CDN — same path Gameday uses; usually live within seconds.
  if (gamePk != null) {
    try {
      const fastball = await resolveFastballClip(gamePk, playIds);
      if (fastball) {
        return {
          playId: fastball.playId,
          url: fastball.url,
          title: fastball.title,
          savantUrl: savantSportyVideosUrl(fastball.playId),
        };
      }
    } catch {
      // continue
    }
  }

  // 2) Film Room GraphQL by PlayId (works even when CDN probe is cold).
  for (const playId of playIds) {
    try {
      const filmroom = await resolveFilmroomClipByPlayId(playId);
      if (filmroom) {
        return {
          playId: filmroom.playId,
          url: filmroom.url,
          title: filmroom.title,
          savantUrl: savantSportyVideosUrl(filmroom.playId),
        };
      }
    } catch {
      // try next
    }
  }

  // 3) StatsAPI curated Content highlights (broadcast packages).
  if (gamePk != null) {
    try {
      const clip = await resolveHighlightByPlayIds(gamePk, playIds);
      if (clip) {
        return {
          playId: clip.playId ?? primary,
          url: clip.url,
          title: clip.title,
          savantUrl: savantSportyVideosUrl(primary),
        };
      }
    } catch {
      // continue
    }
  }

  // 4) Baseball Savant sporty-videos (often next-day for full archive coverage).
  for (const playId of playIds) {
    try {
      const resolved = await resolvePlayVideo(playId);
      if (resolved) return resolved;
    } catch {
      // try next
    }
  }

  return null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const playIds = parsePlayIds(url);
  const gamePkRaw = url.searchParams.get("gamePk");
  const gamePkNum = gamePkRaw != null && gamePkRaw !== "" ? Number(gamePkRaw) : null;
  const gamePk =
    gamePkNum != null && Number.isFinite(gamePkNum) && gamePkNum > 0 ? gamePkNum : null;

  if (playIds.length === 0) {
    return NextResponse.json({ error: "Invalid playId" }, { status: 400 });
  }

  const key = cacheKey(playIds, gamePk);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    if (!cached.value) {
      return NextResponse.json({ error: "Video not found" }, { status: 404 });
    }
    return NextResponse.json(cached.value, {
      headers: { "Cache-Control": "public, max-age=60" },
    });
  }

  try {
    const resolved = await resolveWithFallbacks(playIds, gamePk);
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
