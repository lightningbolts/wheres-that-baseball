"use client";

import { useEffect, useRef, useState } from "react";

import { PlayDetailDialog } from "@/components/features/PlayDetailDialog";
import { BaseDiamond } from "@/components/features/BaseDiamond";
import { useEntranceIndex } from "@/hooks/useEntranceIndex";
import { cn } from "@/lib/utils";
import {
  formatGameScore,
  formatOuts,
  formatRunnerBases,
  isHalfInningStart,
} from "@/lib/mlb/situationFormat";
import type { GameSituation, PlayByPlayEntry, PlayDetail } from "@/types/mlb-live";
import { formatInningHalf } from "@/lib/utils";

interface PlayByPlayProps {
  plays: PlayByPlayEntry[];
  awayAbbrev: string;
  homeAbbrev: string;
  venueId?: number | null;
  className?: string;
  selectedAtBatIndex?: number | null;
  onSelectAtBat?: (play: PlayByPlayEntry) => void;
  autoScrollToLatest?: boolean;
  /** Fade in newly completed at-bats (live feed). */
  animateEntrance?: boolean;
}

interface InningGroup {
  key: string;
  label: string;
  plays: PlayByPlayEntry[];
}

function groupByInning(plays: PlayByPlayEntry[]): InningGroup[] {
  const groups: InningGroup[] = [];

  for (const play of plays) {
    const key = `${play.inning}-${play.halfInning}`;
    const label = `${play.inning} ${formatInningHalf(play.halfInning)}`;

    const existing = groups.find((g) => g.key === key);
    if (existing) {
      existing.plays.push(play);
    } else {
      groups.push({ key, label, plays: [play] });
    }
  }

  return groups;
}

function formatBatterLine(hits: number, atBats: number): string {
  return `${hits}-${atBats}`;
}

function compactContactLine(hit: PlayByPlayEntry["detail"]["hit"]): string | null {
  if (!hit) return null;

  const parts: string[] = [];
  if (hit.launchSpeed > 0) parts.push(`${hit.launchSpeed.toFixed(0)} mph EV`);
  if (hit.launchAngle !== 0 || hit.launchSpeed > 0) {
    parts.push(`${hit.launchAngle.toFixed(0)}°`);
  }
  if (hit.spinRate) parts.push(`${Math.round(hit.spinRate)} rpm`);
  if (hit.pitchSpeed) parts.push(`vs ${hit.pitchSpeed.toFixed(0)} mph ${hit.pitchTypeCode ?? ""}`.trim());

  return parts.length > 0 ? parts.join(" · ") : null;
}

function eventAbbrev(event: string): string {
  const map: Record<string, string> = {
    Single: "1B",
    Double: "2B",
    Triple: "3B",
    "Home Run": "HR",
    Walk: "BB",
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
  };
  return map[event] ?? event.slice(0, 3).toUpperCase();
}

function SituationMarker({
  situation,
  awayAbbrev,
  homeAbbrev,
}: {
  situation: GameSituation;
  awayAbbrev: string;
  homeAbbrev: string;
}) {
  const runners = formatRunnerBases(situation.bases);

  return (
    <div className="flex items-center gap-2 border-t border-border/40 bg-overlay px-3 py-2">
      <BaseDiamond
        onFirst={situation.onFirst}
        onSecond={situation.onSecond}
        onThird={situation.onThird}
        size="tiny"
        className="shrink-0"
      />
      <div className="min-w-0 flex-1 text-[11px] leading-snug text-muted">
        <span className="font-mono tabular-nums text-secondary">
          {awayAbbrev} {formatGameScore(situation.awayScore, situation.homeScore)} {homeAbbrev}
        </span>
        <span className="mx-1.5 text-faint">·</span>
        <span>{formatOuts(situation.outs)}</span>
        {runners && (
          <>
            <span className="mx-1.5 text-faint">·</span>
            <span>{runners}</span>
          </>
        )}
      </div>
    </div>
  );
}

function ThreeOutsBlurb({
  situation,
  awayAbbrev,
  homeAbbrev,
  animate,
}: {
  situation: GameSituation;
  awayAbbrev: string;
  homeAbbrev: string;
  animate?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 border-t border-border/40 bg-overlay px-3 py-2",
        animate && "animate-pitch_in",
      )}
    >
      <BaseDiamond
        onFirst={false}
        onSecond={false}
        onThird={false}
        size="tiny"
        className="shrink-0 opacity-40"
      />
      <div className="min-w-0 flex-1 text-[11px] leading-snug text-muted">
        <span className="font-mono tabular-nums text-secondary">
          {awayAbbrev} {formatGameScore(situation.awayScore, situation.homeScore)} {homeAbbrev}
        </span>
        <span className="mx-1.5 text-faint">·</span>
        <span className="font-medium text-secondary">3 outs</span>
      </div>
    </div>
  );
}

function shouldShowThreeOuts(
  group: InningGroup,
  groupIndex: number,
  groups: InningGroup[],
): boolean {
  const lastPlay = group.plays[group.plays.length - 1];
  if (!lastPlay) return false;

  const isLatestGroup = groupIndex === groups.length - 1;
  if (!isLatestGroup) return true;

  return lastPlay.outs === 3;
}

