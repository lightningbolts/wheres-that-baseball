"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { AppNav } from "@/components/features/AppNav";
import { AtBatMatchup } from "@/components/features/AtBatMatchup";
import { AtBatOutcomeToast } from "@/components/features/AtBatOutcomeToast";
import { BoxScoreView } from "@/components/features/BoxScoreView";
import { CallItGame } from "@/components/features/callIt/CallItGame";
import { ConnectionIndicator } from "@/components/features/ConnectionIndicator";
import { DashboardSkeleton } from "@/components/features/DashboardSkeleton";
import { DueUpDialog } from "@/components/features/DueUpDialog";
import { GameDetailTabs, type GameDetailTab } from "@/components/features/GameDetailTabs";
import { GameFieldView } from "@/components/features/GameFieldView";
import { GameHitsView } from "@/components/features/GameHitsView";
import { GameHighlightsView } from "@/components/features/GameHighlightsView";
import { GameFinalDialog } from "@/components/features/GameFinalDialog";
import { GameStateView } from "@/components/features/GameStateView";
import { NerdInsightToasts } from "@/components/features/NerdInsightToasts";
import { PlayByPlay } from "@/components/features/PlayByPlay";
import { ProbabilityChart } from "@/components/features/ProbabilityChart";
import { Scorebug } from "@/components/features/Scorebug";
import { StealIndicator } from "@/components/features/StealIndicator";
import { PitchSequence, type StrikeZoneMode } from "@/components/features/PitchSequence";
import { useArchiveFinishedGame } from "@/hooks/useArchiveFinishedGame";
import { useAtBatOutcomeToast } from "@/hooks/useAtBatOutcomeToast";
import { useBatterHotZones } from "@/hooks/useBatterHotZones";
import { useBatterRisp } from "@/hooks/useBatterRisp";
import { useBatterVsPitcher } from "@/hooks/useBatterVsPitcher";
import { useBreakLinger } from "@/hooks/useBreakLinger";
import { useLiveGameOverlays } from "@/hooks/useLiveGameOverlays";
import { useLiveGameState } from "@/hooks/useLiveGameState";
import { useNerdInsights, buildInsightMaps } from "@/hooks/useNerdInsights";
import { useGameBoxScore } from "@/hooks/useGameBoxScore";
import { useLivePredictions } from "@/hooks/useLivePredictions";
import { useMlPredictions } from "@/hooks/useMlPredictions";
import { useOutcomeOdds } from "@/hooks/useOutcomeOdds";
import { isGameOver } from "@/lib/mlb/gameOver";
import { isHalfInningBreak } from "@/lib/mlb/lineup";
import { isPlayByPlayAtBat } from "@/lib/mlb/liveFeed";
import { allPitchesThroughPoint } from "@/lib/mlb/allGamePitches";
import { cn } from "@/lib/utils";
import { LIVE_GAME_STATUSES, type SlateGame } from "@/types/mlb";

interface LiveGameDashboardProps {
  game: SlateGame;
}

