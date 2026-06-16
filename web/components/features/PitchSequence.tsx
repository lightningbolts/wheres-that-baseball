"use client";

import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";
import type { PlayPitch } from "@/types/mlb-live";
import {
  homePlatePath,
  pitchResultColor,
  toSvgPercent,
  zoneRectPercent,
} from "@/lib/mlb/strikeZoneMath";

interface PitchSequenceProps {
  pitches: PlayPitch[];
  className?: string;
  compact?: boolean;
  size?: "compact" | "default" | "large";
  layout?: "horizontal" | "stacked" | "split";
  scrollToLatest?: boolean;
  /** When true, pitch list scrolls inside its column (dashboard). When false, expands (dialog). */
  contained?: boolean;
  /** Fade in newly arrived pitches (live at-bat). */
  animateEntrance?: boolean;
}

function usePitchEntranceIndex(pitches: PlayPitch[], enabled: boolean): number {
  const seenLengthRef = useRef(enabled ? pitches.length : 0);
  const prevLengthRef = useRef(pitches.length);

  if (!enabled) return pitches.length;

  if (pitches.length === 0) {
    seenLengthRef.current = 0;
  } else if (pitches.length < prevLengthRef.current) {
    seenLengthRef.current = 0;
  }

  const entranceFromIndex = seenLengthRef.current;
  prevLengthRef.current = pitches.length;

  useEffect(() => {
    if (!enabled) return;
    seenLengthRef.current = pitches.length;
  }, [enabled, pitches.length]);

  return entranceFromIndex;
}

function reviewBadge(review: NonNullable<PlayPitch["review"]>): string {
  return review.isOverturned ? "ABS overturned" : "ABS confirmed";
}

const SIZE_STYLES = {
  compact: {
    chart: "w-[120px]",
    chartMinH: "min-h-[180px]",
    dotR: 2.2,
    dotFont: 2.6,
    feed: "text-[12px]",
    badge: "h-6 w-6 text-[10px]",
    rowPy: "py-2",
  },
  default: {
    chart: "w-[160px]",
    chartMinH: "min-h-[220px]",
    dotR: 2.6,
    dotFont: 2.8,
    feed: "text-[13px]",
    badge: "h-7 w-7 text-[11px]",
    rowPy: "py-2.5",
  },
  large: {
    chart: "w-[200px]",
    chartMinH: "min-h-[280px]",
    dotR: 3.2,
    dotFont: 3.2,
    feed: "text-[14px]",
    badge: "h-8 w-8 text-[12px]",
    rowPy: "py-3",
  },
} as const;

