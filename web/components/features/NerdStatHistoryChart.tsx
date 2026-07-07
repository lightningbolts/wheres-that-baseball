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
  useMultiNerdStatHistory,
  useNerdStatHistory,
  useSelectedNerdStatHistory,
  type NerdStatHistoryViewMode,
} from "@/hooks/useNerdStatHistory";
import {
  multiSeriesHasPlottedValues,
  type NerdStatHistoryBasis,
  type NerdStatHistorySeriesPoint,
  type NerdStatHistorySplit,
  type SelectedMultiHistorySeries,
} from "@/lib/mlb/nerdStats/history";
import { MLB_TEAMS, NERD_STAT_GROUP_FILTERS, getTeamById, type NerdStatGroupFilter } from "@/lib/mlb/teams";
import { cn } from "@/lib/utils";

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
const SINGLE_CHART_HEIGHT = 220;
const COMPARE_CHART_HEIGHT = 280;
const PADDING = { top: 16, right: 12, bottom: 28, left: 44 };

const VIEW_MODES: Array<{ id: NerdStatHistoryViewMode; label: string }> = [
  { id: "single", label: "One team" },
  { id: "compare", label: "Compare teams" },
];

function getTeamAbbrev(teamId: number): string {
  return getTeamById(teamId)?.abbrev ?? "???";
}

