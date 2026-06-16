"use client";

import {
  HittingLineSummary,
  HittingStatPills,
  StatBlockSkeleton,
} from "@/components/features/HittingStatPills";
import { cn } from "@/lib/utils";
import type { BatterVsPitcherRecord as MatchupRecord } from "@/types/mlb-live";

interface BatterVsPitcherRecordProps {
  batterName: string;
  pitcherName: string;
  record: MatchupRecord | null;
  isLoading: boolean;
  className?: string;
}

export function BatterVsPitcherRecord({
  batterName,
  pitcherName,
  record,
  isLoading,
  className,
}: BatterVsPitcherRecordProps) {
  const batterLast = batterName.split(" ").pop() ?? batterName;
  const pitcherLast = pitcherName.split(" ").pop() ?? pitcherName;

  if (isLoading) {
    return <StatBlockSkeleton className={className} />;
  }

  if (!record) {
    return (
      <div
        className={cn(
          "mb-3 rounded border border-border/60 bg-overlay px-3 py-2",
          className,
        )}
      >
        <p className="text-xs text-muted">
          {batterLast} has no MLB history vs {pitcherLast}
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "mb-3 rounded border border-border bg-overlay px-3 py-2.5",
        className,
      )}
    >
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-[11px] font-medium uppercase tracking-wide text-secondary">
          Lifetime vs {pitcherLast}
        </span>
        <HittingLineSummary line={record} />
      </div>
      <HittingStatPills line={record} />
    </div>
  );
}
