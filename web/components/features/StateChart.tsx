"use client";

import { motion } from "framer-motion";
import {
  memo,
  useCallback,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";

import {
  BASE_STATE_LABELS,
  BASE_STATE_ORDER,
  buildHalfInningPath,
  buildStateChartCells,
  cellDisplayValue,
  findCellCenter,
  hitTestStateChart,
  markerDisplayPoint,
  markerRadius,
  normalizeScale,
  runExpectancyRange,
  STATE_CHART_VIEW,
  type StateChartCursor,
  type StateChartHitTarget,
  type StateChartMode,
  type StateChartPathMarker,
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

function hoverFromHit(hit: StateChartHitTarget): HoverContent {
  if (hit.kind === "cell") {
    const { cell } = hit;
    return {
      id: cell.id,
      title: `${cell.label} · ${cell.outs} out${cell.outs === 1 ? "" : "s"}`,
      lines: [
        `RE ${cell.expectedRuns.toFixed(2)}`,
        cell.homeWinProb != null
          ? `Home WP ${formatProbability(cell.homeWinProb)}`
          : "Home WP —",
      ],
    };
  }
  if (hit.kind === "segment") {
    const { segment } = hit;
    return {
      id: segment.id,
      title: segment.event,
      lines: [`WPA ${formatWpa(segment.wpa) ?? "0.0%"}`],
    };
  }
  const { marker } = hit;
  return {
    id: marker.id,
    title: marker.event,
    lines: [`WPA ${formatWpa(marker.wpa) ?? "0.0%"}`, "Same base-out state"],
  };
}

function clientToSvgPoint(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } | null {
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const point = svg.createSVGPoint();
  point.x = clientX;
  point.y = clientY;
  const local = point.matrixTransform(ctm.inverse());
  return { x: local.x, y: local.y };
}

export function StateChart({ plays, cursor, mode = "re", className }: StateChartProps) {
  const [hover, setHover] = useState<HoverContent | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const hoverIdRef = useRef<string | null>(null);

  const cells = useMemo(() => buildStateChartCells(cursor), [cursor]);
  const { segments, markers } = useMemo(
    () => buildHalfInningPath(plays, cursor),
    [plays, cursor],
  );
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
    const tipWidth = tip.offsetWidth || 160;
    const tipHeight = tip.offsetHeight || 48;
    let x = clientX - rect.left + 12;
    let y = clientY - rect.top - 8;
    if (x + tipWidth > rect.width - 4) x = clientX - rect.left - tipWidth - 12;
    if (y + tipHeight > rect.height - 4) y = clientY - rect.top - tipHeight - 4;
    x = Math.max(4, Math.min(x, rect.width - tipWidth - 4));
    y = Math.max(4, y);
    tip.style.transform = `translate(${x}px, ${y}px)`;
  }, []);

  const applyHover = useCallback(
    (next: HoverContent | null, clientX: number, clientY: number) => {
      if (!next) {
        if (hoverIdRef.current != null) {
          hoverIdRef.current = null;
          setHover(null);
        }
        return;
      }
      moveTooltip(clientX, clientY);
      if (hoverIdRef.current === next.id) return;
      hoverIdRef.current = next.id;
      setHover(next);
    },
    [moveTooltip],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const svg = svgRef.current;
      if (!svg) return;
      const local = clientToSvgPoint(svg, event.clientX, event.clientY);
      if (!local) return;
      const hit = hitTestStateChart(local.x, local.y, cells, segments, markers);
      applyHover(hit ? hoverFromHit(hit) : null, event.clientX, event.clientY);
    },
    [applyHover, cells, markers, segments],
  );

  const handlePointerLeave = useCallback(() => {
    hoverIdRef.current = null;
    setHover(null);
  }, []);

  const { width, height } = STATE_CHART_VIEW;

  return (
    <div
      ref={rootRef}
      className={cn("relative w-full", className)}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      <StateChartSvg
        svgRef={svgRef}
        cells={cells}
        segments={segments}
        markers={markers}
        cellFills={cellFills}
        cursorPoint={cursorPoint}
        width={width}
        height={height}
      />

      <div
        ref={tooltipRef}
        className={cn(
          "pointer-events-none absolute left-0 top-0 z-10 max-w-[200px] border border-border bg-surface-elevated px-2.5 py-1.5 text-[11px] shadow-sm will-change-transform",
          hover ? "opacity-100" : "opacity-0",
        )}
        aria-hidden={!hover}
      >
        {hover ? (
          <>
            <p className="font-medium text-foreground">{hover.title}</p>
            {hover.lines.map((line) => (
              <p key={line} className="font-mono tabular-nums text-muted">
                {line}
              </p>
            ))}
          </>
        ) : null}
      </div>
    </div>
  );
}

interface StateChartSvgProps {
  svgRef: RefObject<SVGSVGElement | null>;
  cells: ReturnType<typeof buildStateChartCells>;
  segments: StateChartPathSegment[];
  markers: StateChartPathMarker[];
  cellFills: Map<string, string>;
  cursorPoint: ReturnType<typeof findCellCenter> | null;
  width: number;
  height: number;
}

const StateChartSvg = memo(function StateChartSvg({
  svgRef,
  cells,
  segments,
  markers,
  cellFills,
  cursorPoint,
  width,
  height,
}: StateChartSvgProps) {
  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${width} ${height}`}
      className="h-auto w-full touch-none"
      role="img"
      aria-label="Base-out state chart"
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
            className="pointer-events-none fill-[var(--muted)] font-sans text-[11px]"
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
            className="pointer-events-none fill-[var(--muted)] font-sans text-[10px]"
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

        return (
          <polygon
            key={cell.id}
            points={cell.points}
            fill={cellFills.get(cell.id)}
            stroke={isCursor ? cssVar("--state-chart-cursor") : cssVar("--state-chart-grid")}
            strokeWidth={isCursor ? 2.5 : 1}
            className="pointer-events-none"
          />
        );
      })}

      {segments.map((seg) => (
        <line
          key={seg.id}
          x1={seg.from.cx}
          y1={seg.from.cy}
          x2={seg.to.cx}
          y2={seg.to.cy}
          stroke={segmentStroke(seg.wpa)}
          strokeWidth={segmentWidth(seg.wpa)}
          strokeLinecap="round"
          className="pointer-events-none"
        />
      ))}

      {markers.map((marker) => {
        const { cx, cy } = markerDisplayPoint(marker);
        const r = markerRadius(marker.wpa);
        return (
          <g key={marker.id} className="pointer-events-none">
            <circle
              cx={cx}
              cy={cy}
              r={r + 2.5}
              fill="none"
              stroke={segmentStroke(marker.wpa)}
              strokeWidth={1.25}
              opacity={0.45}
            />
            <circle
              cx={cx}
              cy={cy}
              r={r}
              fill={segmentStroke(marker.wpa)}
              stroke="var(--state-chart-bg)"
              strokeWidth={1.25}
            />
          </g>
        );
      })}

      {cursorPoint && (
        <motion.circle
          cx={cursorPoint.cx}
          cy={cursorPoint.cy}
          r={7}
          fill="none"
          stroke={cssVar("--state-chart-cursor")}
          strokeWidth={2}
          className="pointer-events-none"
          initial={false}
          animate={{ cx: cursorPoint.cx, cy: cursorPoint.cy }}
          transition={{ duration: 0.22, ease: "easeOut" }}
        />
      )}
    </svg>
  );
});