function formatAxisValue(value: number): string {
  if (Math.abs(value) >= 100) return value.toFixed(0);
  if (Math.abs(value) >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

function hasPlottedValues(points: NerdStatHistorySeriesPoint[]): boolean {
  return points.some(
    (point) =>
      (point.teamValue != null && Number.isFinite(point.teamValue)) ||
      (point.groupAverage != null && Number.isFinite(point.groupAverage)),
  );
}

function chartXFromClient(
  clientX: number,
  clientY: number,
  svg: SVGSVGElement,
): number | null {
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;

  const point = svg.createSVGPoint();
  point.x = clientX;
  point.y = clientY;
  const svgPoint = point.matrixTransform(ctm.inverse());
  return Math.max(PADDING.left, Math.min(CHART_WIDTH - PADDING.right, svgPoint.x));
}

function nearestIndexForChartX(
  chartX: number,
  pointCount: number,
  plotWidth: number,
): number {
  if (pointCount <= 0) return 0;
  if (pointCount === 1) return 0;

  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < pointCount; index += 1) {
    const x = PADDING.left + (index / (pointCount - 1)) * plotWidth;
    const distance = Math.abs(x - chartX);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function selectionFromPointer(
  clientX: number,
  clientY: number,
  svg: SVGSVGElement,
  pointCount: number,
  plotWidth: number,
): ChartPointerSelection | null {
  const chartX = chartXFromClient(clientX, clientY, svg);
  if (chartX == null || pointCount === 0) return null;
  return {
    index: nearestIndexForChartX(chartX, pointCount, plotWidth),
    chartX,
  };
}

interface ChartPointerSelection {
  index: number;
  chartX: number;
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

function plottedIndexBounds(values: Array<number | null>): { first: number; last: number } | null {
  let first: number | null = null;
  let last: number | null = null;

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value == null || !Number.isFinite(value)) continue;
    if (first === null) first = index;
    last = index;
  }

  return first != null && last != null ? { first, last } : null;
}

function buildAreaPath(
  linePath: string,
  values: Array<number | null>,
  xForIndex: (index: number) => number,
  plotBottom: number,
): string | null {
  const bounds = plottedIndexBounds(values);
  if (!bounds) return null;
  return `${linePath} L ${xForIndex(bounds.last).toFixed(2)},${plotBottom} L ${xForIndex(bounds.first).toFixed(2)},${plotBottom} Z`;
}

function useChartScale(
  numericValues: number[],
  chartHeight: number,
) {
  const minValue = numericValues.length > 0 ? Math.min(...numericValues) : 0;
  const maxValue = numericValues.length > 0 ? Math.max(...numericValues) : 1;
  const valueSpan = maxValue - minValue || 1;
  const paddedMin = minValue - valueSpan * 0.08;
  const paddedMax = maxValue + valueSpan * 0.08;
  const plotWidth = CHART_WIDTH - PADDING.left - PADDING.right;
  const plotHeight = chartHeight - PADDING.top - PADDING.bottom;

  const yForValue = useCallback(
    (value: number) =>
      PADDING.top + plotHeight - ((value - paddedMin) / (paddedMax - paddedMin)) * plotHeight,
    [paddedMax, paddedMin, plotHeight],
  );

  const yTicks = useMemo(() => {
    const ticks: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      ticks.push(paddedMin + ((paddedMax - paddedMin) * i) / 3);
    }
    return ticks;
  }, [paddedMax, paddedMin]);

  return { plotWidth, plotHeight, yForValue, yTicks, paddedMin, paddedMax };
}

function useXAxis(pointCount: number, plotWidth: number) {
  const xForIndex = useCallback(
    (index: number) => {
      if (pointCount <= 1) return PADDING.left + plotWidth / 2;
      return PADDING.left + (index / (pointCount - 1)) * plotWidth;
    },
    [plotWidth, pointCount],
  );

  const xLabelIndexes = useMemo(() => {
    if (pointCount <= 1) return [0];
    const maxLabels = 5;
    const step = Math.max(1, Math.floor((pointCount - 1) / (maxLabels - 1)));
    const indexes = [];
    for (let index = 0; index < pointCount; index += step) indexes.push(index);
    if (indexes[indexes.length - 1] !== pointCount - 1) indexes.push(pointCount - 1);
    return indexes;
  }, [pointCount]);

  return { xForIndex, xLabelIndexes };
}

function HistoryLineChart({
  points,
  leagueAverage,
  showLeagueGuide,
  formatValue,
  onSelect,
  selection,
}: {
  points: NerdStatHistorySeriesPoint[];
  leagueAverage?: number | null;
  showLeagueGuide: boolean;
  formatValue: (value: number) => string;
  onSelect: (selection: ChartPointerSelection | null) => void;
  selection: ChartPointerSelection | null;
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

  const { plotWidth, plotHeight, yForValue, yTicks } = useChartScale(
    numericValues,
    SINGLE_CHART_HEIGHT,
  );
  const { xForIndex, xLabelIndexes } = useXAxis(points.length, plotWidth);

  const teamPath = buildPath(teamValues, xForIndex, yForValue);
  const groupPath = buildPath(groupValues, xForIndex, yForValue);
  const teamAreaPath =
    teamPath != null
      ? buildAreaPath(teamPath, teamValues, xForIndex, PADDING.top + plotHeight)
      : null;

  const handlePointer = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg || points.length === 0) return;
    onSelect(selectionFromPointer(clientX, clientY, svg, points.length, plotWidth));
  };

  return (
    <div className="relative w-full overflow-x-auto">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${CHART_WIDTH} ${SINGLE_CHART_HEIGHT}`}
        className="h-[220px] w-full min-w-[280px] touch-none select-none sm:h-[260px]"
        role="img"
        aria-label="Nerd stat trend chart"
        onPointerDown={(event) => handlePointer(event.clientX, event.clientY)}
        onPointerMove={(event) => {
          if (event.buttons > 0) handlePointer(event.clientX, event.clientY);
        }}
        onPointerLeave={() => onSelect(null)}
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
            {teamAreaPath && (
              <path d={teamAreaPath} fill={`url(#${gradientId})`} stroke="none" />
            )}
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

        {points.map((point, index) =>
          point.teamValue != null && Number.isFinite(point.teamValue) ? (
            <circle
              key={`team-dot-${index}`}
              cx={xForIndex(index)}
              cy={yForValue(point.teamValue)}
              r={points.length <= 3 ? 4 : 2.5}
              fill="var(--secondary)"
              stroke="var(--background)"
              strokeWidth={1.5}
            />
          ) : null,
        )}

        {selection != null && points[selection.index] && (
          <>
            <line
              x1={selection.chartX}
              x2={selection.chartX}
              y1={PADDING.top}
              y2={PADDING.top + plotHeight}
              stroke="var(--border-strong)"
              strokeWidth={1}
            />
            {points[selection.index]!.teamValue != null && (
              <circle
                cx={xForIndex(selection.index)}
                cy={yForValue(points[selection.index]!.teamValue!)}
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
            y={SINGLE_CHART_HEIGHT - 8}
            textAnchor="middle"
            className="fill-subtle text-[10px]"
          >
            {points[index]?.date.slice(5)}
          </text>
        ))}
      </svg>

      {selection != null && points[selection.index] && (
        <ChartTooltip
          point={points[selection.index]!}
          formatValue={formatValue}
          className="pointer-events-none absolute left-3 top-3 max-w-[calc(100%-1.5rem)] rounded-lg border border-border bg-surface-elevated px-3 py-2 text-xs shadow-sm sm:left-auto sm:right-3"
        />
      )}
    </div>
  );
}

