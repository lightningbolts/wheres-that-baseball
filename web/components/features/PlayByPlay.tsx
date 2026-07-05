"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { PlayDetailDialog } from "@/components/features/PlayDetailDialog";
import { BaseDiamond } from "@/components/features/BaseDiamond";
import { PitchFeedList } from "@/components/features/PitchFeedList";
import { useEntranceIndex } from "@/hooks/useEntranceIndex";
import { cn } from "@/lib/utils";
import {
  formatGameScore,
  formatOuts,
  formatRunnerBases,
} from "@/lib/mlb/situationFormat";
import type { BaseOccupancy, GameSituation, PlayByPlayEntry, PlayDetail, PlayPitch } from "@/types/mlb-live";
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
  /** Sidebar uses collapsible innings; feed is a flat scrollable list for mobile. */
  variant?: "sidebar" | "feed";
  /** Rendered at the top of the feed scroll area (e.g. outcome odds on mobile). */
  feedHeader?: React.ReactNode;
  /** Label for the collapsible feed header (feed variant). */
  feedHeaderTitle?: string;
  /** Start with the feed header collapsed (mobile feed). */
  feedHeaderCollapsedDefault?: boolean;
  /** In-progress at-bat pitches appended to the feed (live Gameday-style). */
  livePitches?: PlayPitch[];
  /** Animate newly arrived live pitches in the feed. */
  animateLivePitches?: boolean;
  /** Show embedded pitch rows on the completed at-bat with this index. */
  embedPitchesAtBatIndex?: number | null;
  /** When this changes (e.g. game PK), scroll to the latest play once content loads. */
  monitorKey?: string | number;
  /** Scroll with a parent container instead of an internal feed scroller (mobile Gameday). */
  embeddedScroll?: boolean;
  /** Parent scroll container when embeddedScroll is true. */
  parentScrollRef?: React.RefObject<HTMLElement | null>;
}

interface InningGroup {
  key: string;
  label: string;
  playIndices: number[];
}

