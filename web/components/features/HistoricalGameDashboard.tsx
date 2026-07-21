"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { AppNav } from "@/components/features/AppNav";
import { BatterRispRecord } from "@/components/features/BatterRispRecord";
import { BatterVsPitcherRecord } from "@/components/features/BatterVsPitcherRecord";
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
import { PitchSequence, type StrikeZoneMode } from "@/components/features/PitchSequence";
import { PlayByPlay } from "@/components/features/PlayByPlay";
import { ProbabilityChart } from "@/components/features/ProbabilityChart";
import { StealIndicator } from "@/components/features/StealIndicator";
import { Scorebug } from "@/components/features/Scorebug";
import { Skeleton } from "@/components/ui/Skeleton";
import { useGameBoxScore } from "@/hooks/useGameBoxScore";
import { useGamePredictions } from "@/hooks/useGamePredictions";
import { useLiveGameState } from "@/hooks/useLiveGameState";
import { useLivePredictions } from "@/hooks/useLivePredictions";
import { useGameState } from "@/hooks/useGameState";
import { useOutcomeOdds } from "@/hooks/useOutcomeOdds";
import { useArchiveFinishedGame } from "@/hooks/useArchiveFinishedGame";
import { useBatterHotZones } from "@/hooks/useBatterHotZones";
import { useBatterRisp } from "@/hooks/useBatterRisp";
import { useBatterVsPitcher } from "@/hooks/useBatterVsPitcher";
import { useBreakLinger } from "@/hooks/useBreakLinger";
import { useLiveGameOverlays } from "@/hooks/useLiveGameOverlays";
import { usePlayIdMap } from "@/hooks/usePlayIdMap";
import { formatGameDate, formatMatchup, formatScore, isLiveStatus } from "@/lib/games/format";
import { buildSeasonHistoryHref } from "@/lib/mlb/schedule";
import { gameStateForAtBat, findPlayByAtBatIndex } from "@/lib/games/replay";
import { allPitchesThroughPoint } from "@/lib/mlb/allGamePitches";
import { isGameOver } from "@/lib/mlb/gameOver";
import { isHalfInningBreak } from "@/lib/mlb/lineup";
import { isPlayByPlayAtBat } from "@/lib/mlb/liveFeed";
import { cn } from "@/lib/utils";
import { normalizeOutcomeProbabilities } from "@/types/database";
import type { Game } from "@/types/database";
import { LIVE_GAME_STATUSES } from "@/types/mlb";
import type { PlayByPlayEntry } from "@/types/mlb-live";

