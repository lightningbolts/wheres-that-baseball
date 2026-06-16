"use client";

import { useCallback, useEffect, useState } from "react";

import { AppNav } from "@/components/features/AppNav";
import { BatterRispRecord } from "@/components/features/BatterRispRecord";
import { BatterVsPitcherRecord } from "@/components/features/BatterVsPitcherRecord";
import { BoxScoreView } from "@/components/features/BoxScoreView";
import { ConnectionIndicator } from "@/components/features/ConnectionIndicator";
import { DashboardSkeleton } from "@/components/features/DashboardSkeleton";
import { GameDetailTabs, type GameDetailTab } from "@/components/features/GameDetailTabs";
import { GameSidebar } from "@/components/features/GameSidebar";
import { PlayByPlay } from "@/components/features/PlayByPlay";
import { ProbabilityChart } from "@/components/features/ProbabilityChart";
import { Scorebug } from "@/components/features/Scorebug";
import { PitchSequence } from "@/components/features/PitchSequence";
import { useBatterRisp } from "@/hooks/useBatterRisp";
import { useBatterVsPitcher } from "@/hooks/useBatterVsPitcher";
import { useLiveGameState } from "@/hooks/useLiveGameState";
import { useLivePredictions } from "@/hooks/useLivePredictions";
import { cn } from "@/lib/utils";
import { DEFAULT_OUTCOME_PROBABILITIES } from "@/types/database";
import { LIVE_GAME_STATUSES, type ActiveGame } from "@/types/mlb";

const GAMES_REFRESH_MS = 10_000;

interface LiveDashboardProps {
  initialGames: ActiveGame[];
  scheduleError?: string | null;
}

interface DashboardContentProps {
  games: ActiveGame[];
  selectedGamePk: number;
  onSelectGame: (gamePk: number) => void;
}

function DashboardContent({ games, selectedGamePk, onSelectGame }: DashboardContentProps) {
  const selectedGame =
    games.find((g) => g.gamePk === selectedGamePk) ?? games[0];

  const { gameState, boxScore, isLoading: isFeedLoading } = useLiveGameState(selectedGamePk);
  const { latestPrediction, isLoading: isPredictionsLoading, error, connectionStatus } =
    useLivePredictions(selectedGamePk);

  const [activeTab, setActiveTab] = useState<GameDetailTab>("plays");

  const probabilities =
    latestPrediction?.outcome_probabilities ?? DEFAULT_OUTCOME_PROBABILITIES;

  const onFirst = latestPrediction?.on_first ?? gameState?.onFirst ?? false;
  const onSecond = latestPrediction?.on_second ?? gameState?.onSecond ?? false;
  const onThird = latestPrediction?.on_third ?? gameState?.onThird ?? false;
  const runnersInScoringPosition = onSecond || onThird;

  const { record: matchupRecord, isLoading: isMatchupLoading } = useBatterVsPitcher(
    gameState?.batterId,
    gameState?.pitcherId,
  );
  const { stats: rispStats, isLoading: isRispLoading } = useBatterRisp(
    gameState?.batterId,
    runnersInScoringPosition,
  );

  const showSkeleton = isFeedLoading && !gameState && isPredictionsLoading && !latestPrediction;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <ConnectionIndicator status={connectionStatus} error={error} />
      <GameDetailTabs activeTab={activeTab} onTabChange={setActiveTab} />

      {activeTab === "box" ? (
        <BoxScoreView boxScore={boxScore} isLoading={isFeedLoading} />
      ) : (
        <>
      <Scorebug
        gameState={
          gameState
            ? { ...gameState, onFirst, onSecond, onThird }
            : null
        }
      />

      <div className="flex min-h-0 flex-1">
        <div className="hidden w-[300px] shrink-0 border-r border-border md:flex lg:w-[320px]">
          <PlayByPlay
            plays={gameState?.plays ?? []}
            awayAbbrev={gameState?.awayAbbrev ?? "AWY"}
            homeAbbrev={gameState?.homeAbbrev ?? "HME"}
            venueId={gameState?.venueId}
            className="w-full"
          />
        </div>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="border-b border-border p-2 lg:hidden">
            <select
              value={selectedGamePk}
              onChange={(e) => onSelectGame(Number(e.target.value))}
              className="w-full border border-border-strong bg-surface-elevated px-2 py-1.5 text-sm text-foreground"
            >
              {games.map((game) => (
                <option key={game.gamePk} value={game.gamePk}>
                  {game.label} ({game.status})
                </option>
              ))}
            </select>
          </div>

          {showSkeleton ? (
            <DashboardSkeleton />
          ) : (
            <>
              <div className="h-56 shrink-0 border-b border-border md:hidden">
                <PlayByPlay
                  plays={gameState?.plays ?? []}
                  awayAbbrev={gameState?.awayAbbrev ?? "AWY"}
                  homeAbbrev={gameState?.homeAbbrev ?? "HME"}
                  venueId={gameState?.venueId}
                  className="h-full"
                />
              </div>

              <div className="flex min-h-0 flex-1 flex-col gap-px bg-border">
                <Panel title="Current at-bat" className="min-h-[380px] flex-[3]">
                  {gameState && (
                    <>
                      <BatterVsPitcherRecord
                        batterName={gameState.batterName}
                        pitcherName={gameState.pitcherName}
                        record={matchupRecord}
                        isLoading={isMatchupLoading}
                      />
                      {runnersInScoringPosition && (
                        <BatterRispRecord
                          batterName={gameState.batterName}
                          stats={rispStats}
                          isLoading={isRispLoading}
                        />
                      )}
                    </>
                  )}
                  {(gameState?.atBatPitches.length ?? 0) === 0 ? (
                    <p className="text-sm text-subtle">Waiting for first pitch…</p>
                  ) : (
                    <PitchSequence
                      pitches={gameState?.atBatPitches ?? []}
                      size="large"
                      layout="split"
                      scrollToLatest
                      contained
                      animateEntrance
                      className="min-h-0 flex-1"
                    />
                  )}
                </Panel>

                <Panel title="Outcome odds" className="min-h-[160px] shrink-0 lg:flex-1">
                  <div className="flex flex-1 flex-col justify-center">
                    {latestPrediction ? (
                      <ProbabilityChart probabilities={probabilities} />
                    ) : (
                      <p className="py-4 text-center text-sm text-muted">
                        {LIVE_GAME_STATUSES.has(selectedGame?.status ?? "")
                          ? "Waiting on ingestor."
                          : "Available when live."}
                      </p>
                    )}
                  </div>
                </Panel>
              </div>
            </>
          )}
        </main>
      </div>
        </>
      )}
    </div>
  );
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
    <section className={cn("flex min-h-[220px] flex-col bg-panel p-3 lg:min-h-0", className)}>
      <h3 className="mb-2 shrink-0 text-xs font-medium text-muted">{title}</h3>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
    </section>
  );
}

