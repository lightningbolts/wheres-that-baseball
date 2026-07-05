"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AppNav } from "@/components/features/AppNav";
import { GameHitsSprayChart } from "@/components/features/GameHitsSprayChart";
import { PlayDetailDialog } from "@/components/features/PlayDetailDialog";
import { TeamLogo } from "@/components/ui/TeamLogo";
import { Skeleton } from "@/components/ui/Skeleton";
import { useBallparkHitsDetail } from "@/hooks/useBallparkHits";
import { useRestoreScrollWhenReady } from "@/hooks/useRestoreScrollWhenReady";
import {
  HIT_TYPE_COLORS,
  HIT_TYPE_LABELS,
  type HitType,
  type SprayChartHit,
} from "@/lib/mlb/gameHits";
import type { SprayPreviewHit, VenueHit } from "@/lib/mlb/ballparkHits";
import { cn, formatInningHalf } from "@/lib/utils";
import type { PlayDetail } from "@/types/mlb-live";

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

const HIT_TYPES: HitType[] = ["Single", "Double", "Triple", "Home Run"];
const CURRENT_SEASON = new Date().getFullYear();

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
  venueHit,
  selected,
  onSelect,
}: {
  venueHit: VenueHit;
  selected: boolean;
  onSelect: () => void;
}) {
  const { hit } = venueHit;

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
            style={{ backgroundColor: venueHit.color }}
            aria-hidden
          />
          <span className="shrink-0 font-mono text-[11px] text-muted">
            {HIT_TYPE_LABELS[venueHit.event]}
          </span>
          <span className="truncate text-[13px] font-medium text-foreground">
            {venueHit.batterName}
          </span>
        </div>
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-subtle">
          {venueHit.inning} {formatInningHalf(venueHit.halfInning)}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
        <span className="font-mono tabular-nums">
          {venueHit.awayAbbrev} {venueHit.awayScore}–{venueHit.homeScore} {venueHit.homeAbbrev}
        </span>
        <span>{venueHit.gameDate}</span>
        {hit.launchSpeed > 0 && (
          <span className="font-mono tabular-nums">{hit.launchSpeed.toFixed(0)} mph EV</span>
        )}
      </div>
    </button>
  );
}

