"use client";

import { useEffect, useState } from "react";

import { CatcherScene } from "@/components/features/callIt/CatcherScene";
import { findBatterBoxLine } from "@/lib/mlb/boxScoreLookup";
import { cn } from "@/lib/utils";
import {
  useCallItGame,
  type CallItMode,
} from "@/hooks/useCallItGame";
import type { GameBoxScore } from "@/types/mlb-boxscore";
import type { LiveGameState } from "@/types/mlb-live";

interface CallItGameProps {
  gameState: LiveGameState | null;
  boxScore: GameBoxScore | null;
  paused: boolean;
  gameOver: boolean;
  className?: string;
}

function ModeToggle({
  mode,
  onChange,
}: {
  mode: CallItMode;
  onChange: (mode: CallItMode) => void;
}) {
  return (
    <div className="flex rounded-lg border border-border bg-surface-elevated p-0.5">
      {(
        [
          { id: "umpire" as const, label: "Umpire" },
          { id: "predictor" as const, label: "Predictor" },
        ] as const
      ).map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onChange(item.id)}
          className={cn(
            "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            mode === item.id
              ? "bg-foreground text-background"
              : "text-muted hover:text-foreground",
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function Scoreboard({
  correct,
  total,
  streak,
  bestStreak,
}: {
  correct: number;
  total: number;
  streak: number;
  bestStreak: number;
}) {
  const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;

  return (
    <div className="grid grid-cols-4 gap-2 text-center">
      <div className="rounded-md border border-border bg-surface-elevated px-2 py-2">
        <p className="text-[10px] uppercase tracking-wide text-subtle">Score</p>
        <p className="font-mono text-lg font-semibold tabular-nums">
          {correct}/{total}
        </p>
      </div>
      <div className="rounded-md border border-border bg-surface-elevated px-2 py-2">
        <p className="text-[10px] uppercase tracking-wide text-subtle">Accuracy</p>
        <p className="font-mono text-lg font-semibold tabular-nums">{accuracy}%</p>
      </div>
      <div className="rounded-md border border-border bg-surface-elevated px-2 py-2">
        <p className="text-[10px] uppercase tracking-wide text-subtle">Streak</p>
        <p className="font-mono text-lg font-semibold tabular-nums">{streak}</p>
      </div>
      <div className="rounded-md border border-border bg-surface-elevated px-2 py-2">
        <p className="text-[10px] uppercase tracking-wide text-subtle">Best</p>
        <p className="font-mono text-lg font-semibold tabular-nums">{bestStreak}</p>
      </div>
    </div>
  );
}

export function CallItGame({
  gameState,
  boxScore,
  paused,
  gameOver,
  className,
}: CallItGameProps) {
  const {
    mode,
    setMode,
    phase,
    score,
    activePitch,
    reveal,
    canGuess,
    statusMessage,
    guess,
    animatePitchIn,
  } = useCallItGame({ gameState, paused, gameOver });

  const [lockedGuess, setLockedGuess] = useState<"strike" | "ball" | null>(null);

  useEffect(() => {
    if (phase !== "awaiting_pre") setLockedGuess(null);
  }, [phase]);

  const handleGuess = (call: "strike" | "ball") => {
    if (mode === "predictor" && phase === "awaiting_pre") setLockedGuess(call);
    guess(call);
  };

  const batterLine = findBatterBoxLine(
    boxScore,
    gameState?.batterId,
    gameState?.offenseTeamId,
  );
  const batSide = batterLine?.batSide ?? "R";

  const displayPitches = gameState?.atBatPitches ?? [];
  const showReveal = phase === "revealed" && reveal != null;

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col gap-3 p-3 md:gap-4", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ModeToggle mode={mode} onChange={setMode} />
        <p className="text-xs text-muted">
          {gameState?.batterName ?? "—"} vs {gameState?.pitcherName ?? "—"}
        </p>
      </div>

      <Scoreboard
        correct={score.correct}
        total={score.total}
        streak={score.streak}
        bestStreak={score.bestStreak}
      />

      <div className="relative min-h-0 flex-1">
        <CatcherScene
          pitches={displayPitches}
          batSide={batSide}
          batterId={gameState?.batterId ?? null}
          batterName={gameState?.batterName ?? "—"}
          activePitch={activePitch}
          revealCall={showReveal}
          animatePitchIn={animatePitchIn}
          className="h-[clamp(17rem,42dvh,28rem)] md:h-full"
        />

        {showReveal ? (
          <div
            className={cn(
              "absolute inset-x-3 bottom-3 rounded-lg border px-4 py-3 text-center shadow-lg backdrop-blur-sm",
              reveal.correct
                ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-100"
                : "border-red-500/40 bg-red-500/15 text-red-100",
            )}
          >
            <p className="text-sm font-semibold">
              {reveal.correct ? "Correct!" : `Wrong — it was a ${reveal.actual}`}
            </p>
            {!reveal.correct && reveal.absDisagrees ? (
              <p className="mt-1 text-xs opacity-90">
                ABS zone says {reveal.absSaysStrike ? "strike" : "ball"}
              </p>
            ) : null}
            {reveal.pitch.review ? (
              <p className="mt-1 text-xs opacity-90">
                {reveal.pitch.review.isOverturned ? "ABS overturned" : "ABS confirmed"}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <p className="text-center text-sm text-secondary">{statusMessage}</p>

      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          disabled={!canGuess}
          onClick={() => handleGuess("ball")}
          className={cn(
            "rounded-lg border-2 py-4 text-base font-semibold transition-colors",
            canGuess
              ? lockedGuess === "ball"
                ? "border-emerald-400 bg-emerald-500/25 text-emerald-100"
                : "border-emerald-500/60 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20"
              : "cursor-not-allowed border-border bg-overlay text-muted",
          )}
        >
          Ball
        </button>
        <button
          type="button"
          disabled={!canGuess}
          onClick={() => handleGuess("strike")}
          className={cn(
            "rounded-lg border-2 py-4 text-base font-semibold transition-colors",
            canGuess
              ? lockedGuess === "strike"
                ? "border-red-400 bg-red-500/25 text-red-100"
                : "border-red-500/60 bg-red-500/10 text-red-200 hover:bg-red-500/20"
              : "cursor-not-allowed border-border bg-overlay text-muted",
          )}
        >
          Strike
        </button>
      </div>
    </div>
  );
}
