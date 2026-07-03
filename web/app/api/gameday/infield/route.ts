import { NextResponse } from "next/server";

import { GAMEDAY_FETCH_HEADERS, gamedayInfieldCdnUrl } from "@/lib/mlb/gamedayAssets";

export const dynamic = "force-dynamic";

const imageCache = new Map<string, { bytes: Uint8Array; expiresAt: number }>();
const CACHE_MS = 60 * 60 * 1000;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const venueId = searchParams.get("venueId") ?? "default";

  const cached = imageCache.get(venueId);
  if (cached && cached.expiresAt > Date.now()) {
    return new NextResponse(Buffer.from(cached.bytes), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=3600",
      },
    });
  }

  const venueNum = venueId === "default" ? null : Number(venueId);
  let cdnUrl = gamedayInfieldCdnUrl(venueNum);
  let response = await fetch(cdnUrl, { headers: GAMEDAY_FETCH_HEADERS });

  if (!response.ok && venueId !== "default") {
    cdnUrl = gamedayInfieldCdnUrl(null);
    response = await fetch(cdnUrl, { headers: GAMEDAY_FETCH_HEADERS });
  }

  if (!response.ok) {
    return NextResponse.json({ error: "Infield image unavailable" }, { status: 502 });
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  imageCache.set(venueId, { bytes, expiresAt: Date.now() + CACHE_MS });

  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
