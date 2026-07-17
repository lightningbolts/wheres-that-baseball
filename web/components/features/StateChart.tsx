"use client";

import { motion } from "framer-motion";
import { useMemo, useState } from "react";

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

interface HoverState {
  kind: "cell" | "segment";
  x: number;
  y: number;
  title: string;
  lines: string[];
}

function cssVar(name: string): string {
  return `var(${name})`;
}

function lerpColor(t: number, low: string, high: string): string {
  // SVG fill uses CSS color-mix when available; fall back to opacity blend via solid mid.
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
  const [hover, setHover] = useState<HoverState | null>(null);

  const cells = useMemo(() => buildStateChartCells(cursor), [cursor]);
  const path = useMemo(() => buildHalfInningPath(plays, cursor), [plays, cursor]);
  const reRange = useMemo(() => runExpectancyRange(cells), [cells]);

  const cursorPoint = useMemo(() => {
    if (!cursor) return null;
    return findCellCenter(cursor.onFirst, cursor.onSecond, cursor.onThird, cursor.outs);
  }, [cursor]);

  const { width, height } = STATE_CHART_VIEW;

  return (
    <div className={cn("relative w-full", className)}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
        role="img"
        aria-label="Base-out state chart"
        onMouseLeave={() => setHover(null)}
      >
        <rect
          x={0}
          y={0}
          width={width}
          height={height}
          fill={cssVar("--state-chart-bg")}
        />

        {/* Outs band labels */}
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

        {/* Base-state column labels */}
        {BASE_STATE_ORDER.map((base, i) => {
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

        {/* Cells */}
        {cells.map((cell) => {
          const value = cellDisplayValue(cell, mode);
          const isCursor =
            cursorPoint != null &&
            cell.base === cursorPoint.base &&
            cell.outs === cursorPoint.outs;

          return (
            <g key={cell.id}>
              <polygon
                points={cell.points}
                fill={cellFill(value, mode, reRange.min, reRange.max)}
                stroke={isCursor ? cssVar("--state-chart-cursor") : cssVar("--state-chart-grid")}
                strokeWidth={isCursor ? 2.5 : 1}
                className="cursor-pointer"
                onMouseEnter={(e) => {
                  const svg = e.currentTarget.ownerSVGElement;
                  if (!svg) return;
                  const rect = svg.getBoundingClientRect();
                  setHover({
                    kind: "cell",
                    x: e.clientX - rect.left,
                    y: e.clientY - rect.top,
                    title: `${cell.label} · ${cell.outs} out${cell.outs === 1 ? "" : "s"}`,
                    lines: [
                      `RE ${cell.expectedRuns.toFixed(2)}`,
                      cell.homeWinProb != null
                        ? `Home WP ${formatProbability(cell.homeWinProb)}`
                        : "Home WP —",
                    ],
                  });
                }}
                onMouseMove={(e) => {
                  const svg = e.currentTarget.ownerSVGElement;
                  if (!svg) return;
                  const rect = svg.getBoundingClientRect();
                  setHover((prev) =>
                    prev
                      ? { ...prev, x: e.clientX - rect.left, y: e.clientY - rect.top }
                      : prev,
                  );
                }}
              />
            </g>
          );
        })}

        {/* Half-inning path */}
        {path.map((seg) => (
          <PathSegment
            key={seg.id}
            segment={seg}
            onHover={(next) => setHover(next)}
          />
        ))}

        {/* Live cursor */}
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

      {hover && (
        <div
          className="pointer-events-none absolute z-10 max-w-[200px] border border-border bg-surface-elevated px-2.5 py-1.5 text-[11px] shadow-sm"
          style={{
            left: Math.min(hover.x + 12, width),
            top: Math.max(hover.y - 8, 0),
          }}
        >
          <p className="font-medium text-foreground">{hover.title}</p>
          {hover.lines.map((line) => (
            <p key={line} className="font-mono tabular-nums text-muted">
              {line}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function PathSegment({
  segment,
  onHover,
}: {
  segment: StateChartPathSegment;
  onHover: (hover: HoverState | null) => void;
}) {
  const wpaLabel = formatWpa(segment.wpa) ?? "0.0%";

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
      onMouseEnter={(e) => {
        const svg = e.currentTarget.ownerSVGElement;
        if (!svg) return;
        const rect = svg.getBoundingClientRect();
        onHover({
          kind: "segment",
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
          title: segment.event,
          lines: [`WPA ${wpaLabel}`],
        });
      }}
      onMouseMove={(e) => {
        const svg = e.currentTarget.ownerSVGElement;
        if (!svg) return;
        const rect = svg.getBoundingClientRect();
        onHover({
          kind: "segment",
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
          title: segment.event,
          lines: [`WPA ${wpaLabel}`],
        });
      }}
    />
  );
}
