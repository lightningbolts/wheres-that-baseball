"use client";

import Link from "next/link";
import { useEffect } from "react";

import { TeamLogo } from "@/components/ui/TeamLogo";
import type { NerdInsight } from "@/lib/mlb/nerdInsights/types";
import { cn } from "@/lib/utils";

interface NerdInsightToastsProps {
  toasts: NerdInsight[];
  onDismiss: (id: string) => void;
  className?: string;
}

function InsightToastCard({
  toast,
  onDismiss,
}: {
  toast: NerdInsight;
  onDismiss: (id: string) => void;
}) {
  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(toast.id), toast.durationMs ?? 7_000);
    return () => window.clearTimeout(timer);
  }, [onDismiss, toast.durationMs, toast.id]);

  return (
    <div
      role="status"
      className={cn(
        "pointer-events-auto w-full max-w-sm rounded-xl border border-border bg-surface/95 p-3 shadow-lg backdrop-blur-sm",
        "animate-play_in",
      )}
    >
      <div className="flex items-start gap-2.5">
        {toast.teamId != null && (
          <TeamLogo teamId={toast.teamId} size={28} className="mt-0.5 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-medium uppercase tracking-wide text-secondary">
            {toast.eyebrow}
          </p>
          <p className="mt-0.5 text-sm font-medium text-foreground">{toast.title}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted">{toast.message}</p>
          {toast.statId && (
            <Link
              href={`/nerd/${toast.statId}`}
              className="mt-2 inline-block text-[11px] text-secondary hover:underline"
              onClick={() => onDismiss(toast.id)}
            >
              See nerd standings →
            </Link>
          )}
        </div>
        <button
          type="button"
          onClick={() => onDismiss(toast.id)}
          className="shrink-0 rounded p-1 text-subtle hover:bg-hover hover:text-foreground"
          aria-label="Dismiss insight"
        >
          ×
        </button>
      </div>
    </div>
  );
}

export function NerdInsightToasts({ toasts, onDismiss, className }: NerdInsightToastsProps) {
  if (toasts.length === 0) return null;

  return (
    <div
      className={cn(
        "pointer-events-none fixed bottom-4 left-4 z-50 flex w-[min(100vw-2rem,24rem)] flex-col gap-2",
        className,
      )}
      aria-live="polite"
      aria-label="Nerd stat insights"
    >
      {toasts.map((toast) => (
        <InsightToastCard key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
