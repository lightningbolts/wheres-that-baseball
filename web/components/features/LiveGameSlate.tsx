"use client";

import { useCallback, useEffect, useState } from "react";

import { AppNav } from "@/components/features/AppNav";
import { LiveGameCard } from "@/components/features/LiveGameCard";
import { getBrowserTimeZone } from "@/lib/mlb/schedule";
import type { SlateGame } from "@/types/mlb";

const SLATE_REFRESH_MS = 10_000;

interface LiveGameSlateProps {
  initialGames: SlateGame[];
  scheduleError?: string | null;
}

function NoGamesState({ scheduleError }: { scheduleError?: string | null }) {
  return (
    <div className="flex flex-1 items-center justify-center px-6">
      <div className="max-w-sm text-center">
        <h1 className="text-lg font-medium text-foreground">No games on the board</h1>
        <p className="mt-2 text-sm text-muted">No live or scheduled games on today&apos;s slate.</p>
        {scheduleError && <p className="mt-4 text-sm text-red-400/80">{scheduleError}</p>}
      </div>
    </div>
  );
}

export function LiveGameSlate({ initialGames, scheduleError }: LiveGameSlateProps) {
  const [games, setGames] = useState(initialGames);

  const refreshGames = useCallback(async () => {
    try {
      const params = new URLSearchParams({ tz: getBrowserTimeZone() });
      const response = await fetch(`/api/games?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as { games: SlateGame[] };
      setGames(data.games);
    } catch {
      // keep stale slate
    }
  }, []);

  useEffect(() => {
    void refreshGames();
    const interval = setInterval(() => void refreshGames(), SLATE_REFRESH_MS);
    return () => clearInterval(interval);
  }, [refreshGames]);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <AppNav />
      {games.length === 0 ? (
        <NoGamesState scheduleError={scheduleError} />
      ) : (
        <main className="mx-auto w-full max-w-6xl flex-1 px-3 py-4 sm:px-4 sm:py-6">
          <div className="mb-4">
            <h1 className="text-lg font-medium text-foreground">Today&apos;s games</h1>
            <p className="mt-1 text-sm text-muted">
              Click a game for play-by-play and predictions. Hover for the box score.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {games.map((game) => (
              <LiveGameCard key={game.gamePk} game={game} />
            ))}
          </div>
        </main>
      )}
    </div>
  );
}