function StrikeZoneChart({
  pitches,
  className,
  size,
  fill,
  entranceFromIndex = pitches.length,
}: {
  pitches: PlayPitch[];
  className?: string;
  size: keyof typeof SIZE_STYLES;
  fill?: boolean;
  entranceFromIndex?: number;
}) {
  const styles = SIZE_STYLES[size];
  const plotted = pitches.filter((p) => p.isPitch);
  const szTop = plotted[plotted.length - 1]?.strikeZoneTop ?? 3.5;
  const szBottom = plotted[plotted.length - 1]?.strikeZoneBottom ?? 1.5;
  const zone = zoneRectPercent(szTop, szBottom);
  const plate = homePlatePath(zone);

  return (
    <svg
      viewBox="0 0 100 100"
      className={cn(
        "border border-border bg-zone-chart-bg",
        fill ? cn("h-full w-full", styles.chartMinH) : cn("shrink-0", styles.chart),
        className,
      )}
      aria-hidden
      preserveAspectRatio="xMidYMid meet"
    >
      <path
        d={plate}
        fill="var(--zone-chart-plate)"
        stroke="var(--zone-chart-grid)"
        strokeWidth="0.55"
      />
      <rect
        x={zone.x}
        y={zone.y}
        width={zone.width}
        height={zone.height}
        fill="var(--zone-chart-zone-fill)"
        stroke="var(--zone-chart-grid)"
        strokeWidth="0.85"
      />
      {[1, 2].map((i) => (
        <line
          key={`v${i}`}
          x1={zone.x + (zone.width * i) / 3}
          y1={zone.y}
          x2={zone.x + (zone.width * i) / 3}
          y2={zone.y + zone.height}
          stroke="var(--zone-chart-grid)"
          strokeWidth="0.35"
          opacity="0.8"
        />
      ))}
      {[1, 2].map((i) => (
        <line
          key={`h${i}`}
          x1={zone.x}
          y1={zone.y + (zone.height * i) / 3}
          x2={zone.x + zone.width}
          y2={zone.y + (zone.height * i) / 3}
          stroke="var(--zone-chart-grid)"
          strokeWidth="0.35"
          opacity="0.8"
        />
      ))}
      {plotted.map((pitch, index) => {
        const dot = toSvgPercent(pitch.plateX, pitch.plateZ, szTop, szBottom);
        const color = pitchResultColor(pitch);
        const animate = index >= entranceFromIndex;
        return (
          <g
            key={`${pitch.pitchNumber}-${pitch.callCode}`}
            className={animate ? "animate-pitch_in opacity-0" : undefined}
          >
            <circle cx={dot.x} cy={dot.y} r={styles.dotR + 0.35} fill="rgb(0 0 0 / 0.2)" />
            <circle cx={dot.x} cy={dot.y} r={styles.dotR} fill={color} />
            <text
              x={dot.x}
              y={dot.y}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={styles.dotFont}
              fill="#fff"
              fontWeight="bold"
            >
              {pitch.pitchNumber}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Gameday-style vertical pitch list. */
function PitchFeed({
  pitches,
  size,
  entranceFromIndex = pitches.length,
}: {
  pitches: PlayPitch[];
  size: keyof typeof SIZE_STYLES;
  entranceFromIndex?: number;
}) {
  const styles = SIZE_STYLES[size];

  return (
    <ul className={cn("divide-y divide-border", styles.feed)} role="list">
      {pitches.map((p, index) => {
        const color = pitchResultColor(p);
        const animate = index >= entranceFromIndex;
        return (
          <li
            key={`${p.pitchNumber}-${p.callCode}-${p.balls}-${p.strikes}`}
            className={cn(
              "flex items-start gap-3",
              styles.rowPy,
              animate && "animate-pitch_in opacity-0",
            )}
          >
            {p.isPitch ? (
              <span
                className={cn(
                  "flex shrink-0 items-center justify-center rounded-full font-bold text-white",
                  styles.badge,
                )}
                style={{ backgroundColor: color }}
              >
                {p.pitchNumber}
              </span>
            ) : (
              <span className={cn("shrink-0 rounded-full bg-faint", styles.badge)} />
            )}
            <div className="min-w-0 flex-1">
              <p className="font-medium leading-snug text-foreground">{p.callDescription}</p>
              {p.isPitch && (
                <p className="mt-0.5 text-muted">
                  {p.startSpeed.toFixed(1)} mph {p.typeDescription}
                </p>
              )}
              {p.review && (
                <p className="mt-0.5 text-xs font-medium text-amber-500">{reviewBadge(p.review)}</p>
              )}
            </div>
            <span className="shrink-0 pl-2 pt-0.5 font-mono text-sm tabular-nums text-secondary">
              {p.balls} - {p.strikes}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function PitchFeedColumn({
  pitches,
  resolvedSize,
  contained,
  scrollToLatest,
  entranceFromIndex,
  className,
}: {
  pitches: PlayPitch[];
  resolvedSize: keyof typeof SIZE_STYLES;
  contained: boolean;
  scrollToLatest?: boolean;
  entranceFromIndex: number;
  className?: string;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(pitches.length);

  useEffect(() => {
    if (!scrollToLatest || pitches.length === 0) return;
    if (pitches.length >= prevCountRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
    prevCountRef.current = pitches.length;
  }, [pitches.length, scrollToLatest]);

  if (!contained) {
    return (
      <div className={className}>
        <PitchFeed
          pitches={pitches}
          size={resolvedSize}
          entranceFromIndex={entranceFromIndex}
        />
        <div ref={bottomRef} className="h-px" aria-hidden />
      </div>
    );
  }

  return (
    <div className={cn("flex min-h-0 flex-col overflow-hidden", className)}>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain [scrollbar-gutter:stable]">
        <div className="pr-2">
          <PitchFeed
            pitches={pitches}
            size={resolvedSize}
            entranceFromIndex={entranceFromIndex}
          />
          <div ref={bottomRef} className="h-px shrink-0" aria-hidden />
        </div>
      </div>
    </div>
  );
}

function SplitLayout({
  pitches,
  resolvedSize,
  contained,
  className,
  scrollToLatest,
  entranceFromIndex,
}: {
  pitches: PlayPitch[];
  resolvedSize: keyof typeof SIZE_STYLES;
  contained: boolean;
  className?: string;
  scrollToLatest?: boolean;
  entranceFromIndex: number;
}) {
  const styles = SIZE_STYLES[resolvedSize];

  return (
    <div
      className={cn(
        "flex flex-col gap-3 md:flex-row",
        contained ? "h-full min-h-0 overflow-hidden" : "items-start",
        className,
      )}
    >
      <PitchFeedColumn
        pitches={pitches}
        resolvedSize={resolvedSize}
        contained={contained}
        scrollToLatest={scrollToLatest}
        entranceFromIndex={entranceFromIndex}
        className={cn(
          "min-w-0 flex-[1]",
          contained && "min-h-0",
          !contained && "md:max-w-[38%]",
        )}
      />

      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-[2] flex-col",
          contained ? "h-full" : "w-full md:w-auto",
          styles.chartMinH,
        )}
      >
        <StrikeZoneChart
          pitches={pitches}
          size={resolvedSize}
          fill
          entranceFromIndex={entranceFromIndex}
          className="flex-1"
        />
      </div>
    </div>
  );
}

/** Zone + Gameday pitch feed. Use layout="split" for dashboard; contained scrolls in-panel. */
export function PitchSequence({
  pitches,
  className,
  compact,
  size,
  layout = "split",
  scrollToLatest,
  contained = true,
  animateEntrance = false,
}: PitchSequenceProps) {
  const resolvedSize = size ?? (compact ? "compact" : "default");
  const entranceFromIndex = usePitchEntranceIndex(pitches, animateEntrance);

  if (pitches.length === 0) {
    return <p className="text-sm text-subtle">No pitches yet.</p>;
  }

  if (layout === "split" || layout === "stacked" || layout === "horizontal") {
    return (
      <SplitLayout
        pitches={pitches}
        resolvedSize={resolvedSize}
        contained={contained}
        className={className}
        scrollToLatest={scrollToLatest}
        entranceFromIndex={entranceFromIndex}
      />
    );
  }

  return null;
}
