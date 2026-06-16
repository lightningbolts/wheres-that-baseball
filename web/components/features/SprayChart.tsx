"use client";

import { cn } from "@/lib/utils";
import {
  FIELD_SEGMENT_ORDER,
  FIELD_SEGMENT_STYLES,
  GENERIC_FIELD_SEGMENTS,
  GENERIC_TRANSFORM,
  getBallparkByVenueId,
  mapHitToSvg,
} from "@/lib/mlb/ballparkPaths";
import type { HitData } from "@/types/mlb-live";

interface SprayChartProps {
  hit: HitData | null;
  venueId?: number | null;
  className?: string;
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

/** Top-down field plot — MLB coordX/coordY in MLBAM hc_x/hc_y space. */
export function SprayChart({ hit, venueId, className }: SprayChartProps) {
  if (!hit) {
    return (
      <div
        className={cn(
          "flex aspect-square w-full max-w-[220px] items-center justify-center border border-border bg-scorebug text-xs text-subtle",
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

  return (
    <div className={cn("w-full max-w-[220px]", className)}>
      <svg viewBox="0 0 100 100" className="w-full border border-border bg-[#1a2e1a]">
        <FieldBackground venueId={venueId} />
        <circle cx={x} cy={y} r="2.5" fill="#fbbf24" stroke="#fff" strokeWidth="0.5" />
        <line
          x1={home.x}
          y1={home.y}
          x2={x}
          y2={y}
          stroke="#fbbf24"
          strokeWidth="0.4"
          opacity="0.5"
        />
      </svg>
      <p className="mt-1 text-center text-[10px] text-subtle">
        {hit.totalDistance > 0 ? `${Math.round(hit.totalDistance)} ft` : "In play"}
        {park ? ` · ${park.venueName}` : ""}
      </p>
    </div>
  );
}
