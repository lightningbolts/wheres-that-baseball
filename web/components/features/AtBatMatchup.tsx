"use client";

import Image from "next/image";

import {
  HittingLineSummary,
  HittingStatPills,
  StatBlockSkeleton,
} from "@/components/features/HittingStatPills";
import {
  findBatterBoxLine,
  findPitcherBoxLine,
  formatBatterGameLine,
  formatPitcherGameLine,
} from "@/lib/mlb/boxScoreLookup";
import { mlbPlayerHeadshotUrl } from "@/lib/mlb/cardPitchers";
import { cn } from "@/lib/utils";
import type { BatterVsPitcherRecord } from "@/types/mlb-live";
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
  className?: string;
}

function PlayerHeadshot({ playerId, name }: { playerId: number | null; name: string }) {
  if (!playerId) {
    return (
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-overlay text-[10px] text-muted md:h-14 md:w-14">
        —
      </div>
    );
  }

  return (
    <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-full bg-overlay md:h-14 md:w-14">
      <Image
        src={mlbPlayerHeadshotUrl(playerId, 112)}
        alt={name}
        width={56}
        height={56}
        className="h-full w-full object-cover object-top"
        unoptimized
      />
    </div>
  );
}

function MatchupSide({
  playerId,
  name,
  role,
  gameLine,
  align,
}: {
  playerId: number | null;
  name: string;
  role: string;
  gameLine: string | null;
  align: "left" | "right";
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-1 items-start gap-1.5 md:gap-2.5",
        align === "right" && "flex-row-reverse text-right",
      )}
    >
      <PlayerHeadshot playerId={playerId} name={name} />
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-medium uppercase tracking-wide text-subtle">
          {role}
        </p>
        <p className="truncate text-[13px] font-medium leading-snug text-foreground md:text-sm">
          {name}
        </p>
        {gameLine && (
          <p className="font-mono text-[11px] tabular-nums text-secondary">
            {gameLine}
          </p>
        )}
      </div>
    </div>
  );
}

/** Batter vs pitcher row with headshots and game / career lines for the live at-bat panel. */
export function AtBatMatchup({
  batterId,
  batterName,
  pitcherId,
  pitcherName,
  offenseTeamId,
  boxScore,
  matchupRecord,
  isMatchupLoading,
  className,
}: AtBatMatchupProps) {
  const batterLine = findBatterBoxLine(boxScore, batterId, offenseTeamId);
  const pitcherLine = findPitcherBoxLine(boxScore, pitcherId, offenseTeamId);
  const batterGameLine = formatBatterGameLine(batterLine);
  const pitcherGameLine = formatPitcherGameLine(pitcherLine);
  const pitcherLast = pitcherName.split(" ").pop() ?? pitcherName;

  return (
    <div
      className={cn(
        "shrink-0 border-b border-border/60 bg-overlay/40 px-3 py-1.5 md:mb-3 md:rounded md:border md:bg-overlay md:px-3 md:py-2.5",
        className,
      )}
    >
      <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-1 md:gap-2">
        <MatchupSide
          playerId={batterId}
          name={batterName}
          role="At bat"
          gameLine={batterGameLine}
          align="left"
        />
        <span className="pt-4 text-[11px] font-semibold uppercase tracking-wide text-subtle md:pt-5">
          vs
        </span>
        <MatchupSide
          playerId={pitcherId}
          name={pitcherName}
          role="Pitching"
          gameLine={pitcherGameLine}
          align="right"
        />
      </div>

      {isMatchupLoading ? (
        <StatBlockSkeleton className="mt-2 hidden border-0 bg-transparent p-0 md:block" />
      ) : matchupRecord ? (
        <div className="mt-2 hidden border-t border-border/50 pt-2 md:block">
          <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-[10px] font-medium uppercase tracking-wide text-subtle">
              Lifetime vs {pitcherLast}
            </span>
            <HittingLineSummary line={matchupRecord} />
          </div>
          <HittingStatPills line={matchupRecord} />
        </div>
      ) : (
        <p className="mt-1 hidden text-[10px] text-muted md:mt-2 md:block md:text-[11px]">
          No MLB history vs {pitcherLast}
        </p>
      )}
    </div>
  );
}
