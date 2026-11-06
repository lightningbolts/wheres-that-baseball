"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { AppNav } from "@/components/features/AppNav";
import { TeamLogo } from "@/components/ui/TeamLogo";
import {
  BREAKOUT_BASELINE_LABELS,
  formatPct,
  formatRate3,
  type BreakoutAlreadyBrokeOut,
  type BreakoutBacktest,
  type BreakoutExplanation,
  type BreakoutHitter,
  type BreakoutPitcher,
  type BreakoutProspect,
  type BreakoutReport,
} from "@/lib/mlb/breakouts";
import { mlbPlayerHeadshotUrl } from "@/lib/mlb/cardPitchers";
import { cn } from "@/lib/utils";

export type BreakoutTab = "hitters" | "pitchers";
export type BreakoutPool = "mlb" | "prospects";
type PitcherRoleFilter = "all" | "SP" | "RP";

function Headshot({ playerId, name, size = "md" }: { playerId: number; name: string; size?: "sm" | "md" }) {
  const px = size === "sm" ? 32 : 44;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={mlbPlayerHeadshotUrl(playerId, 96)}
      alt=""
      title={name}
      width={px}
      height={px}
      loading="lazy"
      className={cn(
        "shrink-0 rounded-full border border-border bg-surface-elevated object-cover",
        size === "sm" ? "size-8" : "size-11",
      )}
    />
  );
}

function ProbabilityMeter({ value, max }: { value: number; max: number }) {
  const width = Math.max(4, Math.round((value / max) * 100));
  return (
    <div className="flex min-w-[88px] flex-col items-end gap-1">
      <span className="font-mono text-sm font-medium tabular-nums text-foreground">{formatPct(value)}</span>
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-elevated" aria-hidden>
        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col rounded-md border border-border px-2 py-1">
      <span className="text-[10px] uppercase tracking-wide text-subtle">{label}</span>
      <span className="font-mono text-xs tabular-nums text-foreground">{value}</span>
    </div>
  );
}

function fmt1(value: number | null, suffix = ""): string {
  return value == null ? "—" : `${value.toFixed(1)}${suffix}`;
}

