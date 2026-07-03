"use client";

import Link from "next/link";

import { TeamLogo } from "@/components/ui/TeamLogo";
import { saveReturnScrollPosition, saveScrollPosition } from "@/lib/scrollRestoration";
import type { NerdStatLeaderboard } from "@/lib/mlb/nerdStats/types";
import { cn } from "@/lib/utils";

interface NerdStatCardProps {
  stat: NerdStatLeaderboard;
  season: number;
  highlighted?: boolean;
  className?: string;
}

export function NerdStatCard({ stat, season, highlighted, className }: NerdStatCardProps) {
  const allZero =
    stat.leaders.length > 0 && stat.leaders.every((leader) => leader.value === 0);
  const emptyMessage =
    stat.id.includes("triple-play") && allZero
      ? "No triple plays yet this season"
      : allZero
        ? "No events recorded yet"
        : null;

  return (
    <Link
      href={`/nerd/${stat.id}`}
      scroll={false}
      onClick={() => {
        const path = window.location.pathname;
        const query = window.location.search.replace(/^\?/, "");
        const y = window.scrollY;
        saveScrollPosition(query ? `${path}?${query}` : path, y);
        saveReturnScrollPosition(path, y, query);
      }}
      className={cn(
        "group flex flex-col rounded-xl border bg-surface p-4 transition-colors",
        highlighted
          ? "border-secondary/40 ring-1 ring-secondary/20"
          : "border-border hover:border-border-strong hover:bg-surface-elevated",
        className,
      )}
    >
      <div className="mb-1 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted">
            {stat.category}
          </p>
          <h2 className="mt-0.5 text-sm font-medium text-foreground group-hover:text-foreground">
            {stat.title}
          </h2>
        </div>
        {highlighted && (
          <span className="shrink-0 rounded bg-secondary/15 px-1.5 py-0.5 text-[10px] font-medium text-secondary">
            Today
          </span>
        )}
      </div>
      <p className="mb-3 line-clamp-2 text-xs text-muted">{stat.subtitle}</p>

      <ol className="space-y-2">
        {stat.leaders.length === 0 || emptyMessage ? (
          <li className="text-xs text-subtle">{emptyMessage ?? "No data yet"}</li>
        ) : (
          stat.leaders.map((leader) => (
            <li key={leader.teamId} className="flex items-center gap-2">
              <span className="w-4 shrink-0 font-mono text-[10px] tabular-nums text-subtle">
                {leader.rank}
              </span>
              <TeamLogo teamId={leader.teamId} size={20} />
              <span className="min-w-0 flex-1 truncate text-xs text-foreground">
                {leader.abbrev}
              </span>
              <span className="shrink-0 font-mono text-xs tabular-nums text-foreground">
                {leader.displayValue}
              </span>
            </li>
          ))
        )}
      </ol>

      {stat.leagueAverageDisplay && (
        <p className="mt-3 text-[10px] text-subtle">
          League avg: {stat.leagueAverageDisplay}
        </p>
      )}

      <span className="mt-3 text-[11px] text-muted group-hover:text-secondary">
        Full leaderboard →
      </span>
    </Link>
  );
}
