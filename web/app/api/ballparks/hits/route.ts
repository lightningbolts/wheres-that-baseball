import { NextResponse } from "next/server";

import type { BallparkHitsAggregate, BallparkHitsDetail } from "@/lib/mlb/ballparkHits";
import { paginateBallparkDetail } from "@/lib/mlb/ballparkHitsApi";
import {
  getEmptyBallparkHitsDetail,
  getEmptyBallparkHitsSummary,
  loadBallparkHitsDetail,
  loadBallparkHitsSummary,
} from "@/lib/mlb/ballparkHitsStore";
import { enrichVenueHitDetail } from "@/lib/mlb/hitDetailFromArchive";

export const dynamic = "force-dynamic";

const DEFAULT_PAGE_SIZE = 50;

function loadSummary(season: number): BallparkHitsAggregate {
  const summary = loadBallparkHitsSummary(season);
  if (summary) {
    return { ...summary, source: "file" };
  }

  return {
    ...getEmptyBallparkHitsSummary(season),
    source: "empty",
    backfillPending: true,
  };
}

function loadDetail(season: number, venueId: number): BallparkHitsDetail {
  const detail = loadBallparkHitsDetail(season, venueId);
  if (detail) {
    return { ...detail, source: "file" };
  }

  try {
    return { ...getEmptyBallparkHitsDetail(season, venueId), source: "empty" };
  } catch {
    throw new Error("Unknown venue");
  }
}

function parsePositiveInt(value: string | null, fallback: number): number {
  if (value == null) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const seasonParam = searchParams.get("season");
  const venueIdParam = searchParams.get("venueId");
  const hitKeyParam = searchParams.get("hitKey");
  const season = seasonParam ? Number.parseInt(seasonParam, 10) : new Date().getFullYear();
  const venueId = venueIdParam ? Number.parseInt(venueIdParam, 10) : undefined;

  if (!Number.isFinite(season) || season < 2000) {
    return NextResponse.json({ error: "Invalid season" }, { status: 400 });
  }

  if (venueIdParam != null && (!Number.isFinite(venueId) || venueId! <= 0)) {
    return NextResponse.json({ error: "Invalid venueId" }, { status: 400 });
  }

  try {
    if (venueId != null && hitKeyParam) {
      const detail = loadDetail(season, venueId);
      const hit = detail.hits.find((entry) => entry.hitKey === hitKeyParam);
      if (!hit) {
        return NextResponse.json({ error: "Hit not found" }, { status: 404 });
      }
      const enriched = await enrichVenueHitDetail(hit);
      return NextResponse.json(
        { hit: enriched },
        { headers: { "Cache-Control": "public, max-age=300" } },
      );
    }

    if (venueId != null) {
      const detail = loadDetail(season, venueId);
      const hitsOnly = searchParams.get("hitsOnly") === "true";
      const limit = parsePositiveInt(searchParams.get("limit"), hitsOnly ? DEFAULT_PAGE_SIZE : 0);
      const offset = parsePositiveInt(searchParams.get("offset"), 0);
      const includeDetail = searchParams.get("includeDetail") === "true";
      const includeChartHits = searchParams.get("includeChartHits") !== "false";

      const result = paginateBallparkDetail(detail, {
        limit,
        offset,
        includeDetail,
        includeChartHits: hitsOnly ? false : includeChartHits,
      });

      if (hitsOnly) {
        return NextResponse.json(
          {
            hits: result.hits,
            hitsTotal: result.hitsTotal,
            hasMore: result.hasMore,
          },
          { headers: { "Cache-Control": "public, max-age=120" } },
        );
      }

      return NextResponse.json(result, {
        headers: { "Cache-Control": "public, max-age=120" },
      });
    }

    const result = loadSummary(season);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "public, max-age=120" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load ballpark hits";
    const status = message === "Unknown venue" ? 404 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
