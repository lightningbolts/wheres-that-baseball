"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { AppNav } from "@/components/features/AppNav";
import { TeamLogo } from "@/components/ui/TeamLogo";
import { formatRate3 } from "@/lib/mlb/breakouts";
import { mlbPlayerHeadshotUrl } from "@/lib/mlb/cardPitchers";
import { formatPp, respectGrade, type RespectPlayer, type RespectReport, type RespectSortKey } from "@/lib/mlb/respect";
import { getTeamById } from "@/lib/mlb/teams";
import { cn } from "@/lib/utils";

const SORTS: { key: RespectSortKey; label: string }[] = [
  { key: "respectPlus", label: "Respect+" },
  { key: "avoidancePlus", label: "Raw avoidance" },
  { key: "fbAvoidPp", label: "Fastball avoid" },
  { key: "zoneAvoidPp", label: "Zone avoid" },
  { key: "heartAvoidPp", label: "Heart avoid" },
  { key: "pa", label: "PA" },
];

function RespectBar({ value }: { value: number }) {
  // Diverging bar centered at 100, clamped to 55–145.
  const offset = Math.max(-45, Math.min(45, value - 100));
  const pct = (Math.abs(offset) / 45) * 50;
  return (
    <div className="relative h-1.5 w-20 rounded-full bg-surface-elevated" aria-hidden>
      <span className="absolute inset-y-0 left-1/2 w-px bg-border-strong" />
      <span
        className={cn("absolute inset-y-0 rounded-full", offset >= 0 ? "bg-emerald-500" : "bg-rose-500")}
        style={offset >= 0 ? { left: "50%", width: `${pct}%` } : { right: "50%", width: `${pct}%` }}
      />
    </div>
  );
}

function SummaryTile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-border bg-surface px-3 py-2.5">
      <span className="text-[10px] uppercase tracking-wide text-subtle">{label}</span>
      <span className="font-mono text-lg tabular-nums text-foreground">{value}</span>
      <span className="text-[11px] leading-snug text-muted">{note}</span>
    </div>
  );
}

function PpCell({ value }: { value: number | null }) {
  return (
    <td
      className={cn(
        "px-2 py-2 text-right font-mono tabular-nums",
        value == null ? "text-subtle" : value > 0 ? "text-emerald-600 dark:text-emerald-400" : value < 0 ? "text-rose-600 dark:text-rose-400" : "text-secondary",
      )}
    >
      {formatPp(value)}
    </td>
  );
}

function PlayerRow({ p, rank }: { p: RespectPlayer; rank: number }) {
  const team = p.teamId ? getTeamById(p.teamId) : null;
  return (
    <tr className="border-b border-border last:border-b-0 hover:bg-hover">
      <td className="hidden w-8 px-2 py-2 text-right font-mono text-xs tabular-nums text-subtle sm:table-cell">{rank}</td>
      <td className="sticky left-0 z-10 bg-surface px-2 py-2 sm:static">
        <div className="flex min-w-[150px] max-w-[170px] sm:max-w-none items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={mlbPlayerHeadshotUrl(p.playerId, 64)}
            alt=""
            width={32}
            height={32}
            loading="lazy"
            className="size-8 shrink-0 rounded-full border border-border bg-surface-elevated object-cover"
          />
          <div className="min-w-0">
            <Link
              href={`/players/${p.playerId}`}
              className="block truncate text-sm font-medium text-foreground underline-offset-2 hover:underline"
            >
              {p.name}
            </Link>
            <span className="flex items-center gap-1 text-[11px] text-muted">
              {p.teamId ? <TeamLogo teamId={p.teamId} size={14} /> : null}
              {team?.abbrev ?? "—"} · {p.pa} PA
            </span>
          </div>
        </div>
      </td>
      <td className="px-2 py-2">
        <div className="flex items-center justify-end gap-2">
          <span className="w-8 text-right font-mono text-sm font-semibold tabular-nums text-foreground">{p.respectPlus}</span>
          <RespectBar value={p.respectPlus} />
        </div>
      </td>
      <td className="hidden px-2 py-2 text-xs text-secondary sm:table-cell">
        <span className="font-mono tabular-nums">{p.percentile}</span>
        <span className="ml-1.5 text-muted">{respectGrade(p.percentile)}</span>
      </td>
      <td className="px-2 py-2 text-right font-mono tabular-nums text-secondary">{p.avoidancePlus}</td>
      <PpCell value={p.fbAvoidPp} />
      <PpCell value={p.zoneAvoidPp} />
      <PpCell value={p.heartAvoidPp} />
      <td className="px-2 py-2 text-right font-mono tabular-nums text-secondary">{p.chasePct?.toFixed(1) ?? "—"}</td>
      <td className="px-2 py-2 text-right font-mono tabular-nums text-secondary">{formatRate3(p.woba)}</td>
    </tr>
  );
}

