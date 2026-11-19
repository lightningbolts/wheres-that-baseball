"use client";

/**
 * Click-to-sort helpers shared by the game's stat tables (pitch tracker, franchise
 * StatTable): numbers sort numerically, text alphabetically, and missing values
 * (null, undefined, NaN, "") always sink to the bottom whichever way the column runs.
 */
import { useCallback, useState } from "react";

export type SortVal = number | string | null | undefined;

const missing = (v: SortVal) => v == null || v === "" || (typeof v === "number" && !Number.isFinite(v));

/** Compare two cell values for a sort; missing values go last in both directions. */
export function compareSortVals(a: SortVal, b: SortVal, asc: boolean): number {
  const ma = missing(a);
  const mb = missing(b);
  if (ma || mb) return ma === mb ? 0 : ma ? 1 : -1;
  const d = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
  return asc ? d : -d;
}

/** A sorted copy of `rows` (stable: ties keep their original order). */
export function sortRows<R>(rows: readonly R[], get: (r: R) => SortVal, asc: boolean): R[] {
  return rows
    .map((r, i) => ({ r, i, v: get(r) }))
    .sort((x, y) => compareSortVals(x.v, y.v, asc) || x.i - y.i)
    .map((x) => x.r);
}

export interface SortState {
  key: string;
  asc: boolean;
}

/** Next sort state after clicking a header: flip the active column, else start the new one in its natural direction. */
export function nextSort(s: SortState, key: string, firstAsc: boolean): SortState {
  return s.key === key ? { key, asc: !s.asc } : { key, asc: firstAsc };
}

export function useSort(initial: SortState) {
  const [sort, setSort] = useState<SortState>(initial);
  const toggle = useCallback((key: string, firstAsc = false) => setSort((s) => nextSort(s, key, firstAsc)), []);
  return { sort, toggle };
}

/** aria-sort for a header cell. */
export const ariaSort = (s: SortState, key: string): "ascending" | "descending" | "none" => (s.key === key ? (s.asc ? "ascending" : "descending") : "none");
