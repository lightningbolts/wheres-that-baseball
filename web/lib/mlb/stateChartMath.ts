/**
 * Layout + path math for the State Chart: 24 base-out cells arranged by
 * outs bands and runner pressure, with half-inning WPA path segments.
 */

import {
  decodeBaseState,
  encodeBaseState,
  expectedRunsRemaining,
  homeWinProbability,
} from "@/lib/mlb/winExpectancy";
import type { PlayByPlayEntry } from "@/types/mlb-live";

/** Display order within each outs band (runner pressure). */
export const BASE_STATE_ORDER = [1, 2, 3, 5, 4, 6, 7, 8] as const;

export type BaseStateCode = (typeof BASE_STATE_ORDER)[number];

export const BASE_STATE_LABELS: Record<BaseStateCode, string> = {
  1: "Empty",
  2: "1B",
  3: "2B",
  5: "3B",
  4: "1·2",
  6: "1·3",
  7: "2·3",
  8: "Loaded",
};

export type StateChartMode = "re" | "wp";

export interface StateChartCursor {
  inning: number;
  halfInning: string;
  outs: number;
  onFirst: boolean;
  onSecond: boolean;
  onThird: boolean;
  awayScore: number;
  homeScore: number;
}

export interface StateChartCell {
  id: string;
  base: BaseStateCode;
  outs: number;
  label: string;
  onFirst: boolean;
  onSecond: boolean;
  onThird: boolean;
  /** Center of diamond cell in viewBox coords. */
  cx: number;
  cy: number;
  /** Diamond vertices as SVG points string. */
  points: string;
  expectedRuns: number;
  homeWinProb: number | null;
}

export interface StateChartPathSegment {
  id: string;
  from: { cx: number; cy: number; base: BaseStateCode; outs: number };
  to: { cx: number; cy: number; base: BaseStateCode; outs: number };
  wpa: number;
  event: string;
  atBatIndex: number;
}

export const STATE_CHART_VIEW = {
  width: 720,
  height: 360,
  paddingX: 56,
  paddingTop: 28,
  paddingBottom: 36,
  cellSize: 28,
} as const;

function diamondPoints(cx: number, cy: number, size: number): string {
  const h = size;
  return `${cx},${cy - h} ${cx + h},${cy} ${cx},${cy + h} ${cx - h},${cy}`;
}

function cellCenter(baseIndex: number, outs: number): { cx: number; cy: number } {
  const { width, height, paddingX, paddingTop, paddingBottom } = STATE_CHART_VIEW;
  const bandHeight = (height - paddingTop - paddingBottom) / 3;
  const usableWidth = width - paddingX * 2;
  const step = usableWidth / (BASE_STATE_ORDER.length - 1 || 1);
  return {
    cx: paddingX + baseIndex * step,
    cy: paddingTop + bandHeight * (outs + 0.5),
  };
}

function normalizeHalf(halfInning: string): string {
  const n = halfInning.toLowerCase().replace(/\s+/g, "");
  if (n.startsWith("bot")) return "bottom";
  if (n.startsWith("top")) return "top";
  return n;
}

export function sameHalfInning(
  a: { inning: number; halfInning: string },
  b: { inning: number; halfInning: string },
): boolean {
  return a.inning === b.inning && normalizeHalf(a.halfInning) === normalizeHalf(b.halfInning);
}

