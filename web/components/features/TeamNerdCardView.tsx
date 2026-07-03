"use client";

import Link from "next/link";
import { useMemo } from "react";

import { AppNav } from "@/components/features/AppNav";
import { NerdShareActions } from "@/components/features/NerdShareActions";
import { TeamLogo } from "@/components/ui/TeamLogo";
import { Skeleton } from "@/components/ui/Skeleton";
import { useTeamNerdCard } from "@/hooks/useNerdStats";
import { useRestoreScrollWhenReady } from "@/hooks/useRestoreScrollWhenReady";
import { NERD_STAT_CATEGORIES } from "@/lib/mlb/nerdStats/types";
import { cn } from "@/lib/utils";

const CURRENT_SEASON = new Date().getFullYear();

interface TeamNerdCardViewProps {
  teamId: number;
}

export function TeamNerdCardView({ teamId }: TeamNerdCardViewProps) {
  const { data, isLoading, error } = useTeamNerdCard(teamId, CURRENT_SEASON);

  const grouped = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, typeof data.stats>();
    for (const stat of data.stats) {
      const list = map.get(stat.category) ?? [];
      list.push(stat);
      map.set(stat.category, list);
    }
    return NERD_STAT_CATEGORIES.map((category) => ({
      category,
      stats: map.get(category.id) ?? [],
    })).filter((group) => group.stats.length > 0);
  }, [data]);

  useRestoreScrollWhenReady(!isLoading && grouped.length > 0);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <AppNav />

      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-6">
        <Link href="/nerd" scroll={false} className="text-xs text-muted transition-colors hover:text-foreground">
          ← Nerd Standings
        </Link>

        {isLoading ? (
          <div className="mt-4 space-y-4">
            <Skeleton className="h-10 w-48" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : data ? (
          <>
            <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <TeamLogo teamId={data.teamId} size={48} />
                <div>
                  <h1 className="text-xl font-medium text-foreground">{data.teamName}</h1>
                  <p className="text-sm text-muted">
                    {CURRENT_SEASON} nerd card · where they rank on every weird stat
                  </p>
                </div>
              </div>
              <NerdShareActions
                sharePath={`/nerd/team/${teamId}`}
                shareCardQuery={`teamId=${teamId}&season=${CURRENT_SEASON}`}
                shareTitle={`${data.teamName} Nerd Card`}
              />
            </div>

            <div className="mt-6 space-y-6">
              {grouped.map((group) => (
                <section key={group.category.id}>
                  <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
                    {group.category.label}
                  </h2>
                  <div className="divide-y divide-border rounded-xl border border-border bg-surface">
                    {group.stats.map((stat) => (
                      <Link
                        key={stat.statId}
                        href={`/nerd/${stat.statId}`}
                        className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-hover"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm text-foreground">{stat.title}</p>
                          <p className="text-xs text-muted">Rank #{stat.rank}</p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="font-mono text-sm tabular-nums text-foreground">
                            {stat.displayValue}
                          </p>
                          <RankBadge rank={stat.rank} sort={stat.sort} />
                        </div>
                      </Link>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </>
        ) : null}

        {error && (
          <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

function RankBadge({ rank, sort }: { rank: number; sort: "asc" | "desc" }) {
  const isElite = rank <= 3;
  const isCursed = rank >= 28;
  const label = isElite ? "elite" : isCursed ? "cursed" : null;
  if (!label) return null;

  return (
    <span
      className={cn(
        "text-[10px] uppercase tracking-wide",
        label === "elite" ? "text-emerald-400" : "text-amber-400",
      )}
    >
      {label} {sort === "desc" ? "chaos" : "sus"}
    </span>
  );
}
