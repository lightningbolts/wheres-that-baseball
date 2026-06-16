"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { AppNav } from "@/components/features/AppNav";
import { BatterRispRecord } from "@/components/features/BatterRispRecord";
import { BatterVsPitcherRecord } from "@/components/features/BatterVsPitcherRecord";
import { DashboardSkeleton } from "@/components/features/DashboardSkeleton";
import { PitchSequence } from "@/components/features/PitchSequence";
import { PlayByPlay } from "@/components/features/PlayByPlay";
import { ProbabilityChart } from "@/components/features/ProbabilityChart";
import { Scorebug } from "@/components/features/Scorebug";
import { Skeleton } from "@/components/ui/Skeleton";
import { useGamePredictions } from "@/hooks/useGamePredictions";
import { useGameState } from "@/hooks/useGameState";
import { useBatterRisp } from "@/hooks/useBatterRisp";
import { useBatterVsPitcher } from "@/hooks/useBatterVsPitcher";
import { formatGameDate, formatMatchup, formatScore, isLiveStatus } from "@/lib/games/format";
import { gameStateForAtBat } from "@/lib/games/replay";
import { cn } from "@/lib/utils";
import { DEFAULT_OUTCOME_PROBABILITIES } from "@/types/database";
import type { Game } from "@/types/database";
import type { PlayByPlayEntry } from "@/types/mlb-live";

interface HistoricalGameDashboardProps {
  game: Game;
}

function Panel({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex min-h-[180px] flex-col bg-panel p-3 lg:min-h-0", className)}>
      <h3 className="mb-2 shrink-0 text-xs font-medium text-muted">{title}</h3>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
    </section>
  );
}

