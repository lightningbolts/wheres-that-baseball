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
  type BreakoutMetricSet,
  type BreakoutPitcher,
  type BreakoutProspect,
  type BreakoutReport,
  type TurnaroundHitter,
  type TurnaroundKind,
  type TurnaroundPitcher,
  type TurnaroundReport,
} from "@/lib/mlb/breakouts";
import { mlbPlayerHeadshotUrl } from "@/lib/mlb/cardPitchers";
import { cn } from "@/lib/utils";

export type BreakoutTab = "hitters" | "pitchers";
export type BreakoutPool = "mlb" | "prospects";
export type BreakoutView = "breakouts" | TurnaroundKind;
type Tone = "up" | "down";

const VIEW_LABELS: Record<BreakoutView, string> = {
  breakouts: "Breakouts",
  regression: "Regression",
  bounceback: "Bounceback",
};
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

function ProbabilityMeter({ value, max, tone = "up" }: { value: number; max: number; tone?: Tone }) {
  const width = Math.max(4, Math.round((value / max) * 100));
  return (
    <div className="flex min-w-[88px] flex-col items-end gap-1">
      <span className="font-mono text-sm font-medium tabular-nums text-foreground">{formatPct(value)}</span>
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-elevated" aria-hidden>
        <div
          className={cn("h-full rounded-full", tone === "down" ? "bg-rose-500" : "bg-emerald-500")}
          style={{ width: `${width}%` }}
        />
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
  tone = "up",
  riskLabel = "Risk",
  barLabel = "Bar to clear",
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
  tone?: Tone;
  riskLabel?: string;
  barLabel?: string;
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
        <ProbabilityMeter value={probability} max={maxProbability} tone={tone} />
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
                <span
                  className={cn("mt-[7px] size-1 shrink-0 rounded-full", tone === "down" ? "bg-rose-500" : "bg-emerald-500")}
                  aria-hidden
                />
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
              <dt className="shrink-0 font-medium text-amber-600 dark:text-amber-400">{riskLabel}:</dt>
              <dd>{risk}</dd>
            </div>
          ) : null}
          <div className="flex gap-1.5">
            <dt className="shrink-0 font-medium text-secondary">{barLabel}:</dt>
            <dd>{bar.replace(/^(Needs|Regression =|Bounceback =) /, "")}</dd>
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
    { label: "wRC+", value: h.stats.wrcPlus == null ? "—" : String(Math.round(h.stats.wrcPlus)) },
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
    { label: "xFIP", value: p.stats.xfip == null ? "—" : p.stats.xfip.toFixed(2) },
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

const OUTCOME_VERB: Record<BreakoutView, string> = {
  breakouts: "broke out",
  regression: "regressed",
  bounceback: "bounced back",
};

function compareBaseline(view: BreakoutView, kind: BreakoutTab, pool: BreakoutPool): { key: string; label: string } {
  if (view === "regression") return { key: kind === "hitters" ? "wobaOverX" : "eraUnderX", label: "“Lucky” heuristic" };
  if (view === "bounceback") return { key: kind === "hitters" ? "xOverWoba" : "eraOverX", label: "“Unlucky” heuristic" };
  if (pool === "prospects") return { key: "pipelineRank", label: "Pipeline rank alone" };
  return { key: kind === "hitters" ? "xwobaGap" : "eraMinusXera", label: "“Unlucky” heuristic" };
}

