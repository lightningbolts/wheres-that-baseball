"use client";

import Image from "next/image";

import {
  HittingStatCard,
  StatBlockSkeleton,
} from "@/components/features/HittingStatPills";
import {
  findBatterBoxLine,
  findPitcherBoxLine,
  formatBatterGameLine,
  formatPitcherGameLine,
} from "@/lib/mlb/boxScoreLookup";
import { mlbPlayerHeadshotUrl, mlbPlayerPageUrl } from "@/lib/mlb/cardPitchers";
import { cn } from "@/lib/utils";
import type {
  BatterRispStats,
  BatterVsPitcherRecord,
} from "@/types/mlb-live";
import type { GameBoxScore } from "@/types/mlb-boxscore";

interface AtBatMatchupProps {
  batterId: number | null;
  batterName: string;
  pitcherId: number | null;
  pitcherName: string;
  offenseTeamId: number | null;
  boxScore: GameBoxScore | null;
  matchupRecord: BatterVsPitcherRecord | null;
  isMatchupLoading: boolean;
  rispStats?: BatterRispStats | null;
  isRispLoading?: boolean;
  showRisp?: boolean;
  /**
   * panel — mobile: players + history/RISP
   * scorebug — desktop scorebug row: players only
   * context — desktop below scorebug: history/RISP cards (narrow layout)
   */
  variant?: "panel" | "scorebug" | "context";
  className?: string;
}

function PlayerHeadshot({
  playerId,
  name,
  size,
}: {
  playerId: number | null;
  name: string;
  size: "sm" | "md";
}) {
  const px = size === "sm" ? 32 : 44;
  const box = size === "sm" ? "h-8 w-8" : "h-11 w-11";

  if (!playerId) {
    return (
      <div
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full bg-black/5 text-[10px] text-muted dark:bg-white/10",
          box,
        )}
      >
        —
      </div>
    );
  }

  return (
    <a
      href={mlbPlayerPageUrl(playerId)}
      target="_blank"
      rel="noopener noreferrer"
      title={`${name} on MLB.com`}
      aria-label={`View ${name} on MLB.com`}
      className={cn(
        "relative shrink-0 overflow-hidden rounded-full bg-black/5 ring-1 ring-border/80 transition hover:ring-2 hover:ring-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground dark:bg-white/10",
        box,
      )}
    >
      <Image
        src={mlbPlayerHeadshotUrl(playerId, px * 2)}
        alt={name}
        width={px}
        height={px}
        className="h-full w-full object-cover object-top"
        unoptimized
      />
    </a>
  );
}

function MatchupSide({
  playerId,
  name,
  role,
  gameLine,
  align,
  density,
}: {
  playerId: number | null;
  name: string;
  role: string;
  gameLine: string | null;
  align: "left" | "right";
  density: "panel" | "scorebug";
}) {
  const scorebug = density === "scorebug";

  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-2",
        scorebug ? "max-w-[11rem] lg:max-w-[13rem]" : "min-w-0 flex-1",
        align === "right" && "flex-row-reverse text-right",
      )}
    >
      <PlayerHeadshot playerId={playerId} name={name} size={scorebug ? "sm" : "md"} />
      <div className="min-w-0">
        {!scorebug ? (
          <p className="text-[10px] font-medium uppercase tracking-wide text-subtle">{role}</p>
        ) : null}
        <p
          className={cn(
            "truncate font-semibold leading-tight text-foreground",
            scorebug ? "text-[12px]" : "text-[13px] md:text-sm",
          )}
        >
          {name}
        </p>
        {gameLine ? (
          <p
            className={cn(
              "truncate font-mono tabular-nums text-secondary",
              scorebug ? "text-[10px] leading-tight" : "text-[11px]",
            )}
          >
            {gameLine}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function MatchupContextCards({
  pitcherLast,
  matchupRecord,
  isMatchupLoading,
  rispStats,
  isRispLoading,
  showRisp,
}: {
  pitcherLast: string;
  matchupRecord: BatterVsPitcherRecord | null;
  isMatchupLoading: boolean;
  rispStats?: BatterRispStats | null;
  isRispLoading?: boolean;
  showRisp?: boolean;
}) {
  return (
    <div className="flex flex-col items-stretch gap-1.5">
      {isMatchupLoading ? (
        <StatBlockSkeleton className="mb-0" />
      ) : matchupRecord ? (
        <HittingStatCard
          label={`vs ${pitcherLast}`}
          line={matchupRecord}
          className="w-full"
        />
      ) : (
        <p className="text-[11px] text-muted">No MLB history vs {pitcherLast}</p>
      )}
      {showRisp ? (
        isRispLoading ? (
          <StatBlockSkeleton className="mb-0" />
        ) : rispStats ? (
          <HittingStatCard
            label={`${rispStats.season} RISP`}
            line={rispStats}
            tone="risp"
            className="w-full"
          />
        ) : null
      ) : null}
    </div>
  );
}

/** Batter vs pitcher with headshots; scorebug is players-only, context is history/RISP. */
export function AtBatMatchup({
  batterId,
  batterName,
  pitcherId,
  pitcherName,
  offenseTeamId,
  boxScore,
  matchupRecord,
  isMatchupLoading,
  rispStats = null,
  isRispLoading = false,
  showRisp = false,
  variant = "panel",
  className,
}: AtBatMatchupProps) {
  const batterLine = findBatterBoxLine(boxScore, batterId, offenseTeamId);
  const pitcherLine = findPitcherBoxLine(boxScore, pitcherId, offenseTeamId);
  const batterGameLine = formatBatterGameLine(batterLine);
  const pitcherGameLine = formatPitcherGameLine(pitcherLine);
  const pitcherLast = pitcherName.split(" ").pop() ?? pitcherName;

  if (variant === "scorebug") {
    return (
      <div className={cn("flex min-w-0 items-center gap-2 lg:gap-2.5", className)}>
        <MatchupSide
          playerId={batterId}
          name={batterName}
          role="At bat"
          gameLine={batterGameLine}
          align="left"
          density="scorebug"
        />
        <span className="shrink-0 text-[9px] font-bold uppercase tracking-wider text-subtle">
          vs
        </span>
        <MatchupSide
          playerId={pitcherId}
          name={pitcherName}
          role="Pitching"
          gameLine={pitcherGameLine}
          align="left"
          density="scorebug"
        />
      </div>
    );
  }

  if (variant === "context") {
    return (
      <div
        className={cn(
          "shrink-0 border-b border-border/60 bg-overlay/30 py-2",
          className,
        )}
      >
        <MatchupContextCards
          pitcherLast={pitcherLast}
          matchupRecord={matchupRecord}
          isMatchupLoading={isMatchupLoading}
          rispStats={rispStats}
          isRispLoading={isRispLoading}
          showRisp={showRisp}
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "shrink-0 border-b border-border/60 bg-overlay/40 px-3 py-2.5 md:px-0",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <MatchupSide
          playerId={batterId}
          name={batterName}
          role="At bat"
          gameLine={batterGameLine}
          align="left"
          density="panel"
        />
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-subtle">
          vs
        </span>
        <MatchupSide
          playerId={pitcherId}
          name={pitcherName}
          role="Pitching"
          gameLine={pitcherGameLine}
          align="right"
          density="panel"
        />
      </div>

      <div className="mt-2 border-t border-border/50 pt-2">
        <MatchupContextCards
          pitcherLast={pitcherLast}
          matchupRecord={matchupRecord}
          isMatchupLoading={isMatchupLoading}
          rispStats={rispStats}
          isRispLoading={isRispLoading}
          showRisp={showRisp}
        />
      </div>
    </div>
  );
}
