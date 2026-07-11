"use client";

import {
  HittingStatCard,
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
    return <StatBlockSkeleton className={cn("px-3 py-1.5", className)} />;
  }

  if (!record) {
    return (
      <p className={cn("px-3 py-1.5 text-xs text-muted", className)}>
        {batterLast} has no MLB history vs {pitcherLast}
      </p>
    );
  }

  return (
    <HittingStatCard
      label={`vs ${pitcherLast}`}
      line={record}
      className={cn("mb-2 w-full", className)}
    />
  );
}
