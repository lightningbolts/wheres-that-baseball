"use client";

import { memo } from "react";
import { motion } from "framer-motion";

import {
  OUTCOME_DISPLAY_ORDER,
  OUTCOME_LABELS,
  type OutcomeKey,
  type OutcomeProbabilities,
} from "@/types/database";
import { cn, formatProbability } from "@/lib/utils";

interface ProbabilityChartProps {
  probabilities: OutcomeProbabilities;
  /** When true, outcome list scrolls inside its panel instead of overflowing. */
  contained?: boolean;
  /** Denser rows for inline mobile feeds. */
  compact?: boolean;
  className?: string;
}

function barColor(key: OutcomeKey): string {
  switch (key) {
    case "home_run":
    case "triple":
    case "double":
    case "single":
      return "bg-neutral-400";
    case "walk":
    case "hit_by_pitch":
      return "bg-neutral-500";
    case "sac_fly":
    case "sac_bunt":
    case "gidp":
      return "bg-neutral-600";
    case "field_out":
    case "strikeout":
      return "bg-neutral-600";
    default:
      return "bg-neutral-500";
  }
}

const barTransition = {
  duration: 0.18,
  ease: "easeOut" as const,
};

function probabilitiesEqual(a: OutcomeProbabilities, b: OutcomeProbabilities): boolean {
  return OUTCOME_DISPLAY_ORDER.every((key) => (a?.[key] ?? 0) === (b?.[key] ?? 0));
}

export const ProbabilityChart = memo(function ProbabilityChart({
  probabilities,
  contained = false,
  compact = false,
  className,
}: ProbabilityChartProps) {
  const chart = (
    <ul className={cn(compact ? "space-y-1.5" : "space-y-2.5")} role="list">
      {OUTCOME_DISPLAY_ORDER.filter((key) => (probabilities?.[key] ?? 0) > 0.0001).map((key) => {
        const value = probabilities?.[key] ?? 0;
        const widthPercent = Math.min(100, Math.max(0, value * 100));

        return (
          <li key={key}>
            <div
              className={cn(
                "mb-1 flex justify-between",
                compact ? "text-[12px]" : "text-[13px]",
              )}
            >
              <span className="text-secondary">{OUTCOME_LABELS[key]}</span>
              <span className="font-mono tabular-nums text-muted">
                {formatProbability(value)}
              </span>
            </div>
            <div className="h-1.5 bg-surface-elevated">
              <motion.div
                className={`h-full ${barColor(key)}`}
                initial={false}
                animate={{ width: `${widthPercent}%` }}
                transition={barTransition}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );

  if (!contained) {
    return <div className={className}>{chart}</div>;
  }

  return (
    <div className={cn("flex min-h-0 flex-col overflow-hidden", className)}>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain pl-1 pr-4 [scrollbar-gutter:stable]">
        {chart}
      </div>
    </div>
  );
}, (prev, next) =>
  prev.contained === next.contained &&
  prev.compact === next.compact &&
  prev.className === next.className &&
  probabilitiesEqual(prev.probabilities, next.probabilities),
);
