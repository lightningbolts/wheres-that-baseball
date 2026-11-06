import type { Metadata } from "next";

import { BreakoutsBrowser, type BreakoutView } from "@/components/features/BreakoutsBrowser";
import report from "@/data/breakouts/2027.json";
import turnaroundReport from "@/data/breakouts/2027-turnarounds.json";
import type { BreakoutReport, TurnaroundReport } from "@/lib/mlb/breakouts";

const data = report as BreakoutReport;
const turnarounds = turnaroundReport as TurnaroundReport;

export const metadata: Metadata = {
  title: `${data.season} Breakout, Regression & Bounceback Candidates | Where's That Baseball`,
  description: `Statcast-driven ${data.season} MLB breakout, regression and bounceback candidates for hitters, pitchers and top prospects, each with a season-by-season backtest of how often the model's picks came true.`,
};

const VIEWS: BreakoutView[] = ["breakouts", "regression", "bounceback"];

interface BreakoutsPageProps {
  searchParams?: Promise<{ view?: string; tab?: string; pool?: string }>;
}

export default async function BreakoutsPage({ searchParams }: BreakoutsPageProps) {
  const params = (await searchParams) ?? {};
  const view = VIEWS.find((v) => v === params.view) ?? "breakouts";
  return (
    <BreakoutsBrowser
      report={data}
      turnarounds={turnarounds}
      initialView={view}
      initialTab={params.tab === "pitchers" ? "pitchers" : "hitters"}
      initialPool={view === "breakouts" && params.pool === "prospects" ? "prospects" : "mlb"}
    />
  );
}
