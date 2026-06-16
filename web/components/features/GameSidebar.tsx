"use client";

import { cn } from "@/lib/utils";
import { LIVE_GAME_STATUSES, type ActiveGame } from "@/types/mlb";

interface GameSidebarProps {
  games: ActiveGame[];
  selectedGamePk: number;
  onSelectGame: (gamePk: number) => void;
}

export function GameSidebar({ games, selectedGamePk, onSelectGame }: GameSidebarProps) {
  return (
    <aside className="flex h-full flex-col bg-surface">
      <div className="border-b border-border px-3 py-2.5">
        <h2 className="text-xs font-medium text-muted">Today</h2>
      </div>

      <nav className="flex-1 overflow-y-auto" aria-label="Games">
        {games.map((game) => {
          const isSelected = game.gamePk === selectedGamePk;
          const isLive = LIVE_GAME_STATUSES.has(game.status);

          return (
            <button
              key={game.gamePk}
              type="button"
              onClick={() => onSelectGame(game.gamePk)}
              className={cn(
                "w-full border-b border-border/50 px-3 py-2.5 text-left transition-colors",
                isSelected
                  ? "border-l-2 border-l-foreground bg-overlay pl-[10px]"
                  : "border-l-2 border-l-transparent hover:bg-hover",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[13px] text-foreground">{game.label}</span>
                {isLive && (
                  <span className="shrink-0 text-[10px] font-medium text-red-500">LIVE</span>
                )}
              </div>
              {!isLive && (
                <span className="text-[11px] text-subtle">{game.status}</span>
              )}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
