"use client";

import { BaseDiamond } from "@/components/features/BaseDiamond";
import { cn } from "@/lib/utils";
import type { LiveGameState } from "@/types/mlb-live";

interface ScorebugProps {
  gameState: LiveGameState | null;
  className?: string;
}

function inningLabel(inning: number, halfInning: string): string {
  const half = halfInning.toLowerCase();
  const prefix = half.startsWith("top") ? "TOP" : half.startsWith("bot") ? "BOT" : half.toUpperCase();
  return `${prefix} ${inning}`;
}

/** Fox-style broadcast scorebug with score, inning, count, outs, bases, matchup. */
export function Scorebug({ gameState, className }: ScorebugProps) {
  if (!gameState) {
    return (
      <div className={cn("h-14 border-b border-border bg-scorebug", className)}>
        <div className="h-full animate-pulse bg-overlay" />
      </div>
    );
  }

  const {
    awayAbbrev,
    homeAbbrev,
    awayRuns,
    homeRuns,
    inning,
    inningHalf,
    balls,
    strikes,
    outs,
    batterName,
    pitcherName,
    onFirst,
    onSecond,
    onThird,
  } = gameState;

  const safeOuts = Math.min(3, Math.max(0, outs));

  return (
    <div
      className={cn(
        "flex h-14 shrink-0 items-stretch border-b border-border bg-scorebug text-white",
        className,
      )}
    >
      {/* Away */}
      <div className="flex min-w-[72px] flex-col items-center justify-center border-r border-border/80 px-3">
        <span className="text-[10px] font-semibold tracking-wide text-neutral-400">
          {awayAbbrev}
        </span>
        <span className="font-mono text-2xl font-bold leading-none tabular-nums">{awayRuns}</span>
      </div>

      {/* Home */}
      <div className="flex min-w-[72px] flex-col items-center justify-center border-r border-border/80 px-3">
        <span className="text-[10px] font-semibold tracking-wide text-neutral-400">
          {homeAbbrev}
        </span>
        <span className="font-mono text-2xl font-bold leading-none tabular-nums">{homeRuns}</span>
      </div>

      {/* Inning */}
      <div className="flex min-w-[64px] items-center justify-center border-r border-border/80 px-3">
        <span className="font-mono text-sm font-semibold tracking-wide text-neutral-200">
          {inningLabel(inning, inningHalf)}
        </span>
      </div>

      {/* Count */}
      <div className="flex items-center gap-2 border-r border-border/80 px-3">
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-[9px] font-semibold text-green-500">B</span>
          <span className="flex h-7 w-7 items-center justify-center rounded bg-green-600/20 font-mono text-lg font-bold tabular-nums text-green-400">
            {balls}
          </span>
        </div>
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-[9px] font-semibold text-red-500">S</span>
          <span className="flex h-7 w-7 items-center justify-center rounded bg-red-600/20 font-mono text-lg font-bold tabular-nums text-red-400">
            {strikes}
          </span>
        </div>
      </div>

      {/* Outs */}
      <div
        className="flex flex-col items-center justify-center border-r border-border/80 px-3"
        aria-label={`${safeOuts} outs`}
      >
        <span className="mb-1 text-[9px] font-semibold text-neutral-400">OUT</span>
        <div className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className={cn(
                "h-2.5 w-2.5 rounded-full",
                i < safeOuts ? "bg-neutral-200" : "bg-neutral-700",
              )}
            />
          ))}
        </div>
      </div>

      {/* Bases */}
      <div className="flex items-center border-r border-border/80 px-3">
        <BaseDiamond
          onFirst={onFirst}
          onSecond={onSecond}
          onThird={onThird}
          size="compact"
        />
      </div>

      {/* Matchup */}
      <div className="flex min-w-0 flex-1 flex-col justify-center px-4">
        <span className="truncate text-[15px] font-medium text-white">{batterName}</span>
        <span className="truncate text-[12px] text-neutral-400">
          vs <span className="text-neutral-300">{pitcherName}</span>
        </span>
      </div>
    </div>
  );
}
