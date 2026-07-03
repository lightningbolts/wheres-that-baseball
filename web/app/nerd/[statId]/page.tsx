import type { Metadata } from "next";

import { NerdStatDetailView } from "@/components/features/NerdStatDetailView";
import { getNerdStatDefinition } from "@/lib/mlb/nerdStats/definitions";
import { loadNerdStatDetail } from "@/lib/mlb/nerdStats/store";
import { getSiteUrl, SITE_NAME } from "@/lib/site";
import { notFound } from "next/navigation";

interface NerdStatPageProps {
  params: Promise<{ statId: string }>;
}

export async function generateMetadata({ params }: NerdStatPageProps): Promise<Metadata> {
  const { statId } = await params;
  const definition = getNerdStatDefinition(statId);
  if (!definition) return {};

  const season = new Date().getFullYear();
  const detail = loadNerdStatDetail(season, statId);
  const leader = detail?.stat.leaders[0];
  const title = `${definition.title} | Nerd Standings`;
  const description = leader
    ? `#1 ${leader.teamName} (${leader.displayValue}). ${definition.subtitle}`
    : definition.subtitle;
  const url = `${getSiteUrl()}/nerd/${statId}`;

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

export default async function NerdStatPage({ params }: NerdStatPageProps) {
  const { statId } = await params;
  if (!getNerdStatDefinition(statId)) notFound();
  return <NerdStatDetailView statId={statId} />;
}
