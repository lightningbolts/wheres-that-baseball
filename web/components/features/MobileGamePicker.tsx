"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";
import { LIVE_GAME_STATUSES, type ActiveGame } from "@/types/mlb";

interface MobileGamePickerProps {
  games: ActiveGame[];
  selectedGamePk: number;
  onSelectGame: (gamePk: number) => void;
  className?: string;
}

export function MobileGamePicker({
  games,
  selectedGamePk,
  onSelectGame,
  className,
}: MobileGamePickerProps) {
  const [open, setOpen] = useState(false);
  const selected = games.find((game) => game.gamePk === selectedGamePk) ?? games[0];

  if (!selected) return null;

  return (
    <div className={cn("border-b border-border bg-surface p-2 xl:hidden", className)}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 rounded-md border border-border-strong bg-surface-elevated px-3 py-3 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-medium leading-snug text-foreground">
            {selected.label}
          </span>
          <span className="mt-0.5 block text-sm text-muted">{selected.status}</span>
        </span>
        <span className="shrink-0 text-sm text-muted" aria-hidden>
          {open ? "▲" : "▼"}
        </span>
      </button>

      {open && (
        <ul
          className="mt-2 max-h-64 overflow-y-auto rounded-md border border-border bg-surface-elevated"
          role="listbox"
          aria-label="Select game"
        >
          {games.map((game) => {
            const isSelected = game.gamePk === selectedGamePk;
            const isLive = LIVE_GAME_STATUSES.has(game.status);

            return (
              <li key={game.gamePk} role="option" aria-selected={isSelected}>
                <button
                  type="button"
                  onClick={() => {
                    onSelectGame(game.gamePk);
                    setOpen(false);
                  }}
                  className={cn(
                    "w-full border-b border-border/50 px-3 py-3 text-left last:border-b-0",
                    isSelected ? "bg-overlay" : "hover:bg-hover",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-base font-medium leading-snug text-foreground">
                      {game.label}
                    </span>
                    {isLive && (
                      <span className="shrink-0 text-xs font-semibold uppercase text-red-500">
                        Live
                      </span>
                    )}
                  </div>
                  {!isLive && (
                    <span className="mt-0.5 block text-sm text-muted">{game.status}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