function groupByInning(plays: PlayByPlayEntry[]): InningGroup[] {
  const groups: InningGroup[] = [];

  for (let index = 0; index < plays.length; index++) {
    const play = plays[index];
    const key = `${play.inning}-${play.halfInning}`;
    const label = `${play.inning} ${formatInningHalf(play.halfInning)}`;

    const existing = groups.find((g) => g.key === key);
    if (existing) {
      existing.playIndices.push(index);
    } else {
      groups.push({ key, label, playIndices: [index] });
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

function gameEventAbbrev(event: string, description: string): string {
  const text = `${event} ${description}`.toLowerCase();

  if (/stolen base/i.test(text) || /\bsteals?\b/i.test(text)) return "SB";
  if (/caught stealing/i.test(text)) return "CS";
  if (/pickoff/i.test(text)) return "PK";
  if (/wild pitch/i.test(text)) return "WP";
  if (/passed ball/i.test(text)) return "PB";
  if (/balk/i.test(text)) return "BK";
  if (/pitching substitution|pitcher substitution|new pitcher/i.test(text)) return "PR";
  if (/defensive substitution|offensive substitution|defensive switch/i.test(text)) return "SUB";
  if (/mound visit/i.test(text)) return "MV";
  if (/batter timeout/i.test(text)) return "TO";
  if (/runner.*advance|advances/i.test(text)) return "ADV";
  if (/ejection/i.test(text)) return "EJ";
  if (/challenge|review/i.test(text)) return "REV";
  if (/error/i.test(text)) return "E";

  return eventAbbrev(event);
}

function basesEqual(a: BaseOccupancy, b: BaseOccupancy): boolean {
  return a.first === b.first && a.second === b.second && a.third === b.third;
}

function situationsEqual(a: GameSituation, b: GameSituation): boolean {
  return (
    a.awayScore === b.awayScore &&
    a.homeScore === b.homeScore &&
    a.outs === b.outs &&
    a.onFirst === b.onFirst &&
    a.onSecond === b.onSecond &&
    a.onThird === b.onThird &&
    basesEqual(a.bases, b.bases)
  );
}

/** True when a feed row should show the post-play situation marker. */
function entryShowsSituationAfter(entry: PlayByPlayEntry): boolean {
  return !situationsEqual(entry.situationBefore, entrySituationAfter(entry));
}

function entrySituationAfter(play: PlayByPlayEntry): GameSituation {
  return {
    awayScore: play.awayScore,
    homeScore: play.homeScore,
    outs: play.outs,
    bases: play.bases,
    onFirst: play.onFirst,
    onSecond: play.onSecond,
    onThird: play.onThird,
  };
}

function GameEventRow({
  play,
  awayAbbrev,
  homeAbbrev,
  animate,
}: {
  play: PlayByPlayEntry;
  awayAbbrev: string;
  homeAbbrev: string;
  animate: boolean;
}) {
  const showSituationAfter = entryShowsSituationAfter(play);

  return (
    <div className={cn(animate && "animate-play_in")}>
      <div className="border-t border-border/30 px-3 py-2">
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] leading-snug text-muted">
          <GameEventBadge event={play.event} description={play.description} />
          <span>{play.description}</span>
        </p>
      </div>
      {showSituationAfter && (
        <SituationMarker
          situation={entrySituationAfter(play)}
          awayAbbrev={awayAbbrev}
          homeAbbrev={homeAbbrev}
        />
      )}
    </div>
  );
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
        animate && "animate-play_in",
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
  plays: PlayByPlayEntry[],
): boolean {
  const lastIndex = group.playIndices[group.playIndices.length - 1];
  const lastPlay = lastIndex != null ? plays[lastIndex] : undefined;
  if (!lastPlay) return false;

  const isLatestGroup = groupIndex === groups.length - 1;
  if (!isLatestGroup) return true;

  return lastPlay.outs === 3;
}

function eventBadgeClass(event: string): string {
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

function PlayEventBadge({
  label,
  className,
}: {
  label: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-[1.125rem] shrink-0 items-center justify-center rounded px-1.5 font-mono text-[10px] font-semibold leading-none",
        className,
      )}
    >
      {label}
    </span>
  );
}

function AtBatEventBadge({ event }: { event: string }) {
  return (
    <PlayEventBadge label={eventAbbrev(event)} className={eventBadgeClass(event)} />
  );
}

function GameEventBadge({
  event,
  description,
}: {
  event: string;
  description: string;
}) {
  return (
    <PlayEventBadge
      label={gameEventAbbrev(event, description)}
      className="bg-overlay text-muted"
    />
  );
}

function PlayFeedRow({
  play,
  awayAbbrev,
  homeAbbrev,
  selectedAtBatIndex,
  onSelectAtBat,
  setSelectedPlay,
  animate,
  embeddedPitches,
  pitchEntranceFromIndex = 0,
  reverseOrder = false,
}: {
  play: PlayByPlayEntry;
  awayAbbrev: string;
  homeAbbrev: string;
  selectedAtBatIndex: number | null;
  onSelectAtBat?: (play: PlayByPlayEntry) => void;
  setSelectedPlay: (play: PlayDetail | null) => void;
  animate: boolean;
  embeddedPitches?: PlayPitch[];
  pitchEntranceFromIndex?: number;
  reverseOrder?: boolean;
}) {
  const showSituationAfter = entryShowsSituationAfter(play);
  const selected = selectedAtBatIndex === play.atBatIndex;

  return (
    <div className={cn(animate && "animate-play_in")}>
      <button
        type="button"
        onClick={() => {
          onSelectAtBat?.(play);
          setSelectedPlay(play.detail);
        }}
        className={cn(
          "flex w-full items-start gap-2 border-b border-border/40 px-3 py-2.5 text-left active:bg-hover",
          play.isScoringPlay && "border-l-2 border-l-amber-600/60",
          selected && "bg-overlay ring-1 ring-inset ring-border-strong",
        )}
      >
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13px] leading-snug text-foreground">
            <AtBatEventBadge event={play.event} />
            <span className="font-medium">{play.batterName}</span>
            <span className="text-[12px] text-muted">{play.description}</span>
          </p>
        </div>
        <span className="shrink-0 pt-0.5 font-mono text-[10px] tabular-nums text-subtle">
          {formatBatterLine(play.batterHits, play.batterAtBats)}
        </span>
      </button>
      {showSituationAfter && (
        <SituationMarker
          situation={entrySituationAfter(play)}
          awayAbbrev={awayAbbrev}
          homeAbbrev={homeAbbrev}
        />
      )}
      {embeddedPitches && embeddedPitches.length > 0 && (
        <PitchFeedList
          pitches={embeddedPitches}
          entranceFromIndex={pitchEntranceFromIndex}
          reverse={reverseOrder}
        />
      )}
    </div>
  );
}

function GameEventFeedRow({
  play,
  awayAbbrev,
  homeAbbrev,
  animate,
}: {
  play: PlayByPlayEntry;
  awayAbbrev: string;
  homeAbbrev: string;
  animate: boolean;
}) {
  const showSituationAfter = entryShowsSituationAfter(play);

  return (
    <div className={cn(animate && "animate-play_in")}>
      <div className="border-b border-border/40 px-3 py-2">
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] leading-snug text-muted">
          <GameEventBadge event={play.event} description={play.description} />
          <span>{play.description}</span>
        </p>
      </div>
      {showSituationAfter && (
        <SituationMarker
          situation={entrySituationAfter(play)}
          awayAbbrev={awayAbbrev}
          homeAbbrev={homeAbbrev}
        />
      )}
    </div>
  );
}

