"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppNav } from "@/components/features/AppNav";
import { decodeGame } from "@/lib/game/franchise/share";
import type { League, ScheduledGame } from "@/lib/game/franchise/types";
import { GamePage } from "./GamePage";

/** A game opened from a shared link: everything it shows comes from the URL hash. */
export function SharedGame() {
  const [data, setData] = useState<{ league: League; game: ScheduledGame } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = () => {
      const hash = window.location.hash;
      if (hash.length < 3) {
        setError("This link doesn't include a game.");
        return;
      }
      decodeGame(hash)
        .then((d) => {
          setData(d);
          setError(null);
        })
        .catch(() => setError("This game link is broken or incomplete."));
    };
    load();
    window.addEventListener("hashchange", load);
    return () => window.removeEventListener("hashchange", load);
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <AppNav />
      <main className="mx-auto w-full max-w-5xl flex-1 px-3 py-4 sm:px-4 sm:py-8">
        {error && <p className="text-sm text-red-500">{error}</p>}
        {!error && !data && <p className="text-sm text-secondary">Loading…</p>}
        {data && <GamePage league={data.league} game={data.game} />}
        <p className="mt-6 text-xs text-muted">
          From a <Link href="/play/season" className="underline hover:text-foreground">Play Ball franchise</Link> season.
        </p>
      </main>
    </div>
  );
}
