"use client";

import { useMemo } from "react";

import { PlayVideoPlayer } from "@/components/features/PlayVideoPlayer";
import { useGameHighlights } from "@/hooks/useGameHighlights";
import { HIT_EVENTS } from "@/lib/mlb/gameHits";
import type { GameHighlightClip } from "@/lib/mlb/gameHighlights";
import { isVideoEligiblePlay, uniqueHighlightPlays } from "@/lib/mlb/playVideo";
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
  /** Pitch + terminal GUIDs — same candidates dialogs use for Fastball resolve. */
  candidatePlayIds: string[];
  title: string;
  description: string;
  eventLabel: string | null;
  batterName: string | null;
  inningLabel: string | null;
  isHit: boolean;
  atBatIndex: number | null;
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
    <article className="flex h-full flex-col overflow-hidden rounded border border-border bg-surface">
      {/* Fixed header height so aspect-video frames align across the grid */}
      <div className="flex shrink-0 items-start justify-between gap-2 border-b border-border/60 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="flex min-h-[1.125rem] items-center gap-x-1.5 text-[13px] leading-none text-foreground">
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
            <span className="truncate font-medium leading-tight">
              {card.batterName ?? card.title}
            </span>
          </p>
          <p className="mt-1.5 line-clamp-2 min-h-[2.125rem] text-[11px] leading-snug text-muted">
            {card.description || card.title}
          </p>
        </div>
        {card.inningLabel ? (
          <span className="shrink-0 pt-px font-mono text-[10px] tabular-nums text-subtle">
            {card.inningLabel}
          </span>
        ) : null}
      </div>
      <PlayVideoPlayer
        playId={card.playId}
        candidatePlayIds={card.candidatePlayIds}
        gamePk={gamePk}
        videoUrl={card.videoUrl}
        videoTitle={card.title}
        posterUrl={card.posterUrl}
        autoLoad={false}
        size="compact"
        showTitle={false}
        className="mt-auto shrink-0 rounded-none border-0 border-t-0"
      />
    </article>
  );
}

function indexPlaysByAnyPlayId(plays: PlayByPlayEntry[]): Map<string, PlayByPlayEntry> {
  const playById = new Map<string, PlayByPlayEntry>();
  for (const play of plays) {
    const id = play.playId ?? play.detail?.playId;
    if (id) {
      const existing = playById.get(id);
      if (!existing || (existing.isAtBat === false && play.isAtBat !== false)) {
        playById.set(id, play);
      }
    }
    for (const pitch of play.detail?.pitches ?? []) {
      if (pitch.playId && !playById.has(pitch.playId)) {
        playById.set(pitch.playId, play);
      }
    }
  }
  return playById;
}

function collectPlayIds(play: PlayByPlayEntry): string[] {
  const ids: string[] = [];
  const terminal = play.playId ?? play.detail?.playId;
  if (terminal) ids.push(terminal);
  for (const pitch of play.detail?.pitches ?? []) {
    if (pitch.playId) ids.push(pitch.playId);
  }
  return ids;
}

function cardFromPlay(
  play: PlayByPlayEntry,
  clip?: GameHighlightClip | null,
): HighlightCardModel {
  const candidatePlayIds = collectPlayIds(play);
  const playId =
    play.playId ?? play.detail.playId ?? clip?.playId ?? candidatePlayIds[0] ?? null;
  return {
    key: playId ?? `ab-${play.atBatIndex}`,
    playId,
    candidatePlayIds,
    title: clip?.title ?? play.event,
    description: play.description,
    eventLabel: eventShortLabel(play.event),
    batterName: play.batterName,
    inningLabel: `${play.inning} ${formatInningHalf(play.halfInning)}`,
    isHit: HIT_EVENTS.has(play.event),
    atBatIndex: play.atBatIndex,
    // Content MP4 when curated; otherwise PlayVideoPlayer resolves Fastball on tap.
    videoUrl: clip?.url ?? null,
    posterUrl: clip?.thumbnailUrl ?? null,
  };
}

