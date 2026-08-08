import { NextResponse } from "next/server";

import {
  fastballClipUrl,
  isFastballFeed,
  type FastballFeed,
} from "@/lib/mlb/fastballClips";
import { isValidPlayId } from "@/lib/mlb/playVideo";

const UPSTREAM_HEADERS: HeadersInit = {
  Accept: "*/*",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  // CDN hotlink-protects non-MLB origins — fetch as mlb.com from the server.
  Origin: "https://www.mlb.com",
  Referer: "https://www.mlb.com/",
};

export function parseStreamFeed(raw: string | null | undefined): FastballFeed {
  const normalized = raw?.trim().toLowerCase() ?? "";
  return isFastballFeed(normalized) ? normalized : "home";
}

/**
 * Proxy a single Fastball CDN MP4. Path-keyed URLs are required so browser /
 * intermediary caches cannot reuse one play's bytes for another playId
 * (query-string-only URLs were collapsing to the first clip loaded).
 */
export async function proxyFastballStream(options: {
  gamePk: number;
  playId: string;
  feed: FastballFeed;
  range?: string | null;
}): Promise<Response> {
  const { gamePk, playId, feed, range } = options;

  if (!isValidPlayId(playId) || !Number.isFinite(gamePk) || gamePk <= 0) {
    return NextResponse.json({ error: "Invalid clip params" }, { status: 400 });
  }

  const upstreamUrl = fastballClipUrl(gamePk, playId, feed);

  try {
    const upstream = await fetch(upstreamUrl, {
      headers: {
        ...UPSTREAM_HEADERS,
        ...(range ? { Range: range } : {}),
      },
      cache: "no-store",
    });

    if (!upstream.ok && upstream.status !== 206) {
      return NextResponse.json(
        { error: `Upstream ${upstream.status}` },
        { status: upstream.status === 404 ? 404 : 502 },
      );
    }

    const contentType = upstream.headers.get("content-type") ?? "";
    if (contentType.includes("text/html")) {
      return NextResponse.json({ error: "Clip unavailable" }, { status: 404 });
    }

    const headers = new Headers();
    headers.set("Content-Type", contentType || "video/mp4");
    headers.set("Accept-Ranges", "bytes");
    // Path already includes playId — safe to cache per URL. Mark private so
    // shared CDNs don't serve across users with stale Range state.
    headers.set("Cache-Control", "private, max-age=3600, immutable");
    headers.set("Cross-Origin-Resource-Policy", "cross-origin");
    // Bind validators to this exact clip so caches cannot reuse another play.
    headers.set("ETag", `"fb-${gamePk}-${feed}-${playId}"`);
    headers.set("X-Play-Id", playId);

    for (const key of ["Content-Length", "Content-Range", "Last-Modified"]) {
      const value = upstream.headers.get(key);
      if (value) headers.set(key, value);
    }

    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Stream failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
