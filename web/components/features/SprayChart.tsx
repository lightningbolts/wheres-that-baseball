"use client";

import { cn } from "@/lib/utils";
import {
  FIELD_SEGMENT_ORDER,
  FIELD_SEGMENT_STYLES,
  FIELD_VIEW_BOX,
  GENERIC_FIELD_SEGMENTS,
  GENERIC_TRANSFORM,
  getBallparkByVenueId,
  mapHitToSvg,
} from "@/lib/mlb/ballparkPaths";
import type { HitData } from "@/types/mlb-live";
import { SPRAY_CONTACT_COLOR } from "@/lib/mlb/sprayChartStyle";
import { SprayTrajectory } from "@/components/features/SprayChartMarkers";

interface SprayChartProps {
  hit: HitData | null;
  venueId?: number | null;
  className?: string;
  size?: "default" | "large";
}

function FieldBackground({ venueId }: { venueId?: number | null }) {
  const park = getBallparkByVenueId(venueId);
  const segments = park?.segments ?? GENERIC_FIELD_SEGMENTS;

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

const SIZE_CLASSES = {
  default: "max-w-[240px]",
  large: "max-w-[400px]",
} as const;

/** Top-down field plot — MLB coordX/coordY in MLBAM hc_x/hc_y space. */
export function SprayChart({ hit, venueId, className, size = "default" }: SprayChartProps) {
  if (!hit) {
    return (
      <div
        className={cn(
          "flex aspect-square w-full items-center justify-center border border-border bg-zone-chart-bg text-xs text-subtle",
          SIZE_CLASSES[size],
          className,
        )}
      >
        No batted ball data
      </div>
    );
  }

  const park = getBallparkByVenueId(venueId);
  const transform = park?.transform ?? GENERIC_TRANSFORM;
  const { x, y } = mapHitToSvg(hit.coordX, hit.coordY, transform);
  const home = mapHitToSvg(125, 200, transform);
  const dotRadius = size === "large" ? 2.8 : 2.4;

  return (
    <div className={cn("w-full", SIZE_CLASSES[size], className)}>
      <svg
        viewBox={FIELD_VIEW_BOX}
        className="aspect-square w-full border border-border bg-field-chart-bg"
      >
        <FieldBackground venueId={venueId} />
        <SprayTrajectory
          homeX={home.x}
          homeY={home.y}
          x={x}
          y={y}
          color={SPRAY_CONTACT_COLOR}
          ballRadius={dotRadius}
          lineWidth={size === "large" ? 0.7 : 0.6}
        />
      </svg>
      <p className="mt-1.5 text-center text-[11px] text-subtle">
        {hit.totalDistance > 0 ? `${Math.round(hit.totalDistance)} ft` : "In play"}
        {park ? ` · ${park.venueName}` : ""}
      </p>
    </div>
  );
}
