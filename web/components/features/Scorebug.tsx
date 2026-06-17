"use client";

import { BaseDiamond } from "@/components/features/BaseDiamond";
import { isGameOver, isBetweenHalfInnings } from "@/lib/mlb/gameOver";
import type { DueUpBatter } from "@/lib/mlb/lineup";
import { cn } from "@/lib/utils";
import type { LiveGameState } from "@/types/mlb-live";

interface ScorebugProps {
  gameState: LiveGameState | null;
  dueUpBatters?: DueUpBatter[];
  className?: string;
}

function inningLabel(inning: number, halfInning: string): string {
  const half = halfInning.toLowerCase();
  const prefix = half.startsWith("top") ? "TOP" : half.startsWith("bot") ? "BOT" : half.toUpperCase();
  return `${prefix} ${inning}`;
}

/** Fox-style broadcast scorebug with score, inning, count, outs, bases, matchup. */
export function Scorebug({ gameState, dueUpBatters, className }: ScorebugProps) {
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
    onDeckName,
    inHoleName,
    onFirst,
    onSecond,
    onThird,
  } = gameState;

  const isBreak = isBetweenHalfInnings(gameState);
  const gameEnded = isGameOver(gameState);
  const safeOuts = Math.min(3, Math.max(0, outs));

  return (
    <div
      className={cn(
        "flex h-14 shrink-0 items-stretch border-b border-border bg-scorebug text-scorebug-fg",
        className,
      )}
    >
      <div className="flex min-w-[72px] flex-col items-center justify-center border-r border-border px-3">
        <span className="text-[10px] font-semibold tracking-wide text-scorebug-muted">
          {awayAbbrev}
        </span>
        <span className="font-mono text-2xl font-bold leading-none tabular-nums">{awayRuns}</span>
      </div>

      <div className="flex min-w-[72px] flex-col items-center justify-center border-r border-border px-3">
        <span className="text-[10px] font-semibold tracking-wide text-scorebug-muted">
          {homeAbbrev}
        </span>
        <span className="font-mono text-2xl font-bold leading-none tabular-nums">{homeRuns}</span>
      </div>

      <div className="flex min-w-[64px] items-center justify-center border-r border-border px-3">
        <span className="font-mono text-sm font-semibold tracking-wide">
          {gameEnded ? "FINAL" : inningLabel(inning, inningHalf)}
        </span>
      </div>

      <div className="flex items-center gap-2 border-r border-border px-3">
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-[9px] font-semibold text-green-600 dark:text-green-500">B</span>
          <span className="flex h-7 w-7 items-center justify-center rounded bg-green-600/15 font-mono text-lg font-bold tabular-nums text-green-700 dark:bg-green-600/20 dark:text-green-400">
            {isBreak ? "–" : balls}
          </span>
        </div>
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-[9px] font-semibold text-red-600 dark:text-red-500">S</span>
          <span className="flex h-7 w-7 items-center justify-center rounded bg-red-600/15 font-mono text-lg font-bold tabular-nums text-red-700 dark:bg-red-600/20 dark:text-red-400">
            {isBreak ? "–" : strikes}
          </span>
        </div>
      </div>

      <div
        className="flex flex-col items-center justify-center border-r border-border px-3"
        aria-label={`${safeOuts} outs`}
      >
        <span className="mb-1 text-[9px] font-semibold text-scorebug-muted">OUT</span>
        <div className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className={cn(
                "h-2.5 w-2.5 rounded-full",
                i < safeOuts ? "bg-scorebug-fg" : "bg-faint",
              )}
            />
          ))}
        </div>
      </div>

      <div className="flex items-center border-r border-border px-3">
        <BaseDiamond
          onFirst={onFirst}
          onSecond={onSecond}
          onThird={onThird}
          size="compact"
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-center px-4">
        {gameEnded ? (
          <>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-scorebug-muted">
              Final
            </span>
            <span className="truncate text-[15px] font-medium">
              {awayAbbrev} {awayRuns} – {homeRuns} {homeAbbrev}
            </span>
          </>
        ) : isBreak ? (
          <>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-scorebug-muted">
              Due up
            </span>
            <span className="truncate text-[15px] font-medium">
              {dueUpBatters?.[0]
                ? `${dueUpBatters[0].order}. ${dueUpBatters[0].name}`
                : batterName}
            </span>
            <span className="truncate text-[12px] text-scorebug-muted">
              {dueUpBatters?.[1] ? (
                <>
                  {dueUpBatters[1].order}. {dueUpBatters[1].name}
                </>
              ) : onDeckName && onDeckName !== "—" ? (
                onDeckName
              ) : null}
              {dueUpBatters?.[2] ? (
                <>
                  {dueUpBatters[1] || (onDeckName && onDeckName !== "—") ? " · " : ""}
                  {dueUpBatters[2].order}. {dueUpBatters[2].name}
                </>
              ) : inHoleName && inHoleName !== "—" ? (
                <>
                  {(dueUpBatters?.[1] || (onDeckName && onDeckName !== "—")) ? " · " : ""}
                  {inHoleName}
                </>
              ) : null}
            </span>
          </>
        ) : (
          <>
            <span className="truncate text-[15px] font-medium">{batterName}</span>
            <span className="truncate text-[12px] text-scorebug-muted">
              vs <span className="text-secondary">{pitcherName}</span>
            </span>
          </>
        )}
      </div>
    </div>
  );
}