export function HistoricalGameDashboard({ game }: HistoricalGameDashboardProps) {
  const isLive = isLiveStatus(game.status);
  const { gameState, isLoading, error, source, feedSyncedAt } = useGameState(game.game_pk, {
    poll: isLive,
  });

  const [selectedAtBatIndex, setSelectedAtBatIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!gameState?.plays.length) return;
    setSelectedAtBatIndex((current) => {
      if (current != null && gameState.plays.some((play) => play.atBatIndex === current)) {
        return current;
      }
      return gameState.plays[gameState.plays.length - 1]?.atBatIndex ?? null;
    });
  }, [gameState]);

  const selectedPlay = useMemo<PlayByPlayEntry | null>(() => {
    if (!gameState || selectedAtBatIndex == null) return null;
    return gameState.plays.find((play) => play.atBatIndex === selectedAtBatIndex) ?? null;
  }, [gameState, selectedAtBatIndex]);

  const displayState = useMemo(() => {
    if (!gameState) return null;
    if (!selectedPlay) return gameState;
    return gameStateForAtBat(gameState, selectedPlay);
  }, [gameState, selectedPlay]);

  const onFirst = displayState?.onFirst ?? false;
  const onSecond = displayState?.onSecond ?? false;
  const onThird = displayState?.onThird ?? false;
  const runnersInScoringPosition = onSecond || onThird;

  const lastPitch = selectedPlay?.detail.pitches.at(-1);
  const { predictionForAtBat, predictions, isLoading: predictionsLoading } = useGamePredictions(
    game.game_pk,
    selectedPlay
      ? {
          batterName: selectedPlay.batterName,
          inning: selectedPlay.inning,
          balls: lastPitch?.balls ?? 0,
          strikes: lastPitch?.strikes ?? 0,
        }
      : null,
  );

  const probabilities =
    predictionForAtBat?.outcome_probabilities ?? DEFAULT_OUTCOME_PROBABILITIES;

  const { record: matchupRecord, isLoading: isMatchupLoading } = useBatterVsPitcher(
    displayState?.batterId,
    displayState?.pitcherId,
  );
  const { stats: rispStats, isLoading: isRispLoading } = useBatterRisp(
    displayState?.batterId,
    runnersInScoringPosition,
  );

  const score = formatScore(game);

  return (
    <div className="flex h-screen min-h-0 flex-col bg-background text-foreground">
      <AppNav />

      <div className="border-b border-border bg-surface px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link
              href="/games"
              className="text-xs text-muted transition-colors hover:text-secondary"
            >
              ← Season history
            </Link>
            <h1 className="mt-1 text-lg font-medium text-foreground">{formatMatchup(game)}</h1>
            <p className="mt-0.5 text-sm text-muted">
              {formatGameDate(game.game_date)}
              {game.venue_name ? ` · ${game.venue_name}` : ""}
              {score ? ` · Final ${score}` : ""}
            </p>
          </div>
          <div className="text-right text-xs text-subtle">
            {feedSyncedAt ? (
              <span>Feed synced {new Date(feedSyncedAt).toLocaleString()}</span>
            ) : source === "mlb" ? (
              <span>Loaded from MLB API</span>
            ) : (
              <span>{game.feed_synced_at ? "Feed available" : "Run sync-game-feeds to cache in Supabase"}</span>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="border-b border-red-900/50 bg-red-950/30 px-4 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      {isLoading && !gameState ? (
        <div className="flex flex-1 flex-col p-4">
          <Skeleton className="mb-4 h-14 w-full" />
          <DashboardSkeleton />
        </div>
      ) : !gameState ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center">
          <div>
            <p className="text-sm text-secondary">No play-by-play data for this game.</p>
            <p className="mt-2 text-xs text-subtle">
              Run <code className="text-secondary">npm run sync-game-feeds</code> to backfill feeds.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <Scorebug gameState={displayState} />

          <div className="flex min-h-0 flex-1">
            <div className="hidden w-[300px] shrink-0 border-r border-border md:flex lg:w-[320px]">
              <PlayByPlay
                plays={gameState.plays}
                awayAbbrev={gameState.awayAbbrev}
                homeAbbrev={gameState.homeAbbrev}
                venueId={gameState.venueId}
                selectedAtBatIndex={selectedAtBatIndex}
                onSelectAtBat={(play) => setSelectedAtBatIndex(play.atBatIndex)}
                autoScrollToLatest={false}
                className="w-full"
              />
            </div>

            <main className="flex min-h-0 min-w-0 flex-1 flex-col">
              <div className="border-b border-border p-2 md:hidden">
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] text-muted">At-bat</span>
                  <select
                    value={selectedAtBatIndex ?? ""}
                    onChange={(event) =>
                      setSelectedAtBatIndex(Number.parseInt(event.target.value, 10))
                    }
                    className="w-full border border-border-strong bg-surface-elevated px-2 py-1.5 text-sm text-foreground"
                  >
                    {gameState.plays.map((play) => (
                      <option key={play.atBatIndex} value={play.atBatIndex}>
                        {play.inning} {play.halfInning} — {play.batterName} ({play.event})
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="h-56 shrink-0 border-b border-border md:hidden">
                <PlayByPlay
                  plays={gameState.plays}
                  awayAbbrev={gameState.awayAbbrev}
                  homeAbbrev={gameState.homeAbbrev}
                  venueId={gameState.venueId}
                  selectedAtBatIndex={selectedAtBatIndex}
                  onSelectAtBat={(play) => setSelectedAtBatIndex(play.atBatIndex)}
                  autoScrollToLatest={false}
                  className="h-full"
                />
              </div>

              <div className="flex min-h-0 flex-1 flex-col gap-px bg-border">
                <Panel title="Selected at-bat" className="min-h-0 flex-[3]">
                  {displayState && (
                    <>
                      <BatterVsPitcherRecord
                        batterName={displayState.batterName}
                        pitcherName={displayState.pitcherName}
                        record={matchupRecord}
                        isLoading={isMatchupLoading}
                      />
                      {runnersInScoringPosition && (
                        <BatterRispRecord
                          batterName={displayState.batterName}
                          stats={rispStats}
                          isLoading={isRispLoading}
                        />
                      )}
                    </>
                  )}
                  {(displayState?.atBatPitches.length ?? 0) === 0 ? (
                    <p className="text-sm text-subtle">No pitch data for this at-bat.</p>
                  ) : (
                    <PitchSequence
                      pitches={displayState?.atBatPitches ?? []}
                      size="large"
                      layout="stacked"
                      className="h-full"
                    />
                  )}
                </Panel>

                <Panel title="Outcome odds" className="min-h-[160px] shrink-0 lg:flex-1">
                  <div className="flex flex-1 flex-col justify-center">
                    {predictionForAtBat ? (
                      <ProbabilityChart probabilities={probabilities} />
                    ) : predictionsLoading ? (
                      <p className="py-4 text-center text-sm text-muted">Loading predictions…</p>
                    ) : predictions.length > 0 ? (
                      <p className="py-4 text-center text-sm text-muted">
                        No model snapshot matched this exact at-bat count.
                      </p>
                    ) : (
                      <p className="py-4 text-center text-sm text-muted">
                        {isLive
                          ? "Waiting on ingestor for live predictions."
                          : "No ingestor predictions were stored for this game."}
                      </p>
                    )}
                  </div>
                </Panel>
              </div>
            </main>
          </div>
        </div>
      )}
    </div>
  );
}