/** Build the fixed 24-cell topology with RE and optional WP for the cursor score. */
export function buildStateChartCells(cursor: StateChartCursor | null): StateChartCell[] {
  const cells: StateChartCell[] = [];

  for (let outs = 0; outs <= 2; outs += 1) {
    BASE_STATE_ORDER.forEach((base, baseIndex) => {
      const occupancy = decodeBaseState(base);
      const { cx, cy } = cellCenter(baseIndex, outs);
      const expectedRuns = expectedRunsRemaining(
        occupancy.onFirst,
        occupancy.onSecond,
        occupancy.onThird,
        outs,
      );
      const homeWinProb =
        cursor != null
          ? homeWinProbability({
              inning: cursor.inning,
              halfInning: cursor.halfInning,
              outs,
              onFirst: occupancy.onFirst,
              onSecond: occupancy.onSecond,
              onThird: occupancy.onThird,
              awayScore: cursor.awayScore,
              homeScore: cursor.homeScore,
            })
          : null;

      cells.push({
        id: `${base}-${outs}`,
        base,
        outs,
        label: BASE_STATE_LABELS[base],
        ...occupancy,
        cx,
        cy,
        points: diamondPoints(cx, cy, STATE_CHART_VIEW.cellSize),
        expectedRuns,
        homeWinProb,
      });
    });
  }

  return cells;
}

export function findCellCenter(
  onFirst: boolean,
  onSecond: boolean,
  onThird: boolean,
  outs: number,
): { cx: number; cy: number; base: BaseStateCode; outs: number } {
  const base = encodeBaseState(onFirst, onSecond, onThird) as BaseStateCode;
  const cappedOuts = Math.min(Math.max(outs, 0), 2);
  const baseIndex = BASE_STATE_ORDER.indexOf(base);
  const { cx, cy } = cellCenter(baseIndex >= 0 ? baseIndex : 0, cappedOuts);
  return { cx, cy, base, outs: cappedOuts };
}

/**
 * Half-inning path: segments from each play's situationBefore → post-play state.
 * Skips plays that don't change situation when marked.
 */
export function buildHalfInningPath(
  plays: PlayByPlayEntry[],
  cursor: StateChartCursor | null,
): StateChartPathSegment[] {
  if (!cursor) return [];

  const halfPlays = plays.filter(
    (play) =>
      sameHalfInning(play, cursor) &&
      play.affectsSituation !== false &&
      (play.isAtBat || play.affectsSituation === true),
  );

  const segments: StateChartPathSegment[] = [];

  for (const play of halfPlays) {
    const before = play.situationBefore;
    const from = findCellCenter(before.onFirst, before.onSecond, before.onThird, before.outs);

    // After third out the half ends — park the endpoint in the same outs band as the start
    // if outs would exceed 2 (rare MLB edge cases), else use the play's recorded outs.
    const afterOuts = Math.min(Math.max(play.outs, 0), 2);
    const to = findCellCenter(play.onFirst, play.onSecond, play.onThird, afterOuts);

    if (from.cx === to.cx && from.cy === to.cy) continue;

    segments.push({
      id: `seg-${play.atBatIndex}-${play.gameEventKey ?? play.event}`,
      from,
      to,
      wpa: play.wpa ?? 0,
      event: play.event || "Play",
      atBatIndex: play.atBatIndex,
    });
  }

  return segments;
}

/** RE range across all 24 cells for color scaling. */
export function runExpectancyRange(cells: StateChartCell[]): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const cell of cells) {
    min = Math.min(min, cell.expectedRuns);
    max = Math.max(max, cell.expectedRuns);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return { min: 0, max: 1 };
  }
  return { min, max };
}

/** Normalize a value into 0–1 for palette lookup. */
export function normalizeScale(value: number, min: number, max: number): number {
  if (max <= min) return 0.5;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

export function cellDisplayValue(cell: StateChartCell, mode: StateChartMode): number {
  if (mode === "wp") return cell.homeWinProb ?? 0.5;
  return cell.expectedRuns;
}

export function formatHalfInningLabel(cursor: StateChartCursor | null): string {
  if (!cursor) return "No live situation";
  const half = normalizeHalf(cursor.halfInning);
  const arrow = half === "bottom" ? "▼ Bot" : "▲ Top";
  return `${cursor.inning}${ordinalSuffix(cursor.inning)} ${arrow}`;
}

function ordinalSuffix(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "st";
  if (mod10 === 2 && mod100 !== 12) return "nd";
  if (mod10 === 3 && mod100 !== 13) return "rd";
  return "th";
}
