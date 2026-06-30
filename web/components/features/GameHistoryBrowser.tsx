"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import { AppNav } from "@/components/features/AppNav";
import { TeamLogo, TeamLogoWithAbbrev } from "@/components/ui/TeamLogo";
import { Skeleton } from "@/components/ui/Skeleton";
import { useGamesByDate, useGamesByTeam } from "@/hooks/useGames";
import {
  formatGameDate,
  formatScore,
  gameStatusLabel,
  isLiveStatus,
} from "@/lib/games/format";
import {
  buildGameDetailHref,
  buildSeasonHistoryHref,
  getLocalCalendarDate,
} from "@/lib/mlb/schedule";
import { MLB_TEAMS } from "@/lib/mlb/teams";
import { cn } from "@/lib/utils";
import type { Game } from "@/types/database";

type ViewMode = "date" | "team";

interface GameHistoryBrowserProps {
  initialDate?: string;
  initialTeamId?: number | null;
  initialView?: ViewMode;
}

interface GameRowProps {
  game: Game;
  historyContext: { date: string; view: ViewMode; teamId: number | null };
}

function GameRow({ game, historyContext }: GameRowProps) {
  const score = formatScore(game);
  const live = isLiveStatus(game.status);
  const href = buildGameDetailHref(game.game_pk, {
    date: historyContext.view === "date" ? historyContext.date : undefined,
    view: historyContext.view,
    teamId: historyContext.view === "team" ? historyContext.teamId : undefined,
  });

  return (
    <Link
      href={href}
      className="flex flex-col gap-2 border-b border-border/60 px-4 py-3 transition-colors hover:bg-hover sm:flex-row sm:items-center sm:justify-between sm:gap-4"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="flex items-center gap-1.5 text-sm text-foreground">
            <TeamLogoWithAbbrev abbrev={game.away_team_abbrev} size={20} />
            <span className="text-muted">@</span>
            <TeamLogoWithAbbrev abbrev={game.home_team_abbrev} size={20} />
          </h3>
          {live && (
            <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-400">
              Live
            </span>
          )}
          {game.feed_synced_at && (
            <span className="rounded bg-surface-elevated px-1.5 py-0.5 text-[10px] text-muted">
              Full feed
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-muted">
          {game.venue_name ?? "TBD"} · {gameStatusLabel(game)}
        </p>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-4 sm:justify-end">
        {score ? (
          <span className="font-mono text-sm tabular-nums text-foreground">{score}</span>
        ) : (
          <span className="text-xs text-subtle">—</span>
        )}
        <span className="text-xs text-muted">View →</span>
      </div>
    </Link>
  );
}

function GamesList({
  games,
  isLoading,
  error,
  emptyMessage,
  historyContext,
}: {
  games: Game[];
  isLoading: boolean;
  error: string | null;
  emptyMessage: string;
  historyContext: { date: string; view: ViewMode; teamId: number | null };
}) {
  if (isLoading) {
    return (
      <div className="divide-y divide-border/60">
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
        <p className="mt-2 text-xs text-muted">
          Ensure the games table exists and anon SELECT is enabled in Supabase.
        </p>
      </div>
    );
  }

  if (games.length === 0) {
    return (
      <div className="px-4 py-10 text-center">
        <p className="text-sm text-secondary">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-neutral-800/60">
      {games.map((game) => (
        <GameRow key={game.game_pk} game={game} historyContext={historyContext} />
      ))}
    </div>
  );
}

export function GameHistoryBrowser({
  initialDate,
  initialTeamId = null,
  initialView = "date",
}: GameHistoryBrowserProps) {
  const router = useRouter();
  const today = getLocalCalendarDate();
  const maxDate = today;
  const [view, setView] = useState<ViewMode>(initialView);
  const [selectedDate, setSelectedDate] = useState(initialDate ?? today);
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(initialTeamId);

  const syncUrl = useCallback(
    (next: { date?: string; teamId?: number | null; view?: ViewMode }) => {
      const href = buildSeasonHistoryHref({
        date: next.date,
        view: next.view,
        teamId: next.teamId,
      });
      router.replace(href, { scroll: false });
    },
    [router],
  );

  const handleViewChange = (mode: ViewMode) => {
    setView(mode);
    syncUrl({
      view: mode,
      date: selectedDate,
      teamId: selectedTeamId,
    });
  };

  const handleDateChange = (date: string) => {
    setSelectedDate(date);
    syncUrl({ view: "date", date });
  };

  const handleTeamChange = (teamId: number | null) => {
    setSelectedTeamId(teamId);
    syncUrl({ view: "team", teamId });
  };

  const historyContext = useMemo(
    () => ({ date: selectedDate, view, teamId: selectedTeamId }),
    [selectedDate, view, selectedTeamId],
  );

  const dateQuery = useGamesByDate(selectedDate);
  const teamQuery = useGamesByTeam(selectedTeamId);

  const activeQuery = view === "date" ? dateQuery : teamQuery;

  const summary = useMemo(() => {
    if (view === "date") {
      return formatGameDate(selectedDate);
    }
    const team = MLB_TEAMS.find((entry) => entry.id === selectedTeamId);
    return team ? (
      <span className="inline-flex items-center gap-2">
        <TeamLogoWithAbbrev teamId={team.id} abbrev={team.abbrev} size={20} />
        <span className="text-muted">{team.name}</span>
      </span>
    ) : (
      "Select a team"
    );
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
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <AppNav />

      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-6">
        <div className="mb-6">
          <h1 className="text-xl font-medium text-foreground">Season History</h1>
          <p className="mt-1 text-sm text-muted">
            Browse games by date or team, then open any game for full play-by-play replay.
          </p>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-border bg-surface p-1">
            {(["date", "team"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => handleViewChange(mode)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm transition-colors",
                  view === mode
                    ? "bg-surface-elevated text-foreground"
                    : "text-secondary hover:text-foreground",
                )}
              >
                {mode === "date" ? "By Date" : "By Team"}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-4 rounded-xl border border-border bg-surface p-4">
          {view === "date" ? (
            <label className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <span className="text-sm text-secondary">Calendar date</span>
              <input
                type="date"
                value={selectedDate}
                max={maxDate}
                onChange={(event) => handleDateChange(event.target.value)}
                className="rounded-md border border-border-strong bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-muted"
              />
            </label>
          ) : (
            <label className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <span className="text-sm text-secondary">Team</span>
              <select
                value={selectedTeamId ?? ""}
                onChange={(event) => {
                  const value = event.target.value;
                  handleTeamChange(value ? Number.parseInt(value, 10) : null);
                }}
                className="min-w-[240px] rounded-md border border-border-strong bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-muted"
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

        <section className="overflow-hidden rounded-xl border border-border bg-surface">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <h2 className="text-sm font-medium text-foreground">{summary}</h2>
              {recordSummary && (
                <p className="mt-0.5 text-xs text-muted">{recordSummary}</p>
              )}
            </div>
            {!activeQuery.isLoading && activeQuery.games.length > 0 && (
              <span className="text-xs text-muted">
                {activeQuery.games.length} game{activeQuery.games.length === 1 ? "" : "s"}
              </span>
            )}
          </div>

          <GamesList
            games={activeQuery.games}
            isLoading={activeQuery.isLoading}
            error={activeQuery.error}
            historyContext={historyContext}
            emptyMessage={
              view === "date"
                ? "No games on this date."
                : "No games for this team yet. Select a team or try another season window."
            }
          />
        </section>
      </div>
    </div>
  );
}
