"use client";

import { cn } from "@/lib/utils";
import type { BatterHittingLine } from "@/types/mlb-live";

export function StatPill({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | string;
  accent?: "hit" | "hr" | "k";
}) {
  const accentClass =
    accent === "hit"
      ? "text-emerald-400"
      : accent === "hr"
        ? "text-amber-400"
        : accent === "k"
          ? "text-red-400"
          : "text-foreground";

  return (
    <div className="flex min-w-[52px] flex-col items-center rounded border border-border bg-overlay px-3 py-1.5">
      <span className="text-[9px] font-semibold uppercase tracking-wide text-muted">
        {label}
      </span>
      <span className={cn("font-mono text-base font-bold tabular-nums leading-none", accentClass)}>
        {value}
      </span>
    </div>
  );
}

export function HittingStatPills({ line }: { line: BatterHittingLine }) {
  return (
    <div className="flex flex-wrap gap-2">
      <StatPill label="H" value={line.hits} accent="hit" />
      <StatPill label="HR" value={line.homeRuns} accent="hr" />
      <StatPill label="K" value={line.strikeOuts} accent="k" />
      <StatPill label="BB" value={line.walks} />
    </div>
  );
}

export function HittingLineSummary({ line }: { line: BatterHittingLine }) {
  return (
    <span className="text-[11px] text-subtle">
      {line.plateAppearances} PA · {line.atBats} AB · {line.avg} AVG · {line.ops} OPS
    </span>
  );
}

export function StatBlockSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "mb-3 animate-pulse rounded border border-border bg-overlay p-3",
        className,
      )}
    >
      <div className="h-3 w-40 rounded bg-surface-elevated" />
      <div className="mt-2 flex gap-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-10 w-12 rounded bg-surface-elevated" />
        ))}
      </div>
    </div>
  );
}
