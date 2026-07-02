"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";

import { PlayDetailDialog } from "@/components/features/PlayDetailDialog";
import { GameHitsSprayChart } from "@/components/features/GameHitsSprayChart";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  computeGameHitStats,
  extractGameHits,
  HIT_TYPE_COLORS,
  HIT_TYPE_LABELS,
  type GameHit,
  type HitType,
  type SprayChartHit,
} from "@/lib/mlb/gameHits";
import { cn } from "@/lib/utils";
import type { PlayByPlayEntry } from "@/types/mlb-live";
import { formatInningHalf } from "@/lib/utils";

const GameHitsTrajectory3D = dynamic(
  () =>
    import("@/components/features/GameHitsTrajectory3D").then((m) => m.GameHitsTrajectory3D),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[240px] items-center justify-center rounded border border-border bg-field-chart-canvas text-xs text-subtle sm:h-[300px] xl:h-[360px]">
        Loading trajectories…
      </div>
    ),
  },
);

interface GameHitsViewProps {
  plays: PlayByPlayEntry[];
  venueId?: number | null;
  venueName?: string | null;
  awayAbbrev: string;
  homeAbbrev: string;
  isLoading?: boolean;
  className?: string;
}

const HIT_TYPES: HitType[] = ["Single", "Double", "Triple", "Home Run"];

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] text-subtle">{label}</dt>
      <dd className="font-mono text-[13px] tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

