"use client";

import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";
import type { PlayPitch } from "@/types/mlb-live";
import { pitchResultColor, toSvgPercent, zoneRectPercent } from "@/lib/mlb/strikeZoneMath";

interface PitchSequenceProps {
  pitches: PlayPitch[];
  className?: string;
  compact?: boolean;
  size?: "compact" | "default" | "large";
  layout?: "horizontal" | "stacked";
  scrollToLatest?: boolean;
}

function reviewBadge(review: NonNullable<PlayPitch["review"]>): string {
  return review.isOverturned ? "ABS overturned" : "ABS confirmed";
}

const SIZE_STYLES = {
  compact: {
    chart: "w-[120px]",
    chartStacked: "h-32",
    dotR: 2.2,
    dotFont: 2.6,
    table: "text-[12px]",
    head: "text-[10px]",
    rowPy: "py-1",
    marker: "h-1.5 w-1.5",
  },
  default: {
    chart: "w-[140px]",
    chartStacked: "h-40",
    dotR: 2.6,
    dotFont: 2.8,
    table: "text-[13px]",
    head: "text-[11px]",
    rowPy: "py-1.5",
    marker: "h-2 w-2",
  },
  large: {
    chart: "w-[200px]",
    chartStacked: "min-h-[280px] flex-1",
    dotR: 3.2,
    dotFont: 3.2,
    table: "text-[16px]",
    head: "text-[13px]",
    rowPy: "py-2.5",
    marker: "h-3 w-3",
  },
} as const;

function StrikeZoneChart({
  pitches,
  className,
  size,
  stacked,
}: {
  pitches: PlayPitch[];
  className?: string;
  size: keyof typeof SIZE_STYLES;
  stacked?: boolean;
}) {
  const styles = SIZE_STYLES[size];
  const plotted = pitches.filter((p) => p.isPitch);
  const szTop = plotted[plotted.length - 1]?.strikeZoneTop ?? 3.5;
  const szBottom = plotted[plotted.length - 1]?.strikeZoneBottom ?? 1.5;
  const zone = zoneRectPercent(szTop, szBottom);

  return (
    <svg
      viewBox="0 0 100 100"
      className={cn(
        "border border-border bg-scorebug",
        stacked ? cn("w-full shrink-0", styles.chartStacked) : cn("shrink-0", styles.chart),
        className,
      )}
      aria-hidden
      preserveAspectRatio="xMidYMid meet"
    >
      {/* Home plate */}
      <path
        d="M42 92 L50 98 L58 92 L58 88 L42 88 Z"
        fill="#262626"
        stroke="#525252"
        strokeWidth="0.6"
      />
      <rect
        x={zone.x}
        y={zone.y}
        width={zone.width}
        height={zone.height}
        fill="none"
        stroke="#525252"
        strokeWidth="0.8"
      />
      {[1, 2].map((i) => (
        <line
          key={`v${i}`}
          x1={zone.x + (zone.width * i) / 3}
          y1={zone.y}
          x2={zone.x + (zone.width * i) / 3}
          y2={zone.y + zone.height}
          stroke="#333"
          strokeWidth="0.4"
        />
      ))}
      {[1, 2].map((i) => (
        <line
          key={`h${i}`}
          x1={zone.x}
          y1={zone.y + (zone.height * i) / 3}
          x2={zone.x + zone.width}
          y2={zone.y + (zone.height * i) / 3}
          stroke="#333"
          strokeWidth="0.4"
        />
      ))}
      {plotted.map((pitch) => {
        const dot = toSvgPercent(pitch.plateX, pitch.plateZ, szTop, szBottom);
        const color = pitchResultColor(pitch);
        return (
          <g key={`${pitch.pitchNumber}-${pitch.callCode}`}>
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

function PitchTable({
  pitches,
  size,
  showPitchType,
}: {
  pitches: PlayPitch[];
  size: keyof typeof SIZE_STYLES;
  showPitchType: boolean;
}) {
  const styles = SIZE_STYLES[size];

  return (
    <table className={cn("w-full text-left", styles.table)}>
      <thead className="sticky top-0 bg-panel">
        <tr className={cn("border-b border-border text-subtle", styles.head)}>
          <th className="pb-2 pr-4 font-normal">#</th>
          <th className="pb-2 pr-4 font-normal">Cnt</th>
          <th className="pb-2 pr-4 font-normal">Result</th>
          {showPitchType && <th className="pb-2 pr-4 font-normal">Pitch</th>}
          <th className="pb-2 font-normal text-right">mph</th>
        </tr>
      </thead>
      <tbody>
        {pitches.map((p) => {
          const color = pitchResultColor(p);
          return (
            <tr
              key={`${p.pitchNumber}-${p.callCode}-${p.balls}-${p.strikes}`}
              className="border-b border-border/50"
            >
              <td className={cn("pr-4 font-mono text-muted", styles.rowPy)}>
                {p.isPitch ? (
                  <span className="inline-flex items-center gap-2">
                    <span
                      className={cn("inline-block rounded-full", styles.marker)}
                      style={{ backgroundColor: color }}
                    />
                    {p.pitchNumber}
                  </span>
                ) : (
                  "—"
                )}
              </td>
              <td className={cn("pr-4 font-mono tabular-nums text-secondary", styles.rowPy)}>
                {p.balls}-{p.strikes}
              </td>
              <td className={cn("pr-4 text-foreground", styles.rowPy)}>
                <span>{p.callDescription}</span>
                {p.review && (
                  <span className="ml-2 text-[12px] font-medium text-amber-500">
                    {reviewBadge(p.review)}
                  </span>
                )}
              </td>
              {showPitchType && (
                <td className={cn("pr-4 text-muted", styles.rowPy)}>
                  {p.typeDescription}
                </td>
              )}
              <td
                className={cn(
                  "text-right font-mono tabular-nums text-secondary",
                  styles.rowPy,
                )}
              >
                {p.isPitch ? p.startSpeed.toFixed(1) : ""}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Zone + pitch table. Use layout="stacked" for full-width dashboard display. */
export function PitchSequence({
  pitches,
  className,
  compact,
  size,
  layout = "horizontal",
  scrollToLatest,
}: PitchSequenceProps) {
  const resolvedSize = size ?? (compact ? "compact" : "default");
  const showPitchType = resolvedSize !== "compact";
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(pitches.length);

  useEffect(() => {
    if (!scrollToLatest || pitches.length === 0) return;
    if (pitches.length >= prevCountRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
    prevCountRef.current = pitches.length;
  }, [pitches.length, scrollToLatest]);

  if (pitches.length === 0) {
    return <p className="text-sm text-subtle">No pitches yet.</p>;
  }

  if (layout === "stacked") {
    return (
      <div className={cn("flex h-full min-h-0 flex-col", className)}>
        <div className="flex min-h-[240px] flex-[3] flex-col">
          <StrikeZoneChart pitches={pitches} size={resolvedSize} stacked />
        </div>

        <div ref={scrollRef} className="mt-3 min-h-0 flex-[2] overflow-y-auto">
          <PitchTable
            pitches={pitches}
            size={resolvedSize}
            showPitchType={showPitchType}
          />
          <div ref={bottomRef} className="h-px shrink-0" aria-hidden />
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex gap-4", className)}>
      <StrikeZoneChart pitches={pitches} size={resolvedSize} />

      <div className="min-w-0 flex-1 overflow-x-auto">
        <PitchTable
          pitches={pitches}
          size={resolvedSize}
          showPitchType={showPitchType}
        />
      </div>
    </div>
  );
}