function SelectedHitBanner({
  hitKey,
  batterName,
  event,
  awayAbbrev,
  homeAbbrev,
  awayScore,
  homeScore,
  gameDate,
  inning,
  halfInning,
  launchSpeed,
  onOpenDetail,
  onClear,
}: {
  hitKey: string;
  batterName: string;
  event: HitType;
  awayAbbrev?: string;
  homeAbbrev?: string;
  awayScore: number;
  homeScore: number;
  gameDate?: string;
  inning: number;
  halfInning: string;
  launchSpeed?: number;
  onOpenDetail: (hitKey: string) => void;
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
          {awayAbbrev && homeAbbrev ? (
            <span className="font-mono tabular-nums">
              {awayAbbrev} {awayScore}–{homeScore} {homeAbbrev}
            </span>
          ) : null}
          {gameDate ? <span className="ml-2">{gameDate}</span> : null}
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
          onClick={() => onOpenDetail(hitKey)}
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
        <p className="mt-0.5 text-[11px] text-muted">AWY 0–0 HOM · 2026-01-01 · 1 Top</p>
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
  getHitKey,
  selectedHitKey,
  selectedHitBanner,
  onSelectHit,
  className,
}: {
  hits: SprayPreviewHit[];
  venueId: number;
  getHitKey: (hit: { hitKey?: string; atBatIndex: number }) => string;
  selectedHitKey: string | null;
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
            getHitKey={getHitKey}
            selectedHitKey={selectedHitKey}
            onSelectHit={onSelectHit}
            className={className}
          />
          <div className="mt-3">
            {selectedHitBanner ?? <HitBannerPlaceholder />}
          </div>
        </>
      ) : (
        <>
          <div className="flex h-[240px] items-center justify-center rounded border border-border bg-field-chart-canvas text-xs text-subtle sm:h-[300px] xl:h-[360px]">
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

interface BallparkHitsDetailProps {
  venueId: number;
}

export function BallparkHitsDetail({ venueId }: BallparkHitsDetailProps) {
  const { data, isLoading, isLoadingMore, error, loadMore, hasMore, fetchHitDetail } =
    useBallparkHitsDetail(venueId, CURRENT_SEASON);
  useRestoreScrollWhenReady(!isLoading && (data?.stats.total ?? 0) > 0);
  const [selectedHitKey, setSelectedHitKey] = useState<string | null>(null);
  const [detailPlay, setDetailPlay] = useState<PlayDetail | null>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const hitsScrollRef = useRef<HTMLDivElement>(null);

  const getHitKey = (hit: { hitKey?: string; atBatIndex: number }) =>
    "hitKey" in hit && hit.hitKey ? hit.hitKey : String(hit.atBatIndex);

  const toggleHitSelection = useCallback((hitKey: string) => {
    setSelectedHitKey((current) => (current === hitKey ? null : hitKey));
  }, []);

  const handleSelectHit = useCallback(
    (hit: SprayChartHit) => {
      toggleHitSelection(getHitKey(hit));
    },
    [toggleHitSelection],
  );

  const chartHits = useMemo(() => {
    if (!data) return [];
    if (data.chartHits?.length) return data.chartHits;
    return data.hits;
  }, [data]);

  const selectedHitMeta = useMemo(() => {
    if (!selectedHitKey || !data) return null;

    const venueHit = data.hits.find((hit) => hit.hitKey === selectedHitKey);
    if (venueHit) return venueHit;

    const chartHit = chartHits.find((hit) => getHitKey(hit) === selectedHitKey);
    if (!chartHit || !("batterName" in chartHit) || !chartHit.batterName) return null;

    return chartHit;
  }, [chartHits, data, selectedHitKey]);

  const openHitDetail = useCallback(
    async (hitKey: string) => {
      const hit = await fetchHitDetail(hitKey);
      if (hit?.detail) setDetailPlay(hit.detail);
    },
    [fetchHitDetail],
  );

  useEffect(() => {
    const root = hitsScrollRef.current;
    const node = loadMoreRef.current;
    if (!root || !node || !hasMore) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) void loadMore();
      },
      { root, rootMargin: "120px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loadMore, data?.hits.length]);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <AppNav />

      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-6">
        <div className="mb-6">
          <Link
            href="/ballparks"
            scroll={false}
            className="text-xs text-muted transition-colors hover:text-foreground"
          >
            ← All ballparks
          </Link>

          {isLoading ? (
            <div className="mt-3">
              <Skeleton className="h-6 w-56" />
              <Skeleton className="mt-2 h-4 w-40" />
            </div>
          ) : data ? (
            <div className="mt-3 flex items-start gap-3">
              <TeamLogo teamId={data.park.teamId} size={44} />
              <div>
                <h1 className="text-xl font-medium text-foreground">{data.park.venueName}</h1>
                <p className="mt-1 text-sm text-muted">
                  {data.park.teamName} · {CURRENT_SEASON} season · {data.gameCount} game
                  {data.gameCount === 1 ? "" : "s"} · {data.stats.total} hit
                  {data.stats.total === 1 ? "" : "s"}
                </p>
              </div>
            </div>
          ) : null}
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="aspect-square w-full max-w-[480px]" />
            <Skeleton className="h-48 w-full" />
          </div>
        ) : data && data.stats.total > 0 ? (
          <>
            <div className="shrink-0 rounded-xl border border-border bg-surface px-3 py-3 sm:px-4">
              <div className="flex flex-wrap gap-x-3 gap-y-1.5">
                {HIT_TYPES.map((type) => {
                  const count =
                    type === "Single"
                      ? data.stats.singles
                      : type === "Double"
                        ? data.stats.doubles
                        : type === "Triple"
                          ? data.stats.triples
                          : data.stats.homeRuns;

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

              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
                <Stat label="Avg exit velo" value={`${fmtNum(data.stats.avgExitVelo)} mph`} />
                <Stat label="Avg launch angle" value={`${fmtNum(data.stats.avgLaunchAngle, 0)}°`} />
                <Stat label="Hardest hit" value={`${fmtNum(data.stats.maxExitVelo, 0)} mph`} />
                <Stat label="Longest ball" value={`${fmtNum(data.stats.maxDistance, 0, " ft")}`} />
              </dl>
            </div>

            <div className="mt-4 overflow-hidden rounded-xl border border-border">
              <div className="relative">
                <div className="min-w-0 bg-panel lg:mr-[min(320px,34%)]">
                  <section className="p-3 sm:p-4">
                    <p className="mb-3 text-[10px] font-medium uppercase tracking-wide text-muted">
                      Season spray chart
                    </p>
                    <GameHitsSprayChart
                      hits={chartHits}
                      venueId={data.park.venueId}
                      getHitKey={getHitKey}
                      selectedHitKey={selectedHitKey}
                      onSelectHit={handleSelectHit}
                      showLines={false}
                      ballRadius={1.2}
                      className="mx-auto w-full max-w-[min(100%,480px)]"
                    />
                  </section>

                  <LazyTrajectorySection
                    hits={chartHits}
                    venueId={data.park.venueId}
                    getHitKey={getHitKey}
                    selectedHitKey={selectedHitKey}
                    onSelectHit={handleSelectHit}
                    selectedHitBanner={
                      selectedHitMeta ? (
                        <SelectedHitBanner
                          hitKey={getHitKey(selectedHitMeta)}
                          batterName={selectedHitMeta.batterName}
                          event={selectedHitMeta.event}
                          awayAbbrev={
                            "awayAbbrev" in selectedHitMeta ? selectedHitMeta.awayAbbrev : undefined
                          }
                          homeAbbrev={
                            "homeAbbrev" in selectedHitMeta ? selectedHitMeta.homeAbbrev : undefined
                          }
                          awayScore={selectedHitMeta.awayScore}
                          homeScore={selectedHitMeta.homeScore}
                          gameDate={
                            "gameDate" in selectedHitMeta ? selectedHitMeta.gameDate : undefined
                          }
                          inning={selectedHitMeta.inning}
                          halfInning={selectedHitMeta.halfInning}
                          launchSpeed={selectedHitMeta.hit.launchSpeed}
                          onOpenDetail={(hitKey) => void openHitDetail(hitKey)}
                          onClear={() => setSelectedHitKey(null)}
                        />
                      ) : null
                    }
                    className="mx-auto w-full max-w-4xl"
                  />
                </div>

                <aside className="flex max-h-[min(50vh,28rem)] flex-col overflow-hidden border-t border-border bg-surface lg:absolute lg:inset-y-0 lg:right-0 lg:max-h-none lg:w-[min(320px,34%)] lg:border-l lg:border-t-0">
                  <div className="shrink-0 border-b border-border px-3 py-2">
                    <h3 className="text-xs font-medium text-muted">
                      All hits{" "}
                      <span className="font-mono tabular-nums text-subtle">
                        ({data.hits.length}
                        {(data.hitsTotal ?? data.stats.total) > data.hits.length
                          ? ` of ${data.hitsTotal ?? data.stats.total}`
                          : ""}
                        )
                      </span>
                    </h3>
                  </div>
                  <div
                    ref={hitsScrollRef}
                    className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain"
                  >
                    {data.hits.map((venueHit) => (
                      <HitRow
                        key={venueHit.hitKey}
                        venueHit={venueHit}
                        selected={selectedHitKey === venueHit.hitKey}
                        onSelect={() => handleSelectHit(venueHit)}
                      />
                    ))}
                    {hasMore && (
                      <div
                        ref={loadMoreRef}
                        className="flex items-center justify-center border-t border-border px-3 py-3 text-xs text-muted"
                        aria-hidden
                      />
                    )}
                  </div>
                  {hasMore ? (
                    <div className="shrink-0 border-t border-border bg-surface px-3 py-2">
                      <button
                        type="button"
                        onClick={() => void loadMore()}
                        disabled={isLoadingMore}
                        className="w-full rounded-md border border-border bg-panel px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-hover disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isLoadingMore
                          ? "Loading more hits…"
                          : `Load more (${data.hits.length} of ${data.hitsTotal ?? data.stats.total})`}
                      </button>
                    </div>
                  ) : null}
                </aside>
              </div>
            </div>
          </>
        ) : data ? (
          <div className="rounded-xl border border-border bg-surface px-6 py-12 text-center">
            <p className="text-sm text-secondary">No tracked hits at this ballpark yet.</p>
            <p className="mt-2 text-xs text-muted">
              Hits appear here as games are played and archived with full play-by-play feeds.
            </p>
          </div>
        ) : null}
      </div>

      <PlayDetailDialog
        play={detailPlay}
        venueId={data?.park.venueId}
        onClose={() => setDetailPlay(null)}
      />
    </div>
  );
}
