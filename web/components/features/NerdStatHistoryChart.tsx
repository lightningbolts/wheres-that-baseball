"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEventHandler,
  type ReactNode,
} from "react";

import { Skeleton } from "@/components/ui/Skeleton";
import {
  NERD_STAT_HISTORY_BASES,
  NERD_STAT_HISTORY_SPLITS,
  useNerdStatHistory,
  useSelectedNerdStatHistory,
} from "@/hooks/useNerdStatHistory";
import type {
  NerdStatHistoryBasis,
  NerdStatHistorySeriesPoint,
  NerdStatHistorySplit,
} from "@/lib/mlb/nerdStats/history";
import { MLB_TEAMS, NERD_STAT_GROUP_FILTERS, type NerdStatGroupFilter } from "@/lib/mlb/teams";

interface NerdStatHistoryChartProps {
  statId: string;
  season: number;
  sort: "asc" | "desc";
  defaultTeamId?: number;
  initialSplit?: NerdStatHistorySplit;
  leagueAverage?: number | null;
  formatValue?: (value: number) => string;
}

const CHART_WIDTH = 640;
const CHART_HEIGHT = 220;
const PADDING = { top: 16, right: 12, bottom: 28, left: 44 };

function formatAxisValue(value: number): string {
  if (Math.abs(value) >= 100) return value.toFixed(0);
  if (Math.abs(value) >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

function buildPath(
  values: Array<number | null>,
  xForIndex: (index: number) => number,
  yForValue: (value: number) => number,
): string | null {
  const segments: string[] = [];
  let started = false;

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value == null || !Number.isFinite(value)) {
      started = false;
      continue;
    }
    const command = started ? "L" : "M";
    segments.push(`${command}${xForIndex(index).toFixed(2)},${yForValue(value).toFixed(2)}`);
    started = true;
  }

  return segments.length > 0 ? segments.join(" ") : null;
}

