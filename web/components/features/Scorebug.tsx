"use client";

import type { ReactNode } from "react";

import { BaseDiamond } from "@/components/features/BaseDiamond";
import { TeamLogo } from "@/components/ui/TeamLogo";
import { isGameOver, isBetweenHalfInnings } from "@/lib/mlb/gameOver";
import type { DueUpBatter } from "@/lib/mlb/lineup";
import { cn } from "@/lib/utils";
import type { LiveGameState } from "@/types/mlb-live";

interface ScorebugProps {
  gameState: LiveGameState | null;
  dueUpBatters?: DueUpBatter[];
  /** Full-width bar for dashboard headers; compact chip for scene overlays. */
  variant?: "bar" | "overlay";
  /**
   * Desktop/laptop replacement for the plain name matchup line (e.g. headshots).
   * Used when the game is live and not between half-innings; otherwise MatchupLine is shown.
   */
  matchupSlot?: ReactNode;
  className?: string;
}

function inningLabel(inning: number, halfInning: string): string {
  const half = halfInning.toLowerCase();
  const prefix = half.startsWith("top") ? "TOP" : half.startsWith("bot") ? "BOT" : half.toUpperCase();
  return `${prefix} ${inning}`;
}

function StatCell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-center border-r border-border px-1.5 sm:px-2 md:shrink-0 md:px-2.5",
        className,
      )}
    >
      {children}
    </div>
  );
}

function OverlayStatCell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center border-r border-white/15",
        className,
      )}
    >
      {children}
    </div>
  );
}

function MatchupLine({
  gameEnded,
  isBreak,
  awayAbbrev,
  awayRuns,
  homeRuns,
  homeAbbrev,
  dueUpBatters,
  batterName,
  onDeckName,
  inHoleName,
  pitcherName,
}: {
  gameEnded: boolean;
  isBreak: boolean;
  awayAbbrev: string;
  awayRuns: number;
  homeRuns: number;
  homeAbbrev: string;
  dueUpBatters?: DueUpBatter[];
  batterName: string;
  onDeckName: string;
  inHoleName: string;
  pitcherName: string;
}) {
  if (gameEnded) {
    return (
      <span className="truncate text-sm font-medium">
        Final · {awayAbbrev} {awayRuns}–{homeRuns} {homeAbbrev}
      </span>
    );
  }

  if (isBreak) {
    const lead = dueUpBatters?.[0]
      ? `${dueUpBatters[0].order}. ${dueUpBatters[0].name}`
      : batterName;
    const follow =
      dueUpBatters?.[1]?.name ??
      (onDeckName && onDeckName !== "—" ? onDeckName : null);
    return (
      <span className="truncate text-sm">
        <span className="font-medium text-scorebug-muted">Due up </span>
        <span className="font-medium">{lead}</span>
        {follow ? <span className="text-scorebug-muted"> · {follow}</span> : null}
      </span>
    );
  }

  return (
    <span className="truncate text-sm">
      <span className="font-medium">{batterName}</span>
      <span className="text-scorebug-muted"> vs </span>
      <span className="text-secondary">{pitcherName}</span>
    </span>
  );
}

function AbsChallengeDots({
  remaining,
  overlay = false,
}: {
  remaining: number;
  overlay?: boolean;
}) {
  const filled = Math.min(2, Math.max(0, remaining));

  return (
    <div className="flex gap-0.5 lg:gap-1" aria-hidden>
      {[0, 1].map((i) => (
        <span
          key={i}
          className={cn(
            "h-2 w-2 rounded-full border lg:h-2.5 lg:w-2.5",
            i < filled
              ? overlay
                ? "border-amber-300 bg-amber-400"
                : "border-amber-500 bg-amber-400"
              : overlay
                ? "border-white/30 bg-white/15"
                : "border-border-strong bg-faint/40",
          )}
        />
      ))}
    </div>
  );
}

function AbsChallengesField({
  awayRemaining,
  homeRemaining,
  awayAbbrev,
  homeAbbrev,
  overlay = false,
  compact = false,
}: {
  awayRemaining: number;
  homeRemaining: number;
  awayAbbrev: string;
  homeAbbrev: string;
  overlay?: boolean;
  compact?: boolean;
}) {
  if (overlay && compact) {
    return (
      <div
        className="flex items-center gap-1"
        aria-label={`${awayAbbrev} ${awayRemaining} ABS challenges remaining, ${homeAbbrev} ${homeRemaining} ABS challenges remaining`}
      >
        <span className="text-[6px] font-semibold uppercase leading-none text-white/70">ABS</span>
        <AbsChallengeDots remaining={awayRemaining} overlay />
        <span className="text-[6px] leading-none text-white/35">|</span>
        <AbsChallengeDots remaining={homeRemaining} overlay />
      </div>
    );
  }

  return (
    <div
      className="flex flex-col items-center"
      aria-label={`${awayAbbrev} ${awayRemaining} ABS challenges remaining, ${homeAbbrev} ${homeRemaining} ABS challenges remaining`}
    >
      <span
        className={cn(
          "mb-1 text-[8px] font-semibold uppercase tracking-wide lg:mb-1.5 lg:text-[9px]",
          overlay ? "text-white/80" : "text-scorebug-muted",
        )}
      >
        ABS
      </span>
      <div className="flex items-start gap-2 lg:gap-2.5">
        <div className="flex flex-col items-center gap-0.5">
          <AbsChallengeDots remaining={awayRemaining} overlay={overlay} />
          <span
            className={cn(
              "font-mono text-[7px] font-semibold tabular-nums lg:text-[8px]",
              overlay ? "text-white/70" : "text-scorebug-muted",
            )}
          >
            {awayAbbrev}
          </span>
        </div>
        <div className="flex flex-col items-center gap-0.5">
          <AbsChallengeDots remaining={homeRemaining} overlay={overlay} />
          <span
            className={cn(
              "font-mono text-[7px] font-semibold tabular-nums lg:text-[8px]",
              overlay ? "text-white/70" : "text-scorebug-muted",
            )}
          >
            {homeAbbrev}
          </span>
        </div>
      </div>
    </div>
  );
}

