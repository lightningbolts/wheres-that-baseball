"use client";

import Link from "next/link";
import { useCallback, useState } from "react";

import { AppNav } from "@/components/features/AppNav";
import { TeamLogo } from "@/components/ui/TeamLogo";
import { Skeleton } from "@/components/ui/Skeleton";
import { useNerdStatDetail } from "@/hooks/useNerdStats";
import { NERD_STAT_CATEGORIES } from "@/lib/mlb/nerdStats/types";
import { cn } from "@/lib/utils";

const CURRENT_SEASON = new Date().getFullYear();

interface NerdStatDetailViewProps {
  statId: string;
}

export function NerdStatDetailView({ statId }: NerdStatDetailViewProps) {
  const { data, isLoading, error } = useNerdStatDetail(statId, CURRENT_SEASON);
  const [copied, setCopied] = useState(false);

  const shareUrl = typeof window !== "undefined" ? `${window.location.origin}/nerd/${statId}` : "";

  const copyLink = useCallback(async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }, [shareUrl]);

  const categoryLabel =
    NERD_STAT_CATEGORIES.find((item) => item.id === data?.stat.category)?.label ??
    data?.stat.category;

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <AppNav />

      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-6">
        <Link href="/nerd" scroll={false} className="text-xs text-muted transition-colors hover:text-foreground">
          ← Nerd Standings
        </Link>

        {isLoading ? (
          <div className="mt-4 space-y-4">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-full max-w-lg" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : data ? (
          <>
            <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted">
                  {categoryLabel}
                </p>
                <h1 className="mt-1 text-xl font-medium text-foreground">{data.stat.title}</h1>
                <p className="mt-2 max-w-2xl text-sm text-muted">{data.stat.subtitle}</p>
                {data.stat.formula && (
                  <p className="mt-2 max-w-2xl rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs text-secondary">
                    How it&apos;s calculated: {data.stat.formula}
                  </p>
                )}
                {data.stat.leagueAverageDisplay && (
                  <p className="mt-2 text-xs text-subtle">
                    League average: {data.stat.leagueAverageDisplay}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => void copyLink()}
                className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs text-secondary hover:bg-hover"
              >
                {copied ? "Copied!" : "Copy link"}
              </button>
            </div>

            <div className="mt-6 overflow-hidden rounded-xl border border-border">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border bg-surface-elevated text-xs text-muted">
                  <tr>
                    <th className="px-4 py-2 font-medium">#</th>
                    <th className="px-4 py-2 font-medium">Team</th>
                    <th className="px-4 py-2 text-right font-medium">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {data.allTeams.map((leader) => (
                    <tr
                      key={leader.teamId}
                      className={cn(
                        "border-b border-border/50 last:border-0",
                        leader.rank <= 3 && "bg-surface/50",
                      )}
                    >
                      <td className="px-4 py-2.5 font-mono text-xs tabular-nums text-subtle">
                        {leader.rank}
                      </td>
                      <td className="px-4 py-2.5">
                        <Link
                          href={`/nerd/team/${leader.teamId}`}
                          className="flex items-center gap-2 hover:text-secondary"
                        >
                          <TeamLogo teamId={leader.teamId} size={24} />
                          <span>{leader.teamName}</span>
                          <span className="font-mono text-xs text-muted">{leader.abbrev}</span>
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                        {leader.displayValue}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {data.notableEvents.length > 0 && (
              <section className="mt-8">
                <h2 className="text-sm font-medium text-foreground">Notable plays</h2>
                <ul className="mt-3 divide-y divide-border rounded-xl border border-border bg-surface">
                  {data.notableEvents.map((event, index) => (
                    <li key={`${event.gamePk}-${index}`}>
                      <Link
                        href={`/games/${event.gamePk}`}
                        className="flex flex-col gap-1 px-4 py-3 transition-colors hover:bg-hover sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div>
                          <p className="text-sm text-foreground">{event.label}</p>
                          {event.detail && (
                            <p className="text-xs text-muted">{event.detail}</p>
                          )}
                        </div>
                        <span className="shrink-0 text-xs text-subtle">{event.gameDate}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
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