function cardFromClipOnly(clip: GameHighlightClip): HighlightCardModel {
  const isHit = /home\s*run|\bHR\b|single|double|triple/i.test(clip.title);
  return {
    key: clip.id,
    playId: clip.playId,
    candidatePlayIds: clip.playId ? [clip.playId] : [],
    title: clip.title,
    description: clip.description ?? clip.title,
    eventLabel: null,
    batterName: null,
    inningLabel: null,
    isHit,
    atBatIndex: null,
    videoUrl: clip.url,
    posterUrl: clip.thumbnailUrl,
  };
}

/**
 * Every video-eligible PA (Gameday Fastball coverage) merged with Content clips.
 * Content MP4s attach when published; otherwise each card resolves Fastball on tap.
 */
export function buildHighlightCards(
  clips: GameHighlightClip[],
  plays: PlayByPlayEntry[],
): HighlightCardModel[] {
  const playById = indexPlaysByAnyPlayId(plays);
  const clipByPlayId = new Map<string, GameHighlightClip>();
  for (const clip of clips) {
    if (clip.playId) clipByPlayId.set(clip.playId, clip);
  }

  const coveredAtBats = new Set<number>();
  const usedClipIds = new Set<string>();
  const cards: HighlightCardModel[] = [];

  // 1) All finished PAs / steal rows with a play GUID — same set dialogs can play.
  for (const play of uniqueHighlightPlays(plays)) {
    if (!isVideoEligiblePlay(play)) continue;
    const ids = collectPlayIds(play);
    const clip = ids.map((id) => clipByPlayId.get(id)).find(Boolean) ?? null;
    if (clip) usedClipIds.add(clip.id);
    coveredAtBats.add(play.atBatIndex);
    cards.push(cardFromPlay(play, clip));
  }

  // 2) Content-only gems (defense, ABS, etc.) not already tied to a listed PA.
  for (const clip of clips) {
    if (usedClipIds.has(clip.id)) continue;
    const matched = clip.playId ? playById.get(clip.playId) : undefined;
    if (matched && coveredAtBats.has(matched.atBatIndex)) continue;
    if (matched) {
      coveredAtBats.add(matched.atBatIndex);
      cards.push(cardFromPlay(matched, clip));
    } else {
      cards.push(cardFromClipOnly(clip));
    }
    usedClipIds.add(clip.id);
  }

  cards.sort((a, b) => {
    const aIdx = a.atBatIndex ?? Number.MAX_SAFE_INTEGER;
    const bIdx = b.atBatIndex ?? Number.MAX_SAFE_INTEGER;
    if (aIdx !== bIdx) return aIdx - bIdx;
    if (a.isHit !== b.isHit) return a.isHit ? -1 : 1;
    return a.title.localeCompare(b.title);
  });

  return cards;
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

  const cards = useMemo(() => buildHighlightCards(clips, plays), [clips, plays]);

  const hitCount = cards.filter((card) => card.isHit).length;
  const readyCount = cards.filter((card) => Boolean(card.videoUrl)).length;
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
            ? "Clips appear as plays finish"
            : error
              ? "Could not load play videos"
              : "No play videos available for this game"}
        </p>
        <p className="max-w-sm text-[11px] text-subtle">
          Every finished at-bat shows here once it has a play GUID — tap to load the Gameday clip.
        </p>
      </div>
    );
  }

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <div className="shrink-0 border-b border-border px-3 py-2 sm:px-4">
        <p className="text-xs text-muted">
          <span className="font-mono tabular-nums text-foreground">{cards.length}</span> plays
          {hitCount > 0 && (
            <>
              {" "}
              ·{" "}
              <span className="font-mono tabular-nums">{hitCount}</span> hits
            </>
          )}
          {readyCount > 0 && readyCount < cards.length && (
            <>
              {" "}
              ·{" "}
              <span className="font-mono tabular-nums">{readyCount}</span> with video ready
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
