"use client";

import { useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ariaSort, nextSort, sortRows } from "@/components/game/sort";
import { SmallBtn } from "./ui";

export interface Col<R> {
  key: string;
  label: string;
  /** Tooltip (what the stat means). */
  title?: string;
  get: (r: R) => number | string;
  fmt?: (v: number, r: R) => ReactNode;
  /** Lower is better (ERA, K% for hitters…): first click sorts ascending, leader = min. */
  low?: boolean;
  /** Text column (no leader highlight, left aligned). */
  text?: boolean;
  /** Only qualified rows count toward the bold league leader (rate stats). */
  rate?: boolean;
  render?: (r: R) => ReactNode;
  sticky?: boolean;
}

/** fmt helpers */
export const f3 = (v: number): string => (Math.abs(v) >= 1 ? v.toFixed(3) : v.toFixed(3).replace(/^(-?)0/, "$1"));
export const f2 = (v: number): string => v.toFixed(2);
export const f1 = (v: number): string => v.toFixed(1);
export const pct1 = (v: number): string => `${(v * 100).toFixed(1)}%`;
export const ipFmt = (v: number): string => {
  const outs = Math.round(v * 3);
  return `${Math.floor(outs / 3)}.${outs % 3}`;
};

/**
 * Sortable stat table: click a header to sort (again to flip), the leader in each column
 * is bold (Baseball-Reference style), user rows are tinted, rows page by 50.
 */
export function StatTable<R extends { id: number }>({
  rows,
  cols,
  defaultSort,
  highlight,
  isQual,
  pageSize = 50,
  rank = true,
  empty = "No players match these filters.",
}: {
  rows: R[];
  cols: Array<Col<R>>;
  defaultSort: string;
  highlight?: (r: R) => boolean;
  isQual?: (r: R) => boolean;
  pageSize?: number;
  rank?: boolean;
  empty?: string;
}) {
  const [sort, setSort] = useState<{ key: string; asc: boolean }>(() => {
    const c = cols.find((x) => x.key === defaultSort);
    return { key: defaultSort, asc: !!c?.low };
  });
  const [page, setPage] = useState(0);
  const col = cols.find((c) => c.key === sort.key) ?? cols[0];

  const sorted = useMemo(() => {
    return sortRows(rows, col.get, sort.asc);
  }, [rows, col, sort.asc]);

  const leaders = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cols) {
      if (c.text) continue;
      const pool = c.rate && isQual ? rows.filter(isQual) : rows;
      let best: number | null = null;
      for (const r of pool) {
        const v = c.get(r);
        if (typeof v !== "number" || !Number.isFinite(v)) continue;
        if (best == null || (c.low ? v < best : v > best)) best = v;
      }
      if (best != null && pool.length > 1) m.set(c.key, best);
    }
    return m;
  }, [rows, cols, isQual]);

  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const p = Math.min(page, pages - 1);
  const view = sorted.slice(p * pageSize, (p + 1) * pageSize);

  const onHead = (c: Col<R>) => {
    setPage(0);
    setSort((s) => nextSort(s, c.key, !!c.low || !!c.text));
  };

  if (!rows.length) return <p className="py-6 text-center text-sm text-secondary">{empty}</p>;

  return (
    <div className="space-y-2">
      <div className="-mx-3 overflow-x-auto px-3 sm:mx-0 sm:px-0">
        <table className="w-full min-w-max border-collapse text-[13px] tabular-nums">
          <thead>
            <tr>
              {rank && <th className="sticky left-0 z-10 border-b border-border bg-surface px-1.5 py-1.5 text-right text-[11px] font-medium text-muted">#</th>}
              {cols.map((c) => (
                <th
                  key={c.key}
                  title={c.title}
                  aria-sort={ariaSort(sort, c.key)}
                  onClick={() => onHead(c)}
                  className={cn(
                    "cursor-pointer select-none whitespace-nowrap border-b border-border px-1.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-secondary hover:text-foreground",
                    c.text ? "text-left" : "text-right",
                    c.sticky && "sticky left-6 z-10 bg-surface",
                    sort.key === c.key && "text-emerald-500",
                  )}
                >
                  {c.label}
                  {sort.key === c.key ? (sort.asc ? " ▲" : " ▼") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.map((r, i) => {
              const hi = highlight?.(r);
              const q = isQual ? isQual(r) : true;
              return (
                <tr key={r.id} className={cn("hover:bg-hover/60", hi && "bg-emerald-500/10")}>
                  {rank && <td className={cn("sticky left-0 z-10 border-b border-border/40 px-1.5 py-1 text-right text-muted", hi ? "bg-emerald-500/10" : "bg-surface")}>{p * pageSize + i + 1}</td>}
                  {cols.map((c) => {
                    const v = c.get(r);
                    const lead = !c.text && typeof v === "number" && leaders.get(c.key) === v && (!c.rate || q);
                    return (
                      <td
                        key={c.key}
                        className={cn(
                          "whitespace-nowrap border-b border-border/40 px-1.5 py-1",
                          c.text ? "text-left" : "text-right",
                          c.sticky && cn("sticky left-6 z-10", hi ? "bg-emerald-500/10" : "bg-surface"),
                          lead && "font-bold text-foreground",
                          sort.key === c.key && "bg-emerald-500/[0.06]",
                        )}
                      >
                        {c.render ? c.render(r) : typeof v === "number" ? (c.fmt ? c.fmt(v, r) : v) : v}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between text-xs text-secondary">
        <span>
          {sorted.length} {sorted.length === 1 ? "row" : "rows"} · bold = league leader{isQual ? " (rate stats: qualified only)" : ""}
        </span>
        {pages > 1 && (
          <span className="flex items-center gap-1">
            <SmallBtn disabled={p === 0} onClick={() => setPage(p - 1)}>
              ‹ Prev
            </SmallBtn>
            <span>
              {p + 1} / {pages}
            </span>
            <SmallBtn disabled={p >= pages - 1} onClick={() => setPage(p + 1)}>
              Next ›
            </SmallBtn>
          </span>
        )}
      </div>
    </div>
  );
}
