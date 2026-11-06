import type { Metadata } from "next";

import { BreakoutsBrowser } from "@/components/features/BreakoutsBrowser";
import report from "@/data/breakouts/2027.json";
import type { BreakoutReport } from "@/lib/mlb/breakouts";

const data = report as BreakoutReport;

export const metadata: Metadata = {
  title: `${data.season} Breakout Candidates | Where's That Baseball`,
  description: `Statcast-driven ${data.season} MLB breakout candidates for hitters, pitchers and top prospects, with a season-by-season backtest of how often the model's picks actually broke out.`,
};

interface BreakoutsPageProps {
  searchParams?: Promise<{ tab?: string; pool?: string }>;
}

export default async function BreakoutsPage({ searchParams }: BreakoutsPageProps) {
  const params = (await searchParams) ?? {};
  return (
    <BreakoutsBrowser
      report={data}
      initialTab={params.tab === "pitchers" ? "pitchers" : "hitters"}
      initialPool={params.pool === "prospects" ? "prospects" : "mlb"}
    />
  );
}
