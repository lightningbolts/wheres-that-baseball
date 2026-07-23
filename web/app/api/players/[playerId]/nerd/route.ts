import { NextResponse } from "next/server";

import { buildPlayerNerdCard } from "@/lib/mlb/nerdStats/playerNerdBuild";
import {
  loadPlayerNerdCardFile,
  loadSeasonPlayerCounters,
} from "@/lib/mlb/nerdStats/playerNerdStore";
import { loadSeasonCounters } from "@/lib/mlb/nerdStats/store";

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

  const players = loadSeasonPlayerCounters(season);
  const player = players[String(playerId)];

  // Prefer live build from counters so team ranks stay current without a card rebuild.
  if (player) {
    const teams = loadSeasonCounters(season);
    const team = teams[String(player.teamId)] ?? null;
    const teammates = Object.values(players).filter(
      (mate) =>
        mate.teamId === player.teamId &&
        (mate.plateAppearances > 0 || mate.pitchesThrown > 0),
    );
    const card = buildPlayerNerdCard(season, player, team, teammates);
    return NextResponse.json(card, {
      headers: { "Cache-Control": "public, max-age=60" },
    });
  }

  const cached = loadPlayerNerdCardFile(season, playerId);
  if (cached) {
    return NextResponse.json(cached, {
      headers: { "Cache-Control": "public, max-age=120" },
    });
  }

  return NextResponse.json({ error: "Player nerd card not found" }, { status: 404 });
}
