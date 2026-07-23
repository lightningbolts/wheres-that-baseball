"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { AppNav } from "@/components/features/AppNav";
import { TeamLogo } from "@/components/ui/TeamLogo";
import { usePlayerSearch } from "@/hooks/usePlayerBip";
import type { PlayerBipIndexEntry } from "@/lib/mlb/playerBip";

const CURRENT_SEASON = new Date().getFullYear();

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

export function PlayersBrowser() {
  const router = useRouter();
  const { query, setQuery, suggestions, isLoading } = usePlayerSearch(CURRENT_SEASON);

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
              setQuery(player.name);
              router.push(`/players/${player.playerId}`);
            }}
          />
        </div>

        <div className="mt-10 rounded-xl border border-border bg-surface px-6 py-12 text-center">
          <p className="text-sm text-secondary">Start typing a player name to explore season BIP.</p>
          <p className="mt-2 text-xs text-muted">
            Suggestions include season balls in play and parks visited.{" "}
            <Link href="/nerd" className="underline-offset-2 hover:underline">
              Nerd standings
            </Link>{" "}
            attribution appears on each player page.
          </p>
        </div>
      </div>
    </div>
  );
}
