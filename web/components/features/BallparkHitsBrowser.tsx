"use client";

import Link from "next/link";

import { AppNav } from "@/components/features/AppNav";
import { GameHitsSprayChart } from "@/components/features/GameHitsSprayChart";
import { TeamLogo } from "@/components/ui/TeamLogo";
import { Skeleton } from "@/components/ui/Skeleton";
import { useBallparkHitsSummary } from "@/hooks/useBallparkHits";
import { HIT_TYPE_LABELS, type GameHit } from "@/lib/mlb/gameHits";
import type { SprayPreviewHit } from "@/lib/mlb/ballparkHits";
import { cn } from "@/lib/utils";

const CURRENT_SEASON = new Date().getFullYear();

export function BallparkHitsBrowser() {
  const { data, isLoading, error } = useBallparkHitsSummary(CURRENT_SEASON);

  const totalHits = data?.indexedHitCount ?? 0;
  const ballparksWithHits = data?.ballparksWithHits ?? 0;

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <AppNav />

      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-6">
        <div className="mb-6">
          <h1 className="text-xl font-medium text-foreground">Ballpark Hits</h1>
          <p className="mt-1 text-sm text-muted">
            Every tracked hit across all 30 MLB ballparks in the {CURRENT_SEASON} season.
          </p>
          {!isLoading && data && (
            <p className="mt-2 text-xs text-subtle">
              {totalHits.toLocaleString()} hit{totalHits === 1 ? "" : "s"} across{" "}
              {ballparksWithHits} ballpark{ballparksWithHits === 1 ? "" : "s"}
              {data.indexedGameCount > 0 && (
                <>
                  {" "}
                  · {data.indexedGameCount.toLocaleString()} game
                  {data.indexedGameCount === 1 ? "" : "s"} indexed
                </>
              )}
              {data.backfillPending && (
                <span className="text-muted">
                  {" "}
                  · Indexing more games — refresh shortly
                </span>
              )}
            </p>
          )}
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {isLoading
            ? Array.from({ length: 9 }).map((_, index) => (
                <div key={index} className="rounded-xl border border-border bg-surface p-4">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="mt-3 aspect-square w-full" />
                  <Skeleton className="mt-3 h-4 w-24" />
                </div>
              ))
            : data?.parks.map((park) => (
                <Link
                  key={park.venueId}
                  href={`/ballparks/${park.venueId}`}
                  className={cn(
                    "group flex flex-col rounded-xl border border-border bg-surface p-4 transition-colors",
                    "hover:border-border-strong hover:bg-surface-elevated",
                  )}
                >
                  <div className="mb-3 flex items-start gap-3">
                    <TeamLogo teamId={park.teamId} size={36} />
                    <div className="min-w-0 flex-1">
                      <h2 className="truncate text-sm font-medium text-foreground group-hover:text-foreground">
                        {park.venueName}
                      </h2>
                      <p className="text-xs text-muted">
                        {park.teamName} · {park.gameCount} game{park.gameCount === 1 ? "" : "s"}
                      </p>
                    </div>
                    <span className="font-mono text-lg font-semibold tabular-nums text-foreground">
                      {park.stats.total}
                    </span>
                  </div>

                  <div className="pointer-events-none">
                    <GameHitsSprayChart
                      hits={park.previewHits as unknown as GameHit[]}
                      venueId={park.venueId}
                      getHitKey={(hit) => (hit as unknown as SprayPreviewHit).hitKey}
                      className="opacity-90"
                    />
                  </div>

                  <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
                    <span className="font-mono tabular-nums">
                      {HIT_TYPE_LABELS.Single} {park.stats.singles}
                    </span>
                    <span className="font-mono tabular-nums">
                      {HIT_TYPE_LABELS.Double} {park.stats.doubles}
                    </span>
                    <span className="font-mono tabular-nums">
                      {HIT_TYPE_LABELS.Triple} {park.stats.triples}
                    </span>
                    <span className="font-mono tabular-nums">
                      {HIT_TYPE_LABELS["Home Run"]} {park.stats.homeRuns}
                    </span>
                  </div>
                </Link>
              ))}
        </div>
      </div>
    </div>
  );
}
