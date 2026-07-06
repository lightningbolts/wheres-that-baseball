"use client";

import { formatProbability } from "@/lib/utils";
import type { StealProbabilities } from "@/types/database";

interface StealIndicatorProps {
  stealProbabilities: StealProbabilities | null;
  onFirst: boolean;
  onSecond: boolean;
}

export function StealIndicator({
  stealProbabilities,
  onFirst,
  onSecond,
}: StealIndicatorProps) {
  if (!stealProbabilities || (!onFirst && !onSecond)) {
    return null;
  }

  const { steal_attempt: attempt, steal_success: success } = stealProbabilities;
  if (attempt <= 0 && success <= 0) {
    return null;
  }

  return (
    <div className="rounded border border-surface-elevated bg-surface px-3 py-2 text-[12px]">
      <div className="mb-1 font-medium text-secondary">Steal odds</div>
      <div className="flex justify-between gap-4 font-mono tabular-nums text-muted">
        <span>Attempt {formatProbability(attempt)}</span>
        <span>Success {formatProbability(success)}</span>
      </div>
    </div>
  );
}
