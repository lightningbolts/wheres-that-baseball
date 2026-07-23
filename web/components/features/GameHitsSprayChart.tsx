"use client";

import { useState } from "react";

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
import type { HitType, SprayChartHit } from "@/lib/mlb/gameHits";
import { SPRAY_HIT_COLOR_VAR } from "@/lib/mlb/sprayChartStyle";
import { SprayTrajectory } from "@/components/features/SprayChartMarkers";

interface GameHitsSprayChartProps {
  hits: SprayChartHit[];
  venueId?: number | null;
  selectedAtBatIndex?: number | null;
  getHitKey?: (hit: SprayChartHit) => string | number;
  selectedHitKey?: string | number | null;
  onSelectHit?: (hit: SprayChartHit) => void;
  showLineToggle?: boolean;
  /** When set, fixes line/dot mode and hides the toggle unless `showLineToggle` is true. */
  showLines?: boolean;
  ballRadius?: number;
  hideVenueLabel?: boolean;
  className?: string;
}

function SprayLineToggle({
  showLines,
  onChange,
}: {
  showLines: boolean;
  onChange: (showLines: boolean) => void;
}) {
  return (
    <div
      className="inline-flex rounded-md border border-border bg-surface p-0.5"
      role="group"
      aria-label="Spray chart display"
    >
      <button
        type="button"
        onClick={() => onChange(true)}
        className={cn(
          "rounded px-2 py-1 text-[10px] font-medium transition-colors",
          showLines
            ? "bg-surface-elevated text-foreground"
            : "text-muted hover:text-foreground",
        )}
        aria-pressed={showLines}
      >
        Lines
      </button>
      <button
        type="button"
        onClick={() => onChange(false)}
        className={cn(
          "rounded px-2 py-1 text-[10px] font-medium transition-colors",
          !showLines
            ? "bg-surface-elevated text-foreground"
            : "text-muted hover:text-foreground",
        )}
        aria-pressed={!showLines}
      >
        Dots
      </button>
    </div>
  );
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
  getHitKey,
  selectedHitKey = null,
  onSelectHit,
  showLineToggle,
  showLines: showLinesProp,
  ballRadius,
  hideVenueLabel,
  className,
}: GameHitsSprayChartProps) {
  const [showLinesState, setShowLinesState] = useState(true);
  const showLines = showLinesProp ?? showLinesState;
  const park = getBallparkByVenueId(venueId);
  const transform = park?.transform ?? GENERIC_TRANSFORM;
  const home = mapHitToSvg(125, 200, transform);
  const resolveKey = getHitKey ?? ((hit: SprayChartHit) => hit.atBatIndex);
  const activeKey = selectedHitKey ?? selectedAtBatIndex;
  const lineToggleEnabled =
    showLineToggle ?? (showLinesProp == null && Boolean(onSelectHit));

  return (
    <div className={cn("w-full", className)}>
      {lineToggleEnabled && hits.length > 0 && (
        <div className="mb-2 flex justify-end">
          <SprayLineToggle showLines={showLines} onChange={setShowLinesState} />
        </div>
      )}
      <svg
        viewBox={FIELD_VIEW_BOX}
        className="aspect-square w-full border border-border bg-field-chart-bg"
      >
        <FieldBackground venueId={venueId} />
        {hits.map((gameHit) => {
          const { x, y } = mapHitToSvg(gameHit.hit.coordX, gameHit.hit.coordY, transform);
          const hitKey = resolveKey(gameHit);
          const isSelected = activeKey === hitKey;
          const dimmed = activeKey != null && !isSelected;

          return (
            <g
              key={hitKey}
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
                color={
                  SPRAY_HIT_COLOR_VAR[gameHit.event as HitType] ??
                  ("color" in gameHit && typeof gameHit.color === "string"
                    ? gameHit.color
                    : "var(--spray-hit-single)")
                }
                selected={isSelected}
                showLines={showLines}
                ballRadius={ballRadius}
              />
            </g>
          );
        })}
      </svg>
      {park && !hideVenueLabel && (
        <p className="mt-1.5 text-center text-[11px] text-subtle">{park.venueName}</p>
      )}
    </div>
  );
}