interface HistoricalGameDashboardProps {
  game: Game;
  historyBack?: {
    date?: string;
    view?: "date" | "team";
    teamId?: number | null;
  };
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
  flushMobile?: boolean;
}) {
  return (
    <section
      className={cn(
        "flex min-w-0 flex-col overflow-hidden bg-panel md:min-h-[220px] lg:min-h-0",
        flushMobile
          ? "min-h-0 p-0 max-md:min-h-0 md:min-h-[280px] md:px-3 md:pb-3 md:pt-3"
          : "min-h-[280px] p-3",
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

export function HistoricalGameDashboard({ game, historyBack }: HistoricalGameDashboardProps) {
  const searchParams = useSearchParams();
  const urlAtBatIndex = useMemo(() => {
    const raw = searchParams.get("atBat");
    if (!raw) return null;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }, [searchParams]);

  const isLive = isLiveStatus(game.status);
  const [activeTab, setActiveTab] = useState<GameDetailTab>("plays");
  const mobileScrollRef = useRef<HTMLElement>(null);

  const {
    gameState: liveGameState,
    isLoading: liveLoading,
    error: liveError,
  } = useLiveGameState(game.game_pk, {
    enabled: isLive,
    pollBurstKey: activeTab,
  });
  const {
    gameState: archivedGameState,
    isLoading: archivedLoading,
    error: archivedError,
    source,
    feedSyncedAt,
  } = useGameState(game.game_pk, { enabled: !isLive });
  const gameState = isLive ? liveGameState : archivedGameState;
  const isLoading = isLive ? liveLoading : archivedLoading;
  const plays = usePlayIdMap(
    game.game_pk,
    gameState?.plays ?? [],
    !isLive && Boolean(gameState),
  );
  const error = isLive ? liveError : archivedError;

  const {
    boxScore,
    isLoading: isBoxScoreLoading,
    error: boxScoreError,
  } = useGameBoxScore(game.game_pk, { poll: isLive, pollBurstKey: activeTab });

  const { atBatViewState, showBreakUI, isLingering } = useBreakLinger(isLive ? gameState : null);
  const { dueUp, showDueUp, dismissDueUp, showFinal, dismissFinal, gameOver } = useLiveGameOverlays(
    isLive ? gameState : null,
    isLive ? boxScore : null,
    showBreakUI,
  );
  useArchiveFinishedGame(game.game_pk, isLive && gameOver);

  const [selectedAtBatIndex, setSelectedAtBatIndex] = useState<number | null>(null);
  const [zoneMode, setZoneMode] = useState<StrikeZoneMode>("atBat");

  useEffect(() => {
    setZoneMode("atBat");
  }, [game.game_pk]);

  // Call It stays in the tree for now but is hidden from the tab bar.
  useEffect(() => {
    if (activeTab === "callIt") setActiveTab("plays");
  }, [activeTab]);

  const atBatPlays = useMemo(
    () => plays.filter(isPlayByPlayAtBat),
    [plays],
  );

  useEffect(() => {
    if (urlAtBatIndex != null) {
      setActiveTab("plays");
    }
  }, [urlAtBatIndex]);

  useEffect(() => {
    if (isLive || !atBatPlays.length) return;
    setSelectedAtBatIndex((current) => {
      if (
        urlAtBatIndex != null &&
        atBatPlays.some((play) => play.atBatIndex === urlAtBatIndex)
      ) {
        return urlAtBatIndex;
      }
      if (current != null && atBatPlays.some((play) => play.atBatIndex === current)) {
        return current;
      }
      return atBatPlays[atBatPlays.length - 1]?.atBatIndex ?? null;
    });
  }, [atBatPlays, isLive, urlAtBatIndex]);

  const selectedPlay = useMemo<PlayByPlayEntry | null>(() => {
    if (!gameState || selectedAtBatIndex == null) return null;
    return findPlayByAtBatIndex(plays, selectedAtBatIndex) ?? null;
  }, [gameState, plays, selectedAtBatIndex]);

  const replayState = useMemo(() => {
    if (!gameState || !selectedPlay || isLive) return null;
    return gameStateForAtBat(gameState, selectedPlay, {
      awayTeamId: game.away_team_id,
      homeTeamId: game.home_team_id,
    });
  }, [game.away_team_id, game.home_team_id, gameState, isLive, selectedPlay]);

  const displayState = isLive ? atBatViewState : replayState;

  const lastPitch = selectedPlay?.detail.pitches.at(-1);
  const { predictionForAtBat, predictions: archivedPredictions, isLoading: archivedPredictionsLoading } =
    useGamePredictions(
      game.game_pk,
      !isLive && selectedPlay
        ? {
            batterName: selectedPlay.batterName,
            inning: selectedPlay.inning,
            balls: lastPitch?.balls ?? 0,
            strikes: lastPitch?.strikes ?? 0,
          }
        : null,
      { enabled: !isLive },
    );

  const {
    predictions: livePredictions,
    isLoading: livePredictionsLoading,
    error: livePredictionsError,
    connectionStatus,
  } = useLivePredictions(isLive ? game.game_pk : 0, {
    batterName: atBatViewState?.batterName,
    inning: atBatViewState?.inning,
    balls: atBatViewState?.balls,
    strikes: atBatViewState?.strikes,
    pitchCount: atBatViewState?.atBatPitches.length,
  });

  const {
    probabilities: liveOutcomeProbabilities,
    stealProbabilities,
    oddsKey: liveOddsKey,
  } = useOutcomeOdds(isLive ? atBatViewState : null, livePredictions);

  const outcomeProbabilities = isLive
    ? liveOutcomeProbabilities
    : normalizeOutcomeProbabilities(predictionForAtBat?.outcome_probabilities);

  const matchOddsKey = isLive
    ? liveOddsKey
    : predictionForAtBat
      ? `archive-${predictionForAtBat.id}`
      : "archive-none";

  const matchAtBatKey = displayState
    ? `${displayState.batterId ?? 0}-${displayState.inning}-${displayState.inningHalf}`
    : "none";

  const onFirst = isLive
    ? (atBatViewState?.onFirst ?? gameState?.onFirst ?? false)
    : (displayState?.onFirst ?? false);
  const onSecond = isLive
    ? (atBatViewState?.onSecond ?? gameState?.onSecond ?? false)
    : (displayState?.onSecond ?? false);
  const onThird = isLive
    ? (atBatViewState?.onThird ?? gameState?.onThird ?? false)
    : (displayState?.onThird ?? false);
  const runnersInScoringPosition = onSecond || onThird;

  const { record: matchupRecord, isLoading: isMatchupLoading } = useBatterVsPitcher(
    displayState?.batterId,
    displayState?.pitcherId,
  );
  const { stats: rispStats, isLoading: isRispLoading } = useBatterRisp(
    displayState?.batterId,
    runnersInScoringPosition,
  );
  const zoneBatterId = useMemo(() => {
    if (displayState?.batterId != null && displayState.batterId > 0) return displayState.batterId;
    if (selectedPlay?.batterId != null && selectedPlay.batterId > 0) return selectedPlay.batterId;
    if (selectedPlay?.detail.batterId != null && selectedPlay.detail.batterId > 0) {
      return selectedPlay.detail.batterId;
    }
    return null;
  }, [displayState?.batterId, selectedPlay?.batterId, selectedPlay?.detail.batterId]);
  const { zones: batterHotZones } = useBatterHotZones(zoneBatterId, game.season);

  const gameZonePitches = useMemo(() => {
    if (!gameState) return [];
    if (isLive) {
      return allPitchesThroughPoint(gameState, {
        currentAtBatPitches: atBatViewState?.atBatPitches,
      });
    }
    if (selectedAtBatIndex == null) return [];
    return allPitchesThroughPoint(gameState, {
      throughAtBatIndex: selectedAtBatIndex,
    });
  }, [gameState, isLive, atBatViewState?.atBatPitches, selectedAtBatIndex]);

  const totalGamePitchCount = useMemo(
    () => gameZonePitches.filter((pitch) => pitch.isPitch).length,
    [gameZonePitches],
  );

  const score = formatScore(game);
  const seasonHistoryHref = buildSeasonHistoryHref({
    date: historyBack?.date ?? game.game_date,
    view: historyBack?.view ?? "date",
    teamId: historyBack?.teamId,
  });
  const showBatterHighlights =
    isLive &&
    gameState != null &&
    gameState.gameStatus === "Live" &&
    !isHalfInningBreak(gameState.inningState);

  const atBatInProgress =
    isLive &&
    gameState?.gameStatus === "Live" &&
    !showBreakUI &&
    !isLingering &&
    (atBatViewState?.atBatPitches.length ?? 0) > 0;

  const lastCompletedAtBatIndex = useMemo(() => {
    const atBats = plays.filter(isPlayByPlayAtBat);
    return atBats.at(-1)?.atBatIndex ?? null;
  }, [plays]);

  const scorebugState =
    isLive && gameState ? { ...gameState, onFirst, onSecond, onThird } : displayState;

  const panelTitle = isLive
    ? gameOver
      ? "Final"
      : showBreakUI
        ? "Due up"
        : "Current at-bat"
    : "Selected at-bat";

  const renderOutcomeOdds = (compact = false) => {
    if (isLive) {
      if (atBatViewState && gameState?.gameStatus === "Live" && !showBreakUI) {
        return (
          <div className="space-y-3">
            <ProbabilityChart
              key={`${atBatViewState.batterId ?? 0}-${atBatViewState.inning}`}
              probabilities={outcomeProbabilities}
              compact={compact}
              contained={false}
            />
            <StealIndicator
              stealProbabilities={stealProbabilities}
              onFirst={onFirst}
              onSecond={onSecond}
            />
          </div>
        );
      }

      return (
        <p className={cn("text-center text-sm text-muted", compact ? "py-2" : "py-4")}>
          {LIVE_GAME_STATUSES.has(game.status)
            ? showBreakUI
              ? "Between innings"
              : "Waiting for at-bat…"
            : "Available when live."}
        </p>
      );
    }

    if (predictionForAtBat) {
      return (
        <ProbabilityChart
          probabilities={outcomeProbabilities}
          compact={compact}
          contained={false}
        />
      );
    }

    if (archivedPredictionsLoading) {
      return (
        <p className={cn("text-center text-sm text-muted", compact ? "py-2" : "py-4")}>
          Loading predictions…
        </p>
      );
    }

    if (archivedPredictions.length > 0) {
      return (
        <p className={cn("text-center text-sm text-muted", compact ? "py-2" : "py-4")}>
          No model snapshot matched this exact at-bat count.
        </p>
      );
    }

    return (
      <p className={cn("text-center text-sm text-muted", compact ? "py-2" : "py-4")}>
        No ingestor predictions were stored for this game.
      </p>
    );
  };

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-x-hidden bg-background text-foreground">
      <AppNav />

      <div className="shrink-0 border-b border-border bg-surface px-3 py-2 sm:px-4 sm:py-3">
        <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <div className="min-w-0">
            <Link
              href={seasonHistoryHref}
              className="text-xs text-muted transition-colors hover:text-secondary"
            >
              ← Season history
            </Link>
            <h1 className="mt-0.5 text-base font-medium text-foreground sm:mt-1 sm:text-lg">
              {formatMatchup(game)}
            </h1>
            <p className="mt-0.5 truncate text-[11px] text-muted sm:text-sm">
              {formatGameDate(game.game_date)}
              {game.venue_name ? ` · ${game.venue_name}` : ""}
              {score ? ` · Final ${score}` : ""}
            </p>
          </div>
          <div className="hidden shrink-0 text-xs text-subtle sm:block sm:text-right">
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

      {isLoading && !gameState && activeTab === "plays" ? (
        <div className="flex flex-1 flex-col p-4">
          <Skeleton className="mb-4 h-14 w-full" />
          <DashboardSkeleton />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <GameDetailTabs
            activeTab={activeTab}
            onTabChange={setActiveTab}
            showCallItTab={false}
            compact
          />

          <div
            className={cn(
              "flex min-h-0 flex-1 flex-col overflow-hidden",
              activeTab !== "callIt" && "hidden",
            )}
            aria-hidden={activeTab !== "callIt"}
          >
            {isLive && gameState ? (
              <CallItGame
                gameState={atBatViewState ?? gameState}
                boxScore={boxScore}
                paused={showBreakUI || isLingering || isHalfInningBreak(gameState.inningState)}
                gameOver={gameOver || isGameOver(gameState)}
                className="min-h-0 flex-1"
              />
            ) : null}
          </div>

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
              error={boxScoreError}
              atBatPlayerId={showBatterHighlights ? gameState?.batterId : null}
              onDeckPlayerId={showBatterHighlights ? gameState?.onDeckId : null}
              offenseTeamId={showBatterHighlights ? gameState?.offenseTeamId : null}
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
              gameState={displayState}
              boxScore={boxScore}
              isLoading={isLoading && !gameState}
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
              plays={plays}
              venueId={gameState?.venueId ?? game.venue_id}
              venueName={gameState?.venueName ?? game.venue_name}
              awayAbbrev={gameState?.awayAbbrev ?? game.away_team_abbrev}
              homeAbbrev={gameState?.homeAbbrev ?? game.home_team_abbrev}
              gamePk={game.game_pk}
              isLoading={isLoading && !gameState}
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
              gamePk={game.game_pk}
              plays={plays}
              isLive={isLive}
              isLoading={isLoading && !gameState}
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
              gameState={displayState}
              plays={plays}
              isLoading={isLoading && !gameState}
              className="min-h-0 flex-1"
              matchProbabilities={
                (isLive
                  ? atBatViewState && gameState?.gameStatus === "Live" && !showBreakUI
                  : predictionForAtBat != null)
                  ? outcomeProbabilities
                  : null
              }
              matchOddsKey={matchOddsKey}
              matchAtBatKey={matchAtBatKey}
            />
          </div>

          <div
            className={cn(
              "flex min-h-0 flex-1 flex-col overflow-hidden",
              activeTab !== "plays" && "hidden",
            )}
            aria-hidden={activeTab !== "plays"}
          >
          {!gameState ? (
            <div className="flex flex-1 items-center justify-center px-6 text-center">
              <div>
                <p className="text-sm text-secondary">No play-by-play data for this game.</p>
                <p className="mt-2 text-xs text-subtle">
                  Run <code className="text-secondary">npm run sync-game-feeds</code> to backfill feeds, or switch to the Box tab.
                </p>
              </div>
            </div>
          ) : (
            <>
          {isLive && (
            <ConnectionIndicator status={connectionStatus} error={livePredictionsError} />
          )}
          <Scorebug
            className="shrink-0"
            gameState={scorebugState}
            dueUpBatters={
              isLive && gameState && !gameOver && isHalfInningBreak(gameState.inningState)
                ? dueUp?.batters
                : undefined
            }
          />

          <div className="flex min-h-0 flex-1 overflow-hidden">
            <div className="hidden w-[300px] shrink-0 border-r border-border md:flex lg:w-[320px]">
              <PlayByPlay
                plays={plays}
                awayAbbrev={gameState.awayAbbrev}
                homeAbbrev={gameState.homeAbbrev}
                venueId={gameState.venueId}
                gamePk={game.game_pk}
                selectedAtBatIndex={isLive ? undefined : selectedAtBatIndex}
                onSelectAtBat={
                  isLive ? undefined : (play) => setSelectedAtBatIndex(play.atBatIndex)
                }
                autoScrollToLatest={isLive}
                className="w-full"
              />
            </div>

            <main
              ref={mobileScrollRef}
              className="flex min-h-0 min-w-0 flex-1 flex-col max-md:overflow-y-auto max-md:overscroll-y-contain md:overflow-hidden"
            >
              <div className="flex min-h-0 flex-1 flex-col gap-px overflow-hidden bg-border max-md:flex-none max-md:overflow-visible">
                <Panel
                  title={panelTitle}
                  flushMobile
                  className="order-1 min-h-0 flex-1 overflow-hidden max-md:min-h-0 md:order-none md:min-h-[380px]"
                >
                  {displayState ? (
                    <>
                      <div className="hidden md:block">
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
                      </div>
                      <div className="shrink-0 px-3 pb-3 pt-2.5 md:hidden">
                        <PitchSequence
                          key={`zone-mobile-${zoneBatterId ?? selectedAtBatIndex ?? "none"}`}
                          pitches={displayState.atBatPitches}
                          zonePitches={zoneMode === "game" ? gameZonePitches : undefined}
                          zoneMode={zoneMode}
                          onZoneModeChange={setZoneMode}
                          totalGamePitchCount={totalGamePitchCount}
                          layout="zone"
                          size="large"
                          zoneFirst
                          batterZones={batterHotZones ?? undefined}
                          className="h-[clamp(16rem,42dvh,26rem)] w-full"
                        />
                      </div>
                      <div className="hidden min-h-0 flex-1 md:flex">
                        <PitchSequence
                          key={`zone-desktop-${zoneBatterId ?? selectedAtBatIndex ?? "none"}`}
                          pitches={displayState.atBatPitches}
                          zonePitches={zoneMode === "game" ? gameZonePitches : undefined}
                          zoneMode={zoneMode}
                          onZoneModeChange={setZoneMode}
                          totalGamePitchCount={totalGamePitchCount}
                          size="large"
                          layout="dashboard"
                          scrollToLatest={isLive}
                          batterZones={batterHotZones ?? undefined}
                          dashboardFooter={renderOutcomeOdds()}
                          className="min-h-0 flex-1"
                        />
                      </div>
                    </>
                  ) : (
                    <p className="px-3 py-6 text-center text-sm text-muted">
                      Select an at-bat from play-by-play.
                    </p>
                  )}
                </Panel>

                <div className="order-2 flex min-h-0 flex-1 flex-col max-md:flex-none md:hidden">
                  <PlayByPlay
                    plays={plays}
                    awayAbbrev={gameState.awayAbbrev}
                    homeAbbrev={gameState.homeAbbrev}
                    venueId={gameState.venueId}
                    gamePk={game.game_pk}
                    selectedAtBatIndex={isLive ? undefined : selectedAtBatIndex}
                    onSelectAtBat={
                      isLive ? undefined : (play) => setSelectedAtBatIndex(play.atBatIndex)
                    }
                    autoScrollToLatest={isLive}
                    autoScrollOnLivePitches={false}
                    variant="feed"
                    animateEntrance={isLive}
                    embeddedScroll
                    parentScrollRef={mobileScrollRef}
                    className="flex-none"
                    livePitches={
                      isLive && (atBatInProgress || isLingering)
                        ? atBatViewState?.atBatPitches
                        : undefined
                    }
                    animateLivePitches={isLive && (atBatInProgress || isLingering)}
                    embedPitchesAtBatIndex={
                      isLive
                        ? atBatInProgress || isLingering
                          ? null
                          : lastCompletedAtBatIndex
                        : selectedAtBatIndex
                    }
                    feedHeader={renderOutcomeOdds(true)}
                    feedHeaderCollapsedDefault
                  />
                </div>
              </div>
            </main>
          </div>
            </>
          )}
          </div>
        </div>
      )}

      {isLive && (
        <>
          <DueUpDialog context={dueUp} open={showDueUp} onClose={dismissDueUp} />
          <GameFinalDialog
            gameState={gameState}
            boxScore={boxScore}
            open={showFinal}
            onClose={dismissFinal}
          />
        </>
      )}
    </div>
  );
}