function CandidateRow({
  rank,
  playerId,
  name,
  teamId,
  meta,
  probability,
  maxProbability,
  chips,
  explanation,
}: {
  rank: number;
  playerId: number;
  name: string;
  teamId: number | null;
  meta: string;
  probability: number;
  maxProbability: number;
  chips: { label: string; value: string }[];
  explanation: BreakoutExplanation;
}) {
  const { drivers, signals, risk, bar, comp } = explanation;
  return (
    <li className="flex flex-col gap-3 border-b border-border px-3 py-4 last:border-b-0 sm:px-4">
      <div className="flex items-center gap-3">
        <span className="w-6 shrink-0 text-right font-mono text-sm tabular-nums text-subtle">{rank}</span>
        <Headshot playerId={playerId} name={name} />
        <div className="min-w-0 flex-1">
          <Link
            href={`/players/${playerId}`}
            className="block truncate text-[15px] font-medium text-foreground underline-offset-2 hover:underline"
          >
            {name}
          </Link>
          <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
            {teamId ? <TeamLogo teamId={teamId} size={16} /> : null}
            <span className="truncate">{meta}</span>
          </span>
        </div>
        <ProbabilityMeter value={probability} max={maxProbability} />
      </div>
      <div className="flex flex-wrap gap-1.5 pl-9 sm:pl-[92px]">
        {chips.map((chip) => (
          <StatChip key={chip.label} label={chip.label} value={chip.value} />
        ))}
      </div>
      <div className="space-y-2 pl-9 text-[13px] leading-snug sm:pl-[92px]">
        {drivers.length > 0 || signals.length > 0 ? (
          <ul className="space-y-1 text-secondary">
            {drivers.map((line) => (
              <li key={line} className="flex gap-2">
                <span className="mt-[7px] size-1 shrink-0 rounded-full bg-emerald-500" aria-hidden />
                <span>{line}</span>
              </li>
            ))}
            {signals.map((line) => (
              <li key={line} className="flex gap-2">
                <span className="mt-[7px] size-1 shrink-0 rounded-full bg-sky-500" aria-hidden />
                <span>
                  <span className="sr-only">Statcast detail: </span>
                  {line}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <dl className="space-y-1 text-xs text-muted">
          {risk ? (
            <div className="flex gap-1.5">
              <dt className="shrink-0 font-medium text-amber-600 dark:text-amber-400">Risk:</dt>
              <dd>{risk}</dd>
            </div>
          ) : null}
          <div className="flex gap-1.5">
            <dt className="shrink-0 font-medium text-secondary">Bar to clear:</dt>
            <dd>{bar.replace(/^Needs /, "")}</dd>
          </div>
          {comp ? (
            <div className="flex gap-1.5">
              <dt className="shrink-0 font-medium text-secondary">Closest comp:</dt>
              <dd>
                <Link href={`/players/${comp.playerId}`} className="text-secondary underline-offset-2 hover:underline">
                  {comp.name} {comp.season}
                </Link>{" "}
                ({comp.before}) → {comp.season + 1}: {comp.after}
              </dd>
            </div>
          ) : null}
        </dl>
      </div>
    </li>
  );
}

function hitterChips(h: BreakoutHitter) {
  return [
    { label: "PA", value: String(h.stats.pa) },
    { label: "wOBA", value: formatRate3(h.stats.woba) },
    { label: "xwOBA", value: formatRate3(h.stats.xwoba) },
    { label: "HR", value: h.stats.hr == null ? "—" : String(h.stats.hr) },
    { label: "Barrel", value: fmt1(h.stats.barrelPct, "%") },
    { label: "EV50", value: fmt1(h.stats.ev50) },
    { label: "K%", value: fmt1(h.stats.kPct, "%") },
    { label: "BB%", value: fmt1(h.stats.bbPct, "%") },
    { label: "Chase", value: fmt1(h.stats.chasePct, "%") },
  ];
}

function pitcherChips(p: BreakoutPitcher) {
  return [
    { label: "IP", value: p.stats.ip },
    { label: "ERA", value: p.stats.era == null ? "—" : p.stats.era.toFixed(2) },
    { label: "xERA", value: p.stats.xera == null ? "—" : p.stats.xera.toFixed(2) },
    { label: "K", value: p.stats.k == null ? "—" : String(p.stats.k) },
    { label: "K-BB%", value: fmt1(p.stats.kbbPct, "%") },
    { label: "Whiff", value: fmt1(p.stats.whiffPct, "%") },
    { label: "xwOBA", value: formatRate3(p.stats.xwoba) },
    { label: "FB velo", value: fmt1(p.stats.fbVelo) },
    { label: "FB IVB", value: fmt1(p.stats.fbIvb, "″") },
  ];
}

function AlreadyBrokeOut({ season, players }: { season: number; players: BreakoutAlreadyBrokeOut[] }) {
  if (players.length === 0) return null;
  return (
    <section className="mt-10" aria-labelledby="already-broke-out">
      <h2 id="already-broke-out" className="font-serif text-lg font-medium text-foreground">
        Already broke out in {season}
      </h2>
      <p className="mt-1 max-w-2xl text-[13px] text-muted">
        Left off the list on purpose. These players crossed an &ldquo;already established&rdquo; line for the first
        time this season.
      </p>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {players.map((p) => (
          <li key={p.playerId} className="flex items-start gap-2.5 rounded-lg border border-border bg-surface px-3 py-2">
            <Headshot playerId={p.playerId} name={p.name} size="sm" />
            <div className="min-w-0">
              <Link
                href={`/players/${p.playerId}`}
                className="text-sm font-medium text-foreground underline-offset-2 hover:underline"
              >
                {p.name}
              </Link>
              <p className="mt-0.5 text-xs leading-snug text-muted">{p.why.join(" · ")}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function pipelineLabel(p: BreakoutProspect): string {
  if (p.pipeline.overall) return `#${p.pipeline.overall}`;
  if (p.pipeline.org) return `Org #${p.pipeline.org}`;
  return "—";
}

function prospectChips(p: BreakoutProspect, kind: BreakoutTab) {
  const m = p.milb;
  const chips = [
    { label: "Top 100", value: pipelineLabel(p) },
    { label: "FV", value: p.pipeline.fv == null ? "—" : String(p.pipeline.fv) },
    { label: `${m.season} level`, value: m.levels ?? "—" },
  ];
  if (kind === "hitters") {
    chips.push(
      { label: "PA", value: m.pa == null ? "—" : String(m.pa) },
      { label: "OPS", value: formatRate3(m.ops) },
      { label: "ISO", value: formatRate3(m.iso) },
      { label: "HR", value: m.hr == null ? "—" : String(m.hr) },
      { label: "SB", value: m.sb == null ? "—" : String(m.sb) },
      { label: "K%", value: fmt1(m.kPct ?? null, "%") },
      { label: "BB%", value: fmt1(m.bbPct ?? null, "%") },
    );
  } else {
    chips.push(
      { label: "IP", value: m.ip ?? "—" },
      { label: "ERA", value: m.era == null ? "—" : m.era.toFixed(2) },
      { label: "K%", value: fmt1(m.kPct ?? null, "%") },
      { label: "BB%", value: fmt1(m.bbPct ?? null, "%") },
      { label: "K-BB%", value: fmt1(m.kbbPct ?? null, "%") },
      { label: "K", value: m.k == null ? "—" : String(m.k) },
    );
  }
  return chips;
}

function SummaryTile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-3">
      <p className="text-[11px] uppercase tracking-wide text-subtle">{label}</p>
      <p className="mt-1 font-mono text-xl font-medium tabular-nums text-foreground">{value}</p>
      <p className="mt-0.5 text-xs text-muted">{note}</p>
    </div>
  );
}

function BacktestPanel({
  backtest,
  kind,
  pool,
}: {
  backtest: BreakoutBacktest;
  kind: BreakoutTab;
  pool: BreakoutPool;
}) {
  const { summary, seasons } = backtest;
  const baselineKeys = Object.keys(summary.baselines);
  const compareKey = pool === "prospects" ? "pipelineRank" : kind === "hitters" ? "xwobaGap" : "eraMinusXera";
  const compare = summary.baselines[compareKey];

  return (
    <section className="mt-10" aria-labelledby={`backtest-${kind}`}>
      <h2 id={`backtest-${kind}`} className="font-serif text-lg font-medium text-foreground">
        Track record: {pool === "prospects" ? "prospect " : ""}
        {kind === "hitters" ? "hitters" : "pitchers"}
      </h2>
      <p className="mt-1 max-w-2xl text-[13px] text-muted">
        {pool === "prospects"
          ? "Walk-forward backtest. Each year's list was rebuilt from that spring's Pipeline rankings and the prior minor-league season only, then checked against who actually broke out as a rookie. Few prospects break out right away, so hit rates are low; compare them with the base rate."
          : "Walk-forward backtest. Each season's list was rebuilt using only data available at the time, then checked against what actually happened the next year."}
      </p>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <SummaryTile
          label="Top-10 hit rate"
          value={formatPct(summary.model.p10)}
          note={`${(summary.model.p10 / summary.baseRate).toFixed(1)}× base rate`}
        />
        <SummaryTile
          label="Top-25 hit rate"
          value={formatPct(summary.model.p25, pool === "prospects" ? 1 : 0)}
          note="avg. per season"
        />
        <SummaryTile label="Base rate" value={formatPct(summary.baseRate, 1)} note="eligible players who broke out" />
        <SummaryTile
          label={pool === "prospects" ? "Pipeline rank alone" : "“Unlucky” heuristic"}
          value={compare ? formatPct(compare.p25, pool === "prospects" ? 1 : 0) : "—"}
          note="top-25 hit rate"
        />
      </div>

      <div className="mt-4 overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[520px] text-left text-xs">
          <thead className="bg-surface-elevated text-subtle">
            <tr>
              <th className="px-3 py-2 font-medium">{pool === "prospects" ? "Spring Pipeline list" : "Picks from → outcome"}</th>
              <th className="px-3 py-2 text-right font-medium">Breakouts</th>
              <th className="px-3 py-2 text-right font-medium">Model top 10</th>
              <th className="px-3 py-2 text-right font-medium">Model top 25</th>
              {baselineKeys.map((key) => (
                <th key={key} className="px-3 py-2 text-right font-medium">
                  {BREAKOUT_BASELINE_LABELS[key] ?? key} top 25
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums text-secondary">
            {seasons.map((row) => (
              <tr key={row.season} className="border-t border-border">
                <td className="px-3 py-2 font-sans text-foreground">
                  {pool === "prospects" ? row.outcomeSeason : `${row.season} → ${row.outcomeSeason}`}
                </td>
                <td className="px-3 py-2 text-right">
                  {row.breakouts}/{row.cohort}
                </td>
                <td className="px-3 py-2 text-right text-foreground">{Math.round(row.model.p10 * 10)}/10</td>
                <td className="px-3 py-2 text-right text-foreground">{Math.round(row.model.p25 * 25)}/25</td>
                {baselineKeys.map((key) => (
                  <td key={key} className="px-3 py-2 text-right">
                    {Math.round((row.baselines[key]?.p25 ?? 0) * 25)}/25
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted">
        Ranking quality (AUC): model {summary.model.auc.toFixed(2)}
        {baselineKeys.map((key) => `, ${BREAKOUT_BASELINE_LABELS[key] ?? key} ${summary.baselines[key].auc.toFixed(2)}`).join("")}.
        0.50 is a coin flip.
      </p>
    </section>
  );
}

export function BreakoutsBrowser({
  report,
  initialTab = "hitters",
  initialPool = "mlb",
}: {
  report: BreakoutReport;
  initialTab?: BreakoutTab;
  initialPool?: BreakoutPool;
}) {
  const [tab, setTab] = useState<BreakoutTab>(initialTab);
  const [pool, setPool] = useState<BreakoutPool>(initialPool);
  const [roleFilter, setRoleFilter] = useState<PitcherRoleFilter>("all");

  const syncUrl = (nextTab: BreakoutTab, nextPool: BreakoutPool) => {
    const url = new URL(window.location.href);
    if (nextTab === "hitters") url.searchParams.delete("tab");
    else url.searchParams.set("tab", nextTab);
    if (nextPool === "mlb") url.searchParams.delete("pool");
    else url.searchParams.set("pool", nextPool);
    window.history.replaceState(window.history.state, "", url);
  };
  const selectTab = (next: BreakoutTab) => {
    setTab(next);
    syncUrl(next, pool);
  };
  const selectPool = (next: BreakoutPool) => {
    setPool(next);
    syncUrl(tab, next);
  };
  const prospects = report.prospects[tab];

  const pitchers = useMemo(
    () =>
      report.pitchers.filter((p) =>
        roleFilter === "all" ? true : roleFilter === "SP" ? p.role !== "RP" : p.role !== "SP",
      ),
    [report.pitchers, roleFilter],
  );
  const maxProbability = Math.max(
    ...(pool === "prospects" ? prospects : tab === "hitters" ? report.hitters : report.pitchers).map(
      (p) => p.probability,
    ),
    0.01,
  );
  const backtestKey =
    pool === "prospects" ? (tab === "hitters" ? "prospectHitters" : "prospectPitchers") : tab;
  const updated = new Date(report.generatedAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <AppNav />
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-3 py-6 sm:px-4 sm:py-8">
        <p className="text-xs font-medium uppercase tracking-wide text-subtle">Projections</p>
        <h1 className="mt-1 font-serif text-2xl font-medium tracking-tight text-foreground sm:text-3xl">
          {report.season} Breakout Candidates
        </h1>
        <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-muted sm:text-sm">
          Who is most likely to have their first real breakout season in {report.season}? These lists come from
          a model trained on every Statcast season since 2015. Each probability is the model&apos;s estimate that
          the player clears the breakout bar next year, playing time included. Prospects who haven&apos;t
          had a real MLB look yet get a separate model built on Pipeline rankings and minor-league stats. Built from{" "}
          {report.basedOnSeason} data · updated {updated}.
        </p>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-lg border border-border bg-surface p-0.5" role="tablist">
            {(["hitters", "pitchers"] as const).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => selectTab(key)}
                className={cn(
                  "rounded-md px-4 py-1.5 text-sm capitalize transition-colors",
                  tab === key ? "bg-surface-elevated text-foreground" : "text-secondary hover:text-foreground",
                )}
              >
                {key}
              </button>
            ))}
          </div>
          <div className="inline-flex gap-1 text-xs" aria-label="Player pool">
            {(["mlb", "prospects"] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => selectPool(key)}
                aria-pressed={pool === key}
                className={cn(
                  "rounded-md border px-2.5 py-1 transition-colors",
                  pool === key
                    ? "border-border-strong bg-surface-elevated text-foreground"
                    : "border-border text-secondary hover:bg-hover",
                )}
              >
                {key === "mlb" ? "MLB players" : "Prospects"}
              </button>
            ))}
          </div>
          {tab === "pitchers" && pool === "mlb" ? (
            <div className="inline-flex gap-1 text-xs" aria-label="Pitcher role">
              {(["all", "SP", "RP"] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setRoleFilter(key)}
                  aria-pressed={roleFilter === key}
                  className={cn(
                    "rounded-md border px-2.5 py-1 transition-colors",
                    roleFilter === key
                      ? "border-border-strong bg-surface-elevated text-foreground"
                      : "border-border text-secondary hover:bg-hover",
                  )}
                >
                  {key === "all" ? "All" : key === "SP" ? "Starters" : "Relievers"}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <p className="mt-3 text-xs leading-relaxed text-muted">
          <span className="font-medium text-secondary">Breakout = </span>
          {tab === "hitters" ? report.definitions.hitter : report.definitions.pitcher}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          <span className="font-medium text-secondary">Eligible = </span>
          {pool === "prospects" ? report.definitions.prospects : report.definitions.eligibility}
        </p>

        <ol className="mt-4 overflow-hidden rounded-xl border border-border bg-surface">
          {pool === "prospects"
            ? prospects.map((p) => (
                <CandidateRow
                  key={p.playerId}
                  rank={p.rank}
                  playerId={p.playerId}
                  name={p.name}
                  teamId={p.teamId}
                  meta={[
                    p.position,
                    p.age == null ? null : `Age ${p.age}`,
                    p.pipeline.eta ? `ETA ${p.pipeline.eta}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  probability={p.probability}
                  maxProbability={maxProbability}
                  chips={prospectChips(p, tab)}
                  explanation={p}
                />
              ))
            : tab === "hitters"
            ? report.hitters.map((h) => (
                <CandidateRow
                  key={h.playerId}
                  rank={h.rank}
                  playerId={h.playerId}
                  name={h.name}
                  teamId={h.teamId}
                  meta={[h.position, `Age ${h.age}`, h.bats ? `Bats ${h.bats}` : null]
                    .filter(Boolean)
                    .join(" · ")}
                  probability={h.probability}
                  maxProbability={maxProbability}
                  chips={hitterChips(h)}
                  explanation={h}
                />
              ))
            : pitchers.map((p) => (
                <CandidateRow
                  key={p.playerId}
                  rank={p.rank}
                  playerId={p.playerId}
                  name={p.name}
                  teamId={p.teamId}
                  meta={[p.role, `Age ${p.age}`, p.throws ? `Throws ${p.throws}` : null]
                    .filter(Boolean)
                    .join(" · ")}
                  probability={p.probability}
                  maxProbability={maxProbability}
                  chips={pitcherChips(p)}
                  explanation={p}
                />
              ))}
        </ol>

        {pool === "mlb" ? (
          <AlreadyBrokeOut season={report.basedOnSeason} players={report.alreadyBrokeOut[tab]} />
        ) : null}

        <BacktestPanel backtest={report.backtest[backtestKey]} kind={tab} pool={pool} />

        <section className="mt-10 border-t border-border pt-6 text-[13px] leading-relaxed text-muted">
          <h2 className="font-serif text-lg font-medium text-foreground">How it works</h2>
          <ul className="mt-2 list-disc space-y-1.5 pl-5">
            <li>
              Inputs are season-level Statcast leaderboards from {report.source.replace(/^.*?, /, "")}: quality of
              contact (xwOBA, barrels, top-end exit velo, sweet spot), swing decisions (chase, whiff, K%, BB%), and
              for pitchers K-BB%, whiff, xERA, fastball velo and ride, ground balls and year-over-year velo changes.
              Age, workload and career playing time are included because opportunity is part of a breakout.
            </li>
            <li>
              The model is a regularized logistic regression. A gradient-boosted model was also tested and did worse
              out of sample, so the simpler one shipped.
            </li>
            <li>
              Anyone who has already broken out is excluded, judged broadly: a strong full or partial season, a
              dominant half, 30 HR or 180 K, elite relief work, +10 OAA defense, or an All-Star, Gold Glove, Silver
              Slugger, ROY or Players Choice honor (from the MLB Stats API). Prospects with no MLB time aren&apos;t
              scored.
            </li>
            <li>
              Prospects get their own model, because they have no Statcast history. It uses the MLB Pipeline
              rankings published each spring (Top 100 and every org Top 30, back to 2016), scouting grades and ETA,
              and the prior minor-league line adjusted for level and age-for-level. It&apos;s trained on whether each
              ranked prospect broke out the following season. Ranked prospects with a cup of coffee (under 100 MLB
              PA or 15 IP) count as prospects.
            </li>
            <li>
              Each player&apos;s explanation comes from the model itself: the green bullets are the inputs pushing their
              probability up the most, with percentiles against 2026 regulars; blue bullets add Statcast detail the
              model doesn&apos;t use (bat speed, pitch-level whiffs, new pitches, second-half splits). The comp is the
              most similar pre-breakout season among players who debuted in 2015 or later.
            </li>
            <li>
              The &ldquo;unlucky&rdquo; signal (xwOBA above wOBA, or ERA above xERA) is shown as context when it
              applies, but on its own it predicted breakouts about as well as a coin flip.
            </li>
          </ul>
        </section>
      </main>
    </div>
  );
}
