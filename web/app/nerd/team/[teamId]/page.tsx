import type { Metadata } from "next";

import { TeamNerdCardView } from "@/components/features/TeamNerdCardView";
import { loadTeamNerdCard } from "@/lib/mlb/nerdStats/store";
import { getTeamById } from "@/lib/mlb/teams";
import { getSiteUrl, SITE_NAME } from "@/lib/site";
import { notFound } from "next/navigation";

interface TeamNerdPageProps {
  params: Promise<{ teamId: string }>;
}

export async function generateMetadata({ params }: TeamNerdPageProps): Promise<Metadata> {
  const { teamId } = await params;
  const id = Number.parseInt(teamId, 10);
  const team = Number.isFinite(id) ? getTeamById(id) : undefined;
  if (!team) return {};

  const season = new Date().getFullYear();
  const card = loadTeamNerdCard(season, id);
  const best = card?.stats.slice().sort((a, b) => a.rank - b.rank)[0];
  const title = `${team.name} Nerd Card | ${season}`;
  const description = best
    ? `Elite at ${best.title} (rank #${best.rank}). Full obscure-stat report card for the ${team.name}.`
    : `Where the ${team.name} rank on every weird stat in ${season}.`;
  const url = `${getSiteUrl()}/nerd/team/${id}`;

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

export default async function TeamNerdPage({ params }: TeamNerdPageProps) {
  const { teamId } = await params;
  const id = Number.parseInt(teamId, 10);
  if (!Number.isFinite(id) || !getTeamById(id)) notFound();
  return <TeamNerdCardView teamId={id} />;
}
