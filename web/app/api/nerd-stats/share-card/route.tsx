import { NextResponse } from "next/server";

import { getNerdStatDefinition } from "@/lib/mlb/nerdStats/definitions";
import { renderNerdStatImage, renderTeamNerdCardImage } from "@/lib/mlb/nerdStats/renderShareImage";
import { loadNerdStatDetail, loadTeamNerdCard } from "@/lib/mlb/nerdStats/store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const statId = searchParams.get("statId");
  const teamIdParam = searchParams.get("teamId");
  const seasonParam = searchParams.get("season");
  const season = seasonParam ? Number.parseInt(seasonParam, 10) : new Date().getFullYear();

  if (!statId && !teamIdParam) {
    return NextResponse.json({ error: "statId or teamId required" }, { status: 400 });
  }

  try {
    if (statId) {
      if (!getNerdStatDefinition(statId)) {
        return NextResponse.json({ error: "Unknown stat" }, { status: 404 });
      }
      const detail = loadNerdStatDetail(season, statId);
      if (!detail) {
        return NextResponse.json({ error: "Stat data not found" }, { status: 404 });
      }
      const image = await renderNerdStatImage(detail, true);
      return new NextResponse(image.body, {
        status: 200,
        headers: {
          "Content-Type": "image/png",
          "Content-Disposition": `attachment; filename="nerd-standings-${statId}.png"`,
          "Cache-Control": "public, max-age=3600",
        },
      });
    }

    const teamId = Number.parseInt(teamIdParam!, 10);
    if (!Number.isFinite(teamId)) {
      return NextResponse.json({ error: "Invalid teamId" }, { status: 400 });
    }
    const variantParam = searchParams.get("variant");
    const variant = variantParam === "highlights" ? "highlights" : "full";
    const card = loadTeamNerdCard(season, teamId);
    if (!card) {
      return NextResponse.json({ error: "Team card not found" }, { status: 404 });
    }
    const image = await renderTeamNerdCardImage(card, true, variant);
    const filename =
      variant === "highlights" ? `nerd-card-${teamId}-chaos.png` : `nerd-card-${teamId}.png`;
    return new NextResponse(image.body, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to render share card";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
