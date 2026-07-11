"use client";

import { formatPlayWinProbabilityLine } from "@/lib/mlb/wpa";
import { cn } from "@/lib/utils";
import type { PlayByPlayEntry } from "@/types/mlb-live";
import type { OutcomeToastPhase } from "@/hooks/useAtBatOutcomeToast";

interface AtBatOutcomeToastProps {
  play: PlayByPlayEntry;
  phase: Exclude<OutcomeToastPhase, "hidden">;
  onDismiss: () => void;
  className?: string;
}

function eventAbbrev(event: string): string {
  const map: Record<string, string> = {
    Single: "1B",
    Double: "2B",
    Triple: "3B",
    "Home Run": "HR",
    Walk: "BB",
    "Intent Walk": "IBB",
    "Intentional Walk": "IBB",
    Strikeout: "K",
    Groundout: "GO",
    Flyout: "FO",
    "Pop Out": "PO",
    Lineout: "LO",
    "Fielders Choice": "FC",
    Forceout: "FO",
    "Sacrifice Fly": "SF",
    "Sacrifice Bunt": "SAC",
    "Hit By Pitch": "HBP",
    "Grounded Into DP": "GDP",
    "Double Play": "DP",
    "Triple Play": "TP",
    "Field Error": "E",
  };
  return map[event] ?? event.slice(0, 3).toUpperCase();
}

function badgeClass(event: string): string {
  const abbrev = eventAbbrev(event);
  if (abbrev === "K" || abbrev === "FO" || abbrev === "GO" || abbrev === "PO" || abbrev === "LO") {
    return "bg-red-500/15 text-red-700 dark:text-red-400";
  }
  if (abbrev === "BB" || abbrev === "IBB" || abbrev === "HBP") {
    return "bg-green-500/15 text-green-700 dark:text-green-400";
  }
  if (abbrev === "HR" || abbrev === "2B" || abbrev === "3B" || abbrev === "1B") {
    return "bg-sky-500/15 text-sky-700 dark:text-sky-400";
  }
  return "bg-overlay text-muted";
}

function contactLine(hit: PlayByPlayEntry["detail"]["hit"]): string | null {
  if (!hit) return null;
  const parts: string[] = [];
  if (hit.launchSpeed > 0) parts.push(`${hit.launchSpeed.toFixed(0)} mph EV`);
  if (hit.launchAngle !== 0 || hit.launchSpeed > 0) {
    parts.push(`${hit.launchAngle.toFixed(0)}°`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Brief play-result toast that settles into the play-by-play feed. */
export function AtBatOutcomeToast({
  play,
  phase,
  onDismiss,
  className,
}: AtBatOutcomeToastProps) {
  const wpa = formatPlayWinProbabilityLine(play);
  const contact = contactLine(play.detail.hit);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`At-bat result: ${play.event}`}
      className={cn(
        "pointer-events-auto w-full overflow-hidden rounded-lg border border-border-strong bg-surface shadow-lg",
        play.isScoringPlay && "border-l-[3px] border-l-amber-600/70",
        phase === "enter" && "animate-toast_in",
        phase === "hold" && "opacity-100",
        phase === "exit" && "animate-toast_out",
        className,
      )}
    >
      <div className="flex items-start gap-2 px-2.5 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13px] leading-snug text-foreground">
            <span
              className={cn(
                "inline-flex h-[1.125rem] shrink-0 items-center justify-center rounded px-1.5 font-mono text-[10px] font-semibold leading-none",
                badgeClass(play.event),
              )}
            >
              {eventAbbrev(play.event)}
            </span>
            <span className="font-medium">{play.batterName}</span>
            <span className="text-[12px] text-muted">{play.description}</span>
          </p>
          {wpa ? (
            <p className="mt-1 font-mono text-[10px] tabular-nums text-subtle">{wpa}</p>
          ) : null}
          {contact ? (
            <p className="mt-0.5 font-mono text-[11px] text-subtle">{contact}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded p-1 text-subtle hover:bg-hover hover:text-foreground"
          aria-label="Dismiss result"
        >
          ×
        </button>
      </div>
    </div>
  );
}
