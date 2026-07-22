"use client";

import { Dialog } from "@/components/ui/Dialog";
import type { GameBoxScore } from "@/types/mlb-boxscore";
import type { LiveGameState } from "@/types/mlb-live";

interface GameFinalDialogProps {
  gameState: LiveGameState | null;
  boxScore: GameBoxScore | null;
  open: boolean;
  onClose: () => void;
}

function DecisionRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex gap-2 text-sm">
      <span className="w-8 shrink-0 font-semibold text-foreground">{label}</span>
      <span className="text-secondary">{value}</span>
    </div>
  );
}

export function GameFinalDialog({ gameState, boxScore, open, onClose }: GameFinalDialogProps) {
  if (!gameState) return null;

  const { awayAbbrev, homeAbbrev, awayRuns, homeRuns, awayTeam, homeTeam } = gameState;
  const decisions = boxScore?.decisions;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Final"
      className="w-[min(100%,480px)]"
    >
      <div className="space-y-5">
        <p className="text-sm text-secondary">
          {awayTeam} @ {homeTeam}
        </p>

        <div className="flex items-center justify-center gap-8 py-2">
          <div className="text-center">
            <p className="text-xs font-semibold tracking-wide text-muted">{awayAbbrev}</p>
            <p className="font-mono text-4xl font-bold tabular-nums text-foreground">{awayRuns}</p>
          </div>
          <span className="text-lg text-faint">–</span>
          <div className="text-center">
            <p className="text-xs font-semibold tracking-wide text-muted">{homeAbbrev}</p>
            <p className="font-mono text-4xl font-bold tabular-nums text-foreground">{homeRuns}</p>
          </div>
        </div>

        {decisions && (
          <div className="space-y-1.5 border-t border-border pt-4">
            <DecisionRow label="WP" value={decisions.winner} />
            <DecisionRow label="LP" value={decisions.loser} />
            <DecisionRow label="SV" value={decisions.save} />
          </div>
        )}
      </div>
    </Dialog>
  );
}
