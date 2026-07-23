"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Skeleton } from "@/components/ui/Skeleton";
import {
  NERD_STAT_CATEGORIES,
  type NerdStatCategory,
  type PlayerNerdCard,
} from "@/lib/mlb/nerdStats/types";
import { cn } from "@/lib/utils";

function formatShare(share: number | null): string {
  if (share == null || !Number.isFinite(share)) return "—";
  return `${(share * 100).toFixed(1)}%`;
}

export function PlayerNerdContributionPanel({
  playerId,
  season,
}: {
  playerId: number;
  season: number;
}) {
  const [card, setCard] = useState<PlayerNerdCard | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<NerdStatCategory | "all">("all");

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    void (async () => {
      try {
        const params = new URLSearchParams({ season: String(season) });
        const response = await fetch(`/api/players/${playerId}/nerd?${params.toString()}`, {
          cache: "no-store",
        });
        const body = (await response.json()) as PlayerNerdCard | { error?: string };
        if (!response.ok) {
          throw new Error("error" in body && body.error ? body.error : "Failed to load nerd card");
        }
        if (!cancelled) setCard(body as PlayerNerdCard);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load nerd card");
          setCard(null);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [playerId, season]);

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
        <div className="mt-3 flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setCategory("all")}
            className={cn(
              "rounded-md border px-2 py-1 text-[11px]",
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
                "rounded-md border px-2 py-1 text-[11px]",
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
        <div className="max-h-[28rem] overflow-y-auto">
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
                  <td className="px-2 py-2 font-mono tabular-nums text-muted">{row.teamDisplay}</td>
                  <td className="px-2 py-2 font-mono tabular-nums text-muted">
                    {formatShare(row.shareOfTeam)}
                  </td>
                  <td className="px-3 py-2 font-mono tabular-nums text-subtle">
                    {row.playerActions != null && row.teamActions != null
                      ? `${row.playerActions}/${row.teamActions}`
                      : row.playerActions != null
                        ? String(row.playerActions)
                        : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