function HistoryLineChart({
  points,
  leagueAverage,
  showLeagueGuide,
  formatValue,
  onSelectIndex,
  activeIndex,
}: {
  points: NerdStatHistorySeriesPoint[];
  leagueAverage?: number | null;
  showLeagueGuide: boolean;
  formatValue: (value: number) => string;
  onSelectIndex: (index: number | null, coords?: { x: number; y: number }) => void;
  activeIndex: number | null;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const gradientId = useId();

  const teamValues = points.map((point) => point.teamValue);
  const groupValues = points.map((point) => point.groupAverage);

  const numericValues = [...teamValues, ...groupValues].filter(
    (value): value is number => value != null && Number.isFinite(value),
  );
  if (showLeagueGuide && leagueAverage != null && Number.isFinite(leagueAverage)) {
    numericValues.push(leagueAverage);
  }

  const minValue = numericValues.length > 0 ? Math.min(...numericValues) : 0;
  const maxValue = numericValues.length > 0 ? Math.max(...numericValues) : 1;
  const valueSpan = maxValue - minValue || 1;
  const paddedMin = minValue - valueSpan * 0.08;
  const paddedMax = maxValue + valueSpan * 0.08;

  const plotWidth = CHART_WIDTH - PADDING.left - PADDING.right;
  const plotHeight = CHART_HEIGHT - PADDING.top - PADDING.bottom;

  const xForIndex = useCallback(
    (index: number) => {
      if (points.length <= 1) return PADDING.left + plotWidth / 2;
      return PADDING.left + (index / (points.length - 1)) * plotWidth;
    },
    [plotWidth, points.length],
  );

  const yForValue = useCallback(
    (value: number) =>
      PADDING.top + plotHeight - ((value - paddedMin) / (paddedMax - paddedMin)) * plotHeight,
    [paddedMax, paddedMin, plotHeight],
  );

  const teamPath = buildPath(teamValues, xForIndex, yForValue);
  const groupPath = buildPath(groupValues, xForIndex, yForValue);

  const yTicks = useMemo(() => {
    const ticks: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      ticks.push(paddedMin + ((paddedMax - paddedMin) * i) / 3);
    }
    return ticks;
  }, [paddedMax, paddedMin]);

  const xLabelIndexes = useMemo(() => {
    if (points.length <= 1) return [0];
    const maxLabels = 5;
    const step = Math.max(1, Math.floor((points.length - 1) / (maxLabels - 1)));
    const indexes = [];
    for (let index = 0; index < points.length; index += step) indexes.push(index);
    if (indexes[indexes.length - 1] !== points.length - 1) indexes.push(points.length - 1);
    return indexes;
  }, [points.length]);

  const handlePointer = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg || points.length === 0) return;
    const rect = svg.getBoundingClientRect();
    const relativeX = ((clientX - rect.left) / rect.width) * CHART_WIDTH;
    const clampedX = Math.max(PADDING.left, Math.min(CHART_WIDTH - PADDING.right, relativeX));
    const ratio = (clampedX - PADDING.left) / plotWidth;
    const index = Math.round(ratio * Math.max(points.length - 1, 0));
    onSelectIndex(index, { x: clientX - rect.left, y: clientY - rect.top });
  };

  return (
    <div className="relative w-full overflow-x-auto">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        className="h-[220px] w-full min-w-[280px] touch-none select-none sm:h-[260px]"
        role="img"
        aria-label="Nerd stat trend chart"
        onPointerDown={(event) => handlePointer(event.clientX, event.clientY)}
        onPointerMove={(event) => {
          if (event.buttons > 0) handlePointer(event.clientX, event.clientY);
        }}
        onPointerLeave={() => onSelectIndex(null)}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--secondary)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="var(--secondary)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {yTicks.map((tick) => (
          <g key={tick}>
            <line
              x1={PADDING.left}
              x2={CHART_WIDTH - PADDING.right}
              y1={yForValue(tick)}
              y2={yForValue(tick)}
              stroke="var(--border)"
              strokeDasharray="3 4"
            />
            <text
              x={PADDING.left - 8}
              y={yForValue(tick) + 4}
              textAnchor="end"
              className="fill-subtle text-[10px]"
            >
              {formatAxisValue(tick)}
            </text>
          </g>
        ))}

        {showLeagueGuide && leagueAverage != null && Number.isFinite(leagueAverage) && (
          <line
            x1={PADDING.left}
            x2={CHART_WIDTH - PADDING.right}
            y1={yForValue(leagueAverage)}
            y2={yForValue(leagueAverage)}
            stroke="var(--muted)"
            strokeDasharray="6 4"
            strokeWidth={1.25}
          />
        )}

        {groupPath && (
          <path
            d={groupPath}
            fill="none"
            stroke="var(--muted)"
            strokeDasharray="5 4"
            strokeWidth={1.5}
          />
        )}

        {teamPath && (
          <>
            <path
              d={`${teamPath} L ${xForIndex(points.length - 1)} ${PADDING.top + plotHeight} L ${xForIndex(0)} ${PADDING.top + plotHeight} Z`}
              fill={`url(#${gradientId})`}
              stroke="none"
            />
            <path
              d={teamPath}
              fill="none"
              stroke="var(--secondary)"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </>
        )}

        {activeIndex != null && points[activeIndex] && (
          <>
            <line
              x1={xForIndex(activeIndex)}
              x2={xForIndex(activeIndex)}
              y1={PADDING.top}
              y2={PADDING.top + plotHeight}
              stroke="var(--border-strong)"
              strokeWidth={1}
            />
            {points[activeIndex]!.teamValue != null && (
              <circle
                cx={xForIndex(activeIndex)}
                cy={yForValue(points[activeIndex]!.teamValue!)}
                r={4}
                fill="var(--secondary)"
                stroke="var(--background)"
                strokeWidth={2}
              />
            )}
          </>
        )}

        {xLabelIndexes.map((index) => (
          <text
            key={index}
            x={xForIndex(index)}
            y={CHART_HEIGHT - 8}
            textAnchor="middle"
            className="fill-subtle text-[10px]"
          >
            {points[index]?.date.slice(5)}
          </text>
        ))}
      </svg>

      {activeIndex != null && points[activeIndex] && (
        <ChartTooltip
          point={points[activeIndex]!}
          formatValue={formatValue}
          className="pointer-events-none absolute left-3 top-3 max-w-[calc(100%-1.5rem)] rounded-lg border border-border bg-surface-elevated px-3 py-2 text-xs shadow-sm sm:left-auto sm:right-3"
        />
      )}
    </div>
  );
}

function ChartTooltip({
  point,
  formatValue,
  className,
}: {
  point: NerdStatHistorySeriesPoint;
  formatValue: (value: number) => string;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="font-medium text-foreground">{point.date}</p>
      <p className="mt-1 text-muted">
        Team:{" "}
        <span className="font-mono tabular-nums text-foreground">
          {point.teamValue != null ? formatValue(point.teamValue) : "—"}
        </span>
        {point.teamRank != null && (
          <span className="text-subtle"> · rank {point.teamRank}</span>
        )}
      </p>
      <p className="text-muted">
        Group avg:{" "}
        <span className="font-mono tabular-nums text-foreground">
          {point.groupAverage != null ? formatValue(point.groupAverage) : "—"}
        </span>
      </p>
    </div>
  );
}