/** Fox-style broadcast scorebug with score, inning, count, outs, bases, matchup. */
export function Scorebug({
  gameState,
  dueUpBatters,
  variant = "bar",
  matchupSlot,
  className,
}: ScorebugProps) {
  if (!gameState) {
    return (
      <div
        className={cn(
          variant === "overlay"
            ? "h-9 w-48 animate-pulse rounded-md bg-black/50"
            : "h-11 border-b border-border bg-scorebug lg:h-14",
          className,
        )}
      >
        {variant === "bar" ? <div className="h-full animate-pulse bg-overlay" /> : null}
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
    awayAbsChallengesRemaining,
    homeAbsChallengesRemaining,
  } = gameState;

  const isBreak = isBetweenHalfInnings(gameState);
  const gameEnded = isGameOver(gameState);
  const safeOuts = Math.min(3, Math.max(0, outs));
  const useMatchupSlot = Boolean(matchupSlot) && !gameEnded && !isBreak;

  if (variant === "overlay") {
    return (
      <div
        className={cn(
          "pointer-events-none absolute left-2 top-2 z-40 flex h-9 w-max max-w-[calc(100%-1rem)] items-center overflow-hidden rounded-md border border-white/20 bg-black/75 text-white shadow-lg backdrop-blur-md",
          className,
        )}
      >
        <OverlayStatCell className="min-w-[36px] flex-row gap-1 px-1.5 py-0">
          <TeamLogo abbrev={awayAbbrev} size={12} surface="dark" />
          <span className="font-mono text-sm font-bold leading-none tabular-nums">{awayRuns}</span>
        </OverlayStatCell>

        <OverlayStatCell className="min-w-[36px] flex-row gap-1 px-1.5 py-0">
          <TeamLogo abbrev={homeAbbrev} size={12} surface="dark" />
          <span className="font-mono text-sm font-bold leading-none tabular-nums">{homeRuns}</span>
        </OverlayStatCell>

        <OverlayStatCell className="px-1.5 py-0">
          <AbsChallengesField
            awayRemaining={awayAbsChallengesRemaining}
            homeRemaining={homeAbsChallengesRemaining}
            awayAbbrev={awayAbbrev}
            homeAbbrev={homeAbbrev}
            overlay
            compact
          />
        </OverlayStatCell>

        <OverlayStatCell className="min-w-[40px] px-1.5 py-0">
          <span className="font-mono text-[10px] font-semibold tracking-wide">
            {gameEnded ? "FINAL" : inningLabel(inning, inningHalf)}
          </span>
        </OverlayStatCell>

        <OverlayStatCell className="gap-0.5 px-1.5 py-0">
          <span className="font-mono text-sm font-bold tabular-nums text-green-400">
            {isBreak ? "–" : balls}
          </span>
          <span className="text-[9px] text-white/50">–</span>
          <span className="font-mono text-sm font-bold tabular-nums text-red-400">
            {isBreak ? "–" : strikes}
          </span>
        </OverlayStatCell>

        <OverlayStatCell className="gap-2 border-r-0 px-1.5 py-0">
          <div className="flex items-center gap-0.5" aria-label={`${safeOuts} outs`}>
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  i < safeOuts ? "bg-white" : "bg-white/25",
                )}
              />
            ))}
          </div>
          <div className="h-4 w-px shrink-0 bg-white/15" aria-hidden />
          <BaseDiamond
            onFirst={onFirst}
            onSecond={onSecond}
            onThird={onThird}
            size="tiny"
            onDark
            className="shrink-0"
          />
        </OverlayStatCell>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex w-full max-w-full shrink-0 items-stretch border-b border-border bg-scorebug text-scorebug-fg",
        useMatchupSlot
          ? "h-auto min-h-11 flex-col md:h-14 md:flex-row"
          : "h-auto min-h-11 flex-col lg:h-14 lg:flex-row",
        className,
      )}
    >
      {/* Game state — full width on mobile; content-width on desktop beside matchup */}
      <div
        className={cn(
          "flex h-11 min-w-0 items-stretch overflow-x-auto overscroll-x-contain max-md:w-full max-md:overflow-x-hidden lg:overflow-visible",
          useMatchupSlot ? "md:h-14 md:w-auto md:shrink-0" : "lg:h-14 lg:w-auto lg:shrink-0",
        )}
      >
        <StatCell className="min-w-[48px] flex-col gap-0.5 py-1 max-md:min-w-0 max-md:flex-1 md:min-w-[56px] lg:min-w-[72px] lg:px-3">
          <TeamLogo abbrev={awayAbbrev} size={18} className="lg:hidden" />
          <TeamLogo abbrev={awayAbbrev} size={22} className="hidden lg:block" />
          <span className="font-mono text-xl font-bold leading-none tabular-nums lg:text-2xl">
            {awayRuns}
          </span>
        </StatCell>

        <StatCell className="min-w-[48px] flex-col gap-0.5 py-1 max-md:min-w-0 max-md:flex-1 md:min-w-[56px] lg:min-w-[72px] lg:px-3">
          <TeamLogo abbrev={homeAbbrev} size={18} className="lg:hidden" />
          <TeamLogo abbrev={homeAbbrev} size={22} className="hidden lg:block" />
          <span className="font-mono text-xl font-bold leading-none tabular-nums lg:text-2xl">
            {homeRuns}
          </span>
        </StatCell>

        <StatCell className="min-w-[56px] flex-col py-1 max-md:min-w-0 max-md:flex-1 md:min-w-[64px] lg:min-w-[72px] lg:px-3">
          <AbsChallengesField
            awayRemaining={awayAbsChallengesRemaining}
            homeRemaining={homeAbsChallengesRemaining}
            awayAbbrev={awayAbbrev}
            homeAbbrev={homeAbbrev}
          />
        </StatCell>

        <StatCell className="min-w-[44px] max-md:min-w-0 max-md:flex-1 md:min-w-[52px] lg:min-w-[64px] lg:px-3">
          <span className="font-mono text-xs font-semibold tracking-wide md:text-sm">
            {gameEnded ? "FINAL" : inningLabel(inning, inningHalf)}
          </span>
        </StatCell>

        {/* Compact count — tight / medium layouts */}
        <StatCell className="gap-1 max-md:min-w-0 max-md:flex-1 lg:hidden">
          <span className="font-mono text-base font-bold tabular-nums text-green-700 dark:text-green-400">
            {isBreak ? "–" : balls}
          </span>
          <span className="text-[10px] text-scorebug-muted">–</span>
          <span className="font-mono text-base font-bold tabular-nums text-red-700 dark:text-red-400">
            {isBreak ? "–" : strikes}
          </span>
        </StatCell>

        {/* Full B/S boxes — wide layouts */}
        <StatCell className="hidden gap-2 lg:flex lg:px-3">
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
        </StatCell>

        <StatCell className="flex-col py-1 max-md:min-w-0 max-md:flex-1 lg:px-3" aria-label={`${safeOuts} outs`}>
          <span className="mb-0.5 text-[8px] font-semibold text-scorebug-muted lg:mb-1 lg:text-[9px]">
            OUT
          </span>
          <div className="flex gap-0.5 lg:gap-1">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className={cn(
                  "h-2 w-2 rounded-full lg:h-2.5 lg:w-2.5",
                  i < safeOuts ? "bg-scorebug-fg" : "bg-faint",
                )}
              />
            ))}
          </div>
        </StatCell>

        <StatCell className="pr-2 max-md:min-w-0 max-md:flex-1 lg:px-3">
          <BaseDiamond
            onFirst={onFirst}
            onSecond={onSecond}
            onThird={onThird}
            size="tiny"
            className="lg:hidden"
          />
          <BaseDiamond
            onFirst={onFirst}
            onSecond={onSecond}
            onThird={onThird}
            size="compact"
            className="hidden lg:block"
          />
        </StatCell>
      </div>

      {/* Matchup — players only on desktop; history/RISP live in the panel below */}
      <div
        className={cn(
          "hidden min-w-0 items-center border-t border-border px-3 py-1.5 md:flex",
          useMatchupSlot
            ? "md:h-14 md:shrink-0 md:border-l md:border-t-0 md:px-2.5 md:py-0"
            : "lg:h-14 lg:min-w-0 lg:flex-1 lg:border-l lg:border-t-0 lg:py-0 lg:pl-3 lg:pr-3",
        )}
      >
        {useMatchupSlot ? (
          matchupSlot
        ) : (
          <MatchupLine
            gameEnded={gameEnded}
            isBreak={isBreak}
            awayAbbrev={awayAbbrev}
            awayRuns={awayRuns}
            homeRuns={homeRuns}
            homeAbbrev={homeAbbrev}
            dueUpBatters={dueUpBatters}
            batterName={batterName}
            onDeckName={onDeckName}
            inHoleName={inHoleName}
            pitcherName={pitcherName}
          />
        )}
      </div>
    </div>
  );
}
