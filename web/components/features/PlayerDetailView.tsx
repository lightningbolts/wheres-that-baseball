"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AppNav } from "@/components/features/AppNav";
import { GameHitsSprayChart } from "@/components/features/GameHitsSprayChart";
import { PlayDetailDialog } from "@/components/features/PlayDetailDialog";
import { PlayerNerdContributionPanel } from "@/components/features/PlayerNerdContributionPanel";
import { TeamLogo } from "@/components/ui/TeamLogo";
import { Skeleton } from "@/components/ui/Skeleton";
import { usePlayerBip } from "@/hooks/usePlayerBip";
import type { SprayPreviewHit } from "@/lib/mlb/ballparkHits";
import {
  BIP_FAMILY_FILTER_OPTIONS,
  bipEventLabel,
  filterBipByFamily,
  filterBipByHitType,
  HIT_TYPE_LABELS,
  type BipFamilyFilter,
  type HitType,
  type SprayChartHit,
} from "@/lib/mlb/gameHits";
import type { PlayerVenueBip } from "@/lib/mlb/playerBip";
import { enrichPlayDetailWithPlayId } from "@/lib/mlb/playVideo";
import { cn, formatInningHalf } from "@/lib/utils";
import type { PlayDetail } from "@/types/mlb-live";

const GameHitsTrajectory3D = dynamic(
  () =>
    import("@/components/features/GameHitsTrajectory3D").then((m) => m.GameHitsTrajectory3D),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[200px] items-center justify-center rounded border border-border bg-field-chart-canvas text-xs text-subtle sm:h-[220px]">
        Loading trajectories…
      </div>
    ),
  },
);

const CURRENT_SEASON = new Date().getFullYear();
const HIT_TYPES: HitType[] = ["Single", "Double", "Triple", "Home Run"];

