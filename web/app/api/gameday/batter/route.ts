import { NextResponse } from "next/server";

import {
  gamedayBatterCdnUrl,
  type GamedayBatterHand,
} from "@/lib/mlb/gamedayBatter";

export const dynamic = "force-dynamic";

const imageCache = new Map<string, { bytes: Uint8Array; expiresAt: number }>();
const CACHE_MS = 60 * 60 * 1000;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const hand = searchParams.get("hand");

  if (!code || (hand !== "right" && hand !== "left")) {
    return NextResponse.json({ error: "code and hand are required" }, { status: 400 });
  }

  const cacheKey = `${hand}:${code}`;
  const cached = imageCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return new NextResponse(Buffer.from(cached.bytes), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=3600",
      },
    });
  }

  const cdnUrl = gamedayBatterCdnUrl(code, hand as GamedayBatterHand);
  const response = await fetch(cdnUrl, {
    headers: {
      Referer: "https://www.mlb.com/",
      "User-Agent": "mlb-atbat-predictor/1.0",
    },
  });

  if (!response.ok) {
    return NextResponse.json({ error: "Batter image unavailable" }, { status: 502 });
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  imageCache.set(cacheKey, { bytes, expiresAt: Date.now() + CACHE_MS });

  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
