import { NextResponse } from "next/server";

import { loadSeasonPlayerCounters } from "@/lib/mlb/nerdStats/playerNerdStore";
import {
  buildPitchMixFromThrown,
  fetchPlayerPitchingSeasonLine,
} from "@/lib/mlb/playerPitching";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ playerId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { playerId: playerIdParam } = await context.params;
  const playerId = Number.parseInt(playerIdParam, 10);
  const { searchParams } = new URL(request.url);
  const seasonParam = searchParams.get("season");
  const season = seasonParam ? Number.parseInt(seasonParam, 10) : new Date().getFullYear();

  if (!Number.isFinite(playerId) || playerId <= 0) {
    return NextResponse.json({ error: "Invalid playerId" }, { status: 400 });
  }
  if (!Number.isFinite(season) || season < 2000) {
    return NextResponse.json({ error: "Invalid season" }, { status: 400 });
  }

  const line = await fetchPlayerPitchingSeasonLine(playerId, season);
  const playerCounters = loadSeasonPlayerCounters(season)[String(playerId)];
  const pitchMix = buildPitchMixFromThrown(playerCounters?.pitchTypesThrown);

  return NextResponse.json(
    {
      ...line,
      pitchMix,
      nerdPitchesThrown: playerCounters?.pitchesThrown ?? 0,
      nerdStrikeouts: playerCounters?.pitchingStrikeouts ?? 0,
      nerdHitsAllowed: playerCounters?.hitsAllowed ?? 0,
      nerdBallsInPlayAllowed: playerCounters?.ballsInPlayAllowed ?? 0,
    },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}
