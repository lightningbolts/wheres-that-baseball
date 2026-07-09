"use client";

import { useMemo } from "react";

import { LiveField3D } from "@/components/features/LiveField3D";
import { Scorebug } from "@/components/features/Scorebug";
import { Skeleton } from "@/components/ui/Skeleton";
import { deriveDefense } from "@/lib/mlb/fieldDefense";
import {
  getBallparkByVenueId,
  resolveBallparkVenueId,
} from "@/lib/mlb/ballparkPaths";
import { isHalfInningBreak } from "@/lib/mlb/lineup";
import { isGameOver } from "@/lib/mlb/gameOver";
import { playerLastName } from "@/lib/mlb/situationFormat";
import { cn } from "@/lib/utils";
import type { GameBoxScore } from "@/types/mlb-boxscore";
import type { BaseRunner, LiveGameState } from "@/types/mlb-live";

interface GameFieldViewProps {
  gameState: LiveGameState | null;
  boxScore: GameBoxScore | null;
  isLoading?: boolean;
  className?: string;
}

function runnerOrFallback(
  runner: BaseRunner | null | undefined,
  occupied: boolean,
): BaseRunner | null {
  if (runner) return runner;
  if (!occupied) return null;
  return { id: 0, name: "Runner" };
}

function LedgerRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/60 py-1.5 last:border-b-0">
      <dt className="text-[10px] uppercase tracking-wide text-subtle">{label}</dt>
      <dd className="min-w-0 truncate text-right text-sm text-foreground">{value}</dd>
    </div>
  );
}

function DimensionRow({
  label,
  value,
}: {
  label: string;
  value: number | null | undefined;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5">
      <span className="text-[11px] text-muted">{label}</span>
      <span className="font-mono text-[12px] tabular-nums text-foreground">
        {value != null ? `${value}'` : "—"}
      </span>
    </div>
  );
}

