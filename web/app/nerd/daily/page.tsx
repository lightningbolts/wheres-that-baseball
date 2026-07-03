import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getNerdStatDefinition } from "@/lib/mlb/nerdStats/definitions";
import { pickDailyNerdStatId } from "@/lib/mlb/nerdStats/socialHabit";
import { loadNerdStatDetail } from "@/lib/mlb/nerdStats/store";
import { getSiteUrl, SITE_NAME } from "@/lib/site";

export async function generateMetadata(): Promise<Metadata> {
  const season = new Date().getFullYear();
  const statId = pickDailyNerdStatId(season);
  const definition = getNerdStatDefinition(statId);
  const detail = loadNerdStatDetail(season, statId);
  const leader = detail?.stat.leaders[0];
  const title = `Today's Nerd Standings: ${definition?.title ?? "Daily Stat"}`;
  const description = leader
    ? `Actually, ${leader.teamName} leads ${definition?.title} (${leader.displayValue}).`
    : definition?.subtitle;
  const url = `${getSiteUrl()}/nerd/daily`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url,
      siteName: SITE_NAME,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default function NerdDailyPage() {
  const season = new Date().getFullYear();
  redirect(`/nerd/${pickDailyNerdStatId(season)}`);
}