function BacktestPanel({
  backtest,
  kind,
  pool,
  view,
}: {
  backtest: BreakoutBacktest;
  kind: BreakoutTab;
  pool: BreakoutPool;
  view: BreakoutView;
}) {
  const { summary, seasons } = backtest;
  const [small, large] = backtest.topN ?? [10, 25];
  const pick = (m: BreakoutMetricSet, n: number) => m[`p${n}`] ?? 0;
  const baselineKeys = Object.keys(summary.baselines);
  const compare = compareBaseline(view, kind, pool);
  const compareSet = summary.baselines[compare.key];
  const verb = OUTCOME_VERB[view];
  const digits = pool === "prospects" && view === "breakouts" ? 1 : 0;
  const who = kind === "hitters" ? "hitters" : "pitchers";

  let intro =
    "Walk-forward backtest. Each season's list was rebuilt using only data available at the time, then checked against what actually happened the next year.";
  if (view === "breakouts" && pool === "prospects") {
    intro =
      "Walk-forward backtest. Each year's list was rebuilt from that spring's Pipeline rankings and the prior minor-league season only, then checked against who actually broke out as a rookie. Few prospects break out right away, so hit rates are low; compare them with the base rate.";
  } else if (view === "regression") {
    intro +=
      " Regression is common after a big year, so the base rate is high; the question is whether the model's top picks beat it and beat simply ranking by luck or by how good the season was.";
  } else if (view === "bounceback") {
    intro +=
      " Each season only has a few dozen eligible players, so the top-5 and top-10 rates swing a lot from year to year.";
  }

  return (
    <section className="mt-10" aria-labelledby={`backtest-${kind}`}>
      <h2 id={`backtest-${kind}`} className="font-serif text-lg font-medium text-foreground">
        Track record: {pool === "prospects" && view === "breakouts" ? "prospect " : ""}
        {view === "breakouts" ? "" : `${VIEW_LABELS[view].toLowerCase()} `}
        {who}
      </h2>
      <p className="mt-1 max-w-2xl text-[13px] text-muted">{intro}</p>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <SummaryTile
          label={`Top-${small} hit rate`}
          value={formatPct(pick(summary.model, small))}
          note={`${(pick(summary.model, small) / summary.baseRate).toFixed(1)}× base rate`}
        />
        <SummaryTile
          label={`Top-${large} hit rate`}
          value={formatPct(pick(summary.model, large), digits)}
          note="avg. per season"
        />
        <SummaryTile label="Base rate" value={formatPct(summary.baseRate, 1)} note={`eligible ${who} who ${verb}`} />
        <SummaryTile
          label={compare.label}
          value={compareSet ? formatPct(pick(compareSet, large), digits) : "—"}
          note={`top-${large} hit rate`}
        />
      </div>

      <div className="mt-4 overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[520px] text-left text-xs">
          <thead className="bg-surface-elevated text-subtle">
            <tr>
              <th className="px-3 py-2 font-medium">
                {pool === "prospects" && view === "breakouts" ? "Spring Pipeline list" : "Picks from → outcome"}
              </th>
              <th className="px-3 py-2 text-right font-medium">{VIEW_LABELS[view]}</th>
              <th className="px-3 py-2 text-right font-medium">Model top {small}</th>
              <th className="px-3 py-2 text-right font-medium">Model top {large}</th>
              {baselineKeys.map((key) => (
                <th key={key} className="px-3 py-2 text-right font-medium">
                  {BREAKOUT_BASELINE_LABELS[key] ?? key} top {large}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums text-secondary">
            {seasons.map((row) => (
              <tr key={row.season} className="border-t border-border">
                <td className="px-3 py-2 font-sans text-foreground">
                  {pool === "prospects" && view === "breakouts" ? row.outcomeSeason : `${row.season} → ${row.outcomeSeason}`}
                </td>
                <td className="px-3 py-2 text-right">
                  {row.breakouts}/{row.cohort}
                </td>
                <td className="px-3 py-2 text-right text-foreground">
                  {Math.round(pick(row.model, small) * Math.min(small, row.cohort))}/{Math.min(small, row.cohort)}
                </td>
                <td className="px-3 py-2 text-right text-foreground">
                  {Math.round(pick(row.model, large) * Math.min(large, row.cohort))}/{Math.min(large, row.cohort)}
                </td>
                {baselineKeys.map((key) => (
                  <td key={key} className="px-3 py-2 text-right">
                    {Math.round((row.baselines[key] ? pick(row.baselines[key], large) : 0) * Math.min(large, row.cohort))}/
                    {Math.min(large, row.cohort)}
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

function baseYears(season: number): string {
  return `’${String(season - 2).slice(2)}-${String(season - 1).slice(2)}`;
}

function turnHitterChips(h: TurnaroundHitter, view: TurnaroundKind, season: number) {
  const s = h.stats;
  const chips = [
    { label: "PA", value: String(s.pa) },
    { label: "wOBA", value: formatRate3(s.woba) },
    { label: "xwOBA", value: formatRate3(s.xwoba) },
    { label: "wRC+", value: s.wrcPlus == null ? "—" : String(Math.round(s.wrcPlus)) },
  ];
  if (view === "bounceback") chips.push({ label: `${baseYears(season)} wOBA`, value: formatRate3(s.baseWoba) });
  chips.push({ label: "BABIP", value: formatRate3(s.babip) });
  if (view === "regression") {
    chips.push(
      { label: "SLG", value: formatRate3(s.slg) },
      { label: "xSLG", value: formatRate3(s.xslg) },
      { label: "HR", value: s.hr == null ? "—" : String(s.hr) },
    );
  }
  chips.push(
    { label: "Barrel", value: fmt1(s.barrelPct, "%") },
    { label: "EV50", value: fmt1(s.ev50) },
    { label: "K%", value: fmt1(s.kPct, "%") },
  );
  return chips;
}

function turnPitcherChips(p: TurnaroundPitcher, view: TurnaroundKind, season: number) {
  const s = p.stats;
  const chips = [
    { label: "IP", value: s.ip },
    { label: "ERA", value: s.era == null ? "—" : s.era.toFixed(2) },
    { label: "xERA", value: s.xera == null ? "—" : s.xera.toFixed(2) },
    { label: "FIP", value: s.fip == null ? "—" : s.fip.toFixed(2) },
    { label: "xFIP", value: s.xfip == null ? "—" : s.xfip.toFixed(2) },
  ];
  if (view === "bounceback") {
    chips.push({ label: `${baseYears(season)} ERA`, value: s.baseEra == null ? "—" : s.baseEra.toFixed(2) });
  }
  chips.push(
    { label: "BABIP", value: formatRate3(s.babip) },
    { label: "HR/9", value: s.hr9 == null ? "—" : s.hr9.toFixed(2) },
    { label: "K-BB%", value: fmt1(s.kbbPct, "%") },
    { label: "Whiff", value: fmt1(s.whiffPct, "%") },
    { label: "FB velo", value: fmt1(s.fbVelo) },
  );
  return chips;
}

export function BreakoutsBrowser({
  report,
  turnarounds,
  initialView = "breakouts",
  initialTab = "hitters",
  initialPool = "mlb",
}: {
  report: BreakoutReport;
  turnarounds: TurnaroundReport;
  initialView?: BreakoutView;
  initialTab?: BreakoutTab;
  initialPool?: BreakoutPool;
}) {
  const [view, setView] = useState<BreakoutView>(initialView);
  const [tab, setTab] = useState<BreakoutTab>(initialTab);
  const [pool, setPool] = useState<BreakoutPool>(initialPool);
  const [roleFilter, setRoleFilter] = useState<PitcherRoleFilter>("all");

  const syncUrl = (next: { view: BreakoutView; tab: BreakoutTab; pool: BreakoutPool }) => {
    const url = new URL(window.location.href);
    const set = (key: string, value: string, fallback: string) => {
      if (value === fallback) url.searchParams.delete(key);
      else url.searchParams.set(key, value);
    };
    set("view", next.view, "breakouts");
    set("tab", next.tab, "hitters");
    set("pool", next.view === "breakouts" ? next.pool : "mlb", "mlb");
    window.history.replaceState(window.history.state, "", url);
  };
  const selectView = (next: BreakoutView) => {
    setView(next);
    syncUrl({ view: next, tab, pool });
  };
  const selectTab = (next: BreakoutTab) => {
    setTab(next);
    syncUrl({ view, tab: next, pool });
  };
  const selectPool = (next: BreakoutPool) => {
    setPool(next);
    syncUrl({ view, tab, pool: next });
  };

  const turn = view === "breakouts" ? null : view;
  const showProspects = view === "breakouts" && pool === "prospects";
  const prospects = report.prospects[tab];
  const byRole = <T extends { role: string }>(list: T[]) =>
    list.filter((p) => (roleFilter === "all" ? true : roleFilter === "SP" ? p.role !== "RP" : p.role !== "SP"));

  const pitchers = useMemo(() => byRole(report.pitchers), [report.pitchers, roleFilter]); // eslint-disable-line react-hooks/exhaustive-deps
  const turnHitters = turn ? turnarounds[turn].hitters : [];
  const turnPitchers = useMemo(
    () => (turn ? byRole(turnarounds[turn].pitchers) : []),
    [turn, turnarounds, roleFilter], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const shown: { probability: number }[] = turn
    ? tab === "hitters"
      ? turnHitters
      : turnPitchers
    : showProspects
      ? prospects
      : tab === "hitters"
        ? report.hitters
        : pitchers;
  const maxProbability = Math.max(...shown.map((p) => p.probability), 0.01);

  const backtest = turn
    ? turnarounds.backtest[turn][tab]
    : report.backtest[showProspects ? (tab === "hitters" ? "prospectHitters" : "prospectPitchers") : tab];
  const generatedAt = turn ? turnarounds.generatedAt : report.generatedAt;
  const updated = new Date(generatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const tone: Tone = view === "regression" ? "down" : "up";
  const rowLabels = turn ? { riskLabel: "Case against", barLabel: "Counts as" } : {};
  const nextSeason = report.season;
  const lastSeason = report.basedOnSeason;

  const intro: Record<BreakoutView, string> = {
    breakouts: `Who is most likely to have their first real breakout season in ${nextSeason}? These lists come from a model trained on every Statcast season since 2015. Each probability is the model's estimate that the player clears the breakout bar next year, playing time included. Prospects who haven't had a real MLB look yet get a separate model built on Pipeline rankings and minor-league stats.`,
    regression: `Who is most likely to give back a big chunk of their ${lastSeason} production in ${nextSeason}? The model learned from every strong Statcast-era season which ones held up and which didn't: luck gaps (wOBA vs. xwOBA, ERA vs. FIP, xFIP and xERA, BABIP, HR rate), how far the year ran ahead of the player's own track record, the quality of contact and stuff behind it, and age. Each probability assumes he keeps playing.`,
    bounceback: `Which good players coming off a bad ${lastSeason} are most likely to get back to their usual level in ${nextSeason}? The model compares the down year with the two seasons before it and learned from every Statcast-era slump which ones were noise and which were the start of a decline. Each probability includes the chance he doesn't get a real role.`,
  };

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <AppNav />
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-3 py-6 sm:px-4 sm:py-8">
        <p className="text-xs font-medium uppercase tracking-wide text-subtle">Projections</p>
        <h1 className="mt-1 font-serif text-2xl font-medium tracking-tight text-foreground sm:text-3xl">
          {nextSeason} {view === "breakouts" ? "Breakout" : VIEW_LABELS[view]} Candidates
        </h1>
        <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-muted sm:text-sm">
          {intro[view]} Built from {lastSeason} data · updated {updated}.
        </p>

        <div className="mt-5 flex flex-wrap gap-1 border-b border-border" role="tablist" aria-label="List">
          {(["breakouts", "regression", "bounceback"] as const).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={view === key}
              onClick={() => selectView(key)}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
                view === key
                  ? "border-foreground font-medium text-foreground"
                  : "border-transparent text-secondary hover:text-foreground",
              )}
            >
              {VIEW_LABELS[key]}
            </button>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
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
          {view === "breakouts" ? (
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
          ) : null}
          {tab === "pitchers" && !showProspects ? (
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
          <span className="font-medium text-secondary">{VIEW_LABELS[view]} = </span>
          {turn
            ? turnarounds.definitions[turn][tab === "hitters" ? "hitter" : "pitcher"]
            : tab === "hitters"
              ? report.definitions.hitter
              : report.definitions.pitcher}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          <span className="font-medium text-secondary">Eligible = </span>
          {turn
            ? turnarounds.definitions[turn].eligibility
            : showProspects
              ? report.definitions.prospects
              : report.definitions.eligibility}
        </p>

        {shown.length === 0 ? (
          <p className="mt-4 rounded-xl border border-border bg-surface px-4 py-6 text-sm text-muted">
            No {roleFilter === "SP" ? "starters" : "relievers"} on this list.
          </p>
        ) : (
          <ol className="mt-4 overflow-hidden rounded-xl border border-border bg-surface">
            {turn
              ? tab === "hitters"
                ? turnHitters.map((h) => (
                    <CandidateRow
                      key={h.playerId}
                      rank={h.rank}
                      playerId={h.playerId}
                      name={h.name}
                      teamId={h.teamId}
                      meta={[h.position, `Age ${h.age}`, h.bats ? `Bats ${h.bats}` : null].filter(Boolean).join(" · ")}
                      probability={h.probability}
                      maxProbability={maxProbability}
                      chips={turnHitterChips(h, turn, nextSeason)}
                      explanation={h}
                      tone={tone}
                      {...rowLabels}
                    />
                  ))
                : turnPitchers.map((p) => (
                    <CandidateRow
                      key={p.playerId}
                      rank={p.rank}
                      playerId={p.playerId}
                      name={p.name}
                      teamId={p.teamId}
                      meta={[p.role, `Age ${p.age}`, p.throws ? `Throws ${p.throws}` : null].filter(Boolean).join(" · ")}
                      probability={p.probability}
                      maxProbability={maxProbability}
                      chips={turnPitcherChips(p, turn, nextSeason)}
                      explanation={p}
                      tone={tone}
                      {...rowLabels}
                    />
                  ))
              : showProspects
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
                        meta={[h.position, `Age ${h.age}`, h.bats ? `Bats ${h.bats}` : null].filter(Boolean).join(" · ")}
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
                        meta={[p.role, `Age ${p.age}`, p.throws ? `Throws ${p.throws}` : null].filter(Boolean).join(" · ")}
                        probability={p.probability}
                        maxProbability={maxProbability}
                        chips={pitcherChips(p)}
                        explanation={p}
                      />
                    ))}
          </ol>
        )}

        {view === "breakouts" && pool === "mlb" ? (
          <AlreadyBrokeOut season={report.basedOnSeason} players={report.alreadyBrokeOut[tab]} />
        ) : null}

        <BacktestPanel backtest={backtest} kind={tab} pool={pool} view={view} />

        {turn ? (
          <section className="mt-10 border-t border-border pt-6 text-[13px] leading-relaxed text-muted">
            <h2 className="font-serif text-lg font-medium text-foreground">How it works</h2>
            <ul className="mt-2 list-disc space-y-1.5 pl-5">
              <li>
                Same setup as the breakout model: season-level Statcast leaderboards from{" "}
                {turnarounds.source.replace(/^.*?, /, "")}, a regularized logistic regression, and a walk-forward
                backtest where every season is scored using only the data available at the time.
              </li>
              <li>
                Inputs separate luck from skill: wOBA vs. xwOBA and SLG vs. xSLG, BABIP and HR rate compared with the
                player&apos;s own two-year history, park-adjusted wRC+, ERA vs. xERA, FIP and xFIP, plus the contact quality,
                plate discipline, stuff and velocity behind the numbers, year-over-year changes in exit velo, sprint
                speed, velo and whiff rate, injured-list time, workload and age. Sprint speed is only cited for players
                who actually run (27.5 ft/s or faster).
              </li>
              <li>
                Regression is measured among players who kept playing, so it&apos;s about performance, not injuries.
                Bounceback counts only if the player gets a real role, because losing the job is one of the ways a
                bounceback fails. Hitters who still posted a wRC+ above 120 aren&apos;t bounceback candidates: a
                good year shortened by injury isn&apos;t a down year. IL stints come from MLB transactions, and a
                slump that came with real IL time is treated differently from one while healthy.
              </li>
              <li>
                The green or red bullets are the inputs pushing that player&apos;s probability up the most. &ldquo;Case
                against&rdquo; is the biggest input pulling it down. The comp is the most similar past player-season
                (weighted by what the model cares about) that actually {view === "regression" ? "regressed" : "bounced back"}.
              </li>
              <li>
                {view === "regression"
                  ? "The simple “lucky” heuristics (wOBA above xwOBA, ERA below xFIP or xERA) do work for regression, especially for pitchers: ERA minus xFIP alone is hard to beat, so the pitcher model is built around it (ERA vs. xFIP, FIP and xERA, plus age and role) and wins on the top of the list rather than by much overall. The model adds the most on hitters, where track record, power-on-contact gaps and swing-and-miss matter more than the xwOBA gap alone."
                  : "Ranking slumping players by how “unlucky” they were barely beats a coin flip, and ranking by how good they used to be does worse than one. Age, whether they kept their job, and whether the bat speed / velocity is still there carry most of the signal."}
              </li>
            </ul>
          </section>
        ) : (
          <section className="mt-10 border-t border-border pt-6 text-[13px] leading-relaxed text-muted">
            <h2 className="font-serif text-lg font-medium text-foreground">How it works</h2>
            <ul className="mt-2 list-disc space-y-1.5 pl-5">
              <li>
                Inputs are season-level Statcast leaderboards from {report.source.replace(/^.*?, /, "")}: quality of
                contact (xwOBA, park-adjusted wRC+, barrels, top-end exit velo, sweet spot), swing decisions (chase, whiff, K%, BB%), and
                for pitchers K-BB%, whiff, xERA, FIP and xFIP, fastball velo and ride, ground balls and year-over-year velo changes.
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
        )}
      </main>
    </div>
  );
}
