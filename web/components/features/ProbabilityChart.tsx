"use client";

import { motion } from "framer-motion";

import {
  OUTCOME_DISPLAY_ORDER,
  OUTCOME_LABELS,
  type OutcomeKey,
  type OutcomeProbabilities,
} from "@/types/database";
import { formatProbability } from "@/lib/utils";

interface ProbabilityChartProps {
  probabilities: OutcomeProbabilities;
}

function barColor(key: OutcomeKey): string {
  switch (key) {
    case "home_run":
    case "triple":
    case "double":
    case "single":
      return "bg-neutral-400";
    case "walk":
      return "bg-neutral-500";
    case "field_out":
    case "strikeout":
      return "bg-neutral-600";
    default:
      return "bg-neutral-500";
  }
}

const barSpring = {
  type: "spring" as const,
  stiffness: 180,
  damping: 22,
  mass: 0.9,
};

export function ProbabilityChart({ probabilities }: ProbabilityChartProps) {
  return (
    <ul className="space-y-2.5" role="list">
      {OUTCOME_DISPLAY_ORDER.map((key) => {
        const value = probabilities?.[key] ?? 0;
        const widthPercent = Math.min(100, Math.max(0, value * 100));

        return (
          <li key={key}>
            <div className="mb-1 flex justify-between text-[13px]">
              <span className="text-secondary">{OUTCOME_LABELS[key]}</span>
              <span className="font-mono tabular-nums text-muted">
                {formatProbability(value)}
              </span>
            </div>
            <div className="h-1.5 bg-surface-elevated">
              <motion.div
                className={`h-full ${barColor(key)}`}
                initial={{ width: 0 }}
                animate={{ width: `${widthPercent}%` }}
                transition={barSpring}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
