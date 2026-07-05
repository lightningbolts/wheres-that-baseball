import { NextResponse } from "next/server";

import type { NerdStatDetail, NerdStatsSummary, TeamNerdCard } from "@/lib/mlb/nerdStats/types";
import {
  getEmptyNerdStatsSummary,
  loadNerdStatDetail,
  loadNerdStatsSummary,
  loadTeamNerdCard,
  parseNerdStatsWindowParam,
} from "@/lib/mlb/nerdStats/store";
import { getNerdStatDefinition } from "@/lib/mlb/nerdStats/definitions";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const seasonParam = searchParams.get("season");
  const statId = searchParams.get("statId");
  const teamIdParam = searchParams.get("teamId");
  const window = parseNerdStatsWindowParam(searchParams.get("window"));
  const season = seasonParam ? Number.parseInt(seasonParam, 10) : new Date().getFullYear();
  const teamId = teamIdParam ? Number.parseInt(teamIdParam, 10) : undefined;

  if (!Number.isFinite(season) || season < 2000) {
    return NextResponse.json({ error: "Invalid season" }, { status: 400 });
  }

  if (statId && !getNerdStatDefinition(statId)) {
    return NextResponse.json({ error: "Unknown stat" }, { status: 404 });
  }

  if (teamIdParam != null && (!Number.isFinite(teamId) || teamId! <= 0)) {
    return NextResponse.json({ error: "Invalid teamId" }, { status: 400 });
  }

  try {
    let result: NerdStatsSummary | NerdStatDetail | TeamNerdCard;

    if (teamId != null) {
      const card = loadTeamNerdCard(season, teamId);
      if (!card) {
        return NextResponse.json({ error: "Unknown team" }, { status: 404 });
      }
      result = card;
    } else if (statId) {
      const detail = loadNerdStatDetail(season, statId, window);
      if (!detail) {
        return NextResponse.json({ error: "Stat data not found" }, { status: 404 });
      }
      result = detail;
    } else {
      const summary = loadNerdStatsSummary(season, window);
      result = summary
        ? { ...summary, source: "file" as const }
        : window === "season"
          ? { ...getEmptyNerdStatsSummary(season), source: "empty" as const, backfillPending: true }
          : {
              ...getEmptyNerdStatsSummary(season),
              source: "empty" as const,
              window,
              backfillPending: true,
            };
    }

    return NextResponse.json(result, {
      headers: { "Cache-Control": "public, max-age=120" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load nerd stats";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
