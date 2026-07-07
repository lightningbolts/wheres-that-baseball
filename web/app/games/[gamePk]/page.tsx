import { HistoricalGameDashboard } from "@/components/features/HistoricalGameDashboard";
import { ScheduledGameView } from "@/components/features/ScheduledGameView";
import { isReplayableGame } from "@/lib/games/format";
import { fetchScheduleGameByPk } from "@/lib/games/scheduleRow";
import { upsertScheduleRows } from "@/lib/games/scheduleUpsert";
import { createClient } from "@/utils/supabase/server";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { GAME_LIST_COLUMNS, type Game } from "@/types/database";

export const dynamic = "force-dynamic";

interface GameDetailPageProps {
  params: Promise<{ gamePk: string }>;
  searchParams?: Promise<{
    date?: string;
    teamId?: string;
    view?: "date" | "team";
  }>;
}

export default async function GameDetailPage({ params, searchParams }: GameDetailPageProps) {
  const { gamePk: gamePkParam } = await params;
  const resolvedSearchParams = (await searchParams) ?? {};
  const gamePk = Number.parseInt(gamePkParam, 10);
  if (!Number.isFinite(gamePk) || gamePk <= 0) notFound();

  const teamId = resolvedSearchParams.teamId
    ? Number.parseInt(resolvedSearchParams.teamId, 10)
    : null;
  const historyBack = {
    date: resolvedSearchParams.date,
    view: resolvedSearchParams.view === "team" ? ("team" as const) : ("date" as const),
    teamId: Number.isFinite(teamId) ? teamId : null,
  };

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data, error } = await supabase
    .from("games")
    .select(GAME_LIST_COLUMNS)
    .eq("game_pk", gamePk)
    .maybeSingle();

  if (error) notFound();

  let game = (data as Game | null) ?? null;

  if (!game) {
    const scheduleRow = await fetchScheduleGameByPk(gamePk);
    if (!scheduleRow) notFound();

    await upsertScheduleRows([scheduleRow]).catch(() => {
      // Listing still works from MLB; DB sync is best-effort here.
    });

    game = {
      ...scheduleRow,
      game_state: null,
      box_score: null,
      feed_synced_at: null,
      updated_at: new Date().toISOString(),
    };
  }

  if (!isReplayableGame(game)) {
    return <ScheduledGameView game={game} historyBack={historyBack} />;
  }

  return <HistoricalGameDashboard game={game} historyBack={historyBack} />;
}
