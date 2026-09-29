import type { Metadata } from "next";

import { Suspense } from "react";

import { NerdStatDetailView } from "@/components/features/NerdStatDetailView";
import { getNerdStatDefinition, resolveNerdStatId } from "@/lib/mlb/nerdStats/definitions";
import { nerdSeasonTypeLabel, parseNerdSeasonType } from "@/lib/mlb/nerdStats/seasonTypes";
import { loadNerdStatDetail } from "@/lib/mlb/nerdStats/store";
import { getSiteUrl, SITE_NAME } from "@/lib/site";
import { notFound, redirect } from "next/navigation";

interface NerdStatPageProps {
  params: Promise<{ statId: string }>;
  searchParams: Promise<{ seasonType?: string }>;
}

export async function generateMetadata({ params, searchParams }: NerdStatPageProps): Promise<Metadata> {
  const { statId: rawStatId } = await params;
  const seasonType = parseNerdSeasonType((await searchParams).seasonType);
  const statId = resolveNerdStatId(rawStatId);
  const definition = getNerdStatDefinition(statId);
  if (!definition) return {};

  const season = new Date().getFullYear();
  const detail = loadNerdStatDetail(season, statId, "season", "all", seasonType);
  const leader = detail?.stat.leaders[0];
  const title = `${definition.title} | ${nerdSeasonTypeLabel(seasonType)} Nerd Standings`;
  const description = leader
    ? `#1 ${leader.teamName} (${leader.displayValue}). ${definition.subtitle}`
    : definition.subtitle;
  const url = `${getSiteUrl()}/nerd/${statId}${seasonType === "postseason" ? "?seasonType=postseason" : ""}`;

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

export default async function NerdStatPage({ params, searchParams }: NerdStatPageProps) {
  const { statId: rawStatId } = await params;
  const seasonType = parseNerdSeasonType((await searchParams).seasonType);
  const statId = resolveNerdStatId(rawStatId);
  if (statId !== rawStatId) {
    redirect(`/nerd/${statId}${seasonType === "postseason" ? "?seasonType=postseason" : ""}`);
  }
  if (!getNerdStatDefinition(statId)) notFound();
  return (
    <Suspense fallback={null}>
      <NerdStatDetailView statId={statId} />
    </Suspense>
  );
}
