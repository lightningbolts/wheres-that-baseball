"use client";

import {
  HittingStatRow,
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
    <div className={cn("w-fit max-w-full px-1 py-1", className)}>
      <HittingStatRow label={`vs ${pitcherLast}`} line={record} />
    </div>
  );
}
