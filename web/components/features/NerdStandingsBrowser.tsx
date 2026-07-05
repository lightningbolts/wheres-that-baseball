"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { AppNav } from "@/components/features/AppNav";
import { NerdStatCard } from "@/components/features/NerdStatCard";
import { Skeleton } from "@/components/ui/Skeleton";
import { useNerdStatsSummary } from "@/hooks/useNerdStats";
import { useRestoreScrollWhenReady } from "@/hooks/useRestoreScrollWhenReady";
import { saveReturnScrollPosition, saveScrollPosition } from "@/lib/scrollRestoration";
import { NERD_STAT_CATEGORIES, type NerdStatCategory } from "@/lib/mlb/nerdStats/types";
import {
  NERD_STAT_WINDOWS,
  nerdStatWindowLabel,
  parseNerdStatWindow,
  type NerdStatWindowId,
} from "@/lib/mlb/nerdStats/windows";
import { MLB_TEAMS } from "@/lib/mlb/teams";
import { cn } from "@/lib/utils";

const CURRENT_SEASON = new Date().getFullYear();
const NERD_UI_STORAGE_KEY = "nerd-standings-ui";

interface SavedNerdUi {
  category: NerdStatCategory | "all";
  search: string;
  teamId: number | null;
  timeWindow: NerdStatWindowId;
}

function loadSavedNerdUi(): SavedNerdUi | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(NERD_UI_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SavedNerdUi;
  } catch {
    return null;
  }
}

export function NerdStandingsBrowser() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const savedUi = useMemo(() => loadSavedNerdUi(), []);
  const initialWindow = parseNerdStatWindow(
    searchParams.get("window") ?? savedUi?.timeWindow ?? "season",
  );
  const [timeWindow, setTimeWindow] = useState<NerdStatWindowId>(initialWindow);
  const { data, isLoading, error } = useNerdStatsSummary(CURRENT_SEASON, timeWindow);
  const [category, setCategory] = useState<NerdStatCategory | "all">(savedUi?.category ?? "all");
  const [search, setSearch] = useState(savedUi?.search ?? "");
  const [teamId, setTeamId] = useState<number | null>(savedUi?.teamId ?? null);

  const filteredStats = useMemo(() => {
    if (!data?.stats) return [];
    const query = search.trim().toLowerCase();
    return data.stats.filter((stat) => {
      if (category !== "all" && stat.category !== category) return false;
      if (!query) return true;
      return (
        stat.title.toLowerCase().includes(query) ||
        stat.subtitle.toLowerCase().includes(query) ||
        stat.id.includes(query)
      );
    });
  }, [category, data?.stats, search]);

  useRestoreScrollWhenReady(!isLoading && filteredStats.length > 0);

  useEffect(() => {
    const fromUrl = parseNerdStatWindow(searchParams.get("window"));
    setTimeWindow(fromUrl);
  }, [searchParams]);

  useEffect(() => {
    const payload: SavedNerdUi = { category, search, teamId, timeWindow };
    sessionStorage.setItem(NERD_UI_STORAGE_KEY, JSON.stringify(payload));
  }, [category, search, teamId, timeWindow]);

  const statOfTheDay = data?.stats.find((stat) => stat.id === data.statOfTheDayId);

  function handleWindowChange(nextWindow: NerdStatWindowId) {
    setTimeWindow(nextWindow);
    const params = new URLSearchParams(searchParams.toString());
    if (nextWindow === "season") params.delete("window");
    else params.set("window", nextWindow);
    const query = params.toString();
    router.replace(query ? `/nerd?${query}` : "/nerd", { scroll: false });
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <AppNav />

      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-6">
        <div className="mb-6">
          <h1 className="text-xl font-medium text-foreground">Nerd Standings</h1>
          <p className="mt-1 text-sm text-muted">
            Team stat standings · {nerdStatWindowLabel(timeWindow).toLowerCase()}.
          </p>
          {!isLoading && data && (
            <p className="mt-2 text-xs text-subtle">
              {data.indexedGameCount.toLocaleString()} final game
              {data.indexedGameCount === 1 ? "" : "s"} indexed
              {data.backfillPending && (
                <span className="text-muted"> · Run aggregate-nerd-stats to populate</span>
              )}
            </p>
          )}
        </div>

        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-1.5">
            <CategoryChip
              active={category === "all"}
              onClick={() => setCategory("all")}
              label="All"
            />
            {NERD_STAT_CATEGORIES.map((item) => (
              <CategoryChip
                key={item.id}
                active={category === item.id}
                onClick={() => setCategory(item.id)}
                label={item.label}
              />
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={timeWindow}
              onChange={(event) => handleWindowChange(parseNerdStatWindow(event.target.value))}
              className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground"
            >
              {NERD_STAT_WINDOWS.map((window) => (
                <option key={window.id} value={window.id}>
                  {window.label}
                </option>
              ))}
            </select>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search stats…"
              className="w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground placeholder:text-subtle sm:w-48"
            />
            <select
              value={teamId ?? ""}
              onChange={(event) =>
                setTeamId(event.target.value ? Number.parseInt(event.target.value, 10) : null)
              }
              className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground"
            >
              <option value="">Team nerd card</option>
              {MLB_TEAMS.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.abbrev}
                </option>
              ))}
            </select>
            {teamId != null && (
              <Link
                href={`/nerd/team/${teamId}`}
                className="rounded-md border border-border bg-surface-elevated px-3 py-1.5 text-xs text-foreground hover:bg-hover"
              >
                View card
              </Link>
            )}
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 9 }).map((_, index) => (
              <Skeleton key={index} className="h-56 rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredStats.map((stat) => (
              <NerdStatCard
                key={stat.id}
                stat={stat}
                season={CURRENT_SEASON}
                timeWindow={timeWindow}
                highlighted={stat.id === data?.statOfTheDayId && timeWindow === "season"}
              />
            ))}
          </div>
        )}

        {!isLoading && filteredStats.length === 0 && (
          <div className="rounded-xl border border-border bg-surface px-6 py-12 text-center text-sm text-muted">
            No stats match your filters.
          </div>
        )}

        {!isLoading && statOfTheDay && (
          <p className="mt-6 text-center text-xs text-subtle">
            Stat of the day:{" "}
            <Link href="/nerd/daily" scroll={false} className="text-secondary hover:underline">
              {statOfTheDay.title}
            </Link>
            {" · "}
            <Link
              href={`/nerd/${statOfTheDay.id}`}
              scroll={false}
              onClick={() => {
                const path = window.location.pathname;
                const query = window.location.search.replace(/^\?/, "");
                const y = window.scrollY;
                saveScrollPosition(query ? `${path}?${query}` : path, y);
                saveReturnScrollPosition(path, y, query);
              }}
              className="text-secondary hover:underline"
            >
              View leaderboard
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}

function CategoryChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full px-3 py-1 text-xs transition-colors",
        active
          ? "bg-surface-elevated text-foreground"
          : "text-muted hover:bg-hover hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}
