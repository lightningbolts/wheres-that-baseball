"use client";

import { cn } from "@/lib/utils";
import { pitchResultColor } from "@/lib/mlb/strikeZoneMath";
import type { PlayPitch } from "@/types/mlb-live";

const FEED_SIZE = {
  compact: {
    feed: "text-[12px]",
    badge: "h-6 w-6 text-[10px]",
    rowPy: "py-2",
  },
  default: {
    feed: "text-[13px]",
    badge: "h-7 w-7 text-[11px]",
    rowPy: "py-2.5",
  },
} as const;

function reviewBadge(review: NonNullable<PlayPitch["review"]>): string {
  return review.isOverturned ? "ABS overturned" : "ABS confirmed";
}

/** Gameday-style pitch rows for play-by-play feeds. */
export function PitchFeedList({
  pitches,
  size = "compact",
  entranceFromIndex = pitches.length,
  reverse = false,
  /** Drop horizontal padding when a parent already provides the gutter. */
  flush = false,
  className,
}: {
  pitches: PlayPitch[];
  size?: keyof typeof FEED_SIZE;
  entranceFromIndex?: number;
  /** Newest pitch first (mobile feed). */
  reverse?: boolean;
  flush?: boolean;
  className?: string;
}) {
  const styles = FEED_SIZE[size];

  if (pitches.length === 0) return null;

  const orderedPitches = reverse ? [...pitches].reverse() : pitches;

  return (
    <ul className={cn("divide-y divide-border/40 bg-panel/40", styles.feed, className)} role="list">
      {orderedPitches.map((pitch, displayIndex) => {
        const index = reverse ? pitches.length - 1 - displayIndex : displayIndex;
        const color = pitchResultColor(pitch);
        const animate = index >= entranceFromIndex;

        return (
          <li
            key={`${pitch.pitchNumber}-${pitch.callCode}-${pitch.balls}-${pitch.strikes}`}
            className={cn(
              "flex items-start gap-3",
              flush ? "px-0" : "px-3",
              styles.rowPy,
              animate && "animate-pitch_in",
            )}
          >
            {pitch.isPitch ? (
              <span
                className={cn(
                  "flex shrink-0 items-center justify-center rounded-full font-bold text-white",
                  styles.badge,
                )}
                style={{ backgroundColor: color }}
              >
                {pitch.pitchNumber}
              </span>
            ) : (
              <span className={cn("shrink-0 rounded-full bg-faint", styles.badge)} />
            )}
            <div className="min-w-0 flex-1">
              <p className="font-medium leading-snug text-foreground">{pitch.callDescription}</p>
              {pitch.isPitch && pitch.startSpeed > 0 && (
                <p className="mt-0.5 text-muted">
                  {pitch.startSpeed.toFixed(1)} mph {pitch.typeDescription}
                </p>
              )}
              {pitch.isPitch && pitch.startSpeed <= 0 && (
                <p className="mt-0.5 text-muted">{pitch.typeDescription}</p>
              )}
              {pitch.review && (
                <p className="mt-0.5 text-xs font-medium text-amber-500">
                  {reviewBadge(pitch.review)}
                </p>
              )}
            </div>
            <span className="shrink-0 pt-0.5 font-mono text-sm tabular-nums text-secondary">
              {pitch.balls} - {pitch.strikes}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
