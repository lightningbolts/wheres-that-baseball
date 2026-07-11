"use client";

import {
  HittingStatRow,
  StatBlockSkeleton,
} from "@/components/features/HittingStatPills";
import { cn } from "@/lib/utils";
import type { BatterRispStats } from "@/types/mlb-live";

interface BatterRispRecordProps {
  batterName: string;
  stats: BatterRispStats | null;
  isLoading: boolean;
  className?: string;
}

export function BatterRispRecord({
  batterName,
  stats,
  isLoading,
  className,
}: BatterRispRecordProps) {
  const batterLast = batterName.split(" ").pop() ?? batterName;

  if (isLoading) {
    return <StatBlockSkeleton className={cn("px-3 py-1.5", className)} />;
  }

  if (!stats) {
    return (
      <p className={cn("px-3 py-1.5 text-xs text-muted", className)}>
        No RISP data for {batterLast} this season
      </p>
    );
  }

  return (
    <div
      className={cn(
        "w-fit max-w-full rounded border border-amber-300/80 bg-amber-50 px-2.5 py-1.5 dark:border-amber-900/50 dark:bg-amber-950/30",
        className,
      )}
    >
      <HittingStatRow
        label={`${stats.season} RISP`}
        line={stats}
        labelClassName="text-amber-800 dark:text-amber-300"
        summaryClassName="text-amber-900/80 dark:text-subtle"
      />
    </div>
  );
}
