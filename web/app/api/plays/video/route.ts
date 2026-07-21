import { NextResponse } from "next/server";

import {
  isValidPlayId,
  resolvePlayVideo,
  type ResolvedPlayVideo,
} from "@/lib/mlb/playVideo";

export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 15 * 60 * 1000;

interface CacheEntry {
  value: ResolvedPlayVideo | null;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

export async function GET(request: Request) {
  const playId = new URL(request.url).searchParams.get("playId")?.trim() ?? "";
  if (!playId || !isValidPlayId(playId)) {
    return NextResponse.json({ error: "Invalid playId" }, { status: 400 });
  }

  const cached = cache.get(playId);
  if (cached && cached.expiresAt > Date.now()) {
    if (!cached.value) {
      return NextResponse.json({ error: "Video not found" }, { status: 404 });
    }
    return NextResponse.json(cached.value, {
      headers: { "Cache-Control": "public, max-age=300" },
    });
  }

  try {
    const resolved = await resolvePlayVideo(playId);
    cache.set(playId, {
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
