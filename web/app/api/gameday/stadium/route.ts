import { NextResponse } from "next/server";

import {
  GAMEDAY_FETCH_HEADERS,
  gamedayStadiumCdnUrl,
} from "@/lib/mlb/gamedayAssets";

export const dynamic = "force-dynamic";

const imageCache = new Map<string, { bytes: Uint8Array; expiresAt: number }>();
const CACHE_MS = 60 * 60 * 1000;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const venueParam = searchParams.get("venueId");
  const venueId =
    venueParam === "default" || !venueParam ? null : Number.parseInt(venueParam, 10);

  const cacheKey = venueId && venueId > 0 ? String(venueId) : "default";
  const cached = imageCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return new NextResponse(Buffer.from(cached.bytes), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=3600",
      },
    });
  }

  const cdnUrl = gamedayStadiumCdnUrl(venueId);
  const response = await fetch(cdnUrl, { headers: GAMEDAY_FETCH_HEADERS });

  if (!response.ok) {
    return NextResponse.json({ error: "Stadium image unavailable" }, { status: 502 });
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  imageCache.set(cacheKey, { bytes, expiresAt: Date.now() + CACHE_MS });

  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