function CollapsibleFeedHeader({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="shrink-0 border-b border-border bg-panel">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-3 py-2.5 text-left hover:bg-hover"
      >
        <span className="text-xs font-medium text-muted">{title}</span>
        <span className="text-[10px] text-subtle">{open ? "−" : "+"}</span>
      </button>
      {open ? <div className="border-t border-border/50 px-3 py-3">{children}</div> : null}
    </div>
  );
}

function InningFeedHeader({
  label,
  playCount,
  isOpen,
  onToggle,
}: {
  label: string;
  playCount: number;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="sticky top-0 z-10 flex w-full items-center justify-between border-b border-border bg-surface-elevated/95 px-3 py-2 text-left backdrop-blur-sm"
    >
      <span className="text-[11px] font-semibold uppercase tracking-wide text-secondary">
        {label}
      </span>
      <span className="flex items-center gap-2 text-[10px] text-subtle">
        {playCount} plays
        <span className="text-muted">{isOpen ? "−" : "+"}</span>
      </span>
    </button>
  );
}

function PlayFeed({
  plays,
  groups,
  awayAbbrev,
  homeAbbrev,
  entranceFromIndex,
  animateEntrance,
  selectedAtBatIndex,
  onSelectAtBat,
  setSelectedPlay,
  expanded,
  onToggleInning,
  livePitches = [],
  livePitchEntranceFrom,
  embedPitchesAtBatIndex = null,
  reverseOrder = false,
}: {
  plays: PlayByPlayEntry[];
  groups: InningGroup[];
  awayAbbrev: string;
  homeAbbrev: string;
  entranceFromIndex: number;
  animateEntrance: boolean;
  selectedAtBatIndex: number | null;
  onSelectAtBat?: (play: PlayByPlayEntry) => void;
  setSelectedPlay: (play: PlayDetail | null) => void;
  expanded: Set<string>;
  onToggleInning: (key: string) => void;
  livePitches?: PlayPitch[];
  livePitchEntranceFrom: number;
  embedPitchesAtBatIndex?: number | null;
  reverseOrder?: boolean;
}) {
  const inProgress = livePitches.length > 0;
  const orderedGroups = reverseOrder ? [...groups].reverse() : groups;

  return (
    <div>
      {reverseOrder && inProgress && (
        <PitchFeedList
          pitches={livePitches}
          entranceFromIndex={livePitchEntranceFrom}
          reverse
        />
      )}
      {orderedGroups.map((group, displayIndex) => {
        const groupIndex = reverseOrder ? groups.length - 1 - displayIndex : displayIndex;
        const isOpen = expanded.has(group.key);
        const showThreeOuts = shouldShowThreeOuts(group, groupIndex, groups, plays);
        const lastIndex = group.playIndices[group.playIndices.length - 1];
        const lastPlay = lastIndex != null ? plays[lastIndex] : undefined;
        const isLatestGroup = groupIndex === groups.length - 1;
        const playIndices = reverseOrder
          ? [...group.playIndices].reverse()
          : group.playIndices;

        return (
          <section key={group.key}>
            <InningFeedHeader
              label={group.label}
              playCount={group.playIndices.length}
              isOpen={isOpen}
              onToggle={() => onToggleInning(group.key)}
            />
            {isOpen && (
              <>
                {playIndices.map((playIndex) => {
              const play = plays[playIndex];
              const animate = animateEntrance && playIndex >= entranceFromIndex;

              if (play.isAtBat === false) {
                return (
                  <GameEventFeedRow
                    key={`play-${playIndex}`}
                    play={play}
                    awayAbbrev={awayAbbrev}
                    homeAbbrev={homeAbbrev}
                    animate={animate}
                  />
                );
              }

              const embeddedPitches =
                !inProgress &&
                embedPitchesAtBatIndex != null &&
                play.atBatIndex === embedPitchesAtBatIndex &&
                play.detail.pitches.length > 0
                  ? play.detail.pitches
                  : undefined;

              return (
                <PlayFeedRow
                  key={`play-${playIndex}`}
                  play={play}
                  awayAbbrev={awayAbbrev}
                  homeAbbrev={homeAbbrev}
                  selectedAtBatIndex={selectedAtBatIndex}
                  onSelectAtBat={onSelectAtBat}
                  setSelectedPlay={setSelectedPlay}
                  animate={animate}
                  embeddedPitches={embeddedPitches}
                  reverseOrder={reverseOrder}
                />
              );
            })}
            {!reverseOrder && isLatestGroup && inProgress && (
              <PitchFeedList
                pitches={livePitches}
                entranceFromIndex={livePitchEntranceFrom}
              />
            )}
            {showThreeOuts && lastPlay && (
              <ThreeOutsBlurb
                key={`outs-${group.key}`}
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
                animate={animateEntrance && lastIndex >= entranceFromIndex}
              />
            )}
              </>
            )}
          </section>
        );
      })}
    </div>
  );
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
  const showSituationAfter = entryShowsSituationAfter(play);
  const contact = compactContactLine(play.detail.hit);

  return (
    <div className={cn(animate && "animate-play_in")}>
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
          <span className="truncate text-[14px] font-medium text-foreground">
            {play.batterName}
          </span>
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-subtle">
            {formatBatterLine(play.batterHits, play.batterAtBats)}
          </span>
        </div>
        <div className="flex items-center gap-x-1.5 text-[13px] leading-snug text-muted">
          <AtBatEventBadge event={play.event} />
          <p className="line-clamp-3 min-w-0 flex-1">{play.description}</p>
        </div>
        {contact && (
          <p className="mt-1 font-mono text-[11px] text-subtle">{contact}</p>
        )}
      </button>
      {showSituationAfter && (
        <SituationMarker
          situation={entrySituationAfter(play)}
          awayAbbrev={awayAbbrev}
          homeAbbrev={homeAbbrev}
        />
      )}
    </div>
  );
}

