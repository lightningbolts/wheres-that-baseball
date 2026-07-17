"use client";

import { motion } from "framer-motion";
import {
  memo,
  useCallback,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";

import {
  BASE_STATE_LABELS,
  BASE_STATE_ORDER,
  buildHalfInningPath,
  buildStateChartCells,
  cellDisplayValue,
  findCellCenter,
  normalizeScale,
  runExpectancyRange,
  STATE_CHART_VIEW,
  type StateChartCursor,
  type StateChartMode,
  type StateChartPathSegment,
} from "@/lib/mlb/stateChartMath";
import { formatWpa } from "@/lib/mlb/wpa";
import { cn, formatProbability } from "@/lib/utils";
import type { PlayByPlayEntry } from "@/types/mlb-live";

interface StateChartProps {
  plays: PlayByPlayEntry[];
  cursor: StateChartCursor | null;
  mode?: StateChartMode;
  className?: string;
}

interface HoverContent {
  id: string;
  title: string;
  lines: string[];
}

function cssVar(name: string): string {
  return `var(${name})`;
}

function lerpColor(t: number, low: string, high: string): string {
  const clamped = Math.max(0, Math.min(1, t));
  return `color-mix(in srgb, ${high} ${Math.round(clamped * 100)}%, ${low})`;
}

function cellFill(value: number, mode: StateChartMode, reMin: number, reMax: number): string {
  if (mode === "wp") {
    const t = normalizeScale(value, 0, 1);
    if (t < 0.5) {
      return lerpColor(t * 2, cssVar("--state-chart-wp-low"), cssVar("--state-chart-wp-mid"));
    }
    return lerpColor((t - 0.5) * 2, cssVar("--state-chart-wp-mid"), cssVar("--state-chart-wp-high"));
  }
  const t = normalizeScale(value, reMin, reMax);
  return lerpColor(t, cssVar("--state-chart-re-low"), cssVar("--state-chart-re-high"));
}

function segmentStroke(wpa: number): string {
  if (wpa > 0.001) return cssVar("--state-chart-wpa-pos");
  if (wpa < -0.001) return cssVar("--state-chart-wpa-neg");
  return cssVar("--state-chart-grid");
}

function segmentWidth(wpa: number): number {
  return 1.5 + Math.min(4, Math.abs(wpa) * 40);
}

export function StateChart({ plays, cursor, mode = "re", className }: StateChartProps) {
  const [hover, setHover] = useState<HoverContent | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const hoverIdRef = useRef<string | null>(null);

  const cells = useMemo(() => buildStateChartCells(cursor), [cursor]);
  const path = useMemo(() => buildHalfInningPath(plays, cursor), [plays, cursor]);
  const reRange = useMemo(() => runExpectancyRange(cells), [cells]);

  const cursorPoint = useMemo(() => {
    if (!cursor) return null;
    return findCellCenter(cursor.onFirst, cursor.onSecond, cursor.onThird, cursor.outs);
  }, [cursor]);

  const cellFills = useMemo(() => {
    const fills = new Map<string, string>();
    for (const cell of cells) {
      fills.set(cell.id, cellFill(cellDisplayValue(cell, mode), mode, reRange.min, reRange.max));
    }
    return fills;
  }, [cells, mode, reRange.max, reRange.min]);

  const moveTooltip = useCallback((clientX: number, clientY: number) => {
    const root = rootRef.current;
    const tip = tooltipRef.current;
    if (!root || !tip) return;
    const rect = root.getBoundingClientRect();
    const x = clientX - rect.left + 12;
    const y = Math.max(clientY - rect.top - 8, 0);
    tip.style.transform = `translate(${x}px, ${y}px)`;
  }, []);

  const showHover = useCallback(
    (next: HoverContent, clientX: number, clientY: number) => {
      moveTooltip(clientX, clientY);
      if (hoverIdRef.current === next.id) return;
      hoverIdRef.current = next.id;
      setHover(next);
    },
    [moveTooltip],
  );

  const clearHover = useCallback(() => {
    hoverIdRef.current = null;
    setHover(null);
  }, []);

  const { width, height } = STATE_CHART_VIEW;

  return (
    <div ref={rootRef} className={cn("relative w-full", className)}>
      <StateChartSvg
        cells={cells}
        path={path}
        cellFills={cellFills}
        cursorPoint={cursorPoint}
        width={width}
        height={height}
        onShowHover={showHover}
        onMoveTooltip={moveTooltip}
        onClearHover={clearHover}
      />

      <div
        ref={tooltipRef}
        className={cn(
          "pointer-events-none absolute left-0 top-0 z-10 max-w-[200px] border border-border bg-surface-elevated px-2.5 py-1.5 text-[11px] shadow-sm will-change-transform",
          hover ? "visible" : "invisible",
        )}
      >
        {hover && (
          <>
            <p className="font-medium text-foreground">{hover.title}</p>
            {hover.lines.map((line) => (
              <p key={line} className="font-mono tabular-nums text-muted">
                {line}
              </p>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

interface StateChartSvgProps {
  cells: ReturnType<typeof buildStateChartCells>;
  path: StateChartPathSegment[];
  cellFills: Map<string, string>;
  cursorPoint: ReturnType<typeof findCellCenter> | null;
  width: number;
  height: number;
  onShowHover: (next: HoverContent, clientX: number, clientY: number) => void;
  onMoveTooltip: (clientX: number, clientY: number) => void;
  onClearHover: () => void;
}

const StateChartSvg = memo(function StateChartSvg({
  cells,
  path,
  cellFills,
  cursorPoint,
  width,
  height,
  onShowHover,
  onMoveTooltip,
  onClearHover,
}: StateChartSvgProps) {
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-auto w-full"
      role="img"
      aria-label="Base-out state chart"
      onMouseLeave={onClearHover}
    >
      <rect x={0} y={0} width={width} height={height} fill={cssVar("--state-chart-bg")} />

      {[0, 1, 2].map((outs) => {
        const y =
          STATE_CHART_VIEW.paddingTop +
          ((height - STATE_CHART_VIEW.paddingTop - STATE_CHART_VIEW.paddingBottom) / 3) *
            (outs + 0.5);
        return (
          <text
            key={`outs-${outs}`}
            x={14}
            y={y}
            textAnchor="middle"
            dominantBaseline="middle"
            className="fill-[var(--muted)] font-sans text-[11px]"
            transform={`rotate(-90 14 ${y})`}
          >
            {outs} out{outs === 1 ? "" : "s"}
          </text>
        );
      })}

      {BASE_STATE_ORDER.map((base) => {
        const cell = cells.find((c) => c.base === base && c.outs === 0);
        if (!cell) return null;
        return (
          <text
            key={`base-label-${base}`}
            x={cell.cx}
            y={height - 12}
            textAnchor="middle"
            className="fill-[var(--muted)] font-sans text-[10px]"
          >
            {BASE_STATE_LABELS[base]}
          </text>
        );
      })}

      {cells.map((cell) => {
        const isCursor =
          cursorPoint != null &&
          cell.base === cursorPoint.base &&
          cell.outs === cursorPoint.outs;

        const onEnter = (e: ReactMouseEvent<SVGPolygonElement>) => {
          onShowHover(
            {
              id: cell.id,
              title: `${cell.label} · ${cell.outs} out${cell.outs === 1 ? "" : "s"}`,
              lines: [
                `RE ${cell.expectedRuns.toFixed(2)}`,
                cell.homeWinProb != null
                  ? `Home WP ${formatProbability(cell.homeWinProb)}`
                  : "Home WP —",
              ],
            },
            e.clientX,
            e.clientY,
          );
        };

        return (
          <polygon
            key={cell.id}
            points={cell.points}
            fill={cellFills.get(cell.id)}
            stroke={isCursor ? cssVar("--state-chart-cursor") : cssVar("--state-chart-grid")}
            strokeWidth={isCursor ? 2.5 : 1}
            className="cursor-pointer"
            onMouseEnter={onEnter}
            onMouseMove={(e) => onMoveTooltip(e.clientX, e.clientY)}
          />
        );
      })}

      {path.map((seg) => (
        <PathSegment
          key={seg.id}
          segment={seg}
          onShowHover={onShowHover}
          onMoveTooltip={onMoveTooltip}
        />
      ))}

      {cursorPoint && (
        <motion.circle
          cx={cursorPoint.cx}
          cy={cursorPoint.cy}
          r={7}
          fill="none"
          stroke={cssVar("--state-chart-cursor")}
          strokeWidth={2}
          initial={false}
          animate={{ cx: cursorPoint.cx, cy: cursorPoint.cy }}
          transition={{ duration: 0.22, ease: "easeOut" }}
        />
      )}
    </svg>
  );
});

const PathSegment = memo(function PathSegment({
  segment,
  onShowHover,
  onMoveTooltip,
}: {
  segment: StateChartPathSegment;
  onShowHover: (next: HoverContent, clientX: number, clientY: number) => void;
  onMoveTooltip: (clientX: number, clientY: number) => void;
}) {
  const wpaLabel = formatWpa(segment.wpa) ?? "0.0%";
  const content = useMemo<HoverContent>(
    () => ({
      id: segment.id,
      title: segment.event,
      lines: [`WPA ${wpaLabel}`],
    }),
    [segment.event, segment.id, wpaLabel],
  );

  return (
    <line
      x1={segment.from.cx}
      y1={segment.from.cy}
      x2={segment.to.cx}
      y2={segment.to.cy}
      stroke={segmentStroke(segment.wpa)}
      strokeWidth={segmentWidth(segment.wpa)}
      strokeLinecap="round"
      className="cursor-pointer"
      onMouseEnter={(e) => onShowHover(content, e.clientX, e.clientY)}
      onMouseMove={(e) => onMoveTooltip(e.clientX, e.clientY)}
    />
  );
});
