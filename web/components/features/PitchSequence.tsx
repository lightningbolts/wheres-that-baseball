"use client";

import { memo, useEffect, useRef, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { PitchFeedList } from "@/components/features/PitchFeedList";
import { useEntranceIndex } from "@/hooks/useEntranceIndex";
import type { BatterHotZoneCell, PlayPitch } from "@/types/mlb-live";
import {
  homePlatePath,
  pitchResultColor,
  strikeZoneCellRect,
  toSvgPercent,
  zoneRectPercent,
} from "@/lib/mlb/strikeZoneMath";
import { zoneHeatLabelStyle } from "@/lib/mlb/zoneHeatColors";

interface PitchSequenceProps {
  pitches: PlayPitch[];
  className?: string;
  compact?: boolean;
  size?: "compact" | "default" | "large";
  layout?: "horizontal" | "stacked" | "split" | "zone" | "dashboard";
  scrollToLatest?: boolean;
  /** When true, pitch list scrolls inside its column (dashboard). When false, expands (dialog). */
  contained?: boolean;
  /** Fade in newly arrived pitches (live at-bat). */
  animateEntrance?: boolean;
  /** Mobile Gameday-style: large zone on top, pitch feed below. */
  zoneFirst?: boolean;
  /** Shorter strike zone on small screens (live dashboard). */
  mobileZoneCompact?: boolean;
  /** Batter hot/cold zone overlay (MLB zones 01–09). */
  batterZones?: BatterHotZoneCell[];
  /** Outcome odds panel under the pitch feed (desktop dashboard grid). */
  dashboardFooter?: ReactNode;
}

function usePitchEntranceIndex(pitches: PlayPitch[], enabled: boolean): number {
  return useEntranceIndex(pitches.length, enabled);
}

function reviewBadge(review: NonNullable<PlayPitch["review"]>): string {
  return review.isOverturned ? "ABS overturned" : "ABS confirmed";
}

const SIZE_STYLES = {
  compact: {
    chart: "w-[120px]",
    chartMinH: "min-h-[180px]",
    dotR: 2.1,
    dotFont: 2.6,
    feed: "text-[12px]",
    badge: "h-6 w-6 text-[10px]",
    rowPy: "py-2",
  },
  default: {
    chart: "w-[160px]",
    chartMinH: "min-h-[220px]",
    dotR: 2.4,
    dotFont: 2.8,
    feed: "text-[13px]",
    badge: "h-7 w-7 text-[11px]",
    rowPy: "py-2.5",
  },
  large: {
    chart: "w-[200px]",
    chartMinH: "min-h-[280px]",
    dotR: 2.7,
    dotFont: 3.0,
    feed: "text-[14px]",
    badge: "h-8 w-8 text-[12px]",
    rowPy: "py-3",
  },
} as const;

/** Desktop dashboard: pitch feed + outcome odds stay narrow; zone gets the rest. */
export const PITCH_FEED_COLUMN_CLASS =
  "flex w-full min-w-0 shrink-0 flex-col gap-3 overflow-hidden md:w-[33.333%] md:max-w-[38%]";

function BatterZoneOpsLabel({ className }: { className?: string }) {
  return (
    <p
      className={cn(
        "shrink-0 text-center text-[10px] font-semibold uppercase tracking-wide text-muted",
        className,
      )}
    >
      Batter OPS by zone
    </p>
  );
}

function ZoneWithOpsLabel({
  batterZones,
  className,
  children,
}: {
  batterZones?: BatterHotZoneCell[];
  className?: string;
  children: React.ReactNode;
}) {
  if (!batterZones?.length) {
    return <>{children}</>;
  }

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <BatterZoneOpsLabel className="mb-1 px-1" />
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

function ZoneHeatCells({
  zone,
  cells,
}: {
  zone: ReturnType<typeof zoneRectPercent>;
  cells: BatterHotZoneCell[];
}) {
  const byId = new Map(cells.map((cell) => [cell.zoneId.padStart(2, "0"), cell]));

  return (
    <>
      {Array.from({ length: 9 }, (_, index) => {
        const zoneId = String(index + 1).padStart(2, "0");
        const cell = byId.get(zoneId);
        if (!cell) return null;

        const rect = strikeZoneCellRect(zone, zoneId);
        if (!rect) return null;

        const fontSize = Math.min(rect.width, rect.height) * 0.34;
        const label = zoneHeatLabelStyle(cell.color, cell.temp);

        return (
          <g key={zoneId}>
            <rect
              x={rect.x}
              y={rect.y}
              width={rect.width}
              height={rect.height}
              fill={cell.color}
            />
            <text
              x={rect.x + rect.width / 2}
              y={rect.y + rect.height / 2}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={fontSize}
              fill={label.fill}
              fontWeight="600"
              stroke={label.stroke}
              strokeWidth={label.strokeWidth}
              paintOrder="stroke"
            >
              {cell.value}
            </text>
          </g>
        );
      })}
    </>
  );
}

/** Gameday-style mobile strike zone — roughly 40–45% of viewport height */
const MOBILE_ZONE_FIRST_HEIGHT =
  "h-[clamp(17rem,45vh,28rem)] w-full shrink-0";

/** Compact zone for live dashboard — capped so play-by-play keeps room on small phones */
const MOBILE_ZONE_COMPACT_HEIGHT =
  "h-[clamp(9rem,32dvh,13.5rem)] w-full shrink-0";

function mobileZoneHeightClass(compact?: boolean): string {
  return compact ? MOBILE_ZONE_COMPACT_HEIGHT : MOBILE_ZONE_FIRST_HEIGHT;
}

function ZoneGridLines({ zone }: { zone: ReturnType<typeof zoneRectPercent> }) {
  return (
    <>
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
      <rect
        x={zone.x}
        y={zone.y}
        width={zone.width}
        height={zone.height}
        fill="none"
        stroke="var(--zone-chart-grid)"
        strokeWidth="1"
      />
    </>
  );
}

function EmptyStrikeZone({
  className,
  zoneFirst = false,
  mobileZoneCompact = false,
  batterZones,
}: {
  className?: string;
  zoneFirst?: boolean;
  mobileZoneCompact?: boolean;
  batterZones?: BatterHotZoneCell[];
}) {
  const szTop = 3.5;
  const szBottom = 1.5;
  const zone = zoneRectPercent(szTop, szBottom);
  const plate = homePlatePath(zone, szTop, szBottom);

  return (
    <svg
      viewBox="0 0 100 100"
      className={cn(
        "w-full border border-border bg-zone-chart-bg",
        zoneFirst ? mobileZoneHeightClass(mobileZoneCompact) : "h-40",
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
        />
        {batterZones?.length ? <ZoneHeatCells zone={zone} cells={batterZones} /> : null}
        <ZoneGridLines zone={zone} />
    </svg>
  );
}

function StrikeZoneChart({
  pitches,
  className,
  size,
  fill,
  entranceFromIndex = pitches.length,
  batterZones,
}: {
  pitches: PlayPitch[];
  className?: string;
  size: keyof typeof SIZE_STYLES;
  fill?: boolean;
  entranceFromIndex?: number;
  batterZones?: BatterHotZoneCell[];
}) {
  const styles = SIZE_STYLES[size];
  const plotted = pitches.filter((p) => p.isPitch && p.hasPlateLocation !== false);
  const szTop = plotted[plotted.length - 1]?.strikeZoneTop ?? 3.5;
  const szBottom = plotted[plotted.length - 1]?.strikeZoneBottom ?? 1.5;
  const zone = zoneRectPercent(szTop, szBottom);
  const plate = homePlatePath(zone, szTop, szBottom);

  return (
    <svg
      viewBox="0 0 100 100"
      className={cn(
        "border border-border bg-zone-chart-bg",
        fill ? cn("h-full w-full touch-none", styles.chartMinH) : cn("shrink-0", styles.chart),
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
        fill={batterZones?.length ? "transparent" : "var(--zone-chart-zone-fill)"}
      />
      {batterZones?.length ? <ZoneHeatCells zone={zone} cells={batterZones} /> : null}
      <ZoneGridLines zone={zone} />
      {plotted.map((pitch, index) => {
        const dot = toSvgPercent(pitch.plateX, pitch.plateZ, szTop, szBottom);
        const color = pitchResultColor(pitch);
        const animate = index >= entranceFromIndex;
        const dotR = styles.dotR;
        return (
          <g
            key={`${pitch.pitchNumber}-${pitch.callCode}`}
            className={animate ? "animate-pitch_in" : undefined}
          >
            <circle cx={dot.x} cy={dot.y} r={dotR + 0.3} fill="rgb(0 0 0 / 0.2)" />
            <circle cx={dot.x} cy={dot.y} r={dotR} fill={color} />
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

const MemoStrikeZoneChart = memo(StrikeZoneChart);

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
  const feedSize = size === "large" ? "default" : size === "compact" ? "compact" : "default";

  return (
    <PitchFeedList
      pitches={pitches}
      size={feedSize}
      entranceFromIndex={entranceFromIndex}
    />
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
      bottomRef.current?.scrollIntoView({ block: "end" });
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

function DashboardGridLayout({
  pitches,
  resolvedSize,
  scrollToLatest,
  entranceFromIndex,
  batterZones,
  dashboardFooter,
  className,
}: {
  pitches: PlayPitch[];
  resolvedSize: keyof typeof SIZE_STYLES;
  scrollToLatest?: boolean;
  entranceFromIndex: number;
  batterZones?: BatterHotZoneCell[];
  dashboardFooter?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-full min-h-0 w-full flex-col gap-3 overflow-hidden md:flex-row md:items-stretch",
        className,
      )}
    >
      <div className={PITCH_FEED_COLUMN_CLASS}>
        <PitchFeedColumn
          pitches={pitches}
          resolvedSize={resolvedSize}
          contained
          scrollToLatest={scrollToLatest}
          entranceFromIndex={entranceFromIndex}
          className="min-h-0 flex-1 overflow-hidden"
        />
        {dashboardFooter ? (
          <div className="flex w-full shrink-0 flex-col overflow-hidden">
            <h4 className="mb-2 shrink-0 text-xs font-medium text-muted">Outcome odds</h4>
            <div className="max-h-[220px] min-h-0 overflow-hidden">{dashboardFooter}</div>
          </div>
        ) : null}
      </div>
      <ZoneWithOpsLabel
        batterZones={batterZones}
        className="min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      >
        <MemoStrikeZoneChart
          pitches={pitches}
          size="large"
          fill
          entranceFromIndex={entranceFromIndex}
          batterZones={batterZones}
          className="min-h-0 flex-1"
        />
      </ZoneWithOpsLabel>
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
  zoneFirst = false,
  mobileZoneCompact = false,
  batterZones,
}: {
  pitches: PlayPitch[];
  resolvedSize: keyof typeof SIZE_STYLES;
  contained: boolean;
  className?: string;
  scrollToLatest?: boolean;
  entranceFromIndex: number;
  zoneFirst?: boolean;
  mobileZoneCompact?: boolean;
  batterZones?: BatterHotZoneCell[];
}) {
  const styles = SIZE_STYLES[resolvedSize];
  const zoneSize = zoneFirst ? "large" : resolvedSize;

  const zoneChart = (
    <ZoneWithOpsLabel
      batterZones={batterZones}
      className={cn(
        "w-full",
        zoneFirst
          ? cn(mobileZoneHeightClass(mobileZoneCompact), "grow-0 md:h-auto md:min-h-0 md:shrink md:grow")
          : cn("min-h-0", contained ? "h-full" : "w-full md:w-auto", styles.chartMinH),
        zoneFirst ? "order-1 md:order-2 md:flex-[2]" : "flex-[2]",
      )}
    >
      <MemoStrikeZoneChart
        pitches={pitches}
        size={zoneSize}
        fill
        entranceFromIndex={entranceFromIndex}
        batterZones={batterZones}
        className={zoneFirst ? "h-full w-full" : "flex-1"}
      />
    </ZoneWithOpsLabel>
  );

  const pitchFeed = (
    <PitchFeedColumn
      pitches={pitches}
      resolvedSize={resolvedSize}
      contained={contained}
      scrollToLatest={scrollToLatest}
      entranceFromIndex={entranceFromIndex}
      className={cn(
        "min-w-0",
        zoneFirst
          ? "order-2 min-h-0 flex-1 md:order-1 md:max-h-none md:flex-[1]"
          : cn("flex-[1]", contained && "min-h-0", !contained && "md:max-w-[38%]"),
      )}
    />
  );

  return (
    <div
      className={cn(
        "flex w-full max-w-full overflow-x-hidden",
        zoneFirst && contained
          ? "h-full min-h-0 flex-col gap-2 overflow-hidden"
          : cn(
              "flex-col gap-3 md:flex-row",
              contained ? "h-full min-h-0 overflow-hidden" : "items-start",
            ),
        className,
      )}
    >
      {zoneFirst ? (
        <>
          {zoneChart}
          {pitchFeed}
        </>
      ) : (
        <>
          {pitchFeed}
          {zoneChart}
        </>
      )}
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
  zoneFirst = false,
  mobileZoneCompact = false,
  batterZones,
  dashboardFooter,
}: PitchSequenceProps) {
  const resolvedSize = size ?? (compact ? "compact" : "default");
  const entranceFromIndex = usePitchEntranceIndex(pitches, animateEntrance);

  if (layout === "zone") {
    if (pitches.length === 0) {
      return (
        <ZoneWithOpsLabel batterZones={batterZones} className={className}>
          <EmptyStrikeZone
            zoneFirst={zoneFirst}
            mobileZoneCompact={mobileZoneCompact}
            batterZones={batterZones}
            className={cn(
              zoneFirst ? mobileZoneHeightClass(mobileZoneCompact) : "h-40 w-full",
            )}
          />
        </ZoneWithOpsLabel>
      );
    }

    return (
      <ZoneWithOpsLabel batterZones={batterZones} className={className}>
        <MemoStrikeZoneChart
          pitches={pitches}
          size="large"
          fill={false}
          entranceFromIndex={entranceFromIndex}
          batterZones={batterZones}
          className={cn(
            zoneFirst ? mobileZoneHeightClass(mobileZoneCompact) : "h-40 w-full",
          )}
        />
      </ZoneWithOpsLabel>
    );
  }

  if (layout === "dashboard") {
    return (
      <DashboardGridLayout
        pitches={pitches}
        resolvedSize={resolvedSize}
        scrollToLatest={scrollToLatest}
        entranceFromIndex={entranceFromIndex}
        batterZones={batterZones}
        dashboardFooter={dashboardFooter}
        className={className}
      />
    );
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
        zoneFirst={zoneFirst}
        mobileZoneCompact={mobileZoneCompact}
        batterZones={batterZones}
      />
    );
  }

  return null;
}
