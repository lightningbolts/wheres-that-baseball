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
import type { GameHit } from "@/lib/mlb/gameHits";
import { SPRAY_HIT_COLOR_VAR } from "@/lib/mlb/sprayChartStyle";
import { SprayTrajectory } from "@/components/features/SprayChartMarkers";

interface GameHitsSprayChartProps {
  hits: GameHit[];
  venueId?: number | null;
  selectedAtBatIndex?: number | null;
  onSelectHit?: (hit: GameHit) => void;
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

export function GameHitsSprayChart({
  hits,
  venueId,
  selectedAtBatIndex = null,
  onSelectHit,
  className,
}: GameHitsSprayChartProps) {
  const park = getBallparkByVenueId(venueId);
  const transform = park?.transform ?? GENERIC_TRANSFORM;
  const home = mapHitToSvg(125, 200, transform);

  return (
    <div className={cn("w-full", className)}>
      <svg
        viewBox={FIELD_VIEW_BOX}
        className="aspect-square w-full border border-border bg-field-chart-bg"
      >
        <FieldBackground venueId={venueId} />
        {hits.map((gameHit) => {
          const { x, y } = mapHitToSvg(gameHit.hit.coordX, gameHit.hit.coordY, transform);
          const isSelected = selectedAtBatIndex === gameHit.atBatIndex;
          const dimmed = selectedAtBatIndex != null && !isSelected;

          return (
            <g
              key={gameHit.atBatIndex}
              opacity={dimmed ? 0.35 : 1}
              className={onSelectHit ? "cursor-pointer" : undefined}
              onClick={onSelectHit ? () => onSelectHit(gameHit) : undefined}
              onKeyDown={
                onSelectHit
                  ? (event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onSelectHit(gameHit);
                      }
                    }
                  : undefined
              }
              role={onSelectHit ? "button" : undefined}
              tabIndex={onSelectHit ? 0 : undefined}
            >
              <SprayTrajectory
                homeX={home.x}
                homeY={home.y}
                x={x}
                y={y}
                color={SPRAY_HIT_COLOR_VAR[gameHit.event]}
                selected={isSelected}
              />
            </g>
          );
        })}
      </svg>
      {park && (
        <p className="mt-1.5 text-center text-[11px] text-subtle">{park.venueName}</p>
      )}
    </div>
  );
}
