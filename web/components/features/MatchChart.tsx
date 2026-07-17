"use client";

import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";

import {
  MATCH_CHART_VIEW,
  MATCH_CORNERS,
  projectMatchPoint,
  ternaryGuidePaths,
  trianglePath,
  type MatchPoint,
} from "@/lib/predictions/matchProjection";
import { cn, formatProbability } from "@/lib/utils";
import type { OutcomeProbabilities } from "@/types/database";

interface MatchChartProps {
  probabilities: OutcomeProbabilities;
  oddsKey: string;
  /** At-bat identity for resetting the trail (e.g. batterId-inning). */
  atBatKey?: string;
  compact?: boolean;
  className?: string;
}

interface TrailPoint extends MatchPoint {
  oddsKey: string;
}

const MAX_TRAIL = 8;

const pointTransition = {
  duration: 0.22,
  ease: "easeOut" as const,
};

export function MatchChart({
  probabilities,
  oddsKey,
  atBatKey = "default",
  compact = false,
  className,
}: MatchChartProps) {
  const point = useMemo(() => projectMatchPoint(probabilities), [probabilities]);
  const [trail, setTrail] = useState<TrailPoint[]>([]);

  useEffect(() => {
    setTrail([]);
  }, [atBatKey]);

  useEffect(() => {
    setTrail((prev) => {
      if (prev.at(-1)?.oddsKey === oddsKey) return prev;
      const nextPoint = projectMatchPoint(probabilities);
      const next = [...prev, { ...nextPoint, oddsKey }];
      return next.slice(-MAX_TRAIL);
    });
  }, [oddsKey, probabilities]);

  const guides = useMemo(() => ternaryGuidePaths(), []);
  const { width, height } = MATCH_CHART_VIEW;

  return (
    <div className={cn("flex flex-col", compact ? "gap-1.5" : "gap-2", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <p
          className={cn(
            "font-medium uppercase tracking-wide text-muted",
            compact ? "text-[10px]" : "text-[11px]",
          )}
        >
          Match
        </p>
        <p className={cn("font-mono tabular-nums text-subtle", compact ? "text-[10px]" : "text-[11px]")}>
          P {formatProbability(point.buckets.pitcher)} · B{" "}
          {formatProbability(point.buckets.batter)} · FP{" "}
          {formatProbability(point.buckets.freePass)}
        </p>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className={cn("mx-auto h-auto", compact ? "max-h-[160px] w-full max-w-[200px]" : "max-h-[220px] w-full max-w-[260px]")}
        role="img"
        aria-label="At-bat match simplex"
      >
        <path
          d={trianglePath()}
          fill="var(--panel)"
          stroke="var(--border-strong)"
          strokeWidth={1.25}
        />

        {guides.map((d) => (
          <path
            key={d}
            d={d}
            fill="none"
            stroke="var(--border)"
            strokeWidth={0.75}
            strokeDasharray="3 3"
            opacity={0.7}
          />
        ))}

        {/* Corner labels */}
        <text
          x={MATCH_CORNERS.pitcher.x}
          y={MATCH_CORNERS.pitcher.y - 10}
          textAnchor="middle"
          className="fill-[var(--match-pitcher)] font-sans text-[11px] font-medium"
        >
          Pitcher
        </text>
        <text
          x={MATCH_CORNERS.batter.x + 4}
          y={MATCH_CORNERS.batter.y + 16}
          textAnchor="end"
          className="fill-[var(--match-batter)] font-sans text-[11px] font-medium"
        >
          Batter
        </text>
        <text
          x={MATCH_CORNERS.freePass.x - 4}
          y={MATCH_CORNERS.freePass.y + 16}
          textAnchor="start"
          className="fill-[var(--match-free-pass)] font-sans text-[11px] font-medium"
        >
          Free pass
        </text>

        {/* Trail */}
        {trail.length > 1 &&
          trail.slice(0, -1).map((pt, i) => {
            const next = trail[i + 1];
            if (!next) return null;
            const opacity = 0.2 + (i / trail.length) * 0.45;
            return (
              <line
                key={`${pt.oddsKey}-${next.oddsKey}`}
                x1={pt.x}
                y1={pt.y}
                x2={next.x}
                y2={next.y}
                stroke="var(--match-trail)"
                strokeWidth={1.25}
                opacity={opacity}
              />
            );
          })}

        {trail.slice(0, -1).map((pt, i) => (
          <circle
            key={`trail-${pt.oddsKey}`}
            cx={pt.x}
            cy={pt.y}
            r={2.5}
            fill="var(--match-trail)"
            opacity={0.25 + (i / trail.length) * 0.4}
          />
        ))}

        <motion.circle
          cx={point.x}
          cy={point.y}
          r={compact ? 5 : 6}
          fill="var(--match-point)"
          stroke="var(--surface)"
          strokeWidth={1.5}
          initial={false}
          animate={{ cx: point.x, cy: point.y }}
          transition={pointTransition}
        />
      </svg>
    </div>
  );
}