function PlayOutcomeCard({
  play,
  awayAbbrev,
  homeAbbrev,
  selectedAtBatIndex,
  onSelectAtBat,
  setSelectedPlay,
  animate,
}: {
  play: PlayByPlayEntry;
  awayAbbrev: string;
  homeAbbrev: string;
  selectedAtBatIndex: number | null;
  onSelectAtBat?: (play: PlayByPlayEntry) => void;
  setSelectedPlay: (play: PlayDetail | null) => void;
  animate: boolean;
}) {
  const showSituation = !isHalfInningStart(play.situationBefore);
  const contact = compactContactLine(play.detail.hit);

  return (
    <div className={cn(animate && "animate-pitch_in")}>
      {showSituation && (
        <SituationMarker
          situation={play.situationBefore}
          awayAbbrev={awayAbbrev}
          homeAbbrev={homeAbbrev}
        />
      )}
      <button
        type="button"
        onClick={() => {
          onSelectAtBat?.(play);
          setSelectedPlay(play.detail);
        }}
        className={cn(
          "min-h-[88px] w-full border-t border-border/50 px-3 py-4 text-left hover:bg-hover",
          play.isScoringPlay && "border-l-2 border-l-amber-600/60",
          selectedAtBatIndex === play.atBatIndex &&
            "bg-overlay ring-1 ring-inset ring-border-strong",
        )}
      >
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="shrink-0 font-mono text-[11px] text-muted">
              {eventAbbrev(play.event)}
            </span>
            <span className="truncate text-[14px] font-medium text-foreground">
              {play.batterName}
            </span>
          </div>
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-subtle">
            {formatBatterLine(play.batterHits, play.batterAtBats)}
          </span>
        </div>
        <p className="line-clamp-2 text-[13px] leading-relaxed text-muted">
          {play.description}
        </p>
        {contact && (
          <p className="mt-1 font-mono text-[11px] text-subtle">{contact}</p>
        )}
      </button>
    </div>
  );
}

export function PlayByPlay({
  plays,
  awayAbbrev,
  homeAbbrev,
  venueId,
  className,
  selectedAtBatIndex = null,
  onSelectAtBat,
  autoScrollToLatest = true,
  animateEntrance = true,
}: PlayByPlayProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(plays.length);
  const groups = groupByInning(plays);
  const entranceFromIndex = useEntranceIndex(plays.length, animateEntrance);

  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const latest = groups[groups.length - 1]?.key;
    return new Set(latest ? [latest] : []);
  });
  const [selectedPlay, setSelectedPlay] = useState<PlayDetail | null>(null);

  useEffect(() => {
    if (plays.length === 0) return;
    const last = plays[plays.length - 1];
    const key = `${last.inning}-${last.halfInning}`;
    setExpanded((prev) => new Set(prev).add(key));
  }, [plays]);

  useEffect(() => {
    if (!autoScrollToLatest || plays.length === 0) return;
    if (plays.length > prevCountRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
    prevCountRef.current = plays.length;
  }, [plays.length, autoScrollToLatest]);

  const toggleInning = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <>
      <div className={cn("flex h-full min-h-0 flex-col bg-surface", className)}>
        <div className="shrink-0 border-b border-border px-3 py-2">
          <h2 className="text-xs font-medium text-muted">Play-by-play</h2>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {plays.length === 0 ? (
            <p className="px-3 py-6 text-sm text-subtle">No plays yet.</p>
          ) : (
            <div>
              {groups.map((group, groupIndex) => {
                const isOpen = expanded.has(group.key);
                const showThreeOuts = shouldShowThreeOuts(group, groupIndex, groups);
                const lastPlay = group.plays[group.plays.length - 1];

                return (
                  <div key={group.key} className="border-b border-border/80">
                    <button
                      type="button"
                      onClick={() => toggleInning(group.key)}
                      className="flex w-full items-center justify-between bg-surface-elevated px-3 py-2.5 text-left hover:bg-hover"
                    >
                      <span className="text-[11px] font-medium text-secondary">
                        {group.label}
                      </span>
                      <span className="flex items-center gap-2 text-[10px] text-subtle">
                        {group.plays.length} plays
                        <span className="text-muted">{isOpen ? "−" : "+"}</span>
                      </span>
                    </button>

                    {isOpen && (
                      <>
                        {group.plays.map((play) => {
                          const globalIndex = plays.findIndex(
                            (p) => p.atBatIndex === play.atBatIndex,
                          );
                          const animate =
                            animateEntrance && globalIndex >= entranceFromIndex;

                          return (
                            <PlayOutcomeCard
                              key={play.atBatIndex}
                              play={play}
                              awayAbbrev={awayAbbrev}
                              homeAbbrev={homeAbbrev}
                              selectedAtBatIndex={selectedAtBatIndex}
                              onSelectAtBat={onSelectAtBat}
                              setSelectedPlay={setSelectedPlay}
                              animate={animate}
                            />
                          );
                        })}
                        {showThreeOuts && lastPlay && (
                          <ThreeOutsBlurb
                            situation={{
                              awayScore: lastPlay.awayScore,
                              homeScore: lastPlay.homeScore,
                              outs: 3,
                              bases: lastPlay.bases,
                              onFirst: lastPlay.onFirst,
                              onSecond: lastPlay.onSecond,
                              onThird: lastPlay.onThird,
                            }}
                            awayAbbrev={awayAbbrev}
                            homeAbbrev={homeAbbrev}
                            animate={
                              animateEntrance &&
                              plays.findIndex((p) => p.atBatIndex === lastPlay.atBatIndex) >=
                                entranceFromIndex
                            }
                          />
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <PlayDetailDialog
        play={selectedPlay}
        venueId={venueId}
        onClose={() => setSelectedPlay(null)}
      />
    </>
  );
}
