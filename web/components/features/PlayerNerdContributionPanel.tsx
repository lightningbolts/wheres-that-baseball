"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Skeleton } from "@/components/ui/Skeleton";
import { usePlayerNerd } from "@/hooks/usePlayerBip";
import {
  NERD_STAT_CATEGORIES,
  type NerdStatCategory,
  type PlayerNerdStatContribution,
} from "@/lib/mlb/nerdStats/types";
import { cn } from "@/lib/utils";

function formatShare(share: number | null): string {
  if (share == null || !Number.isFinite(share)) return "—";
  return `${(share * 100).toFixed(1)}%`;
}

function formatActions(row: PlayerNerdStatContribution): string {
  if (row.playerActions != null && row.teamActions != null) {
    return `${row.playerActions}/${row.teamActions}`;
  }
  if (row.playerActions != null) return String(row.playerActions);
  return "—";
}

function NerdStatCard({ row }: { row: PlayerNerdStatContribution }) {
  return (
    <li className="border-b border-border/60 px-3 py-3 last:border-b-0">
      <Link
        href={`/nerd/${row.statId}`}
        className="text-[13px] font-medium text-foreground underline-offset-2 hover:underline"
      >
        {row.title}
      </Link>
      <p className="mt-0.5 line-clamp-2 text-[10px] text-subtle">{row.subtitle}</p>
      <dl className="mt-2 grid grid-cols-4 gap-2 text-center">
        <div>
          <dt className="text-[9px] uppercase tracking-wide text-muted">Player</dt>
          <dd className="mt-0.5 font-mono text-[12px] tabular-nums text-foreground">
            {row.playerDisplay}
          </dd>
        </div>
        <div>
          <dt className="text-[9px] uppercase tracking-wide text-muted">Team</dt>
          <dd className="mt-0.5 font-mono text-[12px] tabular-nums text-muted">
            {row.teamDisplay}
          </dd>
        </div>
        <div>
          <dt className="text-[9px] uppercase tracking-wide text-muted">Share</dt>
          <dd className="mt-0.5 font-mono text-[12px] tabular-nums text-muted">
            {formatShare(row.shareOfTeam)}
          </dd>
        </div>
        <div>
          <dt className="text-[9px] uppercase tracking-wide text-muted">Acts</dt>
          <dd className="mt-0.5 font-mono text-[12px] tabular-nums text-subtle">
            {formatActions(row)}
          </dd>
        </div>
      </dl>
    </li>
  );
}

export function PlayerNerdContributionPanel({
  playerId,
  season,
}: {
  playerId: number;
  season: number;
}) {
  const { data: card, isLoading, error } = usePlayerNerd(playerId, season);
  const [category, setCategory] = useState<NerdStatCategory | "all">("all");

  const rows = useMemo(() => {
    if (!card) return [];
    if (category === "all") return card.contributions;
    return card.contributions.filter((c) => c.category === category);
  }, [card, category]);

  return (
    <section className="rounded-xl border border-border bg-surface">
      <div className="border-b border-border px-3 py-3 sm:px-4">
        <h3 className="text-sm font-medium text-foreground">Nerd standings contribution</h3>
        <p className="mt-1 text-[11px] text-muted">
          How this player relates to {card?.teamAbbrev ?? "team"} nerd stats — values, share of
          team actions, and counts.
        </p>
        <div className="-mx-3 mt-3 flex gap-1.5 overflow-x-auto px-3 pb-0.5 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
          <button
            type="button"
            onClick={() => setCategory("all")}
            className={cn(
              "shrink-0 rounded-md border px-2.5 py-1.5 text-[11px] sm:py-1",
              category === "all"
                ? "border-border-strong bg-panel text-foreground"
                : "border-border text-muted hover:bg-hover",
            )}
          >
            All
          </button>
          {NERD_STAT_CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setCategory(cat.id)}
              className={cn(
                "shrink-0 rounded-md border px-2.5 py-1.5 text-[11px] sm:py-1",
                category === cat.id
                  ? "border-border-strong bg-panel text-foreground"
                  : "border-border text-muted hover:bg-hover",
              )}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2 p-4">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : error ? (
        <p className="px-4 py-6 text-center text-xs text-muted">
          {error.includes("not found")
            ? "Player nerd attribution will appear after the next nerd-stats aggregate."
            : error}
        </p>
      ) : rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-muted">No applicable nerd stats yet.</p>
      ) : (
        <>
          {/* Mobile: stacked cards */}
          <ul className="max-h-[28rem] overflow-y-auto overscroll-y-contain md:hidden">
            {rows.map((row) => (
              <NerdStatCard key={row.statId} row={row} />
            ))}
          </ul>

          {/* Desktop: table */}
          <div className="hidden max-h-[28rem] overflow-y-auto md:block">
            <table className="w-full text-left text-[12px]">
              <thead className="sticky top-0 bg-surface text-[10px] uppercase tracking-wide text-muted">
                <tr className="border-b border-border">
                  <th className="px-3 py-2 font-medium">Stat</th>
                  <th className="px-2 py-2 font-medium">Player</th>
                  <th className="px-2 py-2 font-medium">Team</th>
                  <th className="px-2 py-2 font-medium">Share</th>
                  <th className="px-3 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.statId} className="border-b border-border/60 hover:bg-hover/60">
                    <td className="px-3 py-2">
                      <Link
                        href={`/nerd/${row.statId}`}
                        className="font-medium text-foreground underline-offset-2 hover:underline"
                      >
                        {row.title}
                      </Link>
                      <p className="text-[10px] text-subtle">{row.subtitle}</p>
                    </td>
                    <td className="px-2 py-2 font-mono tabular-nums text-foreground">
                      {row.playerDisplay}
                    </td>
                    <td className="px-2 py-2 font-mono tabular-nums text-muted">
                      {row.teamDisplay}
                    </td>
                    <td className="px-2 py-2 font-mono tabular-nums text-muted">
                      {formatShare(row.shareOfTeam)}
                    </td>
                    <td className="px-3 py-2 font-mono tabular-nums text-subtle">
                      {formatActions(row)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
