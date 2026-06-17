import { GameHistoryBrowser } from "@/components/features/GameHistoryBrowser";
import { getLocalCalendarDate } from "@/lib/mlb/schedule";

export const dynamic = "force-dynamic";

interface GamesPageProps {
  searchParams?: Promise<{
    date?: string;
    teamId?: string;
    view?: "date" | "team";
  }>;
}

export default async function GamesPage({ searchParams }: GamesPageProps) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const teamId = resolvedSearchParams.teamId
    ? Number.parseInt(resolvedSearchParams.teamId, 10)
    : null;
  const initialView = resolvedSearchParams.view === "team" ? "team" : "date";

  return (
    <GameHistoryBrowser
      initialDate={resolvedSearchParams.date ?? getLocalCalendarDate()}
      initialTeamId={Number.isFinite(teamId) ? teamId : null}
      initialView={initialView}
    />
  );
}
