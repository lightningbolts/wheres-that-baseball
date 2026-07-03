import { NextResponse } from "next/server";

import { getNerdStatDefinition } from "@/lib/mlb/nerdStats/definitions";
import {
  buildDailySocialPostCopy,
  dailyCategoryLabel,
  pickDailyNerdStatId,
  PRIMARY_VIRAL_HABIT,
} from "@/lib/mlb/nerdStats/socialHabit";
import { loadNerdStatDetail } from "@/lib/mlb/nerdStats/store";
import { getSiteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const seasonParam = searchParams.get("season");
  const dateParam = searchParams.get("date");
  const season = seasonParam ? Number.parseInt(seasonParam, 10) : new Date().getFullYear();
  const date = dateParam ? new Date(`${dateParam}T12:00:00Z`) : new Date();

  if (!Number.isFinite(season) || season < 2000) {
    return NextResponse.json({ error: "Invalid season" }, { status: 400 });
  }
  if (dateParam && Number.isNaN(date.getTime())) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }

  const statId = pickDailyNerdStatId(season, date);
  const definition = getNerdStatDefinition(statId);
  const detail = loadNerdStatDetail(season, statId);
  const siteUrl = getSiteUrl();

  if (!definition || !detail) {
    return NextResponse.json({ error: "Daily stat data not found" }, { status: 404 });
  }

  return NextResponse.json(
    {
      habit: PRIMARY_VIRAL_HABIT,
      season,
      date: date.toISOString().slice(0, 10),
      category: definition.category,
      categoryLabel: dailyCategoryLabel(date),
      statId,
      title: definition.title,
      subtitle: definition.subtitle,
      leader: detail.stat.leaders[0] ?? null,
      urls: {
        daily: `${siteUrl}/nerd/daily`,
        stat: `${siteUrl}/nerd/${statId}`,
        shareCard: `${siteUrl}/api/nerd-stats/share-card?statId=${statId}&season=${season}`,
      },
      suggestedPost: buildDailySocialPostCopy(detail, statId),
      pilot: {
        durationDays: 14,
        postingTimeEt: "09:00",
        hookTemplate: "Actually, {team} is #{rank} in {stat}.",
      },
    },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}
