"use client";

import { useMemo } from "react";

import { PlayVideoPlayer } from "@/components/features/PlayVideoPlayer";
import { HIT_EVENTS } from "@/lib/mlb/gameHits";
import { uniqueHighlightPlays } from "@/lib/mlb/playVideo";
import { cn, formatInningHalf } from "@/lib/utils";
import type { PlayByPlayEntry } from "@/types/mlb-live";

interface GameHighlightsViewProps {
  plays: PlayByPlayEntry[];
  isLive?: boolean;
  isLoading?: boolean;
  className?: string;
}

function eventShortLabel(event: string): string {
  switch (event) {
    case "Single":
      return "1B";
    case "Double":
      return "2B";
    case "Triple":
      return "3B";
    case "Home Run":
      return "HR";
    case "Strikeout":
      return "K";
    case "Walk":
      return "BB";
    case "Intent Walk":
      return "IBB";
    case "Hit By Pitch":
      return "HBP";
    case "Groundout":
    case "Grounded Into DP":
      return "GO";
    case "Flyout":
      return "FO";
    case "Lineout":
      return "LO";
    case "Pop Out":
      return "PO";
    case "Forceout":
      return "FC";
    case "Field Error":
      return "E";
    case "Sac Fly":
      return "SF";
    case "Sac Bunt":
      return "SAC";
    case "Stolen Base":
    case "Stolen Base 2B":
    case "Stolen Base 3B":
    case "Stolen Base Home":
      return "SB";
    case "Caught Stealing":
    case "Caught Stealing 2B":
    case "Caught Stealing 3B":
    case "Caught Stealing Home":
      return "CS";
    default:
      return event.length > 8 ? `${event.slice(0, 7)}…` : event;
  }
}

function HighlightCard({ play }: { play: PlayByPlayEntry }) {
  const playId = play.playId ?? play.detail.playId;
  if (!playId) return null;
  const isHit = HIT_EVENTS.has(play.event);

  return (
    <article className="flex flex-col overflow-hidden rounded border border-border bg-surface">
      <div className="flex items-start justify-between gap-2 border-b border-border/60 px-3 py-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13px] text-foreground">
            <span
              className={cn(
                "inline-flex h-[1.125rem] shrink-0 items-center rounded px-1.5 font-mono text-[10px] font-semibold leading-none",
                isHit
                  ? "bg-amber-500/15 text-amber-800 dark:text-amber-300"
                  : "bg-overlay text-muted",
              )}
            >
              {eventShortLabel(play.event)}
            </span>
            <span className="truncate font-medium">{play.batterName}</span>
          </p>
          <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted">
            {play.description}
          </p>
        </div>
        <span className="shrink-0 pt-0.5 font-mono text-[10px] tabular-nums text-subtle">
          {play.inning} {formatInningHalf(play.halfInning)}
        </span>
      </div>
      <PlayVideoPlayer
        playId={playId}
        autoLoad
        size="compact"
        showTitle={false}
        className="rounded-none border-0 border-t-0"
      />
    </article>
  );
}

export function GameHighlightsView({
  plays,
  isLive = false,
  isLoading = false,
  className,
}: GameHighlightsViewProps) {
  const candidates = useMemo(() => uniqueHighlightPlays(plays), [plays]);
  const hitCount = candidates.filter((play) => HIT_EVENTS.has(play.event)).length;

  if (isLoading && plays.length === 0) {
    return (
      <div className={cn("flex h-full items-center justify-center p-6 text-sm text-subtle", className)}>
        Loading clips…
      </div>
    );
  }

  if (candidates.length === 0) {
    return (
      <div className={cn("flex h-full flex-col items-center justify-center gap-2 p-6 text-center", className)}>
        <p className="text-sm text-muted">
          {isLive
            ? "Clips appear as Savant publishes them"
            : "No play videos available for this game"}
        </p>
        <p className="max-w-sm text-[11px] text-subtle">
          Hits and other plate appearances with Baseball Savant video show up here once a play GUID is known.
        </p>
      </div>
    );
  }

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <div className="shrink-0 border-b border-border px-3 py-2 sm:px-4">
        <p className="text-xs text-muted">
          <span className="font-mono tabular-nums text-foreground">{candidates.length}</span> clips
          {hitCount > 0 && (
            <>
              {" "}
              ·{" "}
              <span className="font-mono tabular-nums">{hitCount}</span> hits first
            </>
          )}
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-3 sm:p-4">
        <div className="mx-auto grid max-w-5xl gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {candidates.map((play) => {
            const playId = play.playId ?? play.detail.playId ?? play.atBatIndex;
            return <HighlightCard key={playId} play={play} />;
          })}
        </div>
      </div>
    </div>
  );
}
