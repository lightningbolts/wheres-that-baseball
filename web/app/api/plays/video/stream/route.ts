import { NextResponse } from "next/server";

import { parseStreamFeed, proxyFastballStream } from "@/lib/mlb/fastballStreamProxy";
import { isValidPlayId } from "@/lib/mlb/playVideo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Legacy query-string proxy. Still works, but new clients should use the
 * path-keyed route (/stream/{gamePk}/{feed}/{playId}) so HTTP caches cannot
 * collapse distinct playIds onto one MP4 body.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const playId = url.searchParams.get("playId")?.trim() ?? "";
  const gamePk = Number(url.searchParams.get("gamePk"));
  const feed = parseStreamFeed(url.searchParams.get("feed"));

  if (!isValidPlayId(playId) || !Number.isFinite(gamePk) || gamePk <= 0) {
    return NextResponse.json({ error: "Invalid clip params" }, { status: 400 });
  }

  // Proxy directly (no redirect) — <video> Range requests handle redirects poorly.
  // Disable shared caching on the query form; path-keyed URLs are preferred.
  const response = await proxyFastballStream({
    gamePk,
    playId,
    feed,
    range: request.headers.get("range"),
  });

  if (response.headers.get("Content-Type")?.includes("video/")) {
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "private, no-store");
    headers.delete("ETag");
    return new NextResponse(response.body, {
      status: response.status,
      headers,
    });
  }

  return response;
}
