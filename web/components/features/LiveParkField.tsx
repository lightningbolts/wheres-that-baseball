"use client";

import { cn } from "@/lib/utils";
import {
  FIELD_SEGMENT_ORDER,
  FIELD_SEGMENT_STYLES,
  FIELD_VIEW_BOX,
  GENERIC_FIELD_SEGMENTS,
  getBallparkByVenueId,
  resolveBallparkVenueId,
} from "@/lib/mlb/ballparkPaths";
import type { FieldDefender } from "@/lib/mlb/fieldDefense";
import {
  FIELD_BASE_SLOTS,
  FIELD_DISTANCE_SLOTS,
} from "@/lib/mlb/fieldPositions";
import { playerLastName } from "@/lib/mlb/situationFormat";
import type { BallparkFieldInfo } from "@/types/ballpark";
import type { BaseRunner } from "@/types/mlb-live";

export interface LiveParkFieldProps {
  venueId?: number | null;
  homeTeamId?: number | null;
  batterName?: string | null;
  showBatter?: boolean;
  runnerFirst?: BaseRunner | null;
  runnerSecond?: BaseRunner | null;
  runnerThird?: BaseRunner | null;
  defense?: FieldDefender[];
  className?: string;
}

function FieldBackground({
  segments,
}: {
  segments: Record<string, string>;
}) {
  return (
    <>
      {FIELD_SEGMENT_ORDER.map((segment) => {
        const d = segments[segment];
        if (!d) return null;
        const style = FIELD_SEGMENT_STYLES[segment] ?? FIELD_SEGMENT_STYLES.outfield_outer;
        return (
          <path
            key={segment}
            d={d}
            fill={style.fill}
            stroke={style.stroke}
            strokeWidth={style.strokeWidth}
            opacity={style.opacity}
          />
        );
      })}
    </>
  );
}

function DistanceLabel({
  x,
  y,
  value,
}: {
  x: number;
  y: number;
  value: number | null | undefined;
}) {
  if (value == null) return null;
  return (
    <text
      x={x}
      y={y}
      textAnchor="middle"
      dominantBaseline="middle"
      fill="var(--muted)"
      fontFamily="var(--font-mono, ui-monospace, monospace)"
      fontSize={3.2}
    >
      {value}
    </text>
  );
}

function PositionPin({ defender }: { defender: FieldDefender }) {
  const labelW = 8;
  const labelH = 4.2;
  const { x, y } = defender;
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect
        x={-labelW / 2}
        y={-labelH - 1.2}
        width={labelW}
        height={labelH}
        fill="var(--surface-elevated)"
        stroke="var(--border)"
        strokeWidth={0.35}
      />
      <text
        y={-labelH / 2 - 1.2}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="var(--foreground)"
        fontSize={2.6}
        fontWeight={600}
      >
        {defender.position}
      </text>
      <polygon
        points="0,-1.2 -1.1,0.4 1.1,0.4"
        fill="var(--surface-elevated)"
        stroke="var(--border)"
        strokeWidth={0.25}
      />
      <circle r={0.7} fill="var(--foreground)" />
    </g>
  );
}

function RunnerMarker({
  base,
  runner,
}: {
  base: "first" | "second" | "third";
  runner: BaseRunner;
}) {
  const slot = FIELD_BASE_SLOTS[base];
  const label = playerLastName(runner.name);
  return (
    <g transform={`translate(${slot.x} ${slot.y})`}>
      <circle r={2.1} fill="var(--field-accent)" />
      <circle r={2.1} fill="none" stroke="var(--surface)" strokeWidth={0.35} />
      <text
        y={4.2}
        textAnchor="middle"
        fill="var(--foreground)"
        fontSize={2.4}
        fontWeight={600}
      >
        {label}
      </text>
    </g>
  );
}

function BatterLabel({ name }: { name: string }) {
  const slot = FIELD_BASE_SLOTS.home;
  const label = playerLastName(name);
  const width = Math.max(14, label.length * 2.2 + 4);
  return (
    <g transform={`translate(${slot.x} ${slot.y + 6})`}>
      <rect x={-width / 2} y={-3} width={width} height={5.2} fill="var(--field-accent)" />
      <text
        y={0.1}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="var(--field-accent-fg)"
        fontSize={2.8}
        fontWeight={600}
      >
        {label}
      </text>
    </g>
  );
}

function distanceValues(info: BallparkFieldInfo | null | undefined) {
  if (!info) return { leftLine: null, center: null, rightLine: null };
  return {
    leftLine: info.leftLine ?? info.left,
    center: info.center,
    rightLine: info.rightLine ?? info.right,
  };
}

/** Venue-accurate SVG park with live batter, runners, and defense pins. */
export function LiveParkField({
  venueId,
  homeTeamId,
  batterName,
  showBatter = true,
  runnerFirst,
  runnerSecond,
  runnerThird,
  defense = [],
  className,
}: LiveParkFieldProps) {
  const resolvedId = resolveBallparkVenueId(venueId, homeTeamId);
  const park = getBallparkByVenueId(resolvedId);
  const segments = park?.segments ?? GENERIC_FIELD_SEGMENTS;
  const distances = distanceValues(park?.fieldInfo);

  return (
    <div className={cn("w-full", className)}>
      <svg
        viewBox={FIELD_VIEW_BOX}
        className="aspect-square w-full border border-border bg-field-chart-bg"
        role="img"
        aria-label={park?.venueName ? `${park.venueName} field` : "Baseball field"}
      >
        <FieldBackground segments={segments} />

        <DistanceLabel
          x={FIELD_DISTANCE_SLOTS.leftLine.x}
          y={FIELD_DISTANCE_SLOTS.leftLine.y}
          value={distances.leftLine}
        />
        <DistanceLabel
          x={FIELD_DISTANCE_SLOTS.center.x}
          y={FIELD_DISTANCE_SLOTS.center.y}
          value={distances.center}
        />
        <DistanceLabel
          x={FIELD_DISTANCE_SLOTS.rightLine.x}
          y={FIELD_DISTANCE_SLOTS.rightLine.y}
          value={distances.rightLine}
        />

        {defense.map((defender) => (
          <PositionPin key={`${defender.position}-${defender.playerId}`} defender={defender} />
        ))}

        {runnerFirst ? <RunnerMarker base="first" runner={runnerFirst} /> : null}
        {runnerSecond ? <RunnerMarker base="second" runner={runnerSecond} /> : null}
        {runnerThird ? <RunnerMarker base="third" runner={runnerThird} /> : null}

        {showBatter && batterName && batterName !== "—" ? (
          <BatterLabel name={batterName} />
        ) : null}
      </svg>
    </div>
  );
}
