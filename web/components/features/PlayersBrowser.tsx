"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";

import { AppNav } from "@/components/features/AppNav";
import { GameHitsSprayChart } from "@/components/features/GameHitsSprayChart";
import { PlayDetailDialog } from "@/components/features/PlayDetailDialog";
import { PlayerNerdContributionPanel } from "@/components/features/PlayerNerdContributionPanel";
import { TeamLogo } from "@/components/ui/TeamLogo";
import { Skeleton } from "@/components/ui/Skeleton";
import { usePlayerBip, usePlayerSearch } from "@/hooks/usePlayerBip";
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
import type { PlayerBipIndexEntry, PlayerVenueBip } from "@/lib/mlb/playerBip";
import { enrichPlayDetailWithPlayId } from "@/lib/mlb/playVideo";
import { cn, formatInningHalf } from "@/lib/utils";
import type { PlayDetail } from "@/types/mlb-live";

const GameHitsTrajectory3D = dynamic(
  () =>
    import("@/components/features/GameHitsTrajectory3D").then((m) => m.GameHitsTrajectory3D),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[220px] items-center justify-center rounded border border-border bg-field-chart-canvas text-xs text-subtle">
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

function PlayerSearchBox({
  query,
  onQueryChange,
  suggestions,
  isLoading,
  onSelect,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  suggestions: PlayerBipIndexEntry[];
  isLoading: boolean;
  onSelect: (player: PlayerBipIndexEntry) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative w-full max-w-xl">
      <label className="sr-only" htmlFor="player-search">
        Search players
      </label>
      <input
        id="player-search"
        type="search"
        value={query}
        onChange={(e) => {
          onQueryChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          window.setTimeout(() => setOpen(false), 150);
        }}
        placeholder="Search players by name…"
        autoComplete="off"
        className="h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm text-foreground outline-none ring-0 placeholder:text-subtle focus:border-border-strong"
      />
      {open && (suggestions.length > 0 || isLoading || query.trim()) ? (
        <ul className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-border bg-surface shadow-lg">
          {isLoading && suggestions.length === 0 ? (
            <li className="px-3 py-2 text-xs text-muted">Searching…</li>
          ) : null}
          {!isLoading && suggestions.length === 0 && query.trim() ? (
            <li className="px-3 py-2 text-xs text-muted">No players found</li>
          ) : null}
          {suggestions.map((player) => (
            <li key={player.playerId}>
              <button
                type="button"
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-hover"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onSelect(player);
                  setOpen(false);
                }}
              >
                {player.teamId ? <TeamLogo teamId={player.teamId} size={28} /> : null}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-foreground">
                    {player.name}
                  </span>
                  <span className="text-[11px] text-muted">
                    {player.teamAbbrev ?? "—"} · {player.bipCount} BIP · {player.hitCount} hits ·{" "}
                    {player.venueCount} parks
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
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
    let hits = filterBipByFamily(park.chartHits, bipFamily);
    if (bipFamily === "hit" || bipFamily === "all") {
      hits = filterBipByHitType(hits, hitTypeFilter);
    }
    return hits;
  }, [bipFamily, hitTypeFilter, park.chartHits]);

  if (filtered.length === 0) return null;

  const getHitKey = (hit: { hitKey?: string; atBatIndex: number }) =>
    hit.hitKey ?? String(hit.atBatIndex);

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5 sm:px-4">
        <h3 className="text-sm font-medium text-foreground">{park.venueName}</h3>
        <span className="font-mono text-[11px] text-muted">
          {park.teamAbbrev} · {filtered.length} BIP
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
            className="mx-auto w-full max-w-[min(100%,420px)]"
          />
        </div>
        <div className="border-t border-border bg-panel p-3 sm:p-4 lg:border-l lg:border-t-0">
          <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted">
            3D trajectories
          </p>
          <GameHitsTrajectory3D
            hits={filtered}
            venueId={park.venueId}
            getHitKey={getHitKey}
            selectedHitKey={selectedHitKey}
            onSelectHit={onSelectHit}
            className="mx-auto w-full max-w-3xl"
          />
        </div>
      </div>
      <ul className="max-h-56 overflow-y-auto border-t border-border">
        {filterBipByFamily(
          bipFamily === "hit" || bipFamily === "all"
            ? filterBipByHitType(park.hits, hitTypeFilter)
            : park.hits,
          bipFamily,
        ).map((hit) => (
          <li key={hit.hitKey}>
            <button
              type="button"
              onClick={() => onSelectHit(hit)}
              className={cn(
                "flex w-full items-center justify-between gap-2 border-t border-border/50 px-3 py-2 text-left text-[12px] hover:bg-hover first:border-t-0",
                selectedHitKey === hit.hitKey && "bg-overlay",
              )}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: hit.color }}
                  aria-hidden
                />
                <span className="font-mono text-[11px] text-muted">
                  {bipEventLabel(hit.event)}
                </span>
                <span className="truncate text-foreground">
                  {hit.awayAbbrev} {hit.awayScore}–{hit.homeScore} {hit.homeAbbrev}
                </span>
              </span>
              <span className="shrink-0 font-mono text-[10px] text-subtle">
                {hit.gameDate} · {hit.inning} {formatInningHalf(hit.halfInning)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PlayerOverlay({
  playerId,
  onClose,
}: {
  playerId: number;
  onClose: () => void;
}) {
  const { data, isLoading, error, fetchHitDetail } = usePlayerBip(playerId, CURRENT_SEASON);
  const [bipFamily, setBipFamily] = useState<BipFamilyFilter>("all");
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

  const selectedMeta = useMemo(() => {
    if (!selectedHitKey || !data) return null;
    for (const park of data.parks) {
      const hit = park.hits.find((h) => h.hitKey === selectedHitKey);
      if (hit) return { hit, venueId: park.venueId };
    }
    return null;
  }, [data, selectedHitKey]);

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

  const handleSelectHit = useCallback((hit: SprayChartHit & { hitKey?: string }) => {
    const key = hit.hitKey ?? String(hit.atBatIndex);
    setSelectedHitKey((current) => (current === key ? null : key));
  }, []);

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-background/95 backdrop-blur-sm">
      <div className="border-b border-border bg-surface px-4 py-3">
        <div className="mx-auto flex w-full max-w-6xl items-start justify-between gap-3">
          <div className="min-w-0">
            {isLoading || !data ? (
              <Skeleton className="h-7 w-48" />
            ) : (
              <div className="flex items-center gap-3">
                {data.teamId ? <TeamLogo teamId={data.teamId} size={40} /> : null}
                <div>
                  <h2 className="text-lg font-medium text-foreground">{data.name}</h2>
                  <p className="text-xs text-muted">
                    {data.teamAbbrev ?? "—"} · {CURRENT_SEASON} · {data.bipCount} BIP ·{" "}
                    {data.parks.length} parks
                  </p>
                </div>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md border border-border px-3 py-1.5 text-xs text-secondary hover:bg-hover"
          >
            Close
          </button>
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
        {error ? (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
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
            <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-surface px-3 py-3">
              <label className="flex flex-col gap-1 text-[10px] text-muted">
                Result
                <select
                  value={bipFamily}
                  onChange={(e) => {
                    setBipFamily(e.target.value as BipFamilyFilter);
                    setSelectedHitKey(null);
                  }}
                  className="h-8 rounded-md border border-border bg-panel px-2 text-[12px] text-foreground"
                >
                  {BIP_FAMILY_FILTER_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              {(bipFamily === "hit" || bipFamily === "all") && (
                <label className="flex flex-col gap-1 text-[10px] text-muted">
                  Hit type
                  <select
                    value={hitTypeFilter}
                    onChange={(e) => {
                      setHitTypeFilter(e.target.value as HitType | "all");
                      setSelectedHitKey(null);
                    }}
                    className="h-8 rounded-md border border-border bg-panel px-2 text-[12px] text-foreground"
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
              <label className="flex flex-col gap-1 text-[10px] text-muted">
                Park
                <select
                  value={parkFilter === "all" ? "all" : String(parkFilter)}
                  onChange={(e) => {
                    const v = e.target.value;
                    setParkFilter(v === "all" ? "all" : Number.parseInt(v, 10));
                    setSelectedHitKey(null);
                  }}
                  className="h-8 max-w-[220px] rounded-md border border-border bg-panel px-2 text-[12px] text-foreground"
                >
                  <option value="all">All parks</option>
                  {data.parks.map((park) => (
                    <option key={park.venueId} value={park.venueId}>
                      {park.venueName} ({park.stats.total})
                    </option>
                  ))}
                </select>
              </label>
              <p className="pb-1.5 text-[11px] text-subtle">
                Avg EV {fmtNum(data.stats.avgExitVelo)} mph · Hardest{" "}
                {fmtNum(data.stats.maxExitVelo, 0)} mph · Longest{" "}
                {fmtNum(data.stats.maxDistance, 0, " ft")}
              </p>
            </div>

            {selectedMeta ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2.5">
                <p className="text-[13px] text-foreground">
                  {selectedMeta.hit.batterName}
                  <span className="ml-2 font-mono text-[11px] text-muted">
                    {bipEventLabel(selectedMeta.hit.event)}
                  </span>
                  <span className="ml-2 text-[11px] text-muted">{selectedMeta.hit.gameDate}</span>
                </p>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void openHitDetail(selectedMeta.hit.hitKey)}
                    className="text-[11px] font-medium text-secondary underline-offset-2 hover:underline"
                  >
                    Play details
                  </button>
                  <Link
                    href={`/games/${selectedMeta.hit.gamePk}?atBat=${selectedMeta.hit.atBatIndex}&date=${selectedMeta.hit.gameDate}&view=date`}
                    className="text-[11px] font-medium text-secondary underline-offset-2 hover:underline"
                  >
                    View in game
                  </Link>
                  <button
                    type="button"
                    onClick={() => setSelectedHitKey(null)}
                    className="text-[11px] text-muted hover:text-foreground"
                  >
                    Clear
                  </button>
                </div>
              </div>
            ) : null}

            <div className="space-y-4">
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
                let hits: SprayPreviewHit[] = filterBipByFamily(park.chartHits, bipFamily);
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

export function PlayersBrowser() {
  const { query, setQuery, suggestions, isLoading } = usePlayerSearch(CURRENT_SEASON);
  const [selectedPlayerId, setSelectedPlayerId] = useState<number | null>(null);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <AppNav />
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-8">
        <h1 className="text-2xl font-medium text-foreground">Players</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          Search for a batter to see balls in play across every park — spray charts, 3D
          trajectories, play video, and how they contribute to their team&apos;s nerd standings.
        </p>

        <div className="mt-6">
          <PlayerSearchBox
            query={query}
            onQueryChange={setQuery}
            suggestions={suggestions}
            isLoading={isLoading}
            onSelect={(player) => {
              setSelectedPlayerId(player.playerId);
              setQuery(player.name);
            }}
          />
        </div>

        {!selectedPlayerId ? (
          <div className="mt-10 rounded-xl border border-border bg-surface px-6 py-12 text-center">
            <p className="text-sm text-secondary">Start typing a player name to explore season BIP.</p>
            <p className="mt-2 text-xs text-muted">
              Suggestions include season balls in play and parks visited.
            </p>
          </div>
        ) : null}
      </div>

      {selectedPlayerId != null ? (
        <PlayerOverlay
          playerId={selectedPlayerId}
          onClose={() => setSelectedPlayerId(null)}
        />
      ) : null}
    </div>
  );
}
