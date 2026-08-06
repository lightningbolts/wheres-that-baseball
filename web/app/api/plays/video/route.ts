import { NextResponse } from "next/server";

import {
  proxiedFastballClipUrl,
  resolveFastballClip,
  resolveFilmroomClipByPlayId,
  type FastballFeed,
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

function fromFastballClip(clip: {
  playId: string;
  gamePk: number;
  feed: FastballFeed;
  availableFeeds: FastballFeed[];
  url: string;
  title: string | null;
}): ResolvedPlayVideo {
  return {
    playId: clip.playId,
    url: clip.url,
    title: clip.title,
    savantUrl: savantSportyVideosUrl(clip.playId),
    gamePk: clip.gamePk,
    feed: clip.feed,
    availableFeeds: clip.availableFeeds,
  };
}

async function resolveWithFallbacks(
  playIds: string[],
  gamePk: number | null,
): Promise<ResolvedPlayVideo | null> {
  const primary = playIds[0];
  if (!primary) return null;

  // Fastball / Film Room: exact primary play GUID for this game only.
  // Candidate pitch GUIDs are Content-only — using them here can latch onto
  // an earlier pitch clip that does not match the finished play.
  const exactPlayIds = [primary];

  // 1) Fastball CDN — same path Gameday uses; usually live within seconds.
  if (gamePk != null) {
    try {
      const fastball = await resolveFastballClip(gamePk, exactPlayIds);
      if (fastball) return fromFastballClip(fastball);
    } catch {
      // continue
    }
  }

  // 2) Film Room GraphQL by PlayId (works even when CDN probe is cold).
  try {
    const filmroom = await resolveFilmroomClipByPlayId(primary, undefined, gamePk);
    if (filmroom) {
      if (gamePk != null && filmroom.gamePk > 0 && filmroom.gamePk !== gamePk) {
        // Reject clips that belong to a different game.
      } else {
        return fromFastballClip(filmroom);
      }
    }
  } catch {
    // continue
  }

  // 3) StatsAPI curated Content highlights (broadcast packages).
  // Candidates help here — Content often keys the in-play pitch GUID.
  if (gamePk != null) {
    try {
      const clip = await resolveHighlightByPlayIds(gamePk, playIds);
      if (clip) {
        return {
          playId: clip.playId ?? primary,
          url: clip.url,
          title: clip.title,
          savantUrl: savantSportyVideosUrl(primary),
          gamePk,
          feed: null,
          availableFeeds: [],
        };
      }
    } catch {
      // continue
    }
  }

  // 4) Baseball Savant sporty-videos (often next-day for full archive coverage).
  // Stick to the terminal play GUID so we don't pull a different pitch's clip.
  try {
    const resolved = await resolvePlayVideo(primary);
    if (resolved) {
      return {
        ...resolved,
        gamePk,
        feed: null,
        availableFeeds: [],
      };
    }
  } catch {
    // miss
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
  const feedRaw = url.searchParams.get("feed")?.trim().toLowerCase() ?? "";
  const preferredFeed: FastballFeed | null =
    feedRaw === "home" || feedRaw === "away" || feedRaw === "network" ? feedRaw : null;

  if (playIds.length === 0) {
    return NextResponse.json({ error: "Invalid playId" }, { status: 400 });
  }

  const key = cacheKey(playIds, gamePk);
  const cached = cache.get(key);
  let resolved: ResolvedPlayVideo | null = null;

  if (cached && cached.expiresAt > Date.now()) {
    resolved = cached.value;
  } else {
    try {
      resolved = await resolveWithFallbacks(playIds, gamePk);
      cache.set(key, {
        value: resolved,
        expiresAt: Date.now() + (resolved ? CACHE_TTL_MS : NEGATIVE_TTL_MS),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Resolve failed";
      return NextResponse.json({ error: message }, { status: 502 });
    }
  }

  if (!resolved) {
    return NextResponse.json({ error: "Video not found" }, { status: 404 });
  }

  // Honor an explicit feed choice when that angle was discovered for this play.
  if (
    preferredFeed &&
    resolved.gamePk != null &&
    resolved.gamePk > 0 &&
    (resolved.availableFeeds ?? []).includes(preferredFeed)
  ) {
    resolved = {
      ...resolved,
      feed: preferredFeed,
      url: proxiedFastballClipUrl(resolved.gamePk, resolved.playId, preferredFeed),
    };
  }

  return NextResponse.json(resolved, {
    headers: {
      "Cache-Control": cached && cached.expiresAt > Date.now()
        ? "public, max-age=60"
        : "public, max-age=300",
    },
  });
}
