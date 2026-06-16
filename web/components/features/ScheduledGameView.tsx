import Link from "next/link";

import { AppNav } from "@/components/features/AppNav";
import { formatGameDate, formatMatchup, gameStatusLabel } from "@/lib/games/format";
import type { Game } from "@/types/database";

interface ScheduledGameViewProps {
  game: Game;
}

export function ScheduledGameView({ game }: ScheduledGameViewProps) {
  return (
    <div className="flex min-h-screen flex-col bg-[#0f0f0f] text-neutral-200">
      <AppNav />

      <div className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-4 py-12 text-center">
        <Link
          href="/games"
          className="mb-8 text-xs text-neutral-500 transition-colors hover:text-neutral-300"
        >
          ← Season history
        </Link>
        <h1 className="text-lg font-medium text-neutral-100">{formatMatchup(game)}</h1>
        <p className="mt-2 text-sm text-neutral-400">
          {formatGameDate(game.game_date)}
          {game.venue_name ? ` · ${game.venue_name}` : ""}
        </p>
        <p className="mt-6 text-sm text-neutral-500">
          This game has not started yet. Play-by-play replay will be available after it is played.
        </p>
        <p className="mt-2 text-xs text-neutral-600">{gameStatusLabel(game)}</p>
      </div>
    </div>
  );
}