function fmtNum(value: number | null, digits = 1, suffix = ""): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${value.toFixed(digits)}${suffix}`;
}

function LazyParkTrajectory3D({
  hits,
  venueId,
  getHitKey,
  selectedHitKey,
  onSelectHit,
}: {
  hits: SprayPreviewHit[];
  venueId: number;
  getHitKey: (hit: { hitKey?: string; atBatIndex: number }) => string;
  selectedHitKey: string | null;
  onSelectHit: (hit: SprayChartHit & { hitKey?: string }) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: "120px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={rootRef} className="border-t border-border bg-panel p-3 sm:p-4 lg:border-l lg:border-t-0">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted">
          3D trajectories
        </p>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="rounded-md border border-border px-2 py-1 text-[11px] text-secondary hover:bg-hover lg:hidden"
        >
          {expanded ? "Hide 3D" : "Show 3D"}
        </button>
      </div>

      {/* Desktop: load when near viewport. Mobile: only after explicit expand. */}
      <div className="hidden lg:block">
        {inView ? (
          <GameHitsTrajectory3D
            hits={hits}
            venueId={venueId}
            getHitKey={getHitKey}
            selectedHitKey={selectedHitKey}
            onSelectHit={onSelectHit}
            className="mx-auto w-full max-w-3xl"
          />
        ) : (
          <div className="flex h-[220px] items-center justify-center rounded border border-border bg-field-chart-canvas text-xs text-subtle">
            Scroll to load 3D…
          </div>
        )}
      </div>

      <div className="lg:hidden">
        {expanded ? (
          <GameHitsTrajectory3D
            hits={hits}
            venueId={venueId}
            getHitKey={getHitKey}
            selectedHitKey={selectedHitKey}
            onSelectHit={onSelectHit}
            className="mx-auto w-full"
          />
        ) : (
          <p className="rounded border border-border bg-field-chart-canvas px-3 py-6 text-center text-[11px] text-subtle">
            Tap Show 3D to load trajectories for this park.
          </p>
        )}
      </div>
    </div>
  );
}

function ParkBipSection({
  park,
  bipFamily,
  hitTypeFilter,
  selectedHitKey,
  onSelectHit,
}: {
  park: PlayerVenueBip;
  bipFamily: BipFamilyFilter;
  hitTypeFilter: HitType | "all";
  selectedHitKey: string | null;
  onSelectHit: (hit: SprayChartHit & { hitKey?: string }) => void;
}) {
  const filtered = useMemo(() => {
    const chartSource = park.chartHits?.length ? park.chartHits : park.hits;
    let hits = filterBipByFamily(chartSource, bipFamily);
    if (bipFamily === "hit" || bipFamily === "all") {
      hits = filterBipByHitType(hits, hitTypeFilter);
    }
    return hits;
  }, [bipFamily, hitTypeFilter, park.chartHits, park.hits]);

  if (filtered.length === 0) return null;

  const getHitKey = (hit: { hitKey?: string; atBatIndex: number }) =>
    hit.hitKey ?? String(hit.atBatIndex);

  const listHits = filterBipByFamily(
    bipFamily === "hit" || bipFamily === "all"
      ? filterBipByHitType(park.hits, hitTypeFilter)
      : park.hits,
    bipFamily,
  );

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 border-b border-border px-3 py-2.5 sm:px-4">
        <h3 className="min-w-0 text-sm font-medium text-foreground">{park.venueName}</h3>
        <span className="shrink-0 font-mono text-[11px] text-muted">
          {park.teamAbbrev} · {filtered.length}
        </span>
      </div>
      <div className="grid gap-0 lg:grid-cols-2">
        <div className="bg-panel p-3 sm:p-4">
          <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted">
            Spray chart
          </p>
          <GameHitsSprayChart
            hits={filtered}
            venueId={park.venueId}
            getHitKey={getHitKey}
            selectedHitKey={selectedHitKey}
            onSelectHit={onSelectHit}
            showLines={false}
            ballRadius={1.2}
            className="mx-auto w-full max-w-[min(100%,360px)] sm:max-w-[min(100%,420px)]"
          />
        </div>
        <LazyParkTrajectory3D
          hits={filtered}
          venueId={park.venueId}
          getHitKey={getHitKey}
          selectedHitKey={selectedHitKey}
          onSelectHit={onSelectHit}
        />
      </div>
      <ul className="max-h-52 overflow-y-auto overscroll-y-contain border-t border-border sm:max-h-56">
        {listHits.map((hit) => (
          <li key={hit.hitKey}>
            <button
              type="button"
              onClick={() => onSelectHit(hit)}
              className={cn(
                "flex w-full flex-col gap-0.5 border-t border-border/50 px-3 py-2.5 text-left text-[12px] hover:bg-hover first:border-t-0 sm:flex-row sm:items-center sm:justify-between sm:gap-2 sm:py-2",
                selectedHitKey === hit.hitKey && "bg-overlay",
              )}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: hit.color }}
                  aria-hidden
                />
                <span className="shrink-0 font-mono text-[11px] text-muted">
                  {bipEventLabel(hit.event)}
                </span>
                <span className="truncate text-foreground">
                  {hit.awayAbbrev} {hit.awayScore}–{hit.homeScore} {hit.homeAbbrev}
                </span>
              </span>
              <span className="pl-4 font-mono text-[10px] text-subtle sm:pl-0 sm:shrink-0">
                {hit.gameDate} · {hit.inning} {formatInningHalf(hit.halfInning)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

interface PlayerDetailViewProps {
  playerId: number;
}

export function PlayerDetailView({ playerId }: PlayerDetailViewProps) {
  const { data, isLoading, error, fetchHitDetail } = usePlayerBip(playerId, CURRENT_SEASON);
  const [bipFamily, setBipFamily] = useState<BipFamilyFilter>("hit");
  const [hitTypeFilter, setHitTypeFilter] = useState<HitType | "all">("all");
  const [parkFilter, setParkFilter] = useState<number | "all">("all");
  const [selectedHitKey, setSelectedHitKey] = useState<string | null>(null);
  const [detailPlay, setDetailPlay] = useState<PlayDetail | null>(null);
  const [detailGamePk, setDetailGamePk] = useState<number | null>(null);
  const [detailGameDate, setDetailGameDate] = useState<string | null>(null);
  const [detailVenueId, setDetailVenueId] = useState<number | null>(null);
  const detailRequestRef = useRef(0);

  const parks = useMemo(() => {
    if (!data) return [];
    if (parkFilter === "all") return data.parks;
    return data.parks.filter((p) => p.venueId === parkFilter);
  }, [data, parkFilter]);

  const openHitDetail = useCallback(
    async (hitKey: string) => {
      const requestId = ++detailRequestRef.current;
      const hit = await fetchHitDetail(hitKey);
      if (requestId !== detailRequestRef.current || !hit?.detail) return;

      const withExisting =
        hit.detail.playId || !hit.playId
          ? hit.detail
          : { ...hit.detail, playId: hit.playId };

      const enriched = await enrichPlayDetailWithPlayId(
        withExisting,
        hit.gamePk,
        hit.atBatIndex,
      );
      if (requestId !== detailRequestRef.current) return;

      setDetailGamePk(hit.gamePk ?? null);
      setDetailGameDate(hit.gameDate ?? null);
      setDetailVenueId(
        data?.parks.find((p) => p.hits.some((h) => h.hitKey === hitKey))?.venueId ?? null,
      );
      setDetailPlay(enriched);
    },
    [data?.parks, fetchHitDetail],
  );

  const handleSelectHit = useCallback(
    (hit: SprayChartHit & { hitKey?: string }) => {
      const key = "hitKey" in hit && hit.hitKey ? hit.hitKey : String(hit.atBatIndex);
      setSelectedHitKey(key);
      void openHitDetail(key);
    },
    [openHitDetail],
  );

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <AppNav />

      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-3 px-3 py-4 sm:gap-4 sm:px-4 sm:py-6">
        <div>
          <Link
            href="/players"
            scroll={false}
            className="text-xs text-muted transition-colors hover:text-foreground"
          >
            ← All players
          </Link>

          {isLoading || !data ? (
            <div className="mt-3">
              <Skeleton className="h-7 w-48" />
              <Skeleton className="mt-2 h-4 w-56" />
            </div>
          ) : (
            <div className="mt-3 flex items-start gap-2.5 sm:items-center sm:gap-3">
              {data.teamId ? <TeamLogo teamId={data.teamId} size={40} className="sm:hidden" /> : null}
              {data.teamId ? (
                <TeamLogo teamId={data.teamId} size={44} className="hidden sm:block" />
              ) : null}
              <div className="min-w-0">
                <h1 className="truncate text-lg font-medium text-foreground sm:text-xl">
                  {data.name}
                </h1>
                <p className="mt-0.5 text-[12px] text-muted sm:mt-1 sm:text-sm">
                  {data.teamAbbrev ?? "—"} · {CURRENT_SEASON} · {data.bipCount} BIP ·{" "}
                  {data.parks.length} parks
                </p>
              </div>
            </div>
          )}
        </div>

        {error ? (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-3 text-sm text-red-400 sm:px-4">
            {error}
          </div>
        ) : null}

        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : data ? (
          <>
            <div className="rounded-xl border border-border bg-surface px-3 py-3">
              <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-end sm:gap-3">
                <label className="flex min-w-0 flex-col gap-1 text-[10px] text-muted">
                  Result
                  <select
                    value={bipFamily}
                    onChange={(e) => {
                      setBipFamily(e.target.value as BipFamilyFilter);
                      setSelectedHitKey(null);
                    }}
                    className="h-9 w-full rounded-md border border-border bg-panel px-2 text-[12px] text-foreground sm:h-8 sm:w-auto"
                  >
                    {BIP_FAMILY_FILTER_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
                {(bipFamily === "hit" || bipFamily === "all") && (
                  <label className="flex min-w-0 flex-col gap-1 text-[10px] text-muted">
                    Hit type
                    <select
                      value={hitTypeFilter}
                      onChange={(e) => {
                        setHitTypeFilter(e.target.value as HitType | "all");
                        setSelectedHitKey(null);
                      }}
                      className="h-9 w-full rounded-md border border-border bg-panel px-2 text-[12px] text-foreground sm:h-8 sm:w-auto"
                    >
                      <option value="all">All hits</option>
                      {HIT_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {HIT_TYPE_LABELS[type]}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="col-span-2 flex min-w-0 flex-col gap-1 text-[10px] text-muted sm:col-span-1">
                  Park
                  <select
                    value={parkFilter === "all" ? "all" : String(parkFilter)}
                    onChange={(e) => {
                      const v = e.target.value;
                      setParkFilter(v === "all" ? "all" : Number.parseInt(v, 10));
                      setSelectedHitKey(null);
                    }}
                    className="h-9 w-full rounded-md border border-border bg-panel px-2 text-[12px] text-foreground sm:h-8 sm:max-w-[220px]"
                  >
                    <option value="all">All parks</option>
                    {data.parks.map((park) => (
                      <option key={park.venueId} value={park.venueId}>
                        {park.venueName} ({park.stats.total})
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="mt-2.5 text-[11px] leading-relaxed text-subtle sm:mt-3">
                Avg EV {fmtNum(data.stats.avgExitVelo)} mph · Hardest{" "}
                {fmtNum(data.stats.maxExitVelo, 0)} mph · Longest{" "}
                {fmtNum(data.stats.maxDistance, 0, " ft")}
              </p>
            </div>

            <div className="space-y-3 sm:space-y-4">
              {parks.map((park) => (
                <ParkBipSection
                  key={park.venueId}
                  park={park}
                  bipFamily={bipFamily}
                  hitTypeFilter={hitTypeFilter}
                  selectedHitKey={selectedHitKey}
                  onSelectHit={handleSelectHit}
                />
              ))}
              {parks.every((park) => {
                const chartSource = park.chartHits?.length ? park.chartHits : park.hits;
                let hits: SprayPreviewHit[] = filterBipByFamily(chartSource, bipFamily);
                if (bipFamily === "hit" || bipFamily === "all") {
                  hits = filterBipByHitType(hits, hitTypeFilter);
                }
                return hits.length === 0;
              }) ? (
                <p className="py-8 text-center text-sm text-muted">
                  No balls in play match these filters.
                </p>
              ) : null}
            </div>

            <PlayerNerdContributionPanel playerId={playerId} season={CURRENT_SEASON} />
          </>
        ) : null}
      </div>

      <PlayDetailDialog
        play={detailPlay}
        venueId={detailVenueId}
        gamePk={detailGamePk}
        gameDate={detailGameDate}
        onClose={() => {
          detailRequestRef.current += 1;
          setDetailPlay(null);
          setDetailGamePk(null);
          setDetailGameDate(null);
          setDetailVenueId(null);
        }}
      />
    </div>
  );
}