function MultiTeamHistoryChart({
  series,
  leagueAverage,
  showLeagueGuide,
  formatValue,
  highlightedTeamId,
  onHighlightTeam,
}: {
  series: SelectedMultiHistorySeries;
  leagueAverage?: number | null;
  showLeagueGuide: boolean;
  formatValue: (value: number) => string;
  highlightedTeamId: number | null;
  onHighlightTeam: (teamId: number | null) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [selection, setSelection] = useState<ChartPointerSelection | null>(null);
  const [tooltipHover, setTooltipHover] = useState(false);
  const pointCount = series.dates.length;

  const numericValues = useMemo(() => {
    const values: number[] = [];
    for (const team of series.teams) {
      for (const value of team.values) {
        if (value != null && Number.isFinite(value)) values.push(value);
      }
    }
    if (showLeagueGuide && leagueAverage != null && Number.isFinite(leagueAverage)) {
      values.push(leagueAverage);
    }
    return values;
  }, [leagueAverage, series.teams, showLeagueGuide]);

  const { plotWidth, plotHeight, yForValue, yTicks } = useChartScale(
    numericValues,
    COMPARE_CHART_HEIGHT,
  );
  const { xForIndex, xLabelIndexes } = useXAxis(pointCount, plotWidth);

  const handlePointer = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg || pointCount === 0) return;
    setSelection(selectionFromPointer(clientX, clientY, svg, pointCount, plotWidth));
  };

  const clearSelection = () => {
    if (!tooltipHover) setSelection(null);
  };

  const activeIndex = selection?.index ?? null;

  const activeEntries =
    activeIndex != null
      ? series.teams
          .map((team) => ({
            teamId: team.teamId,
            teamAbbrev: team.teamAbbrev,
            color: team.color,
            value: team.values[activeIndex] ?? null,
          }))
          .filter((entry) => entry.value != null && Number.isFinite(entry.value))
          .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
      : [];

  return (
    <div>
      <div className="relative w-full overflow-x-auto">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${CHART_WIDTH} ${COMPARE_CHART_HEIGHT}`}
          className="h-[240px] w-full min-w-[280px] touch-none select-none sm:h-[300px]"
          role="img"
          aria-label="Multi-team nerd stat trend chart"
          onPointerDown={(event) => handlePointer(event.clientX, event.clientY)}
          onPointerMove={(event) => {
            if (event.buttons > 0) handlePointer(event.clientX, event.clientY);
          }}
          onPointerLeave={clearSelection}
        >
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

          {series.teams.map((team) => {
            const path = buildPath(team.values, xForIndex, yForValue);
            const dimmed = highlightedTeamId != null && highlightedTeamId !== team.teamId;
            return path ? (
              <path
                key={team.teamId}
                d={path}
                fill="none"
                stroke={team.color}
                strokeWidth={highlightedTeamId === team.teamId ? 2.5 : 1.5}
                strokeLinejoin="round"
                strokeLinecap="round"
                opacity={dimmed ? 0.2 : highlightedTeamId === team.teamId ? 1 : 0.85}
              />
            ) : null;
          })}

          {selection != null && (
            <line
              x1={selection.chartX}
              x2={selection.chartX}
              y1={PADDING.top}
              y2={PADDING.top + plotHeight}
              stroke="var(--border-strong)"
              strokeWidth={1}
            />
          )}

          {selection != null &&
            series.teams.map((team) => {
              const value = team.values[selection.index];
              if (value == null || !Number.isFinite(value)) return null;
              const dimmed = highlightedTeamId != null && highlightedTeamId !== team.teamId;
              return (
                <circle
                  key={`active-${team.teamId}`}
                  cx={xForIndex(selection.index)}
                  cy={yForValue(value)}
                  r={highlightedTeamId === team.teamId ? 4 : 3}
                  fill={team.color}
                  stroke="var(--background)"
                  strokeWidth={1.5}
                  opacity={dimmed ? 0.25 : 1}
                />
              );
            })}

          {xLabelIndexes.map((index) => (
            <text
              key={index}
              x={xForIndex(index)}
              y={COMPARE_CHART_HEIGHT - 8}
              textAnchor="middle"
              className="fill-subtle text-[10px]"
            >
              {series.dates[index]?.slice(5)}
            </text>
          ))}
        </svg>

        {selection != null && activeEntries.length > 0 && (
          <MultiTeamTooltip
            date={series.dates[selection.index] ?? ""}
            entries={activeEntries}
            formatValue={formatValue}
            onPointerEnter={() => setTooltipHover(true)}
            onPointerLeave={() => {
              setTooltipHover(false);
              setSelection(null);
            }}
            className="absolute left-3 top-3 z-10 max-h-48 max-w-[calc(100%-1.5rem)] overflow-y-auto overscroll-contain rounded-lg border border-border bg-surface-elevated px-3 py-2 text-xs shadow-sm sm:left-auto sm:right-3"
          />
        )}
      </div>

      <TeamLegend
        teams={series.teams}
        highlightedTeamId={highlightedTeamId}
        onHighlightTeam={onHighlightTeam}
      />
    </div>
  );
}

function TeamLegend({
  teams,
  highlightedTeamId,
  onHighlightTeam,
}: {
  teams: SelectedMultiHistorySeries["teams"];
  highlightedTeamId: number | null;
  onHighlightTeam: (teamId: number | null) => void;
}) {
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {teams.map((team) => {
        const active = highlightedTeamId === team.teamId;
        return (
          <button
            key={team.teamId}
            type="button"
            onClick={() => onHighlightTeam(active ? null : team.teamId)}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] transition-colors",
              active
                ? "border-border-strong bg-surface-elevated text-foreground"
                : "border-transparent text-muted hover:border-border hover:bg-hover hover:text-foreground",
            )}
            aria-pressed={active}
          >
            <span
              className="inline-block h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: team.color }}
              aria-hidden
            />
            {team.teamAbbrev}
          </button>
        );
      })}
    </div>
  );
}

function MultiTeamTooltip({
  date,
  entries,
  formatValue,
  className,
  onPointerEnter,
  onPointerLeave,
}: {
  date: string;
  entries: Array<{ teamAbbrev: string; color: string; value: number | null }>;
  formatValue: (value: number) => string;
  className?: string;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
}) {
  return (
    <div
      className={className}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onWheel={(event) => event.stopPropagation()}
    >
      <p className="font-medium text-foreground">{date}</p>
      <ul className="mt-1 space-y-0.5">
        {entries.map((entry) => (
          <li key={entry.teamAbbrev} className="flex items-center gap-2 text-muted">
            <span
              className="inline-block h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: entry.color }}
              aria-hidden
            />
            <span className="w-8 font-medium text-foreground">{entry.teamAbbrev}</span>
            <span className="font-mono tabular-nums text-foreground">
              {entry.value != null ? formatValue(entry.value) : "—"}
            </span>
          </li>
        ))}
      </ul>
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
  const [viewMode, setViewMode] = useState<NerdStatHistoryViewMode>("single");
  const [basis, setBasis] = useState<NerdStatHistoryBasis>("cumulative");
  const [split, setSplit] = useState<NerdStatHistorySplit>(initialSplit);
  const [group, setGroup] = useState<NerdStatGroupFilter>("all");
  const [teamId, setTeamId] = useState<number>(defaultTeamId ?? MLB_TEAMS[0]!.id);
  const [selection, setSelection] = useState<ChartPointerSelection | null>(null);
  const [highlightedTeamId, setHighlightedTeamId] = useState<number | null>(null);

  useEffect(() => {
    if (defaultTeamId != null) setTeamId(defaultTeamId);
  }, [defaultTeamId]);

  useEffect(() => {
    setSelection(null);
  }, [viewMode, group, basis, split]);

  useEffect(() => {
    if (viewMode === "compare") {
      setHighlightedTeamId(teamId);
    } else {
      setHighlightedTeamId(null);
    }
  }, [viewMode, group, basis, split, teamId]);

  const selected = useSelectedNerdStatHistory(data, {
    basis,
    split,
    group,
    teamId,
    sort,
  });

  const multiSelected = useMultiNerdStatHistory(data, {
    basis,
    split,
    group,
  });

  const showLeagueGuide =
    group === "all" &&
    basis === "cumulative" &&
    leagueAverage != null &&
    Number.isFinite(leagueAverage);

  const subtitle =
    viewMode === "compare" && multiSelected
      ? highlightedTeamId != null
        ? `${getTeamAbbrev(highlightedTeamId)} highlighted · ${multiSelected.groupLabel} · ${multiSelected.teams.length} teams`
        : `${multiSelected.groupLabel} · ${multiSelected.teams.length} teams`
      : selected
        ? `${selected.teamAbbrev} vs group average`
        : "How this stat has changed by day";

  const hasData =
    viewMode === "compare"
      ? multiSelected != null &&
        multiSelected.dates.length > 0 &&
        multiSeriesHasPlottedValues(multiSelected)
      : selected != null &&
        selected.points.length > 0 &&
        hasPlottedValues(selected.points);

  return (
    <section className="mt-6 rounded-xl border border-border bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-foreground">Daily trend</h2>
          <p className="mt-1 text-xs text-muted">{subtitle}</p>
        </div>
        {viewMode === "single" && (
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
        )}
      </div>

      <div className="-mx-1 mt-4 flex flex-wrap items-center gap-2 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <FilterSelect
          ariaLabel="Chart view"
          value={viewMode}
          onChange={(event) => setViewMode(event.target.value as NerdStatHistoryViewMode)}
        >
          {VIEW_MODES.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </FilterSelect>
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
          onChange={(event) => {
            const nextTeamId = Number.parseInt(event.target.value, 10);
            setTeamId(nextTeamId);
            if (viewMode === "compare") setHighlightedTeamId(nextTeamId);
          }}
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
      ) : !available || !hasData ? (
        <div className="mt-4 rounded-lg border border-border bg-surface-elevated px-4 py-8 text-center text-sm text-muted">
          Daily history is not available yet. Run{" "}
          <code className="text-xs text-secondary">
            npm run aggregate-nerd-stats -- --season={season} --rebuild-history
          </code>{" "}
          to populate trend data.
        </div>
      ) : viewMode === "compare" && multiSelected ? (
        <div className="mt-4">
          <MultiTeamHistoryChart
            series={multiSelected}
            leagueAverage={leagueAverage}
            showLeagueGuide={showLeagueGuide}
            formatValue={formatValue}
            highlightedTeamId={highlightedTeamId}
            onHighlightTeam={(nextTeamId) => {
              setHighlightedTeamId(nextTeamId);
              if (nextTeamId != null) setTeamId(nextTeamId);
            }}
          />
        </div>
      ) : selected ? (
        <div className="mt-4">
          <HistoryLineChart
            points={selected.points}
            leagueAverage={leagueAverage}
            showLeagueGuide={showLeagueGuide}
            formatValue={formatValue}
            selection={selection}
            onSelect={setSelection}
          />
        </div>
      ) : null}
    </section>
  );
}
