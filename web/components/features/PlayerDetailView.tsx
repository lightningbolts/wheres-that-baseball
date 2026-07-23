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
import {
  usePlayerBip,
  usePlayerPitchBip,
  usePlayerPitchingLine,
} from "@/hooks/usePlayerBip";
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
import type { PlayerBipDetail, PlayerVenueBip } from "@/lib/mlb/playerBip";
import type { PlayerPitchingResponse } from "@/lib/mlb/playerCache";
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

type ProfileMode = "hitting" | "pitching";

function fmtNum(value: number | null, digits = 1, suffix = ""): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${value.toFixed(digits)}${suffix}`;
}

function fmtStat(value: number | string | null | undefined): string {
  if (value == null || value === "") return "—";
  return String(value);
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
                  {hit.batterName ? ` · ${hit.batterName}` : ""}
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

function PitchingSummaryPanel({ line }: { line: PlayerPitchingResponse }) {
  const hasMlbLine = line.source === "mlb";
  const mix = line.pitchMix;

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border bg-surface px-3 py-3 sm:px-4">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted">
          Season pitching
          {line.throwHand ? ` · ${line.throwHand}` : ""}
        </p>
        {hasMlbLine ? (
          <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6 sm:gap-3">
            {[
              {
                label: "W-L",
                value: `${fmtStat(line.wins)}-${fmtStat(line.losses)}`,
              },
              { label: "ERA", value: fmtStat(line.era) },
              { label: "IP", value: fmtStat(line.inningsPitched) },
              { label: "SO", value: fmtStat(line.strikeOuts) },
              { label: "BB", value: fmtStat(line.baseOnBalls) },
              { label: "HR", value: fmtStat(line.homeRuns) },
              { label: "WHIP", value: fmtStat(line.whip) },
              { label: "H", value: fmtStat(line.hits) },
              { label: "G", value: fmtStat(line.gamesPlayed) },
              { label: "GS", value: fmtStat(line.gamesStarted) },
            ].map((stat) => (
              <div key={stat.label} className="min-w-0">
                <p className="text-[10px] uppercase tracking-wide text-subtle">{stat.label}</p>
                <p className="font-mono text-sm text-foreground">{stat.value}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-[12px] text-muted">
            No official MLB pitching line for this season yet.
          </p>
        )}
      </div>

      {mix.pitches.length > 0 ? (
        <div className="rounded-xl border border-border bg-surface px-3 py-3 sm:px-4">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted">
            Pitch mix · {mix.totalPitches} pitches
          </p>
          <ul className="mt-3 space-y-2">
            {mix.pitches.map((pitch) => (
              <li key={pitch.code}>
                <div className="mb-1 flex items-baseline justify-between gap-2 text-[12px]">
                  <span className="text-foreground">{pitch.label}</span>
                  <span className="font-mono text-[11px] text-muted">
                    {(pitch.pct * 100).toFixed(1)}% · {pitch.count}
                    {pitch.avgVelocity != null
                      ? ` · ${pitch.avgVelocity.toFixed(1)} mph`
                      : ""}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-panel">
                  <div
                    className="h-full rounded-full bg-foreground/70"
                    style={{ width: `${Math.max(pitch.pct * 100, 1.5)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function BipExplorer({
  data,
  bipLabel,
  bipFamily,
  setBipFamily,
  hitTypeFilter,
  setHitTypeFilter,
  parkFilter,
  setParkFilter,
  selectedHitKey,
  onSelectHit,
}: {
  data: PlayerBipDetail;
  bipLabel: string;
  bipFamily: BipFamilyFilter;
  setBipFamily: (value: BipFamilyFilter) => void;
  hitTypeFilter: HitType | "all";
  setHitTypeFilter: (value: HitType | "all") => void;
  parkFilter: number | "all";
  setParkFilter: (value: number | "all") => void;
  selectedHitKey: string | null;
  onSelectHit: (hit: SprayChartHit & { hitKey?: string }) => void;
}) {
  const parks = useMemo(() => {
    if (parkFilter === "all") return data.parks;
    return data.parks.filter((p) => p.venueId === parkFilter);
  }, [data.parks, parkFilter]);

  return (
    <>
      <div className="rounded-xl border border-border bg-surface px-3 py-3">
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-end sm:gap-3">
          <label className="flex min-w-0 flex-col gap-1 text-[10px] text-muted">
            Result
            <select
              value={bipFamily}
              onChange={(e) => {
                setBipFamily(e.target.value as BipFamilyFilter);
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
          {bipLabel}: Avg EV {fmtNum(data.stats.avgExitVelo)} mph · Hardest{" "}
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
            onSelectHit={onSelectHit}
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
    </>
  );
}

interface PlayerDetailViewProps {
  playerId: number;
}

export function PlayerDetailView({ playerId }: PlayerDetailViewProps) {
  const batting = usePlayerBip(playerId, CURRENT_SEASON);
  const pitchingBip = usePlayerPitchBip(playerId, CURRENT_SEASON);
  const pitchingLine = usePlayerPitchingLine(playerId, CURRENT_SEASON);

  const hasHitting = Boolean(batting.data && batting.data.bipCount > 0);
  const hasPitchingBip = Boolean(pitchingBip.data && pitchingBip.data.bipCount > 0);
  const hasPitchingLine =
    pitchingLine.data?.source === "mlb" ||
    (pitchingLine.data?.nerdPitchesThrown ?? 0) > 0 ||
    (pitchingLine.data?.pitchMix.totalPitches ?? 0) > 0;
  const hasPitching = hasPitchingBip || hasPitchingLine;

  const [mode, setMode] = useState<ProfileMode>("hitting");
  const [modeReady, setModeReady] = useState(false);

  useEffect(() => {
    if (modeReady) return;
    if (batting.isLoading || pitchingBip.isLoading || pitchingLine.isLoading) return;
    if (hasHitting && hasPitching) {
      setMode("hitting");
    } else if (hasPitching) {
      setMode("pitching");
    } else {
      setMode("hitting");
    }
    setModeReady(true);
  }, [
    batting.isLoading,
    hasHitting,
    hasPitching,
    modeReady,
    pitchingBip.isLoading,
    pitchingLine.isLoading,
  ]);

  const activeData = mode === "pitching" ? pitchingBip.data : batting.data;
  const activeFetchHitDetail =
    mode === "pitching" ? pitchingBip.fetchHitDetail : batting.fetchHitDetail;
  const isLoading =
    batting.isLoading || pitchingBip.isLoading || pitchingLine.isLoading || !modeReady;
  const error = mode === "pitching" ? pitchingBip.error || pitchingLine.error : batting.error;

  const displayName =
    activeData?.name ||
    pitchingLine.data?.name ||
    batting.data?.name ||
    pitchingBip.data?.name ||
    `Player ${playerId}`;
  const displayTeamId =
    activeData?.teamId ?? batting.data?.teamId ?? pitchingBip.data?.teamId ?? null;
  const displayTeamAbbrev =
    activeData?.teamAbbrev ?? batting.data?.teamAbbrev ?? pitchingBip.data?.teamAbbrev ?? null;

  const [bipFamily, setBipFamily] = useState<BipFamilyFilter>("hit");
  const [hitTypeFilter, setHitTypeFilter] = useState<HitType | "all">("all");
  const [parkFilter, setParkFilter] = useState<number | "all">("all");
  const [selectedHitKey, setSelectedHitKey] = useState<string | null>(null);
  const [detailPlay, setDetailPlay] = useState<PlayDetail | null>(null);
  const [detailGamePk, setDetailGamePk] = useState<number | null>(null);
  const [detailGameDate, setDetailGameDate] = useState<string | null>(null);
  const [detailVenueId, setDetailVenueId] = useState<number | null>(null);
  const detailRequestRef = useRef(0);

  useEffect(() => {
    setBipFamily("hit");
    setHitTypeFilter("all");
    setParkFilter("all");
    setSelectedHitKey(null);
  }, [mode]);

  const openHitDetail = useCallback(
    async (hitKey: string) => {
      const requestId = ++detailRequestRef.current;
      const hit = await activeFetchHitDetail(hitKey);
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
        activeData?.parks.find((p) => p.hits.some((h) => h.hitKey === hitKey))?.venueId ?? null,
      );
      setDetailPlay(enriched);
    },
    [activeData?.parks, activeFetchHitDetail],
  );

  const handleSelectHit = useCallback(
    (hit: SprayChartHit & { hitKey?: string }) => {
      const key = "hitKey" in hit && hit.hitKey ? hit.hitKey : String(hit.atBatIndex);
      setSelectedHitKey(key);
      void openHitDetail(key);
    },
    [openHitDetail],
  );

  const showTwoWayTabs = hasHitting && hasPitching;

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

          {isLoading && !activeData && !pitchingLine.data ? (
            <div className="mt-3">
              <Skeleton className="h-7 w-48" />
              <Skeleton className="mt-2 h-4 w-56" />
            </div>
          ) : (
            <div className="mt-3 flex items-start gap-2.5 sm:items-center sm:gap-3">
              {displayTeamId ? (
                <TeamLogo teamId={displayTeamId} size={40} className="sm:hidden" />
              ) : null}
              {displayTeamId ? (
                <TeamLogo teamId={displayTeamId} size={44} className="hidden sm:block" />
              ) : null}
              <div className="min-w-0">
                <h1 className="truncate text-lg font-medium text-foreground sm:text-xl">
                  {displayName}
                </h1>
                <p className="mt-0.5 text-[12px] text-muted sm:mt-1 sm:text-sm">
                  {displayTeamAbbrev ?? "—"} · {CURRENT_SEASON}
                  {mode === "pitching"
                    ? ` · ${pitchingBip.data?.bipCount ?? 0} BIP allowed · ${
                        pitchingBip.data?.parks.length ?? 0
                      } parks`
                    : ` · ${batting.data?.bipCount ?? 0} BIP · ${batting.data?.parks.length ?? 0} parks`}
                </p>
              </div>
            </div>
          )}
        </div>

        {showTwoWayTabs ? (
          <div className="flex gap-1 rounded-lg border border-border bg-surface p-1">
            {(
              [
                { id: "hitting" as const, label: "Hitting" },
                { id: "pitching" as const, label: "Pitching" },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setMode(tab.id)}
                className={cn(
                  "flex-1 rounded-md px-3 py-2 text-[12px] font-medium transition-colors",
                  mode === tab.id
                    ? "bg-panel text-foreground"
                    : "text-muted hover:text-foreground",
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        ) : null}

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
        ) : mode === "pitching" ? (
          <>
            {pitchingLine.data ? <PitchingSummaryPanel line={pitchingLine.data} /> : null}
            {pitchingBip.data ? (
              <BipExplorer
                data={pitchingBip.data}
                bipLabel="BIP allowed"
                bipFamily={bipFamily}
                setBipFamily={(v) => {
                  setBipFamily(v);
                  setSelectedHitKey(null);
                }}
                hitTypeFilter={hitTypeFilter}
                setHitTypeFilter={(v) => {
                  setHitTypeFilter(v);
                  setSelectedHitKey(null);
                }}
                parkFilter={parkFilter}
                setParkFilter={(v) => {
                  setParkFilter(v);
                  setSelectedHitKey(null);
                }}
                selectedHitKey={selectedHitKey}
                onSelectHit={handleSelectHit}
              />
            ) : (
              <p className="py-6 text-center text-sm text-muted">
                No balls in play allowed indexed for this pitcher yet.
              </p>
            )}
            <PlayerNerdContributionPanel playerId={playerId} season={CURRENT_SEASON} />
          </>
        ) : batting.data ? (
          <>
            <BipExplorer
              data={batting.data}
              bipLabel="BIP"
              bipFamily={bipFamily}
              setBipFamily={(v) => {
                setBipFamily(v);
                setSelectedHitKey(null);
              }}
              hitTypeFilter={hitTypeFilter}
              setHitTypeFilter={(v) => {
                setHitTypeFilter(v);
                setSelectedHitKey(null);
              }}
              parkFilter={parkFilter}
              setParkFilter={(v) => {
                setParkFilter(v);
                setSelectedHitKey(null);
              }}
              selectedHitKey={selectedHitKey}
              onSelectHit={handleSelectHit}
            />
            <PlayerNerdContributionPanel playerId={playerId} season={CURRENT_SEASON} />
          </>
        ) : hasPitching ? (
          <p className="py-6 text-center text-sm text-muted">
            No batting BIP for this player — switch to pitching if available.
          </p>
        ) : (
          <p className="py-6 text-center text-sm text-muted">Player profile not found.</p>
        )}
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