function DashboardContent({ game }: { game: SlateGame }) {
  const selectedGamePk = game.gamePk;
  const [activeTab, setActiveTab] = useState<GameDetailTab>("plays");
  const [zoneMode, setZoneMode] = useState<StrikeZoneMode>("atBat");
  const mobileScrollRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setZoneMode("atBat");
  }, [selectedGamePk]);

  // Call It stays in the tree for now but is hidden from the tab bar.
  useEffect(() => {
    if (activeTab === "callIt") setActiveTab("plays");
  }, [activeTab]);

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
  const { feedInsights, overlayToasts, liveInsight, dismissToast: dismissNerdInsight } = useNerdInsights(
    gameState,
    { gameOver },
  );
  const { insightsByAtBat, halfInsights, inningInsights } = useMemo(
    () => buildInsightMaps(feedInsights),
    [feedInsights],
  );
  useArchiveFinishedGame(selectedGamePk, gameOver);
  const {
    play: outcomeToastPlay,
    phase: outcomeToastPhase,
    settlingAtBatIndex,
    dismiss: dismissOutcomeToast,
  } = useAtBatOutcomeToast(gameState?.plays ?? [], !gameOver && activeTab === "plays");
  const { predictions, error, connectionStatus } =
    useLivePredictions(selectedGamePk, {
      batterName: atBatViewState?.batterName,
      inning: atBatViewState?.inning,
      balls: atBatViewState?.balls,
      strikes: atBatViewState?.strikes,
      pitchCount: atBatViewState?.atBatPitches.length,
    });
  const mlPredictions = useMlPredictions(atBatViewState, !gameOver);

  const { probabilities, stealProbabilities, oddsKey } = useOutcomeOdds(
    atBatViewState,
    predictions,
    mlPredictions,
  );

  const matchAtBatKey = atBatViewState
    ? `${atBatViewState.batterId ?? 0}-${atBatViewState.inning}-${atBatViewState.inningHalf}`
    : "none";

  const onFirst = atBatViewState?.onFirst ?? gameState?.onFirst ?? false;
  const onSecond = atBatViewState?.onSecond ?? gameState?.onSecond ?? false;
  const onThird = atBatViewState?.onThird ?? gameState?.onThird ?? false;
  const runnersInScoringPosition = onSecond || onThird;

  const { record: matchupRecord, isLoading: isMatchupLoading } = useBatterVsPitcher(
    atBatViewState?.batterId,
    atBatViewState?.pitcherId,
  );
  const { stats: rispStats, isLoading: isRispLoading } = useBatterRisp(
    atBatViewState?.batterId,
    runnersInScoringPosition,
  );
  const gameSeason = new Date(game.gameDate).getFullYear();
  const zoneBatterId = useMemo(() => {
    if (atBatViewState?.batterId != null && atBatViewState.batterId > 0) {
      return atBatViewState.batterId;
    }
    const lastAtBat = gameState?.plays.filter(isPlayByPlayAtBat).at(-1);
    if (lastAtBat?.batterId != null && lastAtBat.batterId > 0) return lastAtBat.batterId;
    if (lastAtBat?.detail.batterId != null && lastAtBat.detail.batterId > 0) {
      return lastAtBat.detail.batterId;
    }
    return null;
  }, [atBatViewState?.batterId, gameState?.plays]);
  const { zones: batterHotZones } = useBatterHotZones(zoneBatterId, gameSeason);

  const gameZonePitches = useMemo(() => {
    if (!gameState) return [];
    return allPitchesThroughPoint(gameState, {
      currentAtBatPitches: atBatViewState?.atBatPitches,
    });
  }, [gameState, atBatViewState?.atBatPitches]);

  const totalGamePitchCount = useMemo(
    () => gameZonePitches.filter((pitch) => pitch.isPitch).length,
    [gameZonePitches],
  );

  const showSkeleton = Boolean(selectedGamePk) && isFeedLoading && !gameState;
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

  const outcomeOddsFooter =
    atBatViewState && gameState?.gameStatus === "Live" && !showBreakUI ? (
      <div className="space-y-3">
        <ProbabilityChart
          key={`${atBatViewState.batterId ?? 0}-${atBatViewState.inning}`}
          probabilities={probabilities}
          contained={false}
        />
        <StealIndicator
          stealProbabilities={stealProbabilities}
          onFirst={onFirst}
          onSecond={onSecond}
        />
      </div>
    ) : (
      <p className="py-2 text-center text-sm text-muted">
        {LIVE_GAME_STATUSES.has(game.status)
          ? showBreakUI
            ? "Between innings"
            : "Waiting for at-bat…"
          : "Available when live."}
      </p>
    );

  const outcomeToastNode =
    outcomeToastPlay && outcomeToastPhase !== "hidden" ? (
      <AtBatOutcomeToast
        play={outcomeToastPlay}
        phase={outcomeToastPhase}
        onDismiss={dismissOutcomeToast}
      />
    ) : null;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <ConnectionIndicator status={connectionStatus} error={error} />
      <GameDetailTabs activeTab={activeTab} onTabChange={setActiveTab} compact />

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
          activeTab !== "field" && "hidden",
        )}
        aria-hidden={activeTab !== "field"}
      >
        <GameFieldView
          gameState={atBatViewState ?? gameState}
          boxScore={boxScore}
          isLoading={isFeedLoading && !gameState}
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
          activeTab !== "highlights" && "hidden",
        )}
        aria-hidden={activeTab !== "highlights"}
      >
        <GameHighlightsView
          plays={gameState?.plays ?? []}
          isLive
          isLoading={isFeedLoading && !gameState}
          className="min-h-0 flex-1"
        />
      </div>

      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col overflow-hidden",
          activeTab !== "state" && "hidden",
        )}
        aria-hidden={activeTab !== "state"}
      >
        <GameStateView
          gameState={atBatViewState ?? gameState}
          plays={gameState?.plays ?? []}
          isLoading={isFeedLoading && !gameState}
          className="min-h-0 flex-1"
          matchProbabilities={
            atBatViewState && gameState?.gameStatus === "Live" && !showBreakUI
              ? probabilities
              : null
          }
          matchOddsKey={oddsKey}
          matchAtBatKey={matchAtBatKey}
        />
      </div>

      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col overflow-hidden",
          activeTab !== "callIt" && "hidden",
        )}
        aria-hidden={activeTab !== "callIt"}
      >
        {showSkeleton ? (
          <DashboardSkeleton />
        ) : (
          <CallItGame
            gameState={atBatViewState ?? gameState}
            boxScore={boxScore}
            paused={showBreakUI || isLingering || isHalfInningBreak(gameState?.inningState ?? "")}
            gameOver={gameOver || (gameState != null && isGameOver(gameState))}
            className="min-h-0 flex-1"
          />
        )}
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
        matchupSlot={
          atBatViewState && !showBreakUI && !gameOver ? (
            <AtBatMatchup
              variant="scorebug"
              batterId={atBatViewState.batterId}
              batterName={atBatViewState.batterName}
              pitcherId={atBatViewState.pitcherId}
              pitcherName={atBatViewState.pitcherName}
              offenseTeamId={atBatViewState.offenseTeamId}
              boxScore={boxScore}
              matchupRecord={matchupRecord}
              isMatchupLoading={isMatchupLoading}
            />
          ) : undefined
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
            settlingAtBatIndex={settlingAtBatIndex}
            insightsByAtBat={insightsByAtBat}
            halfInsights={halfInsights}
            inningInsights={inningInsights}
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
                className="order-1 min-h-0 flex-1 overflow-hidden md:order-none md:min-h-[320px] max-md:min-h-0"
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
                        variant="panel"
                        batterId={atBatViewState.batterId}
                        batterName={atBatViewState.batterName}
                        pitcherId={atBatViewState.pitcherId}
                        pitcherName={atBatViewState.pitcherName}
                        offenseTeamId={atBatViewState.offenseTeamId}
                        boxScore={boxScore}
                        matchupRecord={matchupRecord}
                        isMatchupLoading={isMatchupLoading}
                        rispStats={rispStats}
                        isRispLoading={isRispLoading}
                        showRisp={runnersInScoringPosition}
                        className="md:hidden"
                      />
                      <AtBatMatchup
                        variant="context"
                        batterId={atBatViewState.batterId}
                        batterName={atBatViewState.batterName}
                        pitcherId={atBatViewState.pitcherId}
                        pitcherName={atBatViewState.pitcherName}
                        offenseTeamId={atBatViewState.offenseTeamId}
                        boxScore={boxScore}
                        matchupRecord={matchupRecord}
                        isMatchupLoading={isMatchupLoading}
                        rispStats={rispStats}
                        isRispLoading={isRispLoading}
                        showRisp={runnersInScoringPosition}
                        className="hidden md:block"
                      />
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
                      <div className="shrink-0 px-3 pb-3 pt-2.5 md:hidden">
                        <PitchSequence
                          key={`zone-mobile-${zoneBatterId ?? "none"}`}
                          pitches={atBatViewState?.atBatPitches ?? []}
                          zonePitches={zoneMode === "game" ? gameZonePitches : undefined}
                          zoneMode={zoneMode}
                          onZoneModeChange={setZoneMode}
                          totalGamePitchCount={totalGamePitchCount}
                          layout="zone"
                          size="large"
                          zoneFirst
                          animateEntrance
                          batterZones={batterHotZones ?? undefined}
                          zoneOverlay={outcomeToastNode}
                          className="h-[clamp(16rem,48dvh,28rem)] w-full"
                        />
                      </div>
                      <div className="hidden min-h-0 flex-1 md:flex">
                        <PitchSequence
                          key={`zone-desktop-${zoneBatterId ?? "none"}`}
                          pitches={atBatViewState?.atBatPitches ?? []}
                          zonePitches={zoneMode === "game" ? gameZonePitches : undefined}
                          zoneMode={zoneMode}
                          onZoneModeChange={setZoneMode}
                          totalGamePitchCount={totalGamePitchCount}
                          size="large"
                          layout="dashboard"
                          scrollToLatest
                          animateEntrance
                          batterZones={batterHotZones ?? undefined}
                          dashboardFooter={outcomeOddsFooter}
                          zoneOverlay={outcomeToastNode}
                          className="min-h-0 flex-1"
                        />
                      </div>
                    </>
                  )}
                    </>
                  )}
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
                    autoScrollToLatest={false}
                    autoScrollOnLivePitches={false}
                    settlingAtBatIndex={settlingAtBatIndex}
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
                    feedHeaderCollapsedDefault
                    insightsByAtBat={insightsByAtBat}
                    halfInsights={halfInsights}
                    inningInsights={inningInsights}
                    liveInsight={liveInsight}
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
      <NerdInsightToasts toasts={overlayToasts} onDismiss={dismissNerdInsight} />
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
        flushMobile ? "min-h-0 p-0 md:min-h-[280px] md:px-3 md:pb-3 md:pt-3" : "min-h-[280px] p-3",
        className,
      )}
    >
      <h3
        className={cn(
          "shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted",
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
        <div className="shrink-0 border-b border-border bg-surface px-2 py-1 sm:px-4 sm:py-2">
          <Link
            href="/"
            className="flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-foreground"
          >
            <span aria-hidden>←</span>
            <span className="truncate font-medium text-foreground">{game.label}</span>
          </Link>
        </div>
        <DashboardContent game={game} />
      </div>
    </div>
  );
}
