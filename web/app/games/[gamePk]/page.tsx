import { HistoricalGameDashboard } from "@/components/features/HistoricalGameDashboard";
import { ScheduledGameView } from "@/components/features/ScheduledGameView";
import { isReplayableGame } from "@/lib/games/format";
import { createClient } from "@/utils/supabase/server";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { GAME_LIST_COLUMNS, type Game } from "@/types/database";

export const dynamic = "force-dynamic";

interface GameDetailPageProps {
  params: Promise<{ gamePk: string }>;
}

export default async function GameDetailPage({ params }: GameDetailPageProps) {
  const { gamePk: gamePkParam } = await params;
  const gamePk = Number.parseInt(gamePkParam, 10);
  if (!Number.isFinite(gamePk) || gamePk <= 0) notFound();

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data, error } = await supabase
    .from("games")
    .select(GAME_LIST_COLUMNS)
    .eq("game_pk", gamePk)
    .maybeSingle();

  if (error || !data) notFound();

  const game = data as Game;
  if (!isReplayableGame(game)) {
    return <ScheduledGameView game={game} />;
  }

  return <HistoricalGameDashboard game={game} />;
}
