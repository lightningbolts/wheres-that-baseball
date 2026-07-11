"use client";

import {
  HittingStatCard,
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
    <HittingStatCard
      label={`${stats.season} RISP`}
      line={stats}
      tone="risp"
      className={cn("mx-3 mb-2 w-[calc(100%-1.5rem)] md:mx-0 md:mb-2 md:w-full", className)}
    />
  );
}
