"use client";

import { useCallback, useEffect, useState } from "react";

import { AppNav } from "@/components/features/AppNav";
import { BatterRispRecord } from "@/components/features/BatterRispRecord";
import { BatterVsPitcherRecord } from "@/components/features/BatterVsPitcherRecord";
import { BoxScoreView } from "@/components/features/BoxScoreView";
import { ConnectionIndicator } from "@/components/features/ConnectionIndicator";
import { DashboardSkeleton } from "@/components/features/DashboardSkeleton";
import { DueUpDialog } from "@/components/features/DueUpDialog";
import { GameDetailTabs, type GameDetailTab } from "@/components/features/GameDetailTabs";
import { GameHitsView } from "@/components/features/GameHitsView";
import { GameFinalDialog } from "@/components/features/GameFinalDialog";
import { GameSidebar } from "@/components/features/GameSidebar";
import { PlayByPlay } from "@/components/features/PlayByPlay";
import { ProbabilityChart } from "@/components/features/ProbabilityChart";
import { Scorebug } from "@/components/features/Scorebug";
import { PitchSequence } from "@/components/features/PitchSequence";
import { useArchiveFinishedGame } from "@/hooks/useArchiveFinishedGame";
import { useBatterRisp } from "@/hooks/useBatterRisp";
import { useBatterVsPitcher } from "@/hooks/useBatterVsPitcher";
import { useBreakLinger } from "@/hooks/useBreakLinger";
import { useLiveGameOverlays } from "@/hooks/useLiveGameOverlays";
import { useLiveGameState } from "@/hooks/useLiveGameState";
import { useGameBoxScore } from "@/hooks/useGameBoxScore";
import { useLivePredictions } from "@/hooks/useLivePredictions";
import { useOutcomeOdds } from "@/hooks/useOutcomeOdds";
import { isHalfInningBreak } from "@/lib/mlb/lineup";
import { cn } from "@/lib/utils";
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

  const { gameState, isLoading: isFeedLoading } = useLiveGameState(selectedGamePk);
  const { boxScore, isLoading: isBoxScoreLoading } = useGameBoxScore(selectedGamePk, { poll: true });
  const { atBatViewState, showBreakUI } = useBreakLinger(gameState);
  const { dueUp, showDueUp, dismissDueUp, showFinal, dismissFinal, gameOver } =
    useLiveGameOverlays(gameState, boxScore, showBreakUI);
  useArchiveFinishedGame(selectedGamePk, gameOver);
  const { predictions, isLoading: isPredictionsLoading, error, connectionStatus } =
    useLivePredictions(selectedGamePk, {
      batterName: atBatViewState?.batterName,
      inning: atBatViewState?.inning,
      balls: atBatViewState?.balls,
      strikes: atBatViewState?.strikes,
      pitchCount: atBatViewState?.atBatPitches.length,
    });

  const { probabilities, matchedPrediction } = useOutcomeOdds(atBatViewState, predictions);

  const [activeTab, setActiveTab] = useState<GameDetailTab>("plays");

  const onFirst = matchedPrediction?.on_first ?? gameState?.onFirst ?? false;
  const onSecond = matchedPrediction?.on_second ?? gameState?.onSecond ?? false;
  const onThird = matchedPrediction?.on_third ?? gameState?.onThird ?? false;
  const runnersInScoringPosition = onSecond || onThird;

  const { record: matchupRecord, isLoading: isMatchupLoading } = useBatterVsPitcher(
    atBatViewState?.batterId,
    atBatViewState?.pitcherId,
  );
  const { stats: rispStats, isLoading: isRispLoading } = useBatterRisp(
    atBatViewState?.batterId,
    runnersInScoringPosition,
  );

  const showSkeleton = isFeedLoading && !gameState && isPredictionsLoading && predictions.length === 0;
  const showBatterHighlights =
    gameState != null &&
    gameState.gameStatus === "Live" &&
    !isHalfInningBreak(gameState.inningState);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <ConnectionIndicator status={connectionStatus} error={error} />
      <GameDetailTabs activeTab={activeTab} onTabChange={setActiveTab} />

      {activeTab === "box" ? (
        <BoxScoreView
          boxScore={boxScore}
          isLoading={isBoxScoreLoading}
          atBatPlayerId={showBatterHighlights ? gameState?.batterId : null}
          onDeckPlayerId={showBatterHighlights ? gameState?.onDeckId : null}
          offenseTeamId={showBatterHighlights ? gameState?.offenseTeamId : null}
        />
      ) : activeTab === "spray" ? (
        <GameHitsView
          plays={gameState?.plays ?? []}
          venueId={gameState?.venueId}
          venueName={gameState?.venueName}
          awayAbbrev={gameState?.awayAbbrev ?? "AWY"}
          homeAbbrev={gameState?.homeAbbrev ?? "HME"}
          isLoading={isFeedLoading && !gameState}
        />
      ) : (
        <>
      <Scorebug
        gameState={
          gameState
            ? { ...gameState, onFirst, onSecond, onThird }
            : null
        }
        dueUpBatters={
          gameState && !gameOver && isHalfInningBreak(gameState.inningState)
            ? dueUp?.batters
            : undefined
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
                <Panel
                  title={gameOver ? "Final" : showBreakUI ? "Due up" : "Current at-bat"}
                  className="min-h-[380px] flex-[3]"
                >
                  {gameOver && gameState ? (
                    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-8 text-center">
                      <p className="text-sm text-secondary">
                        {gameState.awayTeam} @ {gameState.homeTeam}
                      </p>
                      <div className="flex items-center gap-6">
                        <div>
                          <p className="text-xs font-semibold text-muted">{gameState.awayAbbrev}</p>
                          <p className="font-mono text-4xl font-bold tabular-nums">{gameState.awayRuns}</p>
                        </div>
                        <span className="text-lg text-faint">–</span>
                        <div>
                          <p className="text-xs font-semibold text-muted">{gameState.homeAbbrev}</p>
                          <p className="font-mono text-4xl font-bold tabular-nums">{gameState.homeRuns}</p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                  {atBatViewState && !showBreakUI && (
                    <>
                      <BatterVsPitcherRecord
                        batterName={atBatViewState.batterName}
                        pitcherName={atBatViewState.pitcherName}
                        record={matchupRecord}
                        isLoading={isMatchupLoading}
                      />
                      {runnersInScoringPosition && (
                        <BatterRispRecord
                          batterName={atBatViewState.batterName}
                          stats={rispStats}
                          isLoading={isRispLoading}
                        />
                      )}
                    </>
                  )}
                  {showBreakUI && dueUp ? (
                    <ul className="space-y-2">
                      {dueUp.batters.map((batter) => (
                        <li
                          key={batter.playerId}
                          className="flex items-center gap-3 border border-border bg-surface-elevated px-3 py-2.5"
                        >
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center bg-overlay font-mono text-xs font-semibold tabular-nums text-muted">
                            {batter.order}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-foreground">{batter.name}</p>
                            <p className="text-[11px] text-subtle">
                              {batter.positions ? `${batter.positions} · ` : ""}
                              {batter.seasonAvg} AVG
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : showBreakUI && gameState?.batterName && gameState.batterName !== "—" ? (
                    <ul className="space-y-2">
                      {[gameState.batterName, gameState.onDeckName, gameState.inHoleName]
                        .filter((name) => name && name !== "—")
                        .map((name, index) => (
                          <li
                            key={`${name}-${index}`}
                            className="flex items-center gap-3 border border-border bg-surface-elevated px-3 py-2.5"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-foreground">{name}</p>
                            </div>
                          </li>
                        ))}
                    </ul>
                  ) : showBreakUI ? (
                    <p className="text-sm text-subtle">Loading due up…</p>
                  ) : (atBatViewState?.atBatPitches.length ?? 0) === 0 ? (
                    <p className="text-sm text-subtle">Waiting for first pitch…</p>
                  ) : (
                    <PitchSequence
                      pitches={atBatViewState?.atBatPitches ?? []}
                      size="large"
                      layout="split"
                      scrollToLatest
                      contained
                      animateEntrance
                      className="min-h-0 flex-1"
                    />
                  )}
                    </>
                  )}
                </Panel>

                <Panel title="Outcome odds" className="min-h-[160px] shrink-0 lg:flex-1">
                  <div className="flex min-h-0 flex-1 flex-col">
                    {atBatViewState && gameState?.gameStatus === "Live" && !showBreakUI ? (
                      <ProbabilityChart
                        key={`${atBatViewState.batterId ?? 0}-${atBatViewState.inning}`}
                        probabilities={probabilities}
                        contained
                        className="min-h-0 flex-1"
                      />
                    ) : (
                      <p className="py-4 text-center text-sm text-muted">
                        {LIVE_GAME_STATUSES.has(selectedGame?.status ?? "")
                          ? showBreakUI ? "Between innings" : "Waiting for at-bat…"
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

      <DueUpDialog context={dueUp} open={showDueUp} onClose={dismissDueUp} />
      <GameFinalDialog
        gameState={gameState}
        boxScore={boxScore}
        open={showFinal}
        onClose={dismissFinal}
      />
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
          <p className="mt-2 text-sm text-muted">No live or scheduled games on today&apos;s slate.</p>
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
