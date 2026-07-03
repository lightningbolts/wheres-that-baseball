"use client";

import { useEffect, useState } from "react";

import { CatcherScene } from "@/components/features/callIt/CatcherScene";
import { Scorebug } from "@/components/features/Scorebug";
import { findBatterBoxLine } from "@/lib/mlb/boxScoreLookup";
import { CALL_IT_ZONE_STORAGE_KEY } from "@/lib/mlb/callItGame";
import { cn } from "@/lib/utils";
import {
  useCallItGame,
  type CallItMode,
} from "@/hooks/useCallItGame";
import { useGamedayBatterImage } from "@/hooks/useGamedayBatterImage";
import { useGamedayStadiumImage } from "@/hooks/useGamedayStadiumImage";
import type { GameBoxScore } from "@/types/mlb-boxscore";
import type { LiveGameState } from "@/types/mlb-live";

interface CallItGameProps {
  gameState: LiveGameState | null;
  boxScore: GameBoxScore | null;
  paused: boolean;
  gameOver: boolean;
  className?: string;
}

function loadShowZone(): boolean {
  if (typeof window === "undefined") return true;
  const stored = localStorage.getItem(CALL_IT_ZONE_STORAGE_KEY);
  return stored !== "0";
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

function ZoneToggle({
  showZone,
  onChange,
}: {
  showZone: boolean;
  onChange: (show: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!showZone)}
      className={cn(
        "flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
        showZone
          ? "border-border bg-surface-elevated text-foreground"
          : "border-border bg-overlay text-muted",
      )}
      aria-pressed={showZone}
    >
      <span
        className={cn(
          "relative h-4 w-7 rounded-full transition-colors",
          showZone ? "bg-foreground" : "bg-faint",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-3 w-3 rounded-full bg-background transition-transform",
            showZone ? "left-3.5" : "left-0.5",
          )}
        />
      </span>
      Strike zone
    </button>
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
    <div className="grid grid-cols-2 gap-1.5 text-center sm:grid-cols-4 sm:gap-2">
      {[
        { label: "Score", value: `${correct}/${total}` },
        { label: "Accuracy", value: `${accuracy}%` },
        { label: "Streak", value: String(streak) },
        { label: "Best", value: String(bestStreak) },
      ].map((stat) => (
        <div
          key={stat.label}
          className="rounded-md border border-border bg-surface-elevated px-1.5 py-1.5 sm:px-2 sm:py-2"
        >
          <p className="text-[8px] uppercase tracking-wide text-subtle sm:text-[10px]">
            {stat.label}
          </p>
          <p className="font-mono text-base font-semibold tabular-nums sm:text-lg">{stat.value}</p>
        </div>
      ))}
    </div>
  );
}

function GuessButtons({
  canGuess,
  lockedGuess,
  onGuess,
  className,
}: {
  canGuess: boolean;
  lockedGuess: "strike" | "ball" | null;
  onGuess: (call: "strike" | "ball") => void;
  className?: string;
}) {
  return (
    <div className={cn("grid grid-cols-2 gap-2", className)}>
      <button
        type="button"
        disabled={!canGuess}
        onClick={() => onGuess("ball")}
        className={cn(
          "rounded-lg border-2 py-3 text-base font-semibold transition-colors sm:py-3.5",
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
        onClick={() => onGuess("strike")}
        className={cn(
          "rounded-lg border-2 py-3 text-base font-semibold transition-colors sm:py-3.5",
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
  const [showStrikeZone, setShowStrikeZone] = useState(true);

  useEffect(() => {
    setShowStrikeZone(loadShowZone());
  }, []);

  useEffect(() => {
    if (phase !== "awaiting_pre") setLockedGuess(null);
  }, [phase]);

  const handleZoneToggle = (show: boolean) => {
    setShowStrikeZone(show);
    localStorage.setItem(CALL_IT_ZONE_STORAGE_KEY, show ? "1" : "0");
  };

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
  const batterImageUrl = useGamedayBatterImage(
    gameState?.gamePk,
    gameState?.offenseTeamId,
    batSide,
  );
  const stadiumImageUrl = useGamedayStadiumImage(gameState?.venueId);

  const displayPitches = gameState?.atBatPitches ?? [];
  const showReveal = phase === "revealed" && reveal != null;

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row", className)}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="shrink-0 space-y-2 border-b border-border bg-panel p-2 sm:p-3 md:hidden">
          <div className="flex flex-wrap items-center gap-2">
            <ModeToggle mode={mode} onChange={setMode} />
            <ZoneToggle showZone={showStrikeZone} onChange={handleZoneToggle} />
          </div>
          <p className="truncate text-xs text-muted">
            {gameState?.batterName ?? "—"} vs {gameState?.pitcherName ?? "—"}
          </p>
          <Scoreboard
            correct={score.correct}
            total={score.total}
            streak={score.streak}
            bestStreak={score.bestStreak}
          />
          <p className="text-center text-sm text-secondary">{statusMessage}</p>
        </div>

        <div className="relative min-h-0 flex-1 bg-neutral-950">
          <CatcherScene
            pitches={displayPitches}
            batSide={batSide}
            batterImageUrl={batterImageUrl}
            stadiumImageUrl={stadiumImageUrl}
            activePitch={activePitch}
            revealCall={showReveal}
            animatePitchIn={animatePitchIn}
            showStrikeZone={showStrikeZone}
            className="absolute inset-0"
          />

          <Scorebug
            gameState={gameState}
            className="absolute left-2 top-2 z-30 max-w-[min(100%,22rem)] rounded-lg border border-white/15 bg-black/70 shadow-lg backdrop-blur-md lg:left-3 lg:top-3"
          />

          {showReveal ? (
          <div
            className={cn(
              "pointer-events-none absolute inset-x-3 bottom-[5.5rem] z-30 rounded-lg border px-3 py-2.5 text-center shadow-lg backdrop-blur-sm sm:px-4 sm:py-3 md:bottom-4",
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

          <div className="absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t from-black/90 via-black/55 to-transparent p-3 pt-8 md:hidden">
            <GuessButtons
              canGuess={canGuess}
              lockedGuess={lockedGuess}
              onGuess={handleGuess}
            />
          </div>
        </div>
      </div>

      <aside className="hidden w-64 shrink-0 flex-col gap-2 border-l border-border bg-panel p-3 md:flex lg:w-72 xl:w-80">
        <div className="flex flex-wrap items-center gap-2">
          <ModeToggle mode={mode} onChange={setMode} />
          <ZoneToggle showZone={showStrikeZone} onChange={handleZoneToggle} />
        </div>

        <p className="truncate text-xs text-muted">
          {gameState?.batterName ?? "—"} vs {gameState?.pitcherName ?? "—"}
        </p>

        <Scoreboard
          correct={score.correct}
          total={score.total}
          streak={score.streak}
          bestStreak={score.bestStreak}
        />

        <p className="text-center text-sm text-secondary">{statusMessage}</p>

        <GuessButtons
          canGuess={canGuess}
          lockedGuess={lockedGuess}
          onGuess={handleGuess}
          className="mt-auto"
        />
      </aside>
    </div>
  );
}
