"use client";

import type { Dist } from "@/lib/game/franchise/seasonProjection";
import { cn } from "@/lib/utils";

/** Standard normal density. */
const phi = (z: number): number => Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);

export type Fmt = (x: number) => string;

/**
 * Histogram of simulated outcomes with the fitted normal curve, the 10th–90th percentile band
 * shaded and the median marked.
 */
export function DistChart({
  dist,
  fmt,
  label,
  height = 120,
  tone = "sky",
  className,
}: {
  dist: Dist;
  fmt: Fmt;
  label: string;
  height?: number;
  tone?: "sky" | "emerald" | "amber" | "violet" | "rose";
  className?: string;
}) {
  const h = dist.hist;
  if (!h || !h.n.length) return null;
  const W = 320;
  const H = height;
  const padB = 18;
  const padT = 6;
  const bins = h.n.length;
  const lo = h.lo;
  const hi = h.lo + h.w * bins;
  const x = (v: number) => ((v - lo) / (hi - lo)) * W;
  // Normal curve in the histogram's units (‰ of sims per bin).
  const curve: Array<[number, number]> = [];
  if (dist.sd > 0) {
    for (let i = 0; i <= 80; i += 1) {
      const v = lo + ((hi - lo) * i) / 80;
      curve.push([v, phi((v - dist.mean) / dist.sd) * (h.w / dist.sd) * 1000]);
    }
  }
  const peak = Math.max(...h.n, ...curve.map((c) => c[1]), 1);
  const y = (n: number) => padT + (H - padB - padT) * (1 - n / peak);
  const p10 = dist.pct[1];
  const p50 = dist.pct[3];
  const p90 = dist.pct[5];
  const color = TONES[tone];
  const path = curve.map(([v, n], i) => `${i ? "L" : "M"}${x(v).toFixed(1)},${y(n).toFixed(1)}`).join("");
  const ticks = [lo, p50, hi - h.w];
  return (
    <figure className={cn("min-w-0", className)}>
      <figcaption className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-subtle">{label}</span>
        <span className="font-mono text-[11px] tabular-nums text-muted">
          median <span className="text-foreground">{fmt(p50)}</span> · 80% {fmt(p10)}–{fmt(p90)}
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${label} distribution: median ${fmt(p50)}, 80% range ${fmt(p10)} to ${fmt(p90)}`}>
        <rect x={x(p10)} y={padT} width={Math.max(0, x(p90) - x(p10))} height={H - padB - padT} className={color.band} />
        {h.n.map((n, i) => {
          const bx = x(lo + i * h.w);
          const bw = Math.max(1, x(lo + (i + 1) * h.w) - bx - 1);
          return (
            <rect key={i} x={bx} y={y(n)} width={bw} height={Math.max(0, H - padB - y(n))} className={color.bar} rx={1}>
              <title>{`${fmt(lo + i * h.w)}–${fmt(lo + (i + 1) * h.w)}: ${(n / 10).toFixed(1)}% of seasons`}</title>
            </rect>
          );
        })}
        {path ? <path d={path} fill="none" strokeWidth={1.75} className={color.line} /> : null}
        <line x1={x(p50)} x2={x(p50)} y1={padT} y2={H - padB} strokeDasharray="3 3" strokeWidth={1} strokeOpacity={0.6} className="stroke-foreground" />
        <line x1={0} x2={W} y1={H - padB} y2={H - padB} strokeWidth={1} className="stroke-border" />
        {ticks.map((t, i) => (
          <text
            key={i}
            x={Math.min(W - 2, Math.max(2, x(i === 1 ? t : i === 0 ? t : t + h.w)))}
            y={H - 4}
            textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"}
            className="fill-subtle font-mono text-[10px]"
          >
            {fmt(i === 2 ? t + h.w : t)}
          </text>
        ))}
      </svg>
    </figure>
  );
}

const TONES = {
  sky: { bar: "fill-sky-500/55", band: "fill-sky-500/10", line: "stroke-sky-600 dark:stroke-sky-300" },
  emerald: { bar: "fill-emerald-500/55", band: "fill-emerald-500/10", line: "stroke-emerald-600 dark:stroke-emerald-300" },
  amber: { bar: "fill-amber-500/55", band: "fill-amber-500/10", line: "stroke-amber-600 dark:stroke-amber-300" },
  violet: { bar: "fill-violet-500/55", band: "fill-violet-500/10", line: "stroke-violet-600 dark:stroke-violet-300" },
  rose: { bar: "fill-rose-500/55", band: "fill-rose-500/10", line: "stroke-rose-600 dark:stroke-rose-300" },
} as const;

/** Exact win totals (one bar per win) with the normal fit and playoff-line context. */
export function WinsChart({ lo, hist, mean, sd, height = 150 }: { lo: number; hist: number[]; mean: number; sd: number; height?: number }) {
  const W = 360;
  const H = height;
  const padB = 18;
  const padT = 6;
  const from = Math.min(lo, Math.floor(mean - 3.2 * sd));
  const to = Math.max(lo + hist.length - 1, Math.ceil(mean + 3.2 * sd));
  const n = to - from + 1;
  const x = (w: number) => ((w - from) / n) * W;
  const peak = Math.max(...hist, phi(0) / Math.max(sd, 1));
  const y = (p: number) => padT + (H - padB - padT) * (1 - p / peak);
  const curve = Array.from({ length: 81 }, (_, i) => {
    const w = from + (n * i) / 80;
    return [w, phi((w - 0.5 - mean) / sd) / sd] as const;
  });
  const ticks = [60, 70, 80, 90, 100, 110].filter((t) => t >= from && t <= to);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Win distribution, mean ${mean.toFixed(1)} wins`}>
      {hist.map((p, i) => {
        const w = lo + i;
        return (
          <rect key={w} x={x(w)} y={y(p)} width={Math.max(1, W / n - 1)} height={Math.max(0, H - padB - y(p))} rx={1} className={w >= 90 ? "fill-emerald-500/60" : w <= 72 ? "fill-rose-500/50" : "fill-sky-500/55"}>
            <title>{`${w} wins: ${(p * 100).toFixed(1)}%`}</title>
          </rect>
        );
      })}
      <path d={curve.map(([w, p], i) => `${i ? "L" : "M"}${x(w).toFixed(1)},${y(p).toFixed(1)}`).join("")} fill="none" strokeWidth={1.75} strokeOpacity={0.75} className="stroke-foreground" />
      <line x1={x(mean + 0.5)} x2={x(mean + 0.5)} y1={padT} y2={H - padB} strokeDasharray="3 3" strokeOpacity={0.6} className="stroke-foreground" />
      <line x1={0} x2={W} y1={H - padB} y2={H - padB} className="stroke-border" />
      {ticks.map((t) => (
        <text key={t} x={x(t + 0.5)} y={H - 4} textAnchor="middle" className="fill-subtle font-mono text-[10px]">
          {t}
        </text>
      ))}
    </svg>
  );
}

