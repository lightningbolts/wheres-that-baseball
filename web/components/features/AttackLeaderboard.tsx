"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { AppNav } from "@/components/features/AppNav";
import { PpCell, RespectBar, StatTabs, SummaryTile } from "@/components/features/RespectLeaderboard";
import { TeamLogo } from "@/components/ui/TeamLogo";
import { mlbPlayerHeadshotUrl } from "@/lib/mlb/cardPitchers";
import { attackGrade, type AttackPlayer, type AttackReport, type AttackSortKey } from "@/lib/mlb/respect";
import { getTeamById } from "@/lib/mlb/teams";

const SORTS: { key: AttackSortKey; label: string }[] = [
  { key: "attackPlus", label: "Attack+" },
  { key: "zoneAttackPp", label: "Zone attack" },
  { key: "heartAttackPp", label: "Heart attack" },
  { key: "zonePct", label: "Zone%" },
  { key: "bbPct", label: "BB%" },
  { key: "kPct", label: "K%" },
  { key: "pitches", label: "Pitches" },
];

function pct(v: number | null) {
  return v == null ? "—" : v.toFixed(1);
}

function PitcherRow({ p, rank }: { p: AttackPlayer; rank: number }) {
  const team = p.teamId ? getTeamById(p.teamId) : null;
  return (
    <tr className="border-b border-border last:border-b-0 hover:bg-hover">
      <td className="hidden w-8 px-2 py-2 text-right font-mono text-xs tabular-nums text-subtle sm:table-cell">{rank}</td>
      <td className="sticky left-0 z-10 bg-surface px-2 py-2 sm:static">
        <div className="flex min-w-[150px] max-w-[170px] items-center gap-2.5 sm:max-w-none">
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
              {team?.abbrev ?? "—"} · {p.bf} BF
            </span>
          </div>
        </div>
      </td>
      <td className="px-2 py-2">
        <div className="flex items-center justify-end gap-2">
          <span className="w-8 text-right font-mono text-sm font-semibold tabular-nums text-foreground">{p.attackPlus}</span>
          <RespectBar value={p.attackPlus} />
        </div>
      </td>
      <td className="hidden px-2 py-2 text-xs text-secondary sm:table-cell">
        <span className="font-mono tabular-nums">{p.percentile}</span>
        <span className="ml-1.5 text-muted">{attackGrade(p.percentile)}</span>
      </td>
      <PpCell value={p.zoneAttackPp} />
      <PpCell value={p.heartAttackPp} />
      <td className="px-2 py-2 text-right font-mono tabular-nums text-secondary">{pct(p.zonePct)}</td>
      <td className="px-2 py-2 text-right font-mono tabular-nums text-secondary">{pct(p.fbPct)}</td>
      <td className="px-2 py-2 text-right font-mono tabular-nums text-secondary">{pct(p.kPct)}</td>
      <td className="px-2 py-2 text-right font-mono tabular-nums text-secondary">{pct(p.bbPct)}</td>
    </tr>
  );
}