export const PlayByPlay = memo(function PlayByPlay({
  plays,
  awayAbbrev,
  homeAbbrev,
  venueId,
  className,
  selectedAtBatIndex = null,
  onSelectAtBat,
  autoScrollToLatest = true,
  animateEntrance = true,
  variant = "sidebar",
  feedHeader,
  feedHeaderTitle = "Outcome odds",
  feedHeaderCollapsedDefault = true,
  livePitches,
  animateLivePitches = false,
  embedPitchesAtBatIndex = null,
  monitorKey,
  embeddedScroll = false,
  parentScrollRef,
}: PlayByPlayProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const latestAnchorRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);
  const prevLivePitchCountRef = useRef(0);
  const hasInitialScrolledRef = useRef(false);
  const groups = useMemo(() => groupByInning(plays), [plays]);
  const entranceFromIndex = useEntranceIndex(plays.length, animateEntrance);
  const livePitchEntranceFrom = useEntranceIndex(
    livePitches?.length ?? 0,
    animateLivePitches,
  );
  const livePitchesList = livePitches ?? [];
  const latestInningKey = useMemo(() => {
    const last = plays[plays.length - 1];
    return last ? `${last.inning}-${last.halfInning}` : null;
  }, [plays]);

  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const latest = groups[groups.length - 1]?.key;
    return new Set(latest ? [latest] : []);
  });
  const [selectedPlay, setSelectedPlay] = useState<PlayDetail | null>(null);

  const latestInningExpanded = latestInningKey ? expanded.has(latestInningKey) : false;

  const scrollFeedToLatest = useCallback((behavior: ScrollBehavior = "smooth") => {
    if (variant === "feed") {
      if (embeddedScroll) {
        latestAnchorRef.current?.scrollIntoView({ behavior, block: "start" });
        return;
      }

      const container = scrollContainerRef.current;
      if (container) {
        container.scrollTo({ top: 0, behavior });
        return;
      }
      latestAnchorRef.current?.scrollIntoView({ behavior, block: "start" });
      return;
    }

    if (embeddedScroll) {
      const parent = parentScrollRef?.current;
      if (parent) {
        parent.scrollTo({ top: parent.scrollHeight, behavior });
        return;
      }
      bottomRef.current?.scrollIntoView({ behavior, block: "end" });
      return;
    }

    const container = scrollContainerRef.current;
    if (container) {
      container.scrollTo({ top: container.scrollHeight, behavior });
      return;
    }
    bottomRef.current?.scrollIntoView({ behavior, block: "end" });
  }, [embeddedScroll, parentScrollRef, variant]);

  useEffect(() => {
    hasInitialScrolledRef.current = false;
    prevCountRef.current = 0;
    prevLivePitchCountRef.current = 0;
  }, [monitorKey]);

  useEffect(() => {
    if (plays.length === 0) return;
    const last = plays[plays.length - 1];
    const key = `${last.inning}-${last.halfInning}`;
    setExpanded((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, [plays]);

  useEffect(() => {
    if (!autoScrollToLatest) return;

    const hasPlays = plays.length > 0;
    const hasLivePitches = livePitchesList.length > 0;
    if (!hasPlays && !hasLivePitches) return;

    if (hasPlays && variant === "feed" && latestInningKey && !latestInningExpanded) {
      return;
    }

    const playsGrew = plays.length > prevCountRef.current;
    const pitchesGrew = livePitchesList.length > prevLivePitchCountRef.current;
    const needsInitialScroll = !hasInitialScrolledRef.current;

    if (!playsGrew && !pitchesGrew && !needsInitialScroll) return;

    const behavior: ScrollBehavior = needsInitialScroll ? "auto" : "smooth";
    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(() => scrollFeedToLatest(behavior));
    });

    hasInitialScrolledRef.current = true;
    prevCountRef.current = plays.length;
    prevLivePitchCountRef.current = livePitchesList.length;

    return () => cancelAnimationFrame(frame);
  }, [
    autoScrollToLatest,
    plays.length,
    livePitchesList.length,
    latestInningKey,
    latestInningExpanded,
    variant,
    scrollFeedToLatest,
  ]);

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
      <div
        className={cn(
          "flex w-full max-w-full flex-col bg-surface",
          embeddedScroll ? "min-h-0" : "h-full min-h-0",
          className,
        )}
      >
        {!embeddedScroll ? (
          <div className="shrink-0 border-b border-border px-3 py-2">
            <h2 className="text-xs font-medium text-muted">Play-by-play</h2>
          </div>
        ) : null}

        {feedHeader && variant === "feed" ? (
          <CollapsibleFeedHeader
            title={feedHeaderTitle}
            defaultOpen={!feedHeaderCollapsedDefault}
          >
            {feedHeader}
          </CollapsibleFeedHeader>
        ) : null}

        <div
          ref={scrollContainerRef}
          className={cn(
            embeddedScroll
              ? "overflow-x-hidden"
              : "min-h-0 flex-1 touch-pan-y overflow-y-auto overflow-x-hidden overscroll-y-contain",
          )}
        >
          {feedHeader && variant !== "feed" ? (
            <div className="border-b border-border bg-panel px-3 py-3">{feedHeader}</div>
          ) : null}
          {variant === "feed" ? <div ref={latestAnchorRef} aria-hidden className="h-0" /> : null}
          {plays.length === 0 ? (
            livePitchesList.length > 0 ? (
              <PitchFeedList
                pitches={livePitchesList}
                entranceFromIndex={livePitchEntranceFrom}
                reverse={variant === "feed"}
              />
            ) : (
              <p className="px-3 py-6 text-sm text-subtle">No plays yet.</p>
            )
          ) : variant === "feed" ? (
            <PlayFeed
              plays={plays}
              groups={groups}
              awayAbbrev={awayAbbrev}
              homeAbbrev={homeAbbrev}
              entranceFromIndex={entranceFromIndex}
              animateEntrance={animateEntrance}
              selectedAtBatIndex={selectedAtBatIndex}
              onSelectAtBat={onSelectAtBat}
              setSelectedPlay={setSelectedPlay}
              expanded={expanded}
              onToggleInning={toggleInning}
              livePitches={livePitchesList}
              livePitchEntranceFrom={livePitchEntranceFrom}
              embedPitchesAtBatIndex={embedPitchesAtBatIndex}
              reverseOrder
            />
          ) : (
            <div>
              {groups.map((group, groupIndex) => {
                const isOpen = expanded.has(group.key);
                const showThreeOuts = shouldShowThreeOuts(group, groupIndex, groups, plays);
                const lastIndex = group.playIndices[group.playIndices.length - 1];
                const lastPlay = lastIndex != null ? plays[lastIndex] : undefined;

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
                        {group.playIndices.length} plays
                        <span className="text-muted">{isOpen ? "−" : "+"}</span>
                      </span>
                    </button>

                    {isOpen && (
                      <>
                        {group.playIndices.map((playIndex) => {
                          const play = plays[playIndex];
                          const animate =
                            animateEntrance && playIndex >= entranceFromIndex;

                          if (play.isAtBat === false) {
                            return (
                              <GameEventRow
                                key={`play-${playIndex}`}
                                play={play}
                                awayAbbrev={awayAbbrev}
                                homeAbbrev={homeAbbrev}
                                animate={animate}
                              />
                            );
                          }

                          return (
                            <PlayOutcomeCard
                              key={`play-${playIndex}`}
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
                            key={`outs-${group.key}`}
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
                            animate={animateEntrance && lastIndex >= entranceFromIndex}
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
});