/** Horizontal probability bar with label. */
export function OddsBar({ p, max = 1, tone = "emerald", label }: { p: number; max?: number; tone?: "emerald" | "sky" | "amber" | "violet" | "rose"; label?: string }) {
  const width = Math.max(p > 0 ? 2 : 0, Math.min(100, (p / Math.max(max, 1e-6)) * 100));
  const bg = { emerald: "bg-emerald-500", sky: "bg-sky-500", amber: "bg-amber-500", violet: "bg-violet-500", rose: "bg-rose-500" }[tone];
  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="h-2 min-w-[48px] flex-1 overflow-hidden rounded-full bg-surface-elevated" aria-hidden>
        <div className={cn("h-full rounded-full", bg)} style={{ width: `${width}%` }} />
      </div>
      <span className="w-12 shrink-0 text-right font-mono text-xs tabular-nums text-foreground">{label ?? pct(p)}</span>
    </div>
  );
}

/** Heat-shaded percentage cell for odds tables. */
export function OddsCell({ p, className }: { p: number; className?: string }) {
  const a = Math.min(1, p) * 0.55;
  return (
    <td className={cn("px-1.5 py-1.5 text-right font-mono text-xs tabular-nums", className)} style={{ backgroundColor: p > 0.004 ? `rgba(16, 185, 129, ${a.toFixed(3)})` : undefined }}>
      {pct(p)}
    </td>
  );
}

/** Percentile ladder: 5th … 95th. */
export function PercentileStrip({ dist, fmt }: { dist: Dist; fmt: Fmt }) {
  const labels = ["5th", "10th", "25th", "50th", "75th", "90th", "95th"];
  return (
    <div className="grid grid-cols-7 overflow-hidden rounded-md border border-border text-center">
      {dist.pct.map((v, i) => (
        <div key={i} className={cn("px-1 py-1", i === 3 ? "bg-surface-elevated" : "", i ? "border-l border-border" : "")}>
          <div className="text-[9px] uppercase tracking-wide text-subtle">{labels[i]}</div>
          <div className="font-mono text-[11px] tabular-nums text-foreground">{fmt(v)}</div>
        </div>
      ))}
    </div>
  );
}

export function pct(p: number): string {
  if (p <= 0) return "—";
  if (p < 0.001) return "<0.1%";
  if (p < 0.1) return `${(p * 100).toFixed(1)}%`;
  if (p > 0.995 && p < 1) return ">99%";
  return `${Math.round(p * 100)}%`;
}

export const fmt3: Fmt = (x) => (x >= 1 ? x.toFixed(3) : x.toFixed(3).replace(/^0/, ""));
export const fmt2: Fmt = (x) => x.toFixed(2);
export const fmt1: Fmt = (x) => x.toFixed(1);
export const fmt0: Fmt = (x) => Math.round(x).toString();
