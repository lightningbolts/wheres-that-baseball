"use client";

import Link from "next/link";

import { TeamLogo } from "@/components/ui/TeamLogo";
import type { NerdInsight } from "@/lib/mlb/nerdInsights/types";
import { cn } from "@/lib/utils";

interface PlayInsightInlineProps {
  insight: NerdInsight;
  className?: string;
}

export function PlayInsightInline({ insight, className }: PlayInsightInlineProps) {
  if (insight.variant === "mini") {
    return (
      <div
        className={cn(
          "flex items-center gap-2 border-b border-border/30 bg-overlay/40 px-3 py-1.5",
          className,
        )}
      >
        {insight.teamId != null && (
          <TeamLogo teamId={insight.teamId} size={16} className="shrink-0 opacity-70" />
        )}
        <p className="min-w-0 text-[11px] leading-snug text-muted">
          <span className="font-medium text-secondary">{insight.eyebrow}</span>
          {" · "}
          {insight.message}
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "border-b border-border/40 bg-surface-elevated/80 px-3 py-2",
        className,
      )}
    >
      <div className="flex items-start gap-2">
        {insight.teamId != null && (
          <TeamLogo teamId={insight.teamId} size={20} className="mt-0.5 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[9px] font-medium uppercase tracking-wide text-secondary">
            {insight.eyebrow}
          </p>
          <p className="mt-0.5 text-[12px] font-medium text-foreground">{insight.title}</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted">{insight.message}</p>
          {insight.statId && (
            <Link
              href={`/nerd/${insight.statId}`}
              className="mt-1 inline-block text-[10px] text-secondary hover:underline"
            >
              See nerd standings →
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

interface InningInsightMarkerProps {
  insights: NerdInsight[];
  className?: string;
}

export function InningInsightMarker({ insights, className }: InningInsightMarkerProps) {
  if (insights.length === 0) return null;

  return (
    <div className={cn("border-b border-border/50", className)}>
      {insights.map((insight) => (
        <PlayInsightInline key={insight.id} insight={insight} />
      ))}
    </div>
  );
}
