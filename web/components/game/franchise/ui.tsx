"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { getTeamColor } from "@/lib/mlb/teamColors";
import { cn } from "@/lib/utils";
import type { League, Player } from "@/lib/game/franchise/types";

/** Apply a mutation to a copy of the league; return a message to toast (optional). */
export type Act = (fn: (l: League) => string | void, opts?: { save?: boolean }) => void;

export interface TabProps {
  league: League;
  act: Act;
}

export function Card({ title, right, children, className }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("min-w-0 rounded-xl border border-border bg-surface p-3 sm:p-4", className)}>
      {(title || right) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-sm font-semibold uppercase tracking-wider text-secondary">{title}</h2>}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

type BtnTone = "primary" | "ghost" | "danger";

export function Btn({ tone = "ghost", className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: BtnTone }) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        "rounded-md px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        tone === "primary" && "bg-emerald-600 font-semibold text-white hover:bg-emerald-500",
        tone === "ghost" && "border border-border hover:bg-hover",
        tone === "danger" && "border border-red-500/40 text-red-500 hover:bg-red-500/10",
        className,
      )}
    />
  );
}

export function SmallBtn({ className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...rest} className={cn("rounded border border-border px-1.5 py-0.5 text-xs hover:bg-hover disabled:opacity-40", className)} />;
}

export function TeamDot({ id, abbrev, className }: { id: number; abbrev: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 font-medium", className)}>
      <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: getTeamColor(id) }} />
      {abbrev}
    </span>
  );
}

/** Scrollable table shell for phone widths. */
export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="-mx-3 overflow-x-auto px-3 sm:mx-0 sm:px-0">
      <table className={cn("w-full min-w-max border-collapse text-sm tabular-nums", className)}>{children}</table>
    </div>
  );
}

export const th = "border-b border-border px-2 py-1.5 text-left text-xs font-medium uppercase tracking-wide text-secondary";
export const td = "border-b border-border/50 px-2 py-1.5";

export function Ovr({ v, className }: { v: number; className?: string }) {
  const tone = v >= 65 ? "text-emerald-500" : v >= 55 ? "text-sky-500" : v >= 45 ? "text-foreground" : "text-muted";
  return <span className={cn("font-semibold tabular-nums", tone, className)}>{Math.round(v)}</span>;
}

export const money = (m: number): string => (Math.abs(m) >= 1 ? `$${m.toFixed(1)}M` : `$${Math.round(m * 1000)}K`);

export const signed = (m: number): string => `${m >= 0 ? "+" : "−"}${money(Math.abs(m))}`;

export function contractStr(p: Player): string {
  if (p.status === "fa") return "Free agent";
  const k = p.contract.kind === "pre" ? "pre-arb" : p.contract.kind === "arb" ? "arb" : p.contract.kind === "minor" ? "minors" : "";
  return `${money(p.contract.aav)} × ${p.contract.years}${k ? ` (${k})` : ""}`;
}

export function injuryStr(p: Player): string | null {
  if (!p.injury || p.injury.days <= 0) return null;
  return `${p.injury.desc}, ${p.injury.days}d`;
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-background/40 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wider text-secondary">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      {sub != null && <div className="text-xs text-secondary">{sub}</div>}
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: Array<{ v: T; label: string }>; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-lg border border-border p-0.5">
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(o.v)}
          className={cn("rounded-md px-2.5 py-1 text-xs", value === o.v ? "bg-emerald-600 text-white" : "text-secondary hover:bg-hover")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
