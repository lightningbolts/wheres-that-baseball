"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { BaseDiamond } from "@/components/features/BaseDiamond";
import { CompactLineScore } from "@/components/features/CompactLineScore";
import { PitcherDuel } from "@/components/features/PitcherDuel";
import { TeamLogo } from "@/components/ui/TeamLogo";
import { useGameCardSnapshot } from "@/hooks/useGameCardSnapshot";
import { cn } from "@/lib/utils";
import { LIVE_GAME_STATUSES, type SlateGame } from "@/types/mlb";
import type { GameBoxScore } from "@/types/mlb-boxscore";

interface LiveGameCardProps {
  game: SlateGame;
}

const CARD_PANEL =
  "w-full rounded-lg border border-border bg-panel transition-colors group-hover:border-border-strong group-hover:bg-surface-elevated";

function formatGameTime(gameDate: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
    timeZoneName: "short",
  }).format(new Date(gameDate));
}

function inningLabel(inning: number, half: string | null): string {
  if (!half) return `INN ${inning}`;
  const normalized = half.toLowerCase();
  const prefix = normalized.startsWith("top")
    ? "TOP"
    : normalized.startsWith("bot")
      ? "BOT"
      : normalized.toUpperCase();
  return `${prefix} ${inning}`;
}

function OutsDots({ outs }: { outs: number }) {
  const safe = Math.min(3, Math.max(0, outs));
  return (
    <div className="flex items-center gap-0.5" aria-label={`${safe} outs`}>
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            index < safe ? "bg-foreground" : "bg-border-strong",
          )}
        />
      ))}
    </div>
  );
}

export function LiveGameCard({ game }: LiveGameCardProps) {
  const isLive = LIVE_GAME_STATUSES.has(game.status);
  const isFinal = game.status === "Final";
  const liveState = useGameCardSnapshot(game.gamePk, isLive);

  const [boxScore, setBoxScore] = useState<GameBoxScore | null>(null);
  const [boxLoading, setBoxLoading] = useState(false);
  const [hovered, setHovered] = useState(false);

  const awayRuns = liveState?.awayRuns ?? game.awayScore;
  const homeRuns = liveState?.homeRuns ?? game.homeScore;
  const inning = liveState?.inning ?? game.currentInning;
  const inningHalf = liveState?.inningHalf ?? game.inningHalf;
  const awayPitcher = liveState?.awayPitcher ?? game.awayPitcher;
  const homePitcher = liveState?.homePitcher ?? game.homePitcher;
  const pitcherLabel = isLive ? "Pitcher" : "Probable";

  const fetchBoxScore = useCallback(async () => {
    if (boxScore || boxLoading) return;
    setBoxLoading(true);
    try {
      const response = await fetch(`/api/games/${game.gamePk}/boxscore?live=1`, {
        cache: "no-store",
      });
      if (!response.ok) return;
      const data = (await response.json()) as { boxScore: GameBoxScore };
      setBoxScore(data.boxScore);
    } catch {
      // box score panel is optional
    } finally {
      setBoxLoading(false);
    }
  }, [boxScore, boxLoading, game.gamePk]);

  useEffect(() => {
    if (isLive || isFinal) {
      void fetchBoxScore();
    }
  }, [fetchBoxScore, isFinal, isLive]);

  const handleMouseEnter = () => {
    setHovered(true);
    void fetchBoxScore();
  };

  return (
    <Link
      href={`/live/${game.gamePk}`}
      className="group relative block w-full"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setHovered(false)}
      onFocus={handleMouseEnter}
      onBlur={() => setHovered(false)}
    >
      <div className={cn(CARD_PANEL, "p-4")}>
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            {isLive && inning != null ? (
              <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground">
                {inningLabel(inning, inningHalf)}
              </p>
            ) : isFinal ? (
              <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground">
                Final
              </p>
            ) : (
              <p className="text-[11px] font-medium text-muted">{formatGameTime(game.gameDate)}</p>
            )}
            {isLive && (
              <span className="mt-0.5 inline-block text-[10px] font-semibold uppercase text-red-500">
                Live
              </span>
            )}
          </div>

          {(awayRuns != null || homeRuns != null) && (
            <div className="shrink-0 text-right text-[10px] text-muted">
              <div className="grid grid-cols-[1.5rem_1.5rem_1.5rem] gap-x-1 font-medium">
                <span>R</span>
                <span>H</span>
                <span>E</span>
              </div>
              <div className="grid grid-cols-[1.5rem_1.5rem_1.5rem] gap-x-1 font-mono tabular-nums text-foreground">
                <span>{awayRuns ?? "—"}</span>
                <span>{game.awayHits ?? "—"}</span>
                <span>{game.awayErrors ?? "—"}</span>
              </div>
              <div className="grid grid-cols-[1.5rem_1.5rem_1.5rem] gap-x-1 font-mono tabular-nums text-foreground">
                <span>{homeRuns ?? "—"}</span>
                <span>{game.homeHits ?? "—"}</span>
                <span>{game.homeErrors ?? "—"}</span>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <TeamLogo abbrev={game.awayAbbrev} size={32} />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{game.awayTeam}</p>
                <p className="text-[11px] text-muted">{game.awayAbbrev}</p>
              </div>
            </div>
            <span className="font-mono text-2xl font-bold tabular-nums text-foreground">
              {awayRuns ?? "—"}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <TeamLogo abbrev={game.homeAbbrev} size={32} />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{game.homeTeam}</p>
                <p className="text-[11px] text-muted">{game.homeAbbrev}</p>
              </div>
            </div>
            <span className="font-mono text-2xl font-bold tabular-nums text-foreground">
              {homeRuns ?? "—"}
            </span>
          </div>
        </div>

        {isLive && liveState && (
          <div className="mt-4 flex items-center justify-between gap-3 border-t border-border/60 pt-3">
            <div className="flex items-center gap-2">
              <BaseDiamond
                onFirst={liveState.onFirst}
                onSecond={liveState.onSecond}
                onThird={liveState.onThird}
                size="tiny"
              />
              <OutsDots outs={liveState.outs} />
            </div>
            <span className="font-mono text-sm font-semibold tabular-nums text-foreground">
              {liveState.balls}-{liveState.strikes}
            </span>
          </div>
        )}

        <PitcherDuel
          awayPitcher={awayPitcher}
          homePitcher={homePitcher}
          awayLabel={pitcherLabel}
          homeLabel={pitcherLabel}
          className="mt-4"
        />

        {!isLive && !isFinal && !awayPitcher && !homePitcher && (
          <p className="mt-3 border-t border-border/60 pt-3 text-[11px] text-muted">
            {game.status}
          </p>
        )}
      </div>

      {(isLive || isFinal) && (
        <div className={cn(CARD_PANEL, "mt-2 p-4 md:hidden")}>
          {boxScore ? (
            <CompactLineScore boxScore={boxScore} className="w-full" />
          ) : (
            <p className="py-2 text-center text-xs text-muted">
              {boxLoading ? "Loading box score…" : "Box score unavailable"}
            </p>
          )}
        </div>
      )}

      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 top-full z-20 mt-1 rounded-lg border border-border-strong bg-panel p-4 shadow-xl transition-opacity duration-150",
          "hidden md:block",
          hovered ? "opacity-100" : "opacity-0",
        )}
        aria-hidden={!hovered}
      >
        {boxScore ? (
          <CompactLineScore boxScore={boxScore} className="w-full" />
        ) : (
          <p className="py-4 text-center text-xs text-muted">
            {boxLoading ? "Loading box score…" : "Hover for box score"}
          </p>
        )}
      </div>
    </Link>
  );
}
