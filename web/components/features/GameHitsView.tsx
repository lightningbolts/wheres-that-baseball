"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
import { cn, formatInningHalf } from "@/lib/utils";
import type { PlayByPlayEntry } from "@/types/mlb-live";

const GameHitsTrajectory3D = dynamic(
  () =>
    import("@/components/features/GameHitsTrajectory3D").then((m) => m.GameHitsTrajectory3D),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[240px] items-center justify-center rounded border border-border bg-field-chart-canvas text-xs text-subtle sm:h-[300px] lg:h-[360px]">
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

function SelectedHitBanner({
  batterName,
  event,
  awayAbbrev,
  homeAbbrev,
  awayScore,
  homeScore,
  inning,
  halfInning,
  launchSpeed,
  onOpenDetail,
  onClear,
}: {
  batterName: string;
  event: HitType;
  awayAbbrev: string;
  homeAbbrev: string;
  awayScore: number;
  homeScore: number;
  inning: number;
  halfInning: string;
  launchSpeed?: number;
  onOpenDetail: () => void;
  onClear: () => void;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-foreground">
          {batterName}
          <span className="ml-2 font-mono text-[11px] font-normal text-muted">
            {HIT_TYPE_LABELS[event]}
          </span>
        </p>
        <p className="mt-0.5 text-[11px] text-muted">
          <span className="font-mono tabular-nums">
            {awayAbbrev} {awayScore}–{homeScore} {homeAbbrev}
          </span>
          <span className="ml-2 font-mono tabular-nums">
            {inning} {formatInningHalf(halfInning)}
          </span>
          {launchSpeed != null && launchSpeed > 0 ? (
            <span className="ml-2 font-mono tabular-nums">{launchSpeed.toFixed(0)} mph EV</span>
          ) : null}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <button
          type="button"
          onClick={onOpenDetail}
          className="text-[11px] font-medium text-secondary underline-offset-2 hover:underline"
        >
          Play details
        </button>
        <button
          type="button"
          onClick={onClear}
          className="text-[11px] text-muted hover:text-foreground"
          aria-label="Clear selection"
        >
          Clear
        </button>
      </div>
    </div>
  );
}

function HitBannerPlaceholder() {
  return (
    <div className="invisible flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-foreground">Placeholder batter</p>
        <p className="mt-0.5 text-[11px] text-muted">AWY 0–0 HOM · 1 Top</p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className="text-[11px] font-medium">Play details</span>
        <span className="text-[11px]">Clear</span>
      </div>
    </div>
  );
}

function LazyTrajectorySection({
  hits,
  venueId,
  selectedAtBatIndex,
  selectedHitBanner,
  onSelectHit,
  className,
}: {
  hits: GameHit[];
  venueId?: number | null;
  selectedAtBatIndex: number | null;
  selectedHitBanner?: React.ReactNode;
  onSelectHit?: (hit: SprayChartHit) => void;
  className?: string;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const [shouldRender, setShouldRender] = useState(false);

  useEffect(() => {
    const node = sectionRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setShouldRender(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <section ref={sectionRef} className="border-t border-border bg-panel p-3 sm:p-4">
      <p className="mb-3 text-[10px] font-medium uppercase tracking-wide text-muted">
        3D trajectories
      </p>
      {shouldRender ? (
        <>
          <GameHitsTrajectory3D
            hits={hits}
            venueId={venueId}
            selectedAtBatIndex={selectedAtBatIndex}
            onSelectHit={onSelectHit}
            className={className}
          />
          <div className="mt-3">
            {selectedHitBanner ?? <HitBannerPlaceholder />}
          </div>
        </>
      ) : (
        <>
          <div className="flex h-[240px] items-center justify-center rounded border border-border bg-field-chart-canvas text-xs text-subtle sm:h-[300px] lg:h-[360px]">
            Scroll to load 3D view…
          </div>
          <div className="mt-3" aria-hidden>
            <HitBannerPlaceholder />
          </div>
        </>
      )}
    </section>
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

  const handleSelectHit = useCallback((gameHit: SprayChartHit) => {
    setSelectedAtBatIndex((current) =>
      current === gameHit.atBatIndex ? null : gameHit.atBatIndex,
    );
  }, []);

  if (isLoading && plays.length === 0) {
    return (
      <div className={cn("flex flex-1 flex-col gap-4 p-4", className)}>
        <Skeleton className="h-16 w-full" />
        <Skeleton className="aspect-square w-full max-w-[480px]" />
        <Skeleton className="h-[240px] w-full sm:h-[300px] lg:h-[360px]" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <>
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain",
          className,
        )}
      >
        {hits.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
            <p className="text-sm text-subtle">No tracked hits yet.</p>
            <p className="mt-1 text-xs text-muted">
              Hits will appear as the game progresses
              {venueName ? ` · ${venueName}` : ""}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4 p-3 sm:p-4">
            <div className="shrink-0 rounded-xl border border-border bg-surface px-3 py-3 sm:px-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <p className="text-xs text-muted">
                  {stats.total} hit{stats.total === 1 ? "" : "s"} with tracking data
                  {venueName ? ` · ${venueName}` : ""}
                </p>
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

              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
                <Stat label="Avg exit velo" value={`${fmtNum(stats.avgExitVelo)} mph`} />
                <Stat label="Avg launch angle" value={`${fmtNum(stats.avgLaunchAngle, 0)}°`} />
                <Stat label="Hardest hit" value={`${fmtNum(stats.maxExitVelo, 0)} mph`} />
                <Stat label="Longest ball" value={`${fmtNum(stats.maxDistance, 0, " ft")}`} />
              </dl>
            </div>

            <div className="overflow-hidden rounded-xl border border-border">
              <div className="relative">
                <div className="min-w-0 bg-panel lg:mr-[min(320px,34%)]">
                  <section className="p-3 sm:p-4">
                    <p className="mb-3 text-[10px] font-medium uppercase tracking-wide text-muted">
                      Spray chart
                    </p>
                    <GameHitsSprayChart
                      hits={hits}
                      venueId={venueId}
                      selectedAtBatIndex={selectedAtBatIndex}
                      onSelectHit={handleSelectHit}
                      showLines={false}
                      ballRadius={1.2}
                      className="mx-auto w-full max-w-[min(100%,480px)]"
                    />
                  </section>

                  <LazyTrajectorySection
                    hits={hits}
                    venueId={venueId}
                    selectedAtBatIndex={selectedAtBatIndex}
                    onSelectHit={handleSelectHit}
                    selectedHitBanner={
                      selectedHit ? (
                        <SelectedHitBanner
                          batterName={selectedHit.batterName}
                          event={selectedHit.event}
                          awayAbbrev={awayAbbrev}
                          homeAbbrev={homeAbbrev}
                          awayScore={selectedHit.awayScore}
                          homeScore={selectedHit.homeScore}
                          inning={selectedHit.inning}
                          halfInning={selectedHit.halfInning}
                          launchSpeed={selectedHit.hit.launchSpeed}
                          onOpenDetail={() => setDetailPlay(selectedHit.detail)}
                          onClear={() => setSelectedAtBatIndex(null)}
                        />
                      ) : null
                    }
                    className="mx-auto w-full max-w-4xl"
                  />
                </div>

                <aside className="flex max-h-[min(50vh,28rem)] flex-col overflow-hidden border-t border-border bg-surface lg:absolute lg:inset-y-0 lg:right-0 lg:max-h-none lg:w-[min(320px,34%)] lg:border-l lg:border-t-0">
                  <div className="shrink-0 border-b border-border px-3 py-2">
                    <h3 className="text-xs font-medium text-muted">
                      Hits{" "}
                      <span className="font-mono tabular-nums text-subtle">({hits.length})</span>
                    </h3>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain">
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
