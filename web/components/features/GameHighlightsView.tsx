"use client";

import { useMemo } from "react";

import { PlayVideoPlayer } from "@/components/features/PlayVideoPlayer";
import { useGameHighlights } from "@/hooks/useGameHighlights";
import { HIT_EVENTS } from "@/lib/mlb/gameHits";
import type { GameHighlightClip } from "@/lib/mlb/gameHighlights";
import { uniqueHighlightPlays } from "@/lib/mlb/playVideo";
import { cn, formatInningHalf } from "@/lib/utils";
import type { PlayByPlayEntry } from "@/types/mlb-live";

interface GameHighlightsViewProps {
  gamePk: number;
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

interface HighlightCardModel {
  key: string;
  playId: string | null;
  title: string;
  description: string;
  eventLabel: string | null;
  batterName: string | null;
  inningLabel: string | null;
  isHit: boolean;
  videoUrl: string | null;
  posterUrl: string | null;
}

function HighlightCard({
  card,
  gamePk,
}: {
  card: HighlightCardModel;
  gamePk: number;
}) {
  if (!card.playId && !card.videoUrl) return null;

  return (
    <article className="flex flex-col overflow-hidden rounded border border-border bg-surface">
      <div className="flex items-start justify-between gap-2 border-b border-border/60 px-3 py-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13px] text-foreground">
            {card.eventLabel ? (
              <span
                className={cn(
                  "inline-flex h-[1.125rem] shrink-0 items-center rounded px-1.5 font-mono text-[10px] font-semibold leading-none",
                  card.isHit
                    ? "bg-amber-500/15 text-amber-800 dark:text-amber-300"
                    : "bg-overlay text-muted",
                )}
              >
                {card.eventLabel}
              </span>
            ) : null}
            <span className="truncate font-medium">
              {card.batterName ?? card.title}
            </span>
          </p>
          <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted">
            {card.description || card.title}
          </p>
        </div>
        {card.inningLabel ? (
          <span className="shrink-0 pt-0.5 font-mono text-[10px] tabular-nums text-subtle">
            {card.inningLabel}
          </span>
        ) : null}
      </div>
      <PlayVideoPlayer
        playId={card.playId}
        gamePk={gamePk}
        videoUrl={card.videoUrl}
        videoTitle={card.title}
        posterUrl={card.posterUrl}
        autoLoad={false}
        size="compact"
        showTitle={false}
        className="rounded-none border-0 border-t-0"
      />
    </article>
  );
}

function buildCardsFromContent(
  clips: GameHighlightClip[],
  plays: PlayByPlayEntry[],
): HighlightCardModel[] {
  const playById = new Map<string, PlayByPlayEntry>();
  for (const play of plays) {
    const id = play.playId ?? play.detail?.playId;
    if (!id) continue;
    // Prefer at-bat rows when multiple share a GUID.
    const existing = playById.get(id);
    if (!existing || (existing.isAtBat === false && play.isAtBat !== false)) {
      playById.set(id, play);
    }
    // Also index pitch-level IDs from the PA so Content guids that point at
    // the in-play pitch (not only the terminal stamp) still match.
    for (const pitch of play.detail?.pitches ?? []) {
      if (pitch.playId && !playById.has(pitch.playId)) {
        playById.set(pitch.playId, play);
      }
    }
  }

  return clips.map((clip) => {
    const play = clip.playId ? playById.get(clip.playId) : undefined;
    const isHit = play ? HIT_EVENTS.has(play.event) : /home\s*run|\bHR\b|single|double|triple/i.test(clip.title);
    return {
      key: clip.id,
      playId: clip.playId,
      title: clip.title,
      description: play?.description ?? clip.description ?? clip.title,
      eventLabel: play ? eventShortLabel(play.event) : null,
      batterName: play?.batterName ?? null,
      inningLabel: play
        ? `${play.inning} ${formatInningHalf(play.halfInning)}`
        : null,
      isHit,
      videoUrl: clip.url,
      posterUrl: clip.thumbnailUrl,
    };
  });
}

/** Fallback when Content has nothing yet — show play rows that may get Savant later. */
function buildCardsFromPlays(plays: PlayByPlayEntry[]): HighlightCardModel[] {
  return uniqueHighlightPlays(plays).map((play) => {
    const playId = play.playId ?? play.detail.playId ?? null;
    return {
      key: playId ?? String(play.atBatIndex),
      playId,
      title: play.event,
      description: play.description,
      eventLabel: eventShortLabel(play.event),
      batterName: play.batterName,
      inningLabel: `${play.inning} ${formatInningHalf(play.halfInning)}`,
      isHit: HIT_EVENTS.has(play.event),
      videoUrl: null,
      posterUrl: null,
    };
  });
}

export function GameHighlightsView({
  gamePk,
  plays,
  isLive = false,
  isLoading = false,
  className,
}: GameHighlightsViewProps) {
  const refreshKey = isLive ? plays.length : 0;
  const {
    clips,
    isLoading: clipsLoading,
    error,
  } = useGameHighlights(gamePk, { isLive, refreshKey });

  const cards = useMemo(() => {
    if (clips.length > 0) return buildCardsFromContent(clips, plays);
    // Live: don't dump every PA as a dead Savant card — wait for Content clips.
    if (isLive) return [];
    return buildCardsFromPlays(plays);
  }, [clips, plays, isLive]);

  const hitCount = cards.filter((card) => card.isHit).length;
  const waiting =
    (isLoading || clipsLoading) && cards.length === 0 && clips.length === 0;

  if (waiting) {
    return (
      <div className={cn("flex h-full items-center justify-center p-6 text-sm text-subtle", className)}>
        Loading clips…
      </div>
    );
  }

  if (cards.length === 0) {
    return (
      <div className={cn("flex h-full flex-col items-center justify-center gap-2 p-6 text-center", className)}>
        <p className="text-sm text-muted">
          {isLive
            ? "Clips appear as MLB publishes them"
            : error
              ? "Could not load play videos"
              : "No play videos available for this game"}
        </p>
        <p className="max-w-sm text-[11px] text-subtle">
          {isLive
            ? "In-game highlights show up here shortly after the play — usually before Baseball Savant has the clip."
            : "Hits and other plate appearances with available video show up here."}
        </p>
      </div>
    );
  }

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <div className="shrink-0 border-b border-border px-3 py-2 sm:px-4">
        <p className="text-xs text-muted">
          <span className="font-mono tabular-nums text-foreground">{cards.length}</span> clips
          {hitCount > 0 && (
            <>
              {" "}
              ·{" "}
              <span className="font-mono tabular-nums">{hitCount}</span> hits
            </>
          )}
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-3 sm:p-4">
        <div className="mx-auto grid max-w-5xl gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((card) => (
            <HighlightCard key={card.key} card={card} gamePk={gamePk} />
          ))}
        </div>
      </div>
    </div>
  );
}
