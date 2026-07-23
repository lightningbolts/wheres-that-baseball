import { NextResponse } from "next/server";

import { classifyBipKind, computeGameHitStats } from "@/lib/mlb/gameHits";
import { enrichVenueHitDetail } from "@/lib/mlb/hitDetailFromArchive";
import type { PlayerBipDetail } from "@/lib/mlb/playerBip";
import { loadPlayerPitchBipDetail } from "@/lib/mlb/playerPitchBipStore";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ playerId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { playerId: playerIdParam } = await context.params;
  const playerId = Number.parseInt(playerIdParam, 10);
  const { searchParams } = new URL(request.url);
  const seasonParam = searchParams.get("season");
  const season = seasonParam ? Number.parseInt(seasonParam, 10) : new Date().getFullYear();
  const includeDetail = searchParams.get("includeDetail") === "true";
  const venueIdParam = searchParams.get("venueId");
  const venueId = venueIdParam ? Number.parseInt(venueIdParam, 10) : undefined;
  const hitKey = searchParams.get("hitKey");

  if (!Number.isFinite(playerId) || playerId <= 0) {
    return NextResponse.json({ error: "Invalid playerId" }, { status: 400 });
  }
  if (!Number.isFinite(season) || season < 2000) {
    return NextResponse.json({ error: "Invalid season" }, { status: 400 });
  }

  const detail = loadPlayerPitchBipDetail(season, playerId);
  if (!detail) {
    return NextResponse.json({ error: "Pitcher BIP not found" }, { status: 404 });
  }

  if (hitKey) {
    for (const park of detail.parks) {
      const hit = park.hits.find((h) => h.hitKey === hitKey);
      if (hit) {
        const enriched = await enrichVenueHitDetail(hit);
        return NextResponse.json(
          { hit: enriched },
          { headers: { "Cache-Control": "public, max-age=300" } },
        );
      }
    }
    return NextResponse.json({ error: "Hit not found" }, { status: 404 });
  }

  let parks = detail.parks;
  if (venueId != null && Number.isFinite(venueId)) {
    parks = parks.filter((p) => p.venueId === venueId);
  }

  const slimParks = parks.map((park) => ({
    ...park,
    chartHits: undefined,
    hits: park.hits.map((hit) => {
      if (includeDetail) return hit;
      const { detail: _detail, ...rest } = hit;
      return rest;
    }),
  }));

  const allHits = slimParks.flatMap((p) => p.hits);
  const payload: PlayerBipDetail = {
    ...detail,
    parks: slimParks as PlayerBipDetail["parks"],
    bipCount: allHits.length,
    stats: computeGameHitStats(
      allHits.map((h) => ({
        event: h.event,
        hit: h.hit,
        bipKind: h.bipKind ?? classifyBipKind(h.event),
      })),
    ),
    source: "file",
  };

  return NextResponse.json(payload, {
    headers: { "Cache-Control": "public, max-age=120" },
  });
}
