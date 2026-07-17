"use client";

import { useMemo, useState } from "react";

import { MatchChart } from "@/components/features/MatchChart";
import { Scorebug } from "@/components/features/Scorebug";
import { StateChart } from "@/components/features/StateChart";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  formatHalfInningLabel,
  type StateChartCursor,
  type StateChartMode,
} from "@/lib/mlb/stateChartMath";
import { cn } from "@/lib/utils";
import type { OutcomeProbabilities } from "@/types/database";
import type { LiveGameState, PlayByPlayEntry } from "@/types/mlb-live";

interface GameStateViewProps {
  gameState: LiveGameState | null;
  plays: PlayByPlayEntry[];
  isLoading?: boolean;
  className?: string;
  /** When set, renders the pitcher/batter/free-pass triangle beside the chart. */
  matchProbabilities?: OutcomeProbabilities | null;
  matchOddsKey?: string;
  matchAtBatKey?: string;
}

function cursorFromGameState(gameState: LiveGameState | null): StateChartCursor | null {
  if (!gameState) return null;
  return {
    inning: gameState.inning,
    halfInning: gameState.inningHalf,
    outs: gameState.outs,
    onFirst: gameState.onFirst,
    onSecond: gameState.onSecond,
    onThird: gameState.onThird,
    awayScore: gameState.awayRuns,
    homeScore: gameState.homeRuns,
  };
}

const MODES: { id: StateChartMode; label: string }[] = [
  { id: "re", label: "Run expectancy" },
  { id: "wp", label: "Win probability" },
];

export function GameStateView({
  gameState,
  plays,
  isLoading,
  className,
  matchProbabilities,
  matchOddsKey,
  matchAtBatKey,
}: GameStateViewProps) {
  const [mode, setMode] = useState<StateChartMode>("re");
  const cursor = useMemo(() => cursorFromGameState(gameState), [gameState]);
  const halfLabel = formatHalfInningLabel(cursor);
  const showMatch =
    matchProbabilities != null &&
    matchOddsKey != null &&
    matchOddsKey !== "none";

  if (isLoading && !gameState) {
    return (
      <div className={cn("flex min-h-0 flex-1 flex-col gap-3 p-4", className)}>
        <Skeleton className="h-14 w-full" />
        <Skeleton className="min-h-[280px] flex-1 w-full" />
      </div>
    );
  }

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col overflow-hidden", className)}>
      <Scorebug className="shrink-0" gameState={gameState} />

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface px-3 py-2.5 sm:px-4">
          <div className="min-w-0">
            <h2 className="text-sm font-medium text-foreground">State chart</h2>
            <p className="text-[11px] text-muted">
              {halfLabel}
              {cursor
                ? ` · ${cursor.awayScore}–${cursor.homeScore} · cursor on live base-out state`
                : " · waiting for game state"}
            </p>
          </div>

          <div className="flex shrink-0 gap-1 rounded border border-border bg-panel p-0.5">
            {MODES.map((item) => {
              const active = mode === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setMode(item.id)}
                  className={cn(
                    "px-2.5 py-1 text-[11px] font-medium transition-colors",
                    active
                      ? "bg-surface-elevated text-foreground"
                      : "text-muted hover:text-secondary",
                  )}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-3 py-4 sm:px-4 lg:flex-row lg:items-start">
          <div className="min-w-0 flex-1">
            <StateChart plays={plays} cursor={cursor} mode={mode} />

            <div className="mt-4 flex flex-wrap gap-4 text-[11px] text-muted">
              <div className="flex items-center gap-2">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full border-2 border-[var(--state-chart-cursor)]"
                  aria-hidden
                />
                Current situation
              </div>
              <div className="flex items-center gap-2">
                <span
                  className="inline-block h-0.5 w-5 bg-[var(--state-chart-wpa-pos)]"
                  aria-hidden
                />
                Positive WPA path
              </div>
              <div className="flex items-center gap-2">
                <span
                  className="inline-block h-0.5 w-5 bg-[var(--state-chart-wpa-neg)]"
                  aria-hidden
                />
                Negative WPA path
              </div>
              <div className="flex items-center gap-2">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full bg-[var(--state-chart-wpa-pos)]"
                  aria-hidden
                />
                Same-state pulse (solo HR, etc.)
              </div>
              <p className="w-full text-subtle">
                {mode === "re"
                  ? "Diamond color = expected runs remaining from that base-out state (RE24). Pulses mark scoring/WPA plays that leave bases and outs unchanged."
                  : "Diamond color = home win probability at the current score and inning. Pulses mark scoring/WPA plays that leave bases and outs unchanged."}
              </p>
            </div>
          </div>

          {showMatch ? (
            <div className="w-full shrink-0 border border-border bg-panel p-3 lg:w-[240px]">
              <MatchChart
                probabilities={matchProbabilities}
                oddsKey={matchOddsKey}
                atBatKey={matchAtBatKey}
                compact
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