function fmtNum(value: number | null, digits = 1, suffix = ""): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${value.toFixed(digits)}${suffix}`;
}

function HitRow({
  gameHit,
  awayAbbrev,
  homeAbbrev,
  selected,
  onSelect,
}: {
  gameHit: GameHit;
  awayAbbrev: string;
  homeAbbrev: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const { hit } = gameHit;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full border-t border-border/50 px-3 py-3 text-left hover:bg-hover sm:py-2.5",
        selected && "bg-overlay ring-1 ring-inset ring-border-strong",
      )}
    >
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: gameHit.color }}
            aria-hidden
          />
          <span className="shrink-0 font-mono text-[11px] text-muted">
            {HIT_TYPE_LABELS[gameHit.event]}
          </span>
          <span className="truncate text-[13px] font-medium text-foreground">
            {gameHit.batterName}
          </span>
        </div>
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-subtle">
          {gameHit.inning} {formatInningHalf(gameHit.halfInning)}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
        <span className="font-mono tabular-nums">
          {awayAbbrev} {gameHit.awayScore}–{gameHit.homeScore} {homeAbbrev}
        </span>
        {hit.launchSpeed > 0 && (
          <span className="font-mono tabular-nums">{hit.launchSpeed.toFixed(0)} mph EV</span>
        )}
        <span className="font-mono tabular-nums">{hit.launchAngle.toFixed(0)}°</span>
        {hit.totalDistance > 0 && (
          <span className="font-mono tabular-nums">{Math.round(hit.totalDistance)} ft</span>
        )}
      </div>
    </button>
  );
}

export function GameHitsView({
  plays,
  venueId,
  venueName,
  awayAbbrev,
  homeAbbrev,
  isLoading = false,
  className,
}: GameHitsViewProps) {
  const hits = useMemo(() => extractGameHits(plays), [plays]);
  const stats = useMemo(() => computeGameHitStats(hits), [hits]);
  const [selectedAtBatIndex, setSelectedAtBatIndex] = useState<number | null>(null);
  const [detailPlay, setDetailPlay] = useState<GameHit["detail"] | null>(null);

  const selectedHit =
    selectedAtBatIndex != null
      ? hits.find((hit) => hit.atBatIndex === selectedAtBatIndex) ?? null
      : null;

  const handleSelectHit = (gameHit: SprayChartHit) => {
    setSelectedAtBatIndex((current) =>
      current === gameHit.atBatIndex ? null : gameHit.atBatIndex,
    );
  };

  if (isLoading && plays.length === 0) {
    return (
      <div className={cn("flex flex-1 flex-col gap-4 p-4", className)}>
        <Skeleton className="h-16 w-full" />
        <Skeleton className="aspect-square w-full max-w-[480px]" />
        <Skeleton className="h-[240px] w-full sm:h-[300px] xl:h-[360px]" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <>
      <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
        <div className="shrink-0 border-b border-border bg-surface px-3 py-3 sm:px-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h2 className="text-sm font-medium text-foreground">Spray chart</h2>
              <p className="mt-0.5 text-xs text-muted">
                {stats.total > 0
                  ? `${stats.total} hit${stats.total === 1 ? "" : "s"} with tracking data`
                  : "Hits will appear as the game progresses"}
                {venueName ? ` · ${venueName}` : ""}
              </p>
            </div>

            <div className="flex flex-wrap gap-x-3 gap-y-1.5 sm:justify-end">
              {HIT_TYPES.map((type) => {
                const count =
                  type === "Single"
                    ? stats.singles
                    : type === "Double"
                      ? stats.doubles
                      : type === "Triple"
                        ? stats.triples
                        : stats.homeRuns;

                return (
                  <div key={type} className="flex items-center gap-1.5 text-[11px] text-muted">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: HIT_TYPE_COLORS[type] }}
                      aria-hidden
                    />
                    <span className="font-mono tabular-nums">
                      {HIT_TYPE_LABELS[type]} {count}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {stats.total > 0 && (
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
              <Stat label="Avg exit velo" value={`${fmtNum(stats.avgExitVelo)} mph`} />
              <Stat label="Avg launch angle" value={`${fmtNum(stats.avgLaunchAngle, 0)}°`} />
              <Stat label="Hardest hit" value={`${fmtNum(stats.maxExitVelo, 0)} mph`} />
              <Stat label="Longest ball" value={`${fmtNum(stats.maxDistance, 0, " ft")}`} />
            </dl>
          )}
        </div>

        {hits.length === 0 ? (
          <div className="flex flex-1 items-center justify-center px-6 py-12 text-center">
            <p className="text-sm text-subtle">No tracked hits yet.</p>
          </div>
        ) : (
          <div className="min-h-0 flex-1 touch-pan-y overflow-y-auto">
            <div className="grid gap-px bg-border xl:grid-cols-[minmax(0,1fr)_minmax(260px,320px)] xl:items-start">
              <div className="flex flex-col gap-px bg-border">
                <section className="bg-panel p-3 sm:p-4">
                  <p className="mb-3 text-[10px] font-medium uppercase tracking-wide text-muted">
                    Field view
                  </p>
                  <GameHitsSprayChart
                    hits={hits}
                    venueId={venueId}
                    selectedAtBatIndex={selectedAtBatIndex}
                    onSelectHit={handleSelectHit}
                    className="mx-auto w-full max-w-[min(100%,480px)]"
                  />
                </section>

                <section className="bg-panel p-3 sm:p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-muted">
                      3D trajectories
                    </p>
                    {selectedHit && (
                      <button
                        type="button"
                        onClick={() => setDetailPlay(selectedHit.detail)}
                        className="text-[11px] text-secondary underline-offset-2 hover:underline"
                      >
                        {selectedHit.batterName} — {selectedHit.event} details
                      </button>
                    )}
                  </div>
                  <GameHitsTrajectory3D
                    hits={hits}
                    venueId={venueId}
                    selectedAtBatIndex={selectedAtBatIndex}
                    className="mx-auto w-full max-w-4xl"
                  />
                </section>
              </div>

              <aside className="flex flex-col bg-surface xl:sticky xl:top-0 xl:max-h-[calc(100dvh-10rem)] xl:min-h-0">
                <div className="shrink-0 border-b border-border px-3 py-2">
                  <h3 className="text-xs font-medium text-muted">
                    Hits <span className="font-mono tabular-nums text-subtle">({hits.length})</span>
                  </h3>
                </div>
                <div className="max-h-[min(50vh,28rem)] overflow-y-auto overscroll-y-contain xl:max-h-none xl:flex-1 xl:min-h-0">
                  {hits.map((gameHit) => (
                    <HitRow
                      key={gameHit.atBatIndex}
                      gameHit={gameHit}
                      awayAbbrev={awayAbbrev}
                      homeAbbrev={homeAbbrev}
                      selected={selectedAtBatIndex === gameHit.atBatIndex}
                      onSelect={() => handleSelectHit(gameHit)}
                    />
                  ))}
                </div>
              </aside>
            </div>
          </div>
        )}
      </div>

      <PlayDetailDialog
        play={detailPlay}
        venueId={venueId}
        onClose={() => setDetailPlay(null)}
      />
    </>
  );
}
