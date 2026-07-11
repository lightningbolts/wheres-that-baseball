"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import type { BatterHittingLine } from "@/types/mlb-live";

export function StatPill({
  label,
  value,
  accent,
  size = "default",
}: {
  label: string;
  value: number | string;
  accent?: "hit" | "hr" | "k";
  size?: "default" | "compact";
}) {
  const accentClass =
    accent === "hit"
      ? "text-emerald-600 dark:text-emerald-400"
      : accent === "hr"
        ? "text-amber-600 dark:text-amber-400"
        : accent === "k"
          ? "text-red-600 dark:text-red-400"
          : "text-foreground";

  return (
    <div
      className={cn(
        "flex flex-col items-center rounded border border-border/80 bg-surface",
        size === "compact" ? "min-w-[32px] px-1.5 py-0.5" : "min-w-[40px] px-2 py-1",
      )}
    >
      <span
        className={cn(
          "font-semibold uppercase tracking-wide text-muted",
          size === "compact" ? "text-[8px] leading-none" : "text-[9px]",
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          "font-mono font-bold tabular-nums leading-none",
          size === "compact" ? "text-[13px]" : "text-base",
          accentClass,
        )}
      >
        {value}
      </span>
    </div>
  );
}

/** Boxed H / HR / K / BB chips. */
export function HittingStatPills({
  line,
  className,
  size = "compact",
}: {
  line: BatterHittingLine;
  className?: string;
  size?: "default" | "compact";
}) {
  return (
    <div className={cn("flex gap-1", className)}>
      <StatPill label="H" value={line.hits} accent="hit" size={size} />
      <StatPill label="HR" value={line.homeRuns} accent="hr" size={size} />
      <StatPill label="K" value={line.strikeOuts} accent="k" size={size} />
      <StatPill label="BB" value={line.walks} size={size} />
    </div>
  );
}

export function HittingLineSummary({
  line,
  className,
}: {
  line: BatterHittingLine;
  className?: string;
}) {
  return (
    <span className={cn("font-mono text-[11px] tabular-nums text-subtle", className)}>
      {line.hits}-{line.atBats} · {line.avg} · {line.ops}
    </span>
  );
}

/** Compact label + rates + pills, content-sized (never full-bleed empty bars). */
export function HittingStatRow({
  label,
  line,
  className,
  labelClassName,
  summaryClassName,
}: {
  label: ReactNode;
  line: BatterHittingLine;
  className?: string;
  labelClassName?: string;
  summaryClassName?: string;
}) {
  return (
    <div className={cn("inline-flex max-w-full flex-wrap items-center gap-x-2 gap-y-1", className)}>
      <span
        className={cn(
          "text-[10px] font-semibold uppercase tracking-wide text-subtle",
          labelClassName,
        )}
      >
        {label}
      </span>
      <HittingLineSummary line={line} className={summaryClassName} />
      <HittingStatPills line={line} size="compact" />
    </div>
  );
}

export function StatBlockSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("animate-pulse", className)}>
      <div className="flex items-center gap-2">
        <div className="h-3 w-20 rounded bg-surface-elevated" />
        <div className="h-3 w-28 rounded bg-surface-elevated" />
        <div className="flex gap-1">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-6 w-7 rounded bg-surface-elevated" />
          ))}
        </div>
      </div>
    </div>
  );
}
