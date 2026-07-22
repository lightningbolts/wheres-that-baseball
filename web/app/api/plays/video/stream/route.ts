import { NextResponse } from "next/server";

import { fastballClipUrl, type FastballFeed } from "@/lib/mlb/fastballClips";
import { isValidPlayId } from "@/lib/mlb/playVideo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UPSTREAM_HEADERS: HeadersInit = {
  Accept: "*/*",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  // CDN hotlink-protects non-MLB origins — fetch as mlb.com from the server.
  Origin: "https://www.mlb.com",
  Referer: "https://www.mlb.com/",
};

function parseFeed(raw: string | null): FastballFeed {
  return raw === "away" ? "away" : "home";
}

/**
 * Same-origin MP4 proxy for Gameday Fastball clips.
 * The CDN returns HTML to browser origins other than mlb.com, so <video src>
 * must hit our server which re-fetches with the correct Origin/Referer.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const playId = url.searchParams.get("playId")?.trim() ?? "";
  const gamePk = Number(url.searchParams.get("gamePk"));
  const feed = parseFeed(url.searchParams.get("feed"));

  if (!isValidPlayId(playId) || !Number.isFinite(gamePk) || gamePk <= 0) {
    return NextResponse.json({ error: "Invalid clip params" }, { status: 400 });
  }

  const upstreamUrl = fastballClipUrl(gamePk, playId, feed);
  const range = request.headers.get("range") ?? undefined;

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
    headers.set("Cache-Control", "public, max-age=3600, immutable");
    headers.set("Cross-Origin-Resource-Policy", "cross-origin");

    for (const key of ["Content-Length", "Content-Range", "ETag", "Last-Modified"]) {
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
