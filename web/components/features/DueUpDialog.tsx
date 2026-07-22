"use client";

import { Dialog } from "@/components/ui/Dialog";
import type { DueUpContext } from "@/lib/mlb/lineup";

interface DueUpDialogProps {
  context: DueUpContext | null;
  open: boolean;
  onClose: () => void;
}

export function DueUpDialog({ context, open, onClose }: DueUpDialogProps) {
  if (!context) return null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Due up — ${context.teamAbbrev}`}
      className="w-[min(100%,420px)]"
    >
      <div className="space-y-4">
        <p className="text-sm text-secondary">
          {context.teamName} · {context.subtitle}
        </p>

        <ol className="space-y-2">
          {context.batters.map((batter) => (
            <li
              key={batter.playerId}
              className="flex items-center gap-3 border border-border bg-surface-elevated px-3 py-2.5"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center bg-overlay font-mono text-xs font-semibold tabular-nums text-muted">
                {batter.order}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{batter.name}</p>
                <p className="text-[11px] text-subtle">
                  {batter.positions ? `${batter.positions} · ` : ""}
                  {batter.seasonAvg} AVG
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </Dialog>
  );
}
