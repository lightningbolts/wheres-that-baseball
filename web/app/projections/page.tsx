import type { Metadata } from "next";

import { ProjectionsBrowser, type ProjTab } from "@/components/features/projections/ProjectionsBrowser";

export const metadata: Metadata = {
  title: "2027 MLB Season Projections: Standings, Playoff Odds & Player Stats | Where's That Baseball",
  description:
    "2027 MLB projections from thousands of simulated seasons on our game engine: projected standings, playoff and World Series odds, award chances, and full stat distributions for every hitter and pitcher.",
};

const TABS: ProjTab[] = ["standings", "odds", "hitters", "pitchers", "awards", "leaders"];

export default async function ProjectionsPage({ searchParams }: { searchParams?: Promise<{ tab?: string }> }) {
  const params = (await searchParams) ?? {};
  return <ProjectionsBrowser initialTab={TABS.find((t) => t === params.tab) ?? "standings"} />;
}