function NoGamesState({ scheduleError }: { scheduleError?: string | null }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <AppNav />
      <div className="flex flex-1 items-center justify-center px-6">
        <div className="max-w-sm text-center">
          <h1 className="text-lg font-medium text-foreground">No games on the board</h1>
          <p className="mt-2 text-sm text-muted">Nothing live or upcoming today.</p>
          {scheduleError && <p className="mt-4 text-sm text-red-400/80">{scheduleError}</p>}
        </div>
      </div>
    </div>
  );
}

export function LiveDashboard({ initialGames, scheduleError }: LiveDashboardProps) {
  const [games, setGames] = useState(initialGames);
  const [selectedGamePk, setSelectedGamePk] = useState<number | null>(
    initialGames[0]?.gamePk ?? null,
  );

  const refreshGames = useCallback(async () => {
    try {
      const response = await fetch("/api/games", { cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as { games: ActiveGame[] };
      setGames(data.games);
      setSelectedGamePk((current) => {
        if (current && data.games.some((g) => g.gamePk === current)) return current;
        const firstLive = data.games.find((g) => LIVE_GAME_STATUSES.has(g.status));
        return firstLive?.gamePk ?? data.games[0]?.gamePk ?? null;
      });
    } catch {
      // keep stale
    }
  }, []);

  useEffect(() => {
    void refreshGames();
    const interval = setInterval(() => void refreshGames(), GAMES_REFRESH_MS);
    return () => clearInterval(interval);
  }, [refreshGames]);

  if (games.length === 0 || selectedGamePk === null) {
    return <NoGamesState scheduleError={scheduleError} />;
  }

  return (
    <div className="flex h-screen min-h-0 flex-col bg-background text-foreground">
      <AppNav />
      <div className="flex min-h-0 flex-1">
        <div className="hidden h-full w-52 shrink-0 border-r border-border lg:block">
          <GameSidebar
            games={games}
            selectedGamePk={selectedGamePk}
            onSelectGame={setSelectedGamePk}
          />
        </div>

        <DashboardContent
          key={selectedGamePk}
          games={games}
          selectedGamePk={selectedGamePk}
          onSelectGame={setSelectedGamePk}
        />
      </div>
    </div>
  );
}
