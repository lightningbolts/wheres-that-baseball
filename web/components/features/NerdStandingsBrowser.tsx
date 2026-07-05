"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type ChangeEventHandler, type ReactNode } from "react";

import { AppNav } from "@/components/features/AppNav";
import { NerdStatCard } from "@/components/features/NerdStatCard";
import { Skeleton } from "@/components/ui/Skeleton";
import { useNerdStatsSummary } from "@/hooks/useNerdStats";
import { useRestoreScrollWhenReady } from "@/hooks/useRestoreScrollWhenReady";
import { saveReturnScrollPosition, saveScrollPosition } from "@/lib/scrollRestoration";
import { NERD_STAT_CATEGORIES, type NerdStatCategory } from "@/lib/mlb/nerdStats/types";
import {
  NERD_STAT_SPLITS,
  nerdStatSplitLabel,
  nerdStandingsHref,
  parseNerdStatSplit,
  type NerdStatSplitFilter,
} from "@/lib/mlb/nerdStats/splits";
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
  venueSplit: NerdStatSplitFilter;
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
  const initialSplit = parseNerdStatSplit(
    searchParams.get("split") ?? savedUi?.venueSplit ?? "all",
  );
  const [timeWindow, setTimeWindow] = useState<NerdStatWindowId>(initialWindow);
  const [venueSplit, setVenueSplit] = useState<NerdStatSplitFilter>(
    initialWindow === "season" ? initialSplit : "all",
  );
  const { data, isLoading, error } = useNerdStatsSummary(
    CURRENT_SEASON,
    timeWindow,
    venueSplit,
  );
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
    const fromSplit = parseNerdStatSplit(searchParams.get("split"));
    setTimeWindow(fromUrl);
    setVenueSplit(fromUrl === "season" ? fromSplit : "all");
  }, [searchParams]);

  useEffect(() => {
    const payload: SavedNerdUi = { category, search, teamId, timeWindow, venueSplit };
    sessionStorage.setItem(NERD_UI_STORAGE_KEY, JSON.stringify(payload));
  }, [category, search, teamId, timeWindow, venueSplit]);

  const statOfTheDay = data?.stats.find((stat) => stat.id === data.statOfTheDayId);

  function handleWindowChange(nextWindow: NerdStatWindowId) {
    setTimeWindow(nextWindow);
    if (nextWindow !== "season") setVenueSplit("all");
    const params = new URLSearchParams(searchParams.toString());
    if (nextWindow === "season") params.delete("window");
    else {
      params.set("window", nextWindow);
      params.delete("split");
    }
    router.replace(nerdStandingsHref(nextWindow, nextWindow === "season" ? venueSplit : "all"), {
      scroll: false,
    });
  }

  function handleSplitChange(nextSplit: NerdStatSplitFilter) {
    setVenueSplit(nextSplit);
    const params = new URLSearchParams(searchParams.toString());
    if (nextSplit === "all") params.delete("split");
    else params.set("split", nextSplit);
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
            Team stat standings · {nerdStatWindowLabel(timeWindow).toLowerCase()}
            {venueSplit !== "all" && timeWindow === "season"
              ? ` · ${nerdStatSplitLabel(venueSplit)?.toLowerCase()}`
              : ""}
            .
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

        <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-3">
          <div className="-mx-1 flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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

          <div className="-mx-1 flex shrink-0 items-center gap-2 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <NerdFilterSelect
              value={timeWindow}
              onChange={(event) => handleWindowChange(parseNerdStatWindow(event.target.value))}
            >
              {NERD_STAT_WINDOWS.map((window) => (
                <option key={window.id} value={window.id}>
                  {window.label}
                </option>
              ))}
            </NerdFilterSelect>
            {timeWindow === "season" && (
              <NerdFilterSelect
                value={venueSplit}
                onChange={(event) =>
                  handleSplitChange(parseNerdStatSplit(event.target.value))
                }
              >
                <option value="all">All games</option>
                {NERD_STAT_SPLITS.map((split) => (
                  <option key={split.id} value={split.id}>
                    {split.label}
                  </option>
                ))}
              </NerdFilterSelect>
            )}
            <NerdFilterSearch
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search stats…"
            />
            <NerdFilterSelect
              value={teamId != null ? String(teamId) : ""}
              onChange={(event) =>
                setTeamId(event.target.value ? Number.parseInt(event.target.value, 10) : null)
              }
            >
              <option value="">Team nerd card</option>
              {MLB_TEAMS.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.abbrev}
                </option>
              ))}
            </NerdFilterSelect>
            {teamId != null && (
              <Link
                href={`/nerd/team/${teamId}`}
                className="inline-flex h-8 shrink-0 items-center rounded-full border border-border bg-surface-elevated px-3 text-xs text-foreground transition-colors hover:border-border-strong hover:bg-hover"
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
                venueSplit={venueSplit}
                highlighted={
                  stat.id === data?.statOfTheDayId &&
                  timeWindow === "season" &&
                  venueSplit === "all"
                }
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
        "shrink-0 rounded-full px-3 py-1 text-xs transition-colors",
        active
          ? "bg-surface-elevated text-foreground"
          : "text-muted hover:bg-hover hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

const nerdFilterControlClass =
  "h-8 appearance-none rounded-full border border-border bg-surface-elevated text-xs text-foreground transition-colors hover:border-border-strong focus:border-border-strong focus:outline-none focus:ring-1 focus:ring-border-strong";

function NerdFilterSelect({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: ChangeEventHandler<HTMLSelectElement>;
  children: ReactNode;
}) {
  return (
    <div className="relative shrink-0">
      <select
        value={value}
        onChange={onChange}
        className={cn(nerdFilterControlClass, "cursor-pointer py-0 pl-3 pr-7")}
      >
        {children}
      </select>
      <ChevronDownIcon className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-subtle" />
    </div>
  );
}

function NerdFilterSearch({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: ChangeEventHandler<HTMLInputElement>;
  placeholder: string;
}) {
  return (
    <input
      type="search"
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className={cn(
        nerdFilterControlClass,
        "w-full min-w-[9rem] px-3 py-0 placeholder:text-subtle sm:w-36",
      )}
    />
  );
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