function FilterSelect({
  value,
  onChange,
  children,
  ariaLabel,
}: {
  value: string;
  onChange: ChangeEventHandler<HTMLSelectElement>;
  children: ReactNode;
  ariaLabel: string;
}) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={onChange}
      className="h-9 min-w-[7rem] shrink-0 cursor-pointer appearance-none rounded-full border border-border bg-surface-elevated px-3 text-xs text-foreground transition-colors hover:border-border-strong focus:border-border-strong focus:outline-none focus:ring-1 focus:ring-border-strong"
    >
      {children}
    </select>
  );
}

export function NerdStatHistoryChart({
  statId,
  season,
  sort,
  defaultTeamId,
  initialSplit = "all",
  leagueAverage,
  formatValue = (value) => value.toFixed(2),
}: NerdStatHistoryChartProps) {
  const { data, isLoading, error, available } = useNerdStatHistory(statId, season);
  const [basis, setBasis] = useState<NerdStatHistoryBasis>("cumulative");
  const [split, setSplit] = useState<NerdStatHistorySplit>(initialSplit);
  const [group, setGroup] = useState<NerdStatGroupFilter>("all");
  const [teamId, setTeamId] = useState<number>(defaultTeamId ?? MLB_TEAMS[0]!.id);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  useEffect(() => {
    if (defaultTeamId != null) setTeamId(defaultTeamId);
  }, [defaultTeamId]);

  const selected = useSelectedNerdStatHistory(data, {
    basis,
    split,
    group,
    teamId,
    sort,
  });

  const showLeagueGuide =
    group === "all" && basis === "cumulative" && leagueAverage != null && Number.isFinite(leagueAverage);

  return (
    <section className="mt-6 rounded-xl border border-border bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-foreground">Daily trend</h2>
          <p className="mt-1 text-xs text-muted">
            {selected ? `${selected.teamAbbrev} vs group average` : "How this stat has changed by day"}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5 text-[10px] text-subtle">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-0.5 w-4 rounded bg-secondary" />
            Team
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-0.5 w-4 rounded border-t border-dashed border-muted" />
            Group avg
          </span>
        </div>
      </div>

      <div className="-mx-1 mt-4 flex flex-wrap items-center gap-2 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <FilterSelect
          ariaLabel="Trend basis"
          value={basis}
          onChange={(event) => setBasis(event.target.value as NerdStatHistoryBasis)}
        >
          {NERD_STAT_HISTORY_BASES.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect
          ariaLabel="Game split"
          value={split}
          onChange={(event) => setSplit(event.target.value as NerdStatHistorySplit)}
        >
          {NERD_STAT_HISTORY_SPLITS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect
          ariaLabel="League or division"
          value={group}
          onChange={(event) => setGroup(event.target.value as NerdStatGroupFilter)}
        >
          {NERD_STAT_GROUP_FILTERS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect
          ariaLabel="Team"
          value={String(teamId)}
          onChange={(event) => setTeamId(Number.parseInt(event.target.value, 10))}
        >
          {MLB_TEAMS.map((team) => (
            <option key={team.id} value={team.id}>
              {team.abbrev}
            </option>
          ))}
        </FilterSelect>
      </div>

      {isLoading ? (
        <Skeleton className="mt-4 h-[220px] w-full rounded-lg sm:h-[260px]" />
      ) : error ? (
        <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      ) : !available || !selected || selected.points.length === 0 ? (
        <div className="mt-4 rounded-lg border border-border bg-surface-elevated px-4 py-8 text-center text-sm text-muted">
          Daily history is not available yet. Run{" "}
          <code className="text-xs text-secondary">aggregate-nerd-stats --rebuild-history</code> to
          populate trend data.
        </div>
      ) : (
        <div className="mt-4">
          <HistoryLineChart
            points={selected.points}
            leagueAverage={leagueAverage}
            showLeagueGuide={showLeagueGuide}
            formatValue={formatValue}
            activeIndex={activeIndex}
            onSelectIndex={(index) => setActiveIndex(index)}
          />
        </div>
      )}
    </section>
  );
}