export function AttackLeaderboard({ report }: { report: AttackReport }) {
  const [query, setQuery] = useState("");
  const [minPitches, setMinPitches] = useState(report.minPitches);
  const [sort, setSort] = useState<AttackSortKey>("attackPlus");
  const [desc, setDesc] = useState(true);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = report.players.filter((p) => p.pitches >= minPitches && (!q || p.name.toLowerCase().includes(q)));
    return [...list].sort((a, b) => {
      const av = a[sort] ?? -Infinity;
      const bv = b[sort] ?? -Infinity;
      return desc ? bv - av : av - bv;
    });
  }, [report.players, query, minPitches, sort, desc]);

  const updated = new Date(report.generatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const options = [report.minPitches, 1500, 2000, 2500].filter((v, i, arr) => arr.indexOf(v) === i && v >= report.minPitches);
  const yoy = report.yearOverYear;

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <AppNav />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-3 py-6 sm:px-4 sm:py-8">
        <StatTabs active="pitchers" />
        <h1 className="mt-1 font-serif text-2xl font-medium tracking-tight text-foreground sm:text-3xl">
          Attack+ · {report.season}
        </h1>
        <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-muted sm:text-sm">
          The pitcher side of Respect+. Attack+ asks how often a pitcher challenges hitters (throws in the zone, and in the
          heart of the zone) compared with what the count, base/out state, score, ballpark and the specific hitter would
          predict. High scores go right after hitters; low scores nibble at the edges. Fastball share is left out because
          for a pitcher it mostly reflects his arsenal. 100 is average and every 15 points is one standard deviation.
          Pitchers with {report.minPitches.toLocaleString()}+ pitches · updated {updated}.
        </p>

        <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <SummaryTile
            label="Within-season reliability"
            value={report.reliability.attack.toFixed(2)}
            note="Split-half (odd vs. even games), corrected to a full season"
          />
          <SummaryTile
            label="Year to year"
            value={yoy?.r != null ? yoy.r.toFixed(2) : "—"}
            note={yoy ? `${yoy.season} → ${report.season}, ${yoy.pitchers} pitchers` : "No prior season"}
          />
          <SummaryTile
            label="Correlation with BB%"
            value={report.validity.corr_attack_bb.toFixed(2)}
            note={`Attackers walk fewer; correlation with K% is ${report.validity.corr_attack_k.toFixed(2)}`}
          />
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search pitchers"
            aria-label="Search pitchers"
            className="h-8 w-full rounded-md border border-border bg-surface px-2.5 text-sm text-foreground placeholder:text-subtle sm:w-56"
          />
          <label className="flex items-center gap-1.5 text-xs text-secondary">
            Sort
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as AttackSortKey)}
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
            Min pitches
            <select
              value={minPitches}
              onChange={(e) => setMinPitches(Number(e.target.value))}
              className="h-8 rounded-md border border-border bg-surface px-2 text-sm text-foreground"
            >
              {options.map((v) => (
                <option key={v} value={v}>
                  {v.toLocaleString()}
                </option>
              ))}
            </select>
          </label>
          <span className="ml-auto text-xs text-subtle">{rows.length} pitchers</span>
        </div>

        <div className="mt-3 overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full min-w-[680px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-[10px] uppercase tracking-wide text-subtle">
                <th className="hidden px-2 py-2 text-right font-medium sm:table-cell">#</th>
                <th className="sticky left-0 z-10 bg-[#1b4332] px-2 py-2 text-left font-medium sm:static">Pitcher</th>
                <th className="px-2 py-2 text-right font-medium">Attack+</th>
                <th className="hidden px-2 py-2 text-left font-medium sm:table-cell">Pctl</th>
                <th className="px-2 py-2 text-right font-medium" title="Percentage points more pitches in the zone than expected">Zone atk</th>
                <th className="px-2 py-2 text-right font-medium" title="Percentage points more pitches in the heart of the zone than expected">Heart atk</th>
                <th className="px-2 py-2 text-right font-medium">Zone%</th>
                <th className="px-2 py-2 text-right font-medium">FB%</th>
                <th className="px-2 py-2 text-right font-medium">K%</th>
                <th className="px-2 py-2 text-right font-medium">BB%</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p, i) => (
                <PitcherRow key={p.playerId} p={p} rank={i + 1} />
              ))}
            </tbody>
          </table>
          {rows.length === 0 ? <p className="px-4 py-6 text-center text-sm text-muted">No pitchers match.</p> : null}
        </div>

        <section className="mt-8 max-w-2xl space-y-3 text-[13px] leading-relaxed text-muted">
          <h2 className="font-serif text-lg font-medium text-foreground">How to read it</h2>
          <p>
            The attack columns are percentage points relative to what an average pitcher would throw that hitter in the
            same spot. A <span className="font-mono">+4.0</span> under Zone atk means he was in the zone 4 points more
            often than expected. Zone attack is the steadier part (reliability {report.reliability.zone_attack.toFixed(2)});
            heart-of-zone attack is noisier ({report.reliability.heart_attack.toFixed(2)}).
          </p>
          <p>
            Attack+ is close to a context-adjusted zone rate, so it tracks raw Zone% closely. Where they differ, the
            schedule of hitters and situations explains it: a pitcher who faces a lot of dangerous hitters, or pitches in
            tight late-game spots, gets credit for attacking anyway.
          </p>
          <p>
            Attacking isn&apos;t automatically good. Aggressive pitchers walk fewer hitters, but Attack+ has almost no
            relationship with strikeout rate. Some of the best strikeout pitchers live on the edges.
          </p>
        </section>
      </main>
    </div>
  );
}