export function RespectLeaderboard({ report }: { report: RespectReport }) {
  const [query, setQuery] = useState("");
  const [minPa, setMinPa] = useState(report.minPa);
  const [sort, setSort] = useState<RespectSortKey>("respectPlus");
  const [desc, setDesc] = useState(true);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = report.players.filter((p) => p.pa >= minPa && (!q || p.name.toLowerCase().includes(q)));
    return [...list].sort((a, b) => {
      const av = a[sort] ?? -Infinity;
      const bv = b[sort] ?? -Infinity;
      return desc ? bv - av : av - bv;
    });
  }, [report.players, query, minPa, sort, desc]);

  const updated = new Date(report.generatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const paOptions = [report.minPa, 400, 500, 600].filter((v, i, arr) => arr.indexOf(v) === i && v >= report.minPa);
  const yoy = report.yearOverYear;

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <AppNav />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-3 py-6 sm:px-4 sm:py-8">
        <p className="text-xs font-medium uppercase tracking-wide text-subtle">New stat</p>
        <h1 className="mt-1 font-serif text-2xl font-medium tracking-tight text-foreground sm:text-3xl">
          Respect+ · {report.season}
        </h1>
        <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-muted sm:text-sm">
          Most hitting stats grade what the hitter does. Respect+ grades what pitchers do because of him. For every pitch
          it asks whether it was in the zone, in the heart of the zone, or a fastball, then removes the count, platoon,
          base/out state, score, ballpark and each pitcher&apos;s own habits. The part his chase and whiff rates explain is removed too,
          so free swingers don&apos;t look feared just because pitchers know they&apos;ll chase. 100 is average and every 15
          points is one standard deviation. Qualified hitters ({report.minPa}+ PA) · updated {updated}.
        </p>

        <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <SummaryTile
            label="Within-season reliability"
            value={report.reliability.respect.toFixed(2)}
            note="Split-half (odd vs. even games), corrected to a full season"
          />
          <SummaryTile
            label="Year to year"
            value={yoy?.r != null ? yoy.r.toFixed(2) : "—"}
            note={yoy ? `${yoy.season} → ${report.season}, ${yoy.batters} hitters (small ${yoy.season} sample)` : "No prior season"}
          />
          <SummaryTile
            label="Correlation with wOBA"
            value={report.validity.corr_respect_woba.toFixed(2)}
            note="Related to talent, but measuring something different"
          />
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search hitters"
            aria-label="Search hitters"
            className="h-8 w-full rounded-md border border-border bg-surface px-2.5 text-sm text-foreground placeholder:text-subtle sm:w-56"
          />
          <label className="flex items-center gap-1.5 text-xs text-secondary">
            Sort
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as RespectSortKey)}
              className="h-8 rounded-md border border-border bg-surface px-2 text-sm text-foreground"
            >
              {SORTS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => setDesc((d) => !d)}
            className="h-8 rounded-md border border-border px-2.5 text-xs text-secondary transition-colors hover:bg-hover hover:text-foreground"
          >
            {desc ? "High → Low" : "Low → High"}
          </button>
          <label className="flex items-center gap-1.5 text-xs text-secondary">
            Min PA
            <select
              value={minPa}
              onChange={(e) => setMinPa(Number(e.target.value))}
              className="h-8 rounded-md border border-border bg-surface px-2 text-sm text-foreground"
            >
              {paOptions.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <span className="ml-auto text-xs text-subtle">{rows.length} hitters</span>
        </div>

        <div className="mt-3 overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full min-w-[680px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-[10px] uppercase tracking-wide text-subtle">
                <th className="hidden px-2 py-2 text-right font-medium sm:table-cell">#</th>
                {/* matches the global `table thead` background so the pinned cell stays opaque */}
                <th className="sticky left-0 z-10 bg-[#1b4332] px-2 py-2 text-left font-medium sm:static">Hitter</th>
                <th className="px-2 py-2 text-right font-medium">Respect+</th>
                <th className="hidden px-2 py-2 text-left font-medium sm:table-cell">Pctl</th>
                <th className="px-2 py-2 text-right font-medium" title="Before the chase/whiff adjustment">Raw</th>
                <th className="px-2 py-2 text-right font-medium" title="Percentage points fewer fastballs than expected">FB avoid</th>
                <th className="px-2 py-2 text-right font-medium" title="Percentage points more pitches outside the zone">Zone avoid</th>
                <th className="px-2 py-2 text-right font-medium" title="Percentage points fewer pitches in the heart of the zone">Heart avoid</th>
                <th className="px-2 py-2 text-right font-medium">Chase%</th>
                <th className="px-2 py-2 text-right font-medium">wOBA</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p, i) => (
                <PlayerRow key={p.playerId} p={p} rank={i + 1} />
              ))}
            </tbody>
          </table>
          {rows.length === 0 ? <p className="px-4 py-6 text-center text-sm text-muted">No hitters match.</p> : null}
        </div>

        <section className="mt-8 max-w-2xl space-y-3 text-[13px] leading-relaxed text-muted">
          <h2 className="font-serif text-lg font-medium text-foreground">How to read it</h2>
          <p>
            The avoidance columns are percentage points relative to what that pitcher would normally throw in the same
            spot. A <span className="font-mono">+7.0</span> under FB avoid means pitchers threw him 7 points fewer fastballs
            than expected. Fastball avoidance is the most stable part of the score (reliability{" "}
            {report.reliability.fb_avoid.toFixed(2)}). Heart-of-zone avoidance is the noisiest (
            {report.reliability.heart_avoid.toFixed(2)}).
          </p>
          <p>
            <span className="text-foreground">Raw</span> is avoidance before the chase/whiff adjustment. When Raw is well
            above Respect+, pitchers are partly exploiting a free swinger rather than fearing him. When Respect+ is above
            Raw, pitchers stay away even though he rarely chases or whiffs.
          </p>
          <p>
            A low score isn&apos;t an insult. Elite contact hitters with little power often rank near the bottom, because
            pitchers can attack them in the zone without much risk.
          </p>
        </section>
      </main>
    </div>
  );
}
