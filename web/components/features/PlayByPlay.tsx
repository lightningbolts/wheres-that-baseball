"use client";

import { useEffect, useRef, useState } from "react";

import { PlayDetailDialog } from "@/components/features/PlayDetailDialog";
import { BaseDiamond } from "@/components/features/BaseDiamond";
import { cn } from "@/lib/utils";
import {
  formatGameScore,
  formatOuts,
  formatRunnerBases,
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
    <div className="flex items-center gap-2 border-t border-neutral-800/40 bg-neutral-900/40 px-3 py-1.5">
      <BaseDiamond
        onFirst={situation.onFirst}
        onSecond={situation.onSecond}
        onThird={situation.onThird}
        size="tiny"
        className="shrink-0"
      />
      <div className="min-w-0 flex-1 text-[11px] leading-snug text-neutral-500">
        <span className="font-mono tabular-nums text-neutral-400">
          {awayAbbrev} {formatGameScore(situation.awayScore, situation.homeScore)} {homeAbbrev}
        </span>
        <span className="mx-1.5 text-neutral-700">·</span>
        <span>{formatOuts(situation.outs)}</span>
        {runners && (
          <>
            <span className="mx-1.5 text-neutral-700">·</span>
            <span>{runners}</span>
          </>
        )}
      </div>
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
}: PlayByPlayProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(plays.length);
  const groups = groupByInning(plays);

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
      <div className={cn("flex h-full min-h-0 flex-col bg-[#111]", className)}>
        <div className="shrink-0 border-b border-neutral-800 px-3 py-2">
          <h2 className="text-xs text-neutral-500">Play-by-play</h2>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {plays.length === 0 ? (
            <p className="px-3 py-6 text-sm text-neutral-600">No plays yet.</p>
          ) : (
            <div>
              {groups.map((group) => {
                const isOpen = expanded.has(group.key);

                return (
                  <div key={group.key} className="border-b border-neutral-800/80">
                    <button
                      type="button"
                      onClick={() => toggleInning(group.key)}
                      className="flex w-full items-center justify-between bg-[#1a1a1a] px-3 py-2 text-left hover:bg-neutral-900"
                    >
                      <span className="text-[11px] font-medium text-neutral-400">
                        {group.label}
                      </span>
                      <span className="flex items-center gap-2 text-[10px] text-neutral-600">
                        {group.plays.length} plays
                        <span className="text-neutral-500">{isOpen ? "−" : "+"}</span>
                      </span>
                    </button>

                    {isOpen &&
                      group.plays.map((play) => (
                        <div key={play.atBatIndex}>
                          <SituationMarker
                            situation={play.situationBefore}
                            awayAbbrev={awayAbbrev}
                            homeAbbrev={homeAbbrev}
                          />
                          <button
                            type="button"
                            onClick={() => {
                              onSelectAtBat?.(play);
                              setSelectedPlay(play.detail);
                            }}
                            className={cn(
                              "w-full border-t border-neutral-800/50 px-3 py-2.5 text-left hover:bg-neutral-900/80",
                              play.isScoringPlay && "border-l-2 border-l-amber-600/60",
                              selectedAtBatIndex === play.atBatIndex &&
                                "bg-neutral-900/90 ring-1 ring-inset ring-neutral-600",
                            )}
                          >
                            <div className="mb-1 flex items-baseline justify-between gap-2">
                              <div className="flex min-w-0 items-baseline gap-2">
                                <span className="shrink-0 font-mono text-[11px] text-neutral-500">
                                  {eventAbbrev(play.event)}
                                </span>
                                <span className="truncate text-[13px] text-neutral-200">
                                  {play.batterName}
                                </span>
                              </div>
                              <span className="shrink-0 font-mono text-[11px] tabular-nums text-neutral-600">
                                {formatBatterLine(play.batterHits, play.batterAtBats)}
                              </span>
                            </div>
                            <p className="line-clamp-2 text-[12px] leading-snug text-neutral-500">
                              {play.description}
                            </p>
                            {(() => {
                              const contact = compactContactLine(play.detail.hit);
                              return contact ? (
                                <p className="mt-0.5 font-mono text-[10px] text-neutral-600">
                                  {contact}
                                </p>
                              ) : null;
                            })()}
                          </button>
                        </div>
                      ))}
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
