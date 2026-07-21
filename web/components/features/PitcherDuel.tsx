"use client";

import Image from "next/image";

import { mlbPlayerHeadshotUrl, mlbPlayerPageUrl } from "@/lib/mlb/cardPitchers";
import { cn } from "@/lib/utils";
import type { CardPitcher } from "@/types/mlb";

interface PitcherDuelProps {
  awayPitcher: CardPitcher | null;
  homePitcher: CardPitcher | null;
  awayLabel?: string;
  homeLabel?: string;
  className?: string;
}

function PitcherSide({
  pitcher,
  align,
  label,
}: {
  pitcher: CardPitcher | null;
  align: "left" | "right";
  label: string;
}) {
  if (!pitcher) {
    return (
      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col gap-1.5",
          align === "right" && "items-end text-right",
        )}
      >
        <p className="text-[10px] font-medium uppercase tracking-wide text-subtle">{label}</p>
        <p className="text-[11px] text-muted">TBD</p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex min-w-0 flex-1 items-start gap-2",
        align === "right" && "flex-row-reverse text-right",
      )}
    >
      <button
        type="button"
        title={`${pitcher.name} on MLB.com`}
        aria-label={`View ${pitcher.name} on MLB.com`}
        onClick={(event) => {
          // LiveGameCard wraps the slate in a Link — avoid nested <a> and navigate separately.
          event.preventDefault();
          event.stopPropagation();
          window.open(mlbPlayerPageUrl(pitcher.playerId), "_blank", "noopener,noreferrer");
        }}
        className="relative h-11 w-11 shrink-0 overflow-hidden rounded-full bg-overlay ring-1 ring-border/80 transition hover:ring-2 hover:ring-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground"
      >
        <Image
          src={mlbPlayerHeadshotUrl(pitcher.playerId, 88)}
          alt={pitcher.name}
          width={44}
          height={44}
          className="h-full w-full object-cover object-top"
          unoptimized
        />
      </button>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-medium uppercase tracking-wide text-subtle">{label}</p>
        <p className="truncate text-[12px] font-medium leading-snug text-foreground">
          {pitcher.name}
        </p>
        {pitcher.throwHand && (
          <p className="text-[10px] text-muted">{pitcher.throwHand}</p>
        )}
        <p className="font-mono text-[10px] tabular-nums text-secondary">{pitcher.line}</p>
      </div>
    </div>
  );
}

/** Away/home pitchers flanking a matchup row on slate cards. */
export function PitcherDuel({
  awayPitcher,
  homePitcher,
  awayLabel = "Away",
  homeLabel = "Home",
  className,
}: PitcherDuelProps) {
  if (!awayPitcher && !homePitcher) return null;

  return (
    <div className={cn("grid grid-cols-2 gap-3 border-t border-border/60 pt-3", className)}>
      <PitcherSide pitcher={awayPitcher} align="left" label={awayLabel} />
      <PitcherSide pitcher={homePitcher} align="right" label={homeLabel} />
    </div>
  );
}
