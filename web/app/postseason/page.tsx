import type { Metadata } from "next";

import { PostseasonBracket } from "@/components/features/PostseasonBracket";
import {
  decodePostseasonPicks,
  fetchPostseasonBracket,
  sanitizePostseasonPicks,
} from "@/lib/mlb/postseason";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Postseason Bracket | Where's That Baseball",
  description: "Call dibs on the MLB postseason bracket, then download or share it. No account required.",
};

interface PostseasonPageProps {
  searchParams?: Promise<{ p?: string; season?: string }>;
}

export default async function PostseasonPage({ searchParams }: PostseasonPageProps) {
  const params = (await searchParams) ?? {};
  const requestedSeason = Number.parseInt(params.season ?? "", 10);
  const season = Number.isFinite(requestedSeason) ? requestedSeason : new Date().getFullYear();
  const bracket = await fetchPostseasonBracket(season);
  const initialPicks = sanitizePostseasonPicks(bracket, decodePostseasonPicks(params.p));

  return <PostseasonBracket bracket={bracket} initialPicks={initialPicks} />;
}
