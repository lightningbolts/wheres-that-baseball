"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";

import { AppNav } from "@/components/features/AppNav";
import { AtBatMatchup } from "@/components/features/AtBatMatchup";
import { BatterRispRecord } from "@/components/features/BatterRispRecord";
import { BoxScoreView } from "@/components/features/BoxScoreView";
import { ConnectionIndicator } from "@/components/features/ConnectionIndicator";
import { DashboardSkeleton } from "@/components/features/DashboardSkeleton";
import { DueUpDialog } from "@/components/features/DueUpDialog";
import { GameDetailTabs, type GameDetailTab } from "@/components/features/GameDetailTabs";
import { GameHitsView } from "@/components/features/GameHitsView";
import { GameFinalDialog } from "@/components/features/GameFinalDialog";
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
import { isPlayByPlayAtBat } from "@/lib/mlb/liveFeed";
import { cn } from "@/lib/utils";
import { LIVE_GAME_STATUSES, type SlateGame } from "@/types/mlb";

interface LiveGameDashboardProps {
  game: SlateGame;
}

function DashboardContent({ game }: { game: SlateGame }) {
  const selectedGamePk = game.gamePk;
  const [activeTab, setActiveTab] = useState<GameDetailTab>("plays");
  const mobileScrollRef = useRef<HTMLElement>(null);

  const { gameState, isLoading: isFeedLoading } = useLiveGameState(selectedGamePk, {
    pollBurstKey: activeTab,
  });
  const { boxScore, isLoading: isBoxScoreLoading } = useGameBoxScore(selectedGamePk, {
    poll: true,
    pollBurstKey: activeTab,
  });
  const { atBatViewState, showBreakUI, isLingering } = useBreakLinger(gameState);
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

  const atBatInProgress =
    gameState?.gameStatus === "Live" &&
    !showBreakUI &&
    !isLingering &&
    gameState.atBatPitches.length > 0;

  const lastCompletedAtBatIndex = useMemo(() => {
    const atBats = gameState?.plays.filter(isPlayByPlayAtBat) ?? [];
    return atBats.at(-1)?.atBatIndex ?? null;
  }, [gameState?.plays]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <ConnectionIndicator status={connectionStatus} error={error} />
      <GameDetailTabs activeTab={activeTab} onTabChange={setActiveTab} />

      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col overflow-hidden",
          activeTab !== "box" && "hidden",
        )}
        aria-hidden={activeTab !== "box"}
      >
        <BoxScoreView
          boxScore={boxScore}
          isLoading={isBoxScoreLoading}
          atBatPlayerId={showBatterHighlights ? gameState?.batterId : null}
          onDeckPlayerId={showBatterHighlights ? gameState?.onDeckId : null}
          offenseTeamId={showBatterHighlights ? gameState?.offenseTeamId : null}
          className="min-h-0 flex-1"
        />
      </div>

      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col overflow-hidden",
          activeTab !== "spray" && "hidden",
        )}
        aria-hidden={activeTab !== "spray"}
      >
        <GameHitsView
          plays={gameState?.plays ?? []}
          venueId={gameState?.venueId}
          venueName={gameState?.venueName}
          awayAbbrev={gameState?.awayAbbrev ?? "AWY"}
          homeAbbrev={gameState?.homeAbbrev ?? "HME"}
          isLoading={isFeedLoading && !gameState}
          className="min-h-0 flex-1"
        />
      </div>

      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col overflow-hidden",
          activeTab !== "plays" && "hidden",
        )}
        aria-hidden={activeTab !== "plays"}
      >
      <Scorebug
        className="shrink-0"
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

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="hidden w-[300px] shrink-0 border-r border-border md:flex lg:w-[320px]">
          <PlayByPlay
            plays={gameState?.plays ?? []}
            awayAbbrev={gameState?.awayAbbrev ?? "AWY"}
            homeAbbrev={gameState?.homeAbbrev ?? "HME"}
            venueId={gameState?.venueId}
            className="w-full"
          />
        </div>

        <main
          ref={mobileScrollRef}
          className="flex min-h-0 min-w-0 flex-1 flex-col max-md:overflow-y-auto max-md:overscroll-y-contain md:overflow-hidden"
        >
          {showSkeleton ? (
            <DashboardSkeleton />
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-px overflow-hidden bg-border max-md:overflow-visible max-md:flex-none">
              <Panel
                title={gameOver ? "Final" : showBreakUI ? "Due up" : "Current at-bat"}
                flushMobile
                className="order-1 min-h-0 overflow-hidden md:order-none md:min-h-[320px] md:flex-[3] md:shrink-0 max-md:min-h-0"
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
                      <AtBatMatchup
                        batterId={atBatViewState.batterId}
                        batterName={atBatViewState.batterName}
                        pitcherId={atBatViewState.pitcherId}
                        pitcherName={atBatViewState.pitcherName}
                        offenseTeamId={atBatViewState.offenseTeamId}
                        boxScore={boxScore}
                        matchupRecord={matchupRecord}
                        isMatchupLoading={isMatchupLoading}
                      />
                      {runnersInScoringPosition && (
                        <BatterRispRecord
                          batterName={atBatViewState.batterName}
                          stats={rispStats}
                          isLoading={isRispLoading}
                          className="mx-3 mb-2 md:mx-0"
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
                  ) : (
                    <>
                      <div className="shrink-0 md:hidden">
                        <PitchSequence
                          pitches={atBatViewState?.atBatPitches ?? []}
                          layout="zone"
                          size="compact"
                          zoneFirst
                          mobileZoneCompact
                          animateEntrance
                          className={cn(
                            "w-full",
                            !atBatInProgress &&
                              "h-[clamp(7.5rem,26dvh,11rem)]",
                          )}
                        />
                      </div>
                      <div className="hidden min-h-0 flex-1 md:flex">
                        <PitchSequence
                          pitches={atBatViewState?.atBatPitches ?? []}
                          size="large"
                          layout="split"
                          scrollToLatest
                          contained
                          animateEntrance
                          className="min-h-0 flex-1"
                        />
                      </div>
                    </>
                  )}
                    </>
                  )}
                </Panel>

                <Panel
                  title="Outcome odds"
                  className="order-2 hidden min-h-[140px] shrink-0 md:order-none md:flex lg:flex-1"
                >
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
                        {LIVE_GAME_STATUSES.has(game.status)
                          ? showBreakUI ? "Between innings" : "Waiting for at-bat…"
                          : "Available when live."}
                      </p>
                    )}
                  </div>
                </Panel>

                <div className="order-2 flex min-h-0 flex-1 flex-col md:hidden max-md:flex-none">
                  <PlayByPlay
                    key={selectedGamePk}
                    monitorKey={selectedGamePk}
                    plays={gameState?.plays ?? []}
                    awayAbbrev={gameState?.awayAbbrev ?? "AWY"}
                    homeAbbrev={gameState?.homeAbbrev ?? "HME"}
                    venueId={gameState?.venueId}
                    variant="feed"
                    embeddedScroll
                    parentScrollRef={mobileScrollRef}
                    className="flex-none"
                    autoScrollToLatest
                    livePitches={
                      atBatInProgress || isLingering
                        ? atBatViewState?.atBatPitches
                        : undefined
                    }
                    animateLivePitches={atBatInProgress || isLingering}
                    embedPitchesAtBatIndex={
                      atBatInProgress || isLingering ? null : lastCompletedAtBatIndex
                    }
                    feedHeader={
                      atBatViewState && gameState?.gameStatus === "Live" && !showBreakUI ? (
                        <ProbabilityChart
                          key={`${atBatViewState.batterId ?? 0}-${atBatViewState.inning}-mobile`}
                          probabilities={probabilities}
                          compact
                        />
                      ) : (
                        <p className="py-2 text-center text-sm text-muted">
                          {LIVE_GAME_STATUSES.has(game.status)
                            ? showBreakUI ? "Between innings" : "Waiting for at-bat…"
                            : "Available when live."}
                        </p>
                      )
                    }
                  />
                </div>
              </div>
          )}
        </main>
      </div>
      </div>

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
  flushMobile,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
  /** Edge-to-edge strike zone on mobile (Gameday-style). */
  flushMobile?: boolean;
}) {
  return (
    <section
      className={cn(
        "flex min-w-0 flex-col overflow-hidden bg-panel md:min-h-[220px] lg:min-h-0",
        flushMobile ? "min-h-0 p-0 md:min-h-[280px] md:p-3" : "min-h-[280px] p-3",
        className,
      )}
    >
      <h3
        className={cn(
          "shrink-0 text-xs font-medium text-muted",
          flushMobile ? "hidden md:mb-2 md:block" : "mb-2",
        )}
      >
        {title}
      </h3>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
    </section>
  );
}

function NoGamesState() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <AppNav />
      <div className="flex flex-1 items-center justify-center px-6">
        <div className="max-w-sm text-center">
          <h1 className="text-lg font-medium text-foreground">Game not found</h1>
          <p className="mt-2 text-sm text-muted">
            <Link href="/" className="text-secondary underline-offset-2 hover:underline">
              Back to today&apos;s games
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export function LiveGameDashboard({ game }: LiveGameDashboardProps) {
  if (!game) {
    return <NoGamesState />;
  }

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background text-foreground">
      <AppNav />
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 border-b border-border bg-surface px-3 py-2 sm:px-4">
          <Link
            href="/"
            className="text-xs text-muted transition-colors hover:text-foreground"
          >
            ← All games
          </Link>
          <p className="mt-0.5 truncate text-sm font-medium text-foreground">{game.label}</p>
        </div>
        <DashboardContent game={game} />
      </div>
    </div>
  );
}