export function GameFieldView({
  gameState,
  boxScore,
  isLoading,
  className,
}: GameFieldViewProps) {
  const isBreak =
    gameState != null && isHalfInningBreak(gameState.inningState);
  const gameEnded = gameState != null && isGameOver(gameState);

  const runnerFirst = useMemo(
    () =>
      isBreak || gameEnded
        ? null
        : runnerOrFallback(gameState?.runnerFirst, gameState?.onFirst ?? false),
    [gameState?.runnerFirst, gameState?.onFirst, isBreak, gameEnded],
  );
  const runnerSecond = useMemo(
    () =>
      isBreak || gameEnded
        ? null
        : runnerOrFallback(gameState?.runnerSecond, gameState?.onSecond ?? false),
    [gameState?.runnerSecond, gameState?.onSecond, isBreak, gameEnded],
  );
  const runnerThird = useMemo(
    () =>
      isBreak || gameEnded
        ? null
        : runnerOrFallback(gameState?.runnerThird, gameState?.onThird ?? false),
    [gameState?.runnerThird, gameState?.onThird, isBreak, gameEnded],
  );

  const defense = useMemo(
    () =>
      deriveDefense(
        boxScore,
        gameState?.offenseTeamId ?? null,
        gameState?.pitcherId ?? null,
        gameState?.pitcherName ?? "—",
      ),
    [
      boxScore,
      gameState?.offenseTeamId,
      gameState?.pitcherId,
      gameState?.pitcherName,
    ],
  );

  const homeTeamId = boxScore?.home.teamId ?? null;
  const resolvedVenueId = resolveBallparkVenueId(gameState?.venueId, homeTeamId);
  const park = getBallparkByVenueId(resolvedVenueId);
  const venueLabel = park?.venueName ?? gameState?.venueName ?? "Ballpark";
  const fieldInfo = park?.fieldInfo;
  const showBatter =
    !isBreak && !gameEnded && Boolean(gameState?.batterName && gameState.batterName !== "—");

  const pitches = useMemo(
    () => (isBreak || gameEnded ? [] : (gameState?.atBatPitches ?? [])),
    [gameState?.atBatPitches, isBreak, gameEnded],
  );

  if (isLoading && !gameState) {
    return (
      <div className={cn("flex min-h-0 flex-1 flex-col gap-3 p-3", className)}>
        <Skeleton className="h-14 w-full" />
        <Skeleton className="min-h-[280px] w-full flex-1" />
      </div>
    );
  }

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col overflow-hidden", className)}>
      <Scorebug
        className="shrink-0"
        gameState={
          gameState
            ? {
                ...gameState,
                onFirst: Boolean(runnerFirst),
                onSecond: Boolean(runnerSecond),
                onThird: Boolean(runnerThird),
              }
            : null
        }
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
        <div className="flex min-h-0 flex-1 flex-col bg-field-chart-canvas p-3 md:overflow-hidden md:p-4">
          <header className="mb-2 flex w-full items-baseline justify-between gap-2 px-0.5">
            <h2 className="font-serif text-base text-foreground sm:text-lg">{venueLabel}</h2>
            {gameState?.dayNight ? (
              <span className="text-[11px] uppercase tracking-wide text-muted">
                {gameState.dayNight}
              </span>
            ) : null}
          </header>
          <LiveField3D
            venueId={resolvedVenueId}
            pitches={pitches}
            defense={defense}
            batterName={gameState?.batterName}
            showBatter={showBatter}
            runnerFirst={runnerFirst}
            runnerSecond={runnerSecond}
            runnerThird={runnerThird}
            className="min-h-0 flex-1"
          />
        </div>

        <aside className="shrink-0 border-t border-border bg-panel md:w-[240px] md:overflow-y-auto md:border-l md:border-t-0 lg:w-[260px]">
          <div className="border-b border-border px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-subtle">Situation</p>
          </div>
          <dl className="px-3 py-1">
            <LedgerRow
              label="Batter"
              value={
                showBatter && gameState?.batterName
                  ? gameState.batterName
                  : isBreak
                    ? "Between innings"
                    : "—"
              }
            />
            <LedgerRow
              label="Pitcher"
              value={
                gameState?.pitcherName && gameState.pitcherName !== "—"
                  ? gameState.pitcherName
                  : "—"
              }
            />
            <LedgerRow
              label="1B"
              value={runnerFirst ? playerLastName(runnerFirst.name) : "—"}
            />
            <LedgerRow
              label="2B"
              value={runnerSecond ? playerLastName(runnerSecond.name) : "—"}
            />
            <LedgerRow
              label="3B"
              value={runnerThird ? playerLastName(runnerThird.name) : "—"}
            />
          </dl>

          <div className="border-b border-t border-border px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-subtle">Wall</p>
          </div>
          <div className="px-3 py-2">
            <DimensionRow label="LF line" value={fieldInfo?.leftLine ?? fieldInfo?.left} />
            <DimensionRow label="Left" value={fieldInfo?.left} />
            <DimensionRow label="LCF" value={fieldInfo?.leftCenter} />
            <DimensionRow label="Center" value={fieldInfo?.center} />
            <DimensionRow label="RCF" value={fieldInfo?.rightCenter} />
            <DimensionRow label="Right" value={fieldInfo?.right} />
            <DimensionRow label="RF line" value={fieldInfo?.rightLine ?? fieldInfo?.right} />
          </div>

          {defense.length > 0 ? (
            <>
              <div className="border-b border-t border-border px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-subtle">Defense</p>
              </div>
              <ul className="px-3 py-1">
                {defense.map((d) => (
                  <li
                    key={`${d.position}-${d.playerId}`}
                    className="flex items-baseline justify-between gap-2 border-b border-border/50 py-1.5 last:border-b-0"
                  >
                    <span className="font-mono text-[11px] tabular-nums text-muted">
                      {d.position}
                    </span>
                    <span className="min-w-0 truncate text-right text-sm text-foreground">
                      {d.name}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
