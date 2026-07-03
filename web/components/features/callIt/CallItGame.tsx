"use client";

import { useEffect, useMemo, useState } from "react";

import { CatcherScene } from "@/components/features/callIt/CatcherScene";
import { Scorebug } from "@/components/features/Scorebug";
import { findBatterBoxLine } from "@/lib/mlb/boxScoreLookup";
import { CALL_IT_ZONE_STORAGE_KEY } from "@/lib/mlb/callItGame";
import { computeCallItGameStats } from "@/lib/mlb/callItGameStats";
import { cn } from "@/lib/utils";
import {
  useCallItGame,
  type CallItMode,
} from "@/hooks/useCallItGame";
import { useGamedayBatterImage } from "@/hooks/useGamedayBatterImage";
import { useGamedayInfieldImage, useGamedayStadiumImage } from "@/hooks/useGamedayStadiumImage";
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

function NerdStatsPanel({ gameState }: { gameState: LiveGameState | null }) {
  const stats = useMemo(() => computeCallItGameStats(gameState), [gameState]);
  if (!stats) return null;

  const rows = [
    {
      label: "Pitches seen / half-inn",
      away: stats.away.pitchesSeenPerInning?.toFixed(1) ?? "—",
      home: stats.home.pitchesSeenPerInning?.toFixed(1) ?? "—",
    },
    {
      label: "Pitches thrown / half-inn",
      away: stats.away.pitchesThrownPerInning?.toFixed(1) ?? "—",
      home: stats.home.pitchesThrownPerInning?.toFixed(1) ?? "—",
    },
    {
      label: "Total pitches",
      away: String(stats.away.pitchesSeen),
      home: String(stats.home.pitchesSeen),
    },
  ];

  return (
    <div className="rounded-lg border border-border bg-surface-elevated p-2">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-subtle">
        Nerd stats
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[280px] text-left text-[11px]">
          <thead>
            <tr className="text-subtle">
              <th className="pb-1 pr-2 font-medium">Metric</th>
              <th className="pb-1 pr-2 font-medium">{stats.away.abbrev}</th>
              <th className="pb-1 font-medium">{stats.home.abbrev}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-t border-border/70">
                <td className="py-1 pr-2 text-muted">{row.label}</td>
                <td className="py-1 pr-2 font-mono tabular-nums">{row.away}</td>
                <td className="py-1 font-mono tabular-nums">{row.home}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1.5 text-[10px] text-subtle">
        {stats.totalPitches} pitches · {stats.scoreablePitches} callable · {stats.foulBalls} fouls ·{" "}
        {stats.ballsInPlay} in play
      </p>
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
              ? "border-emerald-600 bg-emerald-500/20 text-emerald-900 dark:border-emerald-400 dark:bg-emerald-500/25 dark:text-emerald-100"
              : "border-emerald-600/70 bg-emerald-500/10 text-emerald-800 hover:bg-emerald-500/20 dark:border-emerald-500/60 dark:text-emerald-200"
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
              ? "border-red-600 bg-red-500/20 text-red-900 dark:border-red-400 dark:bg-red-500/25 dark:text-red-100"
              : "border-red-600/70 bg-red-500/10 text-red-800 hover:bg-red-500/20 dark:border-red-500/60 dark:text-red-200"
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
    pitchNotice,
    atBatNotice,
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
  const batterAssets = useGamedayBatterImage(
    gameState?.gamePk,
    gameState?.offenseTeamId,
    batSide,
  );
  const stadiumImageUrl = useGamedayStadiumImage(gameState?.venueId);
  const infieldImageUrl = useGamedayInfieldImage(gameState?.venueId);

  const displayPitches = gameState?.atBatPitches ?? [];
  const showReveal = phase === "revealed" && reveal != null;
  const showPitchNotice = pitchNotice != null && !showReveal;
  const showAtBatNotice = atBatNotice != null && !showReveal && !showPitchNotice;

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col overflow-hidden", className)}>
      <div className="relative min-h-[min(58vh,480px)] min-w-0 flex-1 bg-neutral-200 dark:bg-neutral-950">
        <CatcherScene
          pitches={displayPitches}
          batSide={batSide}
          jerseyImageUrl={batterAssets.jerseyUrl}
          pantsImageUrl={batterAssets.pantsUrl}
          stadiumImageUrl={stadiumImageUrl}
          infieldImageUrl={infieldImageUrl}
          activePitch={activePitch}
          revealCall={showReveal}
          animatePitchIn={animatePitchIn}
          showStrikeZone={showStrikeZone}
          className="h-full w-full"
        >
          <Scorebug gameState={gameState} variant="overlay" />
        </CatcherScene>

        {showReveal ? (
          <div
            className={cn(
              "pointer-events-none absolute inset-x-3 bottom-3 z-30 rounded-lg border px-3 py-2.5 text-center shadow-lg backdrop-blur-md sm:px-4 sm:py-3",
              reveal.correct
                ? "border-emerald-400/50 bg-black/70 text-emerald-100"
                : "border-red-400/50 bg-black/70 text-red-100",
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

        {showPitchNotice ? (
          <div className="pointer-events-none absolute inset-x-3 bottom-3 z-30 rounded-lg border border-white/20 bg-black/75 px-3 py-2.5 text-center text-sm text-white shadow-lg backdrop-blur-md">
            <p className="font-semibold">{pitchNotice.label}</p>
            {pitchNotice.endsAtBat ? (
              <p className="mt-0.5 text-xs text-white/75">Ball in play — not scored</p>
            ) : (
              <p className="mt-0.5 text-xs text-white/75">Not a callable pitch</p>
            )}
          </div>
        ) : null}

        {showAtBatNotice ? (
          <div className="pointer-events-none absolute inset-x-3 bottom-3 z-30 rounded-lg border border-sky-400/40 bg-black/75 px-3 py-2.5 text-center text-white shadow-lg backdrop-blur-md">
            <p className="text-xs uppercase tracking-wide text-sky-300">At-bat result</p>
            <p className="mt-0.5 text-sm font-semibold">{atBatNotice.batterName}</p>
            <p className="mt-1 text-xs text-white/85">{atBatNotice.description}</p>
          </div>
        ) : null}
      </div>

      <div className="shrink-0 border-t border-border bg-panel p-2 sm:p-3">
        <div className="mx-auto flex max-w-3xl flex-col gap-2">
          <NerdStatsPanel gameState={gameState} />
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <ModeToggle mode={mode} onChange={setMode} />
              <ZoneToggle showZone={showStrikeZone} onChange={handleZoneToggle} />
            </div>
            <p className="truncate text-xs text-muted">
              {gameState?.batterName ?? "—"} vs {gameState?.pitcherName ?? "—"}
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
            <Scoreboard
              correct={score.correct}
              total={score.total}
              streak={score.streak}
              bestStreak={score.bestStreak}
            />
            <p className="text-center text-sm text-secondary sm:text-right">{statusMessage}</p>
          </div>

          <GuessButtons
            canGuess={canGuess}
            lockedGuess={lockedGuess}
            onGuess={handleGuess}
          />
        </div>
      </div>
    </div>
  );
}
