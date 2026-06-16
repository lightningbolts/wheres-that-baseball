"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { AppNav } from "@/components/features/AppNav";
import { Skeleton } from "@/components/ui/Skeleton";
import { useGamesByDate, useGamesByTeam } from "@/hooks/useGames";
import {
  formatGameDate,
  formatMatchup,
  formatScore,
  gameStatusLabel,
  isLiveStatus,
  isReplayableGame,
} from "@/lib/games/format";
import { getMLBScheduleDate } from "@/lib/mlb/schedule";
import { MLB_TEAMS } from "@/lib/mlb/teams";
import { cn } from "@/lib/utils";
import type { Game } from "@/types/database";

type ViewMode = "date" | "team";

interface GameHistoryBrowserProps {
  initialDate?: string;
  initialTeamId?: number | null;
  initialView?: ViewMode;
}

function GameRow({ game }: { game: Game }) {
  const score = formatScore(game);
  const live = isLiveStatus(game.status);

  return (
    <Link
      href={`/games/${game.game_pk}`}
      className="flex items-center justify-between gap-4 border-b border-neutral-800/60 px-4 py-3 transition-colors hover:bg-neutral-900/50"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-medium text-neutral-100">{formatMatchup(game)}</h3>
          {live && (
            <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-400">
              Live
            </span>
          )}
          {game.feed_synced_at && (
            <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-500">
              Full feed
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-neutral-500">
          {game.venue_name ?? "TBD"} · {gameStatusLabel(game)}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-4">
        {score ? (
          <span className="font-mono text-sm tabular-nums text-neutral-200">{score}</span>
        ) : (
          <span className="text-xs text-neutral-600">—</span>
        )}
        <span className="text-xs text-neutral-500">View →</span>
      </div>
    </Link>
  );
}

function GamesList({
  games,
  isLoading,
  error,
  emptyMessage,
}: {
  games: Game[];
  isLoading: boolean;
  error: string | null;
  emptyMessage: string;
}) {
  if (isLoading) {
    return (
      <div className="divide-y divide-neutral-800/60">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="px-4 py-3">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="mt-2 h-3 w-56" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-4 py-10 text-center">
        <p className="text-sm text-red-400">{error}</p>
        <p className="mt-2 text-xs text-neutral-500">
          Ensure the games table exists and anon SELECT is enabled in Supabase.
        </p>
      </div>
    );
  }

  if (games.length === 0) {
    return (
      <div className="px-4 py-10 text-center">
        <p className="text-sm text-neutral-400">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-neutral-800/60">
      {games.map((game) => (
        <GameRow key={game.game_pk} game={game} />
      ))}
    </div>
  );
}

export function GameHistoryBrowser({
  initialDate,
  initialTeamId = null,
  initialView = "date",
}: GameHistoryBrowserProps) {
  const today = getMLBScheduleDate();
  const [view, setView] = useState<ViewMode>(initialView);
  const [selectedDate, setSelectedDate] = useState(initialDate ?? today);
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(initialTeamId);

  const dateQuery = useGamesByDate(selectedDate);
  const teamQuery = useGamesByTeam(selectedTeamId);

  const activeQuery = view === "date" ? dateQuery : teamQuery;

  const replayableGames = useMemo(
    () => activeQuery.games.filter(isReplayableGame),
    [activeQuery.games],
  );

  const summary = useMemo(() => {
    if (view === "date") {
      return formatGameDate(selectedDate);
    }
    const team = MLB_TEAMS.find((entry) => entry.id === selectedTeamId);
    return team ? `${team.name} (${team.abbrev})` : "Select a team";
  }, [view, selectedDate, selectedTeamId]);

  const recordSummary = useMemo(() => {
    if (view !== "team" || !selectedTeamId || teamQuery.games.length === 0) return null;

    let wins = 0;
    let losses = 0;

    for (const game of teamQuery.games) {
      if (game.away_score == null || game.home_score == null) continue;
      if (game.status !== "Final") continue;

      const isHome = game.home_team_id === selectedTeamId;
      const teamScore = isHome ? game.home_score : game.away_score;
      const oppScore = isHome ? game.away_score : game.home_score;

      if (teamScore > oppScore) wins += 1;
      else if (teamScore < oppScore) losses += 1;
    }

    if (wins + losses === 0) return null;
    return `${wins}-${losses} in completed games`;
  }, [view, selectedTeamId, teamQuery.games]);

  return (
    <div className="flex min-h-screen flex-col bg-[#0f0f0f] text-neutral-200">
      <AppNav />

      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-6">
        <div className="mb-6">
          <h1 className="text-xl font-medium text-neutral-100">Season History</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Browse games by date or team, then open any game for full play-by-play replay.
          </p>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-neutral-800 bg-[#111] p-1">
            {(["date", "team"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setView(mode)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm transition-colors",
                  view === mode
                    ? "bg-neutral-800 text-white"
                    : "text-neutral-400 hover:text-neutral-200",
                )}
              >
                {mode === "date" ? "By Date" : "By Team"}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-4 rounded-xl border border-neutral-800 bg-[#111] p-4">
          {view === "date" ? (
            <label className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <span className="text-sm text-neutral-400">Calendar date</span>
              <input
                type="date"
                value={selectedDate}
                max={today}
                onChange={(event) => setSelectedDate(event.target.value)}
                className="rounded-md border border-neutral-700 bg-[#0f0f0f] px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-500"
              />
            </label>
          ) : (
            <label className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <span className="text-sm text-neutral-400">Team</span>
              <select
                value={selectedTeamId ?? ""}
                onChange={(event) => {
                  const value = event.target.value;
                  setSelectedTeamId(value ? Number.parseInt(value, 10) : null);
                }}
                className="min-w-[240px] rounded-md border border-neutral-700 bg-[#0f0f0f] px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-500"
              >
                <option value="">Choose a team…</option>
                {MLB_TEAMS.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name} ({team.abbrev})
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <section className="overflow-hidden rounded-xl border border-neutral-800 bg-[#111]">
          <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
            <div>
              <h2 className="text-sm font-medium text-neutral-200">{summary}</h2>
              {recordSummary && (
                <p className="mt-0.5 text-xs text-neutral-500">{recordSummary}</p>
              )}
            </div>
            {!activeQuery.isLoading && replayableGames.length > 0 && (
              <span className="text-xs text-neutral-500">
                {replayableGames.length} game{replayableGames.length === 1 ? "" : "s"}
              </span>
            )}
          </div>

          <GamesList
            games={replayableGames}
            isLoading={activeQuery.isLoading}
            error={activeQuery.error}
            emptyMessage={
              view === "date"
                ? "No completed games on this date. Scheduled games appear after they are played."
                : "No completed games for this team yet. Select a team or pick another date range."
            }
          />
        </section>
      </div>
    </div>
  );
}
