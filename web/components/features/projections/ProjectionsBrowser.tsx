"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";

import { AppNav } from "@/components/features/AppNav";
import { TeamLogo } from "@/components/ui/TeamLogo";
import type { AwardOdds, HitterProjection, PitcherProjection, SeasonProjection, TeamProjection } from "@/lib/game/franchise/seasonProjection";
import { mlbPlayerHeadshotUrl } from "@/lib/mlb/cardPitchers";
import { getTeamById, MLB_TEAMS } from "@/lib/mlb/teams";
import { cn } from "@/lib/utils";

import { DistChart, fmt0, fmt1, fmt2, fmt3, OddsBar, OddsCell, PercentileStrip, pct, WinsChart } from "./charts";

export type ProjTab = "standings" | "odds" | "hitters" | "pitchers" | "awards" | "leaders";
const TABS: Array<[ProjTab, string]> = [
  ["standings", "Standings"],
  ["odds", "Playoff odds"],
  ["hitters", "Hitters"],
  ["pitchers", "Pitchers"],
  ["awards", "Awards"],
  ["leaders", "Leaders"],
];

const abbr = (id: number) => getTeamById(id)?.abbrev ?? "FA";

function Headshot({ id, name }: { id: number; name: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={mlbPlayerHeadshotUrl(id, 96)} alt="" title={name} width={28} height={28} loading="lazy" className="size-7 shrink-0 rounded-full border border-border bg-surface-elevated object-cover" />
  );
}

function SubNav() {
  return (
    <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide">
      <span className="text-foreground">Projections</span>
      <span className="text-faint">/</span>
      <span className="text-foreground">Season sim</span>
      <span className="text-faint">·</span>
      <Link href="/breakouts" className="text-subtle underline-offset-2 hover:text-foreground hover:underline">
        Breakouts
      </Link>
    </div>
  );
}

export function ProjectionsBrowser({ initialTab = "standings" }: { initialTab?: ProjTab }) {
  const [data, setData] = useState<SeasonProjection | null>(null);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<ProjTab>(initialTab);

  useEffect(() => {
    let alive = true;
    import("@/data/projections/2027.json")
      .then((m) => alive && setData((m.default ?? m) as unknown as SeasonProjection))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  const select = (t: ProjTab) => {
    setTab(t);
    const url = new URL(window.location.href);
    if (t === "standings") url.searchParams.delete("tab");
    else url.searchParams.set("tab", t);
    window.history.replaceState(window.history.state, "", url);
  };

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <AppNav />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-3 py-6 sm:px-4 sm:py-8">
        <SubNav />
        <h1 className="mt-1 font-serif text-2xl font-medium tracking-tight text-foreground sm:text-3xl">{data?.season ?? 2027} Season Projections</h1>
        <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-muted sm:text-sm">
          {`Every team, hitter and pitcher, projected by playing the whole ${data?.season ?? 2027} season over and over with our franchise game engine. That means the real schedule, depth charts, injuries, call-ups, trades and the full postseason bracket. Each simulated season first re-draws every player's true talent around his projection, so the spread reflects projection error as well as 162 games of luck. Real farm systems come from MLB Pipeline's top-30 lists. `}
          {data ? (
            <>
              {" "}
              <span className="text-foreground">{data.sims.toLocaleString()} simulated seasons</span> · updated{" "}
              {new Date(data.generated).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}.
            </>
          ) : null}
        </p>

        {data ? <LeagueStrip data={data} /> : null}

        <div className="mt-5 flex gap-1 overflow-x-auto border-b border-border [scrollbar-width:none]" role="tablist" aria-label="View">
          {TABS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => select(key)}
              className={cn(
                "-mb-px shrink-0 border-b-2 px-3 py-2 text-sm transition-colors",
                tab === key ? "border-foreground font-medium text-foreground" : "border-transparent text-secondary hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="mt-4">
          {failed ? (
            <p className="text-sm text-muted">Couldn&apos;t load the projections.</p>
          ) : !data ? (
            <p className="animate-pulse text-sm text-muted">Loading {"thousands of simulated seasons"}…</p>
          ) : tab === "standings" ? (
            <Standings data={data} />
          ) : tab === "odds" ? (
            <PlayoffOdds data={data} />
          ) : tab === "hitters" ? (
            <Hitters data={data} />
          ) : tab === "pitchers" ? (
            <Pitchers data={data} />
          ) : tab === "awards" ? (
            <Awards data={data} />
          ) : (
            <Leaders data={data} />
          )}
        </div>

        {data ? (
          <p className="mt-8 max-w-3xl text-[12px] leading-relaxed text-subtle">
            How it works: Opening Day rosters come from the real 40-man rosters, multi-year Statcast projections and real contracts.
            Players who are still unsigned free agents this winter (marked <span className="font-medium">FA</span>) are placed by the
            engine&apos;s simulated free-agent market. True-talent draws are about ±.016 wOBA for established regulars and wider for young
            players, rookies and prospects, plus a shared draw for each club (injury clusters, roster churn) worth about ±4 wins. Both
            were tuned on a 2026 backtest: the model was rebuilt from data through 2025, played from Opening Day 2026 and scored against
            what happened. That test also set how far hitters are pulled toward average, because hitters separated more in the
            projection than in real seasons. WAR uses the engine&apos;s linear-weights model. Percentiles are taken across all simulated
            seasons, and rate stats only count seasons with at least 30 PA (or 10 IP).
          </p>
        ) : null}
      </main>
    </div>
  );
}

function LeagueStrip({ data }: { data: SeasonProjection }) {
  const items = [
    ["Runs / game", fmt2(data.league.rpg.mean)],
    ["League AVG", fmt3(data.league.avg.mean)],
    ["League ERA", fmt2(data.league.era.mean)],
    ["HR / PA", `${(data.league.hrPa.mean * 100).toFixed(2)}%`],
  ];
  return (
    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map(([k, v]) => (
        <div key={k} className="rounded-lg border border-border bg-surface px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-subtle">{k}</div>
          <div className="font-mono text-base tabular-nums text-foreground">{v}</div>
        </div>
      ))}
    </div>
  );
}

/** The keyboard-reachable control that opens a row's details (the row itself also toggles on click). */
function RowToggle({ open, onToggle, label, children }: { open: boolean; onToggle: () => void; label: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className="flex min-w-0 items-center gap-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500"
    >
      {children}
    </button>
  );
}

// ─── Teams ───────────────────────────────────────────────────────────────────

function TeamDetail({ t, wide = false }: { t: TeamProjection; wide?: boolean }) {
  const rounds: Array<[string, number]> = [
    ["Make playoffs", t.playoffs],
    ["Win division", t.div],
    ["First-round bye", t.bye],
    ["Reach DS", t.ds],
    ["Reach LCS", t.lcs],
    ["Win pennant", t.pennant],
    ["Win World Series", t.ws],
  ];
  return (
    <div className={cn("grid gap-4 p-3", wide && "md:grid-cols-[1.4fr_1fr]")}>
      <div>
        <div className="mb-1 flex items-baseline justify-between">
          <span className="text-[11px] font-medium uppercase tracking-wide text-subtle">Win distribution</span>
          <span className="font-mono text-[11px] text-muted">
            {fmt1(t.wins.mean)} ± {fmt1(t.wins.sd)} · 90% {fmt0(t.wins.pct[0])}–{fmt0(t.wins.pct[6])}
          </span>
        </div>
        <WinsChart lo={t.winsLo} hist={t.winsHist} mean={t.wins.mean} sd={t.wins.sd} />
        <div className="mt-2">
          <PercentileStrip dist={t.wins} fmt={fmt0} />
        </div>
      </div>
      <div className="space-y-1.5">
        {rounds.map(([k, p]) => (
          <div key={k} className="grid grid-cols-[110px_1fr] items-center gap-2 text-xs">
            <span className="text-secondary">{k}</span>
            <OddsBar p={p} tone={k.includes("World") ? "amber" : "emerald"} />
          </div>
        ))}
        <div className="pt-2 text-[11px] font-medium uppercase tracking-wide text-subtle">Playoff seed</div>
        <div className="grid grid-cols-6 gap-1">
          {t.seeds.map((p, i) => (
            <div key={i} className="rounded border border-border px-1 py-1 text-center">
              <div className="text-[9px] text-subtle">#{i + 1}</div>
              <div className="font-mono text-[11px] tabular-nums">{pct(p)}</div>
            </div>
          ))}
        </div>
        <p className="pt-1 font-mono text-[11px] text-muted">
          Runs {t.rs} scored · {t.ra} allowed · {t.rs - t.ra >= 0 ? "+" : ""}
          {t.rs - t.ra}
        </p>
      </div>
    </div>
  );
}

function Standings({ data }: { data: SeasonProjection }) {
  const [open, setOpen] = useState<number | null>(null);
  const byId = new Map(data.teams.map((t) => [t.id, t]));
  const groups = (["AL", "NL"] as const).flatMap((lg) =>
    (["East", "Central", "West"] as const).map((div) => ({
      key: `${lg} ${div}`,
      teams: MLB_TEAMS.filter((m) => m.league === lg && m.division === div)
        .map((m) => byId.get(m.id)!)
        .filter(Boolean)
        .sort((a, b) => b.wins.mean - a.wins.mean),
    })),
  );
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {groups.map((g) => (
        <section key={g.key} className="overflow-hidden rounded-lg border border-border bg-surface">
          <h2 className="border-b border-border px-3 py-2 text-sm font-medium">{g.key}</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-subtle">
                <th className="px-3 py-1.5 text-left font-medium">Team</th>
                <th className="px-1.5 text-right font-medium">W</th>
                <th className="px-1.5 text-right font-medium">L</th>
                <th className="hidden px-1.5 text-right font-medium sm:table-cell">80%</th>
                <th className="px-1.5 text-right font-medium">Div</th>
                <th className="px-1.5 text-right font-medium">Playoff</th>
                <th className="px-1.5 pr-3 text-right font-medium">WS</th>
              </tr>
            </thead>
            <tbody>
              {g.teams.map((t) => (
                <Fragment key={t.id}>
                  <tr className="cursor-pointer border-t border-border hover:bg-hover" onClick={() => setOpen(open === t.id ? null : t.id)}>
                    <td className="px-3 py-1.5">
                      <RowToggle open={open === t.id} onToggle={() => setOpen(open === t.id ? null : t.id)} label={`${abbr(t.id)} details`}>
                        <TeamLogo teamId={t.id} size={20} />
                        <span className="font-medium">{abbr(t.id)}</span>
                      </RowToggle>
                    </td>
                    <td className="px-1.5 text-right font-mono tabular-nums">{fmt1(t.wins.mean)}</td>
                    <td className="px-1.5 text-right font-mono tabular-nums text-muted">{fmt1(162 - t.wins.mean)}</td>
                    <td className="hidden px-1.5 text-right font-mono text-xs tabular-nums text-muted sm:table-cell">
                      {fmt0(t.wins.pct[1])}–{fmt0(t.wins.pct[5])}
                    </td>
                    <OddsCell p={t.div} />
                    <OddsCell p={t.playoffs} />
                    <OddsCell p={t.ws} className="pr-3" />
                  </tr>
                  {open === t.id ? (
                    <tr className="border-t border-border">
                      <td colSpan={7}>
                        <TeamDetail t={t} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}

function PlayoffOdds({ data }: { data: SeasonProjection }) {
  const [key, setKey] = useState<keyof TeamProjection>("ws");
  const cols: Array<[keyof TeamProjection, string]> = [
    ["playoffs", "Playoffs"],
    ["div", "Division"],
    ["bye", "Bye"],
    ["ds", "DS"],
    ["lcs", "LCS"],
    ["pennant", "Pennant"],
    ["ws", "Win WS"],
  ];
  const rows = [...data.teams].sort((a, b) => (b[key] as number) - (a[key] as number) || b.wins.mean - a.wins.mean);
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="w-full min-w-[620px] text-sm">
        <thead>
          <tr className="text-[10px] uppercase tracking-wide text-subtle">
            <th className="px-3 py-2 text-left font-medium">Team</th>
            <th className="px-1.5 text-right font-medium">W</th>
            {cols.map(([k, label]) => (
              <th key={k} className="px-1.5 text-right font-medium">
                <button type="button" onClick={() => setKey(k)} className={cn("uppercase underline-offset-2", key === k ? "font-bold underline" : "opacity-75 hover:opacity-100")}>
                  {label}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((t, i) => (
            <Fragment key={t.id}>
              <tr className="cursor-pointer border-t border-border hover:bg-hover" onClick={() => setOpen(open === t.id ? null : t.id)}>
                <td className="px-3 py-1.5">
                  <RowToggle open={open === t.id} onToggle={() => setOpen(open === t.id ? null : t.id)} label={`${abbr(t.id)} details`}>
                    <span className="w-4 text-right font-mono text-[10px] text-subtle">{i + 1}</span>
                    <TeamLogo teamId={t.id} size={20} />
                    <span className="font-medium">{abbr(t.id)}</span>
                    <span className="hidden text-xs text-subtle md:inline">{getTeamById(t.id)?.league}</span>
                  </RowToggle>
                </td>
                <td className="px-1.5 text-right font-mono tabular-nums">{fmt1(t.wins.mean)}</td>
                {cols.map(([k]) => (
                  <OddsCell key={k} p={t[k] as number} />
                ))}
              </tr>
              {open === t.id ? (
                <tr className="border-t border-border">
                  <td colSpan={cols.length + 2}>
                    <TeamDetail t={t} wide />
                  </td>
                </tr>
              ) : null}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Players ─────────────────────────────────────────────────────────────────

type HitKey = "war" | "hr" | "avg" | "obp" | "slg" | "ops" | "woba" | "sb" | "rbi" | "r" | "pa";
type PitKey = "war" | "era" | "fip" | "whip" | "k" | "w" | "sv" | "ip" | "k9" | "bb";

const HIT_COLS: Array<[HitKey, string, (h: HitterProjection) => string, boolean]> = [
  ["pa", "PA", (h) => fmt0(h.pa.mean), true],
  ["hr", "HR", (h) => fmt0(h.hr.mean), true],
  ["r", "R", (h) => fmt0(h.r.mean), true],
  ["rbi", "RBI", (h) => fmt0(h.rbi.mean), true],
  ["sb", "SB", (h) => fmt0(h.sb.mean), true],
  ["avg", "AVG", (h) => fmt3(h.avg.pct[3]), true],
  ["obp", "OBP", (h) => fmt3(h.obp.pct[3]), true],
  ["slg", "SLG", (h) => fmt3(h.slg.pct[3]), true],
  ["ops", "OPS", (h) => fmt3(h.ops.pct[3]), true],
  ["woba", "wOBA", (h) => fmt3(h.woba.pct[3]), true],
  ["war", "WAR", (h) => fmt1(h.war.mean), true],
];

const PIT_COLS: Array<[PitKey, string, (p: PitcherProjection) => string, boolean]> = [
  ["ip", "IP", (p) => fmt0(p.ip.mean), true],
  ["w", "W", (p) => fmt0(p.w.mean), true],
  ["sv", "SV", (p) => fmt0(p.sv.mean), true],
  ["k", "K", (p) => fmt0(p.k.mean), true],
  ["bb", "BB", (p) => fmt0(p.bb.mean), false],
  ["era", "ERA", (p) => fmt2(p.era.pct[3]), false],
  ["fip", "FIP", (p) => fmt2(p.fip.pct[3]), false],
  ["whip", "WHIP", (p) => fmt2(p.whip.pct[3]), false],
  ["k9", "K/9", (p) => fmt1(p.k9.pct[3]), true],
  ["war", "WAR", (p) => fmt1(p.war.mean), true],
];

const sortVal = (d: { mean: number; pct: number[] }, rate: boolean) => (rate ? d.pct[3] : d.mean);
const RATE_HIT = new Set<HitKey>(["avg", "obp", "slg", "ops", "woba"]);
const RATE_PIT = new Set<PitKey>(["era", "fip", "whip", "k9"]);

function Filters({
  q,
  setQ,
  team,
  setTeam,
  extra,
}: {
  q: string;
  setQ: (s: string) => void;
  team: number;
  setTeam: (n: number) => void;
  extra?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search players"
        aria-label="Search players"
        className="h-8 w-44 rounded-md border border-border bg-surface px-2 text-sm outline-none focus:border-border-strong"
      />
      <select value={team} onChange={(e) => setTeam(Number(e.target.value))} aria-label="Team" className="h-8 rounded-md border border-border bg-surface px-2 text-sm">
        <option value={0}>All teams</option>
        {[...MLB_TEAMS]
          .sort((a, b) => a.abbrev.localeCompare(b.abbrev))
          .map((t) => (
            <option key={t.id} value={t.id}>
              {t.abbrev} · {t.name}
            </option>
          ))}
      </select>
      {extra}
    </div>
  );
}

function Tags({ prospect, signing }: { prospect?: HitterProjection["prospect"]; signing?: boolean }) {
  return (
    <>
      {prospect ? (
        <span className="rounded bg-violet-500/15 px-1 text-[10px] font-medium text-violet-700 dark:text-violet-300" title={`MLB Pipeline ${prospect.year}: #${prospect.rank} in system, ${prospect.fv} FV`}>
          #{prospect.rank}
        </span>
      ) : null}
      {signing ? (
        <span className="rounded bg-amber-500/15 px-1 text-[10px] font-medium text-amber-700 dark:text-amber-300" title="Unsigned free agent: placed by the simulated winter market">
          FA
        </span>
      ) : null}
    </>
  );
}

function Hitters({ data }: { data: SeasonProjection }) {
  const [q, setQ] = useState("");
  const [team, setTeam] = useState(0);
  const [pos, setPos] = useState("all");
  const [regulars, setRegulars] = useState(true);
  const [sort, setSort] = useState<HitKey>("war");
  const [limit, setLimit] = useState(60);
  const [open, setOpen] = useState<number | null>(null);
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return data.hitters
      .filter((h) => (!s || h.name.toLowerCase().includes(s)) && (!team || h.team === team) && (pos === "all" || (pos === "prospects" ? !!h.prospect : h.pos === pos)) && (!regulars || h.pa.mean >= 300 || s || team))
      .sort((a, b) => sortVal(b[sort], RATE_HIT.has(sort)) - sortVal(a[sort], RATE_HIT.has(sort)));
  }, [data.hitters, q, team, pos, regulars, sort]);
  return (
    <div>
      <Filters
        q={q}
        setQ={setQ}
        team={team}
        setTeam={setTeam}
        extra={
          <>
            <select value={pos} onChange={(e) => setPos(e.target.value)} aria-label="Position" className="h-8 rounded-md border border-border bg-surface px-2 text-sm">
              <option value="all">All positions</option>
              {["C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "DH"].map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
              <option value="prospects">Ranked prospects</option>
            </select>
            <label className="flex items-center gap-1.5 text-xs text-secondary">
              <input type="checkbox" checked={regulars} onChange={(e) => setRegulars(e.target.checked)} /> 300+ PA
            </label>
          </>
        }
      />
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-subtle">
              <th className="px-3 py-2 text-left font-medium">Player</th>
              {HIT_COLS.map(([k, label]) => (
                <th key={k} className="px-1.5 text-right font-medium">
                  <button type="button" onClick={() => setSort(k)} className={cn("uppercase underline-offset-2", sort === k ? "font-bold underline" : "opacity-75 hover:opacity-100")}>
                    {label}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((h) => (
              <Fragment key={h.id}>
                <tr className="cursor-pointer border-t border-border hover:bg-hover" onClick={() => setOpen(open === h.id ? null : h.id)}>
                  <td className="px-3 py-1.5">
                    <RowToggle open={open === h.id} onToggle={() => setOpen(open === h.id ? null : h.id)} label={`${h.name} details`}>
                      <Headshot id={h.id} name={h.name} />
                      <span className="min-w-0">
                        <span className="flex items-center gap-1">
                          <span className="truncate font-medium">{h.name}</span>
                          <Tags prospect={h.prospect} signing={h.signing} />
                        </span>
                        <span className="block text-[11px] text-subtle">
                          {abbr(h.team)} · {h.pos} · {h.age}
                        </span>
                      </span>
                    </RowToggle>
                  </td>
                  {HIT_COLS.map(([k, , f]) => (
                    <td key={k} className={cn("px-1.5 text-right font-mono tabular-nums", k === sort ? "text-foreground" : "text-secondary", k === "war" && "font-medium")}>
                      {f(h)}
                    </td>
                  ))}
                </tr>
                {open === h.id ? (
                  <tr className="border-t border-border">
                    <td colSpan={HIT_COLS.length + 1}>
                      <HitterDetail h={h} sims={data.sims} />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <ShowMore shown={Math.min(limit, rows.length)} total={rows.length} onMore={() => setLimit(limit + 60)} />
    </div>
  );
}

function ShowMore({ shown, total, onMore }: { shown: number; total: number; onMore: () => void }) {
  return (
    <div className="mt-2 flex items-center justify-between text-xs text-subtle">
      <span>
        {shown} of {total}
      </span>
      {shown < total ? (
        <button type="button" onClick={onMore} className="rounded-md border border-border px-3 py-1 text-secondary hover:bg-hover hover:text-foreground">
          Show more
        </button>
      ) : null}
    </div>
  );
}

function HitterDetail({ h, sims }: { h: HitterProjection; sims: number }) {
  const odds: Array<[string, number]> = [
    ["30+ HR", h.odds.hr30],
    ["40+ HR", h.odds.hr40],
    ["50+ HR", h.odds.hr50],
    [".300 hitter (qualified)", h.odds.avg300],
    ["30+ SB", h.odds.sb30],
    ["5+ WAR", h.odds.war5],
    ["8+ WAR", h.odds.war8],
    ["100+ PA", h.regular],
  ];
  return (
    <div className="space-y-4 p-3">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 font-mono text-xs text-muted">
        <span className="text-foreground">
          Mean line: {fmt0(h.line.pa)} PA · {fmt0(h.line.h)} H · {fmt0(h.line.d)} 2B · {fmt0(h.line.t)} 3B · {fmt0(h.line.hr)} HR · {fmt0(h.line.bb)} BB · {fmt0(h.line.k)} K
        </span>
        <span>
          {fmt3(h.avg.pct[3])}/{fmt3(h.obp.pct[3])}/{fmt3(h.slg.pct[3])}
        </span>
        <span>{sims.toLocaleString()} seasons</span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <DistChart dist={h.war} fmt={fmt1} label="WAR" tone="emerald" />
        <DistChart dist={h.hr} fmt={fmt0} label="Home runs" tone="amber" />
        <DistChart dist={h.ops} fmt={fmt3} label="OPS" tone="sky" />
        <DistChart dist={h.avg} fmt={fmt3} label="Batting average" tone="violet" />
        <DistChart dist={h.sb} fmt={fmt0} label="Stolen bases" tone="rose" />
        <DistChart dist={h.pa} fmt={fmt0} label="Plate appearances" tone="sky" />
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <div className="space-y-2">
          <div className="text-[11px] font-medium uppercase tracking-wide text-subtle">Percentiles</div>
          {(
            [
              ["WAR", h.war, fmt1],
              ["HR", h.hr, fmt0],
              ["RBI", h.rbi, fmt0],
              ["OPS", h.ops, fmt3],
              ["wOBA", h.woba, fmt3],
            ] as const
          ).map(([k, d, f]) => (
            <div key={k} className="grid grid-cols-[44px_1fr] items-center gap-2">
              <span className="text-xs text-secondary">{k}</span>
              <PercentileStrip dist={d} fmt={f} />
            </div>
          ))}
        </div>
        <div className="space-y-1.5">
          <div className="text-[11px] font-medium uppercase tracking-wide text-subtle">Chances</div>
          {odds.map(([k, p]) => (
            <div key={k} className="grid grid-cols-[150px_1fr] items-center gap-2 text-xs">
              <span className="text-secondary">{k}</span>
              <OddsBar p={p} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Pitchers({ data }: { data: SeasonProjection }) {
  const [q, setQ] = useState("");
  const [team, setTeam] = useState(0);
  const [role, setRole] = useState<"all" | "SP" | "RP" | "prospects">("all");
  const [regulars, setRegulars] = useState(true);
  const [sort, setSort] = useState<PitKey>("war");
  const [limit, setLimit] = useState(60);
  const [open, setOpen] = useState<number | null>(null);
  const lowGood = (k: PitKey) => k === "era" || k === "fip" || k === "whip" || k === "bb";
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return data.pitchers
      .filter(
        (p) =>
          (!s || p.name.toLowerCase().includes(s)) &&
          (!team || p.team === team) &&
          (role === "all" || (role === "prospects" ? !!p.prospect : p.role === role)) &&
          (!regulars || p.ip.mean >= (p.role === "SP" ? 100 : 40) || s || team),
      )
      .sort((a, b) => {
        const d = sortVal(b[sort], RATE_PIT.has(sort)) - sortVal(a[sort], RATE_PIT.has(sort));
        return lowGood(sort) ? -d : d;
      });
  }, [data.pitchers, q, team, role, regulars, sort]);
  return (
    <div>
      <Filters
        q={q}
        setQ={setQ}
        team={team}
        setTeam={setTeam}
        extra={
          <>
            <select value={role} onChange={(e) => setRole(e.target.value as typeof role)} aria-label="Role" className="h-8 rounded-md border border-border bg-surface px-2 text-sm">
              <option value="all">Starters & relievers</option>
              <option value="SP">Starters</option>
              <option value="RP">Relievers</option>
              <option value="prospects">Ranked prospects</option>
            </select>
            <label className="flex items-center gap-1.5 text-xs text-secondary">
              <input type="checkbox" checked={regulars} onChange={(e) => setRegulars(e.target.checked)} /> Regulars
            </label>
          </>
        }
      />
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-subtle">
              <th className="px-3 py-2 text-left font-medium">Pitcher</th>
              {PIT_COLS.map(([k, label]) => (
                <th key={k} className="px-1.5 text-right font-medium">
                  <button type="button" onClick={() => setSort(k)} className={cn("uppercase underline-offset-2", sort === k ? "font-bold underline" : "opacity-75 hover:opacity-100")}>
                    {label}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((p) => (
              <Fragment key={p.id}>
                <tr className="cursor-pointer border-t border-border hover:bg-hover" onClick={() => setOpen(open === p.id ? null : p.id)}>
                  <td className="px-3 py-1.5">
                    <RowToggle open={open === p.id} onToggle={() => setOpen(open === p.id ? null : p.id)} label={`${p.name} details`}>
                      <Headshot id={p.id} name={p.name} />
                      <span className="min-w-0">
                        <span className="flex items-center gap-1">
                          <span className="truncate font-medium">{p.name}</span>
                          <Tags prospect={p.prospect} signing={p.signing} />
                        </span>
                        <span className="block text-[11px] text-subtle">
                          {abbr(p.team)} · {p.role} · {p.age}
                        </span>
                      </span>
                    </RowToggle>
                  </td>
                  {PIT_COLS.map(([k, , f]) => (
                    <td key={k} className={cn("px-1.5 text-right font-mono tabular-nums", k === sort ? "text-foreground" : "text-secondary", k === "war" && "font-medium")}>
                      {f(p)}
                    </td>
                  ))}
                </tr>
                {open === p.id ? (
                  <tr className="border-t border-border">
                    <td colSpan={PIT_COLS.length + 1}>
                      <PitcherDetail p={p} sims={data.sims} />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <ShowMore shown={Math.min(limit, rows.length)} total={rows.length} onMore={() => setLimit(limit + 60)} />
    </div>
  );
}

function PitcherDetail({ p, sims }: { p: PitcherProjection; sims: number }) {
  const odds: Array<[string, number]> = [
    ["Cy Young", p.odds.cy],
    ["200+ K", p.odds.k200],
    ["Sub-3.00 ERA (qualified)", p.odds.era3],
    ["15+ wins", p.odds.w15],
    ["30+ saves", p.odds.sv30],
    ["5+ WAR", p.odds.war5],
    [p.role === "SP" ? "30+ IP" : "30+ IP", p.regular],
  ];
  const sp = p.role === "SP";
  return (
    <div className="space-y-4 p-3">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 font-mono text-xs text-muted">
        <span className="text-foreground">
          Mean line: {fmt0(p.line.g)} G · {fmt0(p.line.gs)} GS · {fmt1(p.line.outs / 3)} IP · {fmt0(p.line.w)}-{fmt0(p.line.l)} · {fmt0(p.line.sv)} SV · {fmt0(p.line.k)} K · {fmt0(p.line.bb)} BB · {fmt0(p.line.hr)} HR
        </span>
        <span>{sims.toLocaleString()} seasons</span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <DistChart dist={p.war} fmt={fmt1} label="WAR" tone="emerald" />
        <DistChart dist={p.era} fmt={fmt2} label="ERA" tone="rose" />
        <DistChart dist={p.k} fmt={fmt0} label="Strikeouts" tone="sky" />
        <DistChart dist={p.ip} fmt={fmt0} label="Innings" tone="violet" />
        {sp ? <DistChart dist={p.w} fmt={fmt0} label="Wins" tone="amber" /> : <DistChart dist={p.sv} fmt={fmt0} label="Saves" tone="amber" />}
        {sp ? <DistChart dist={p.sv} fmt={fmt0} label="Saves" tone="amber" /> : <DistChart dist={p.w} fmt={fmt0} label="Wins" tone="amber" />}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <div className="text-[11px] font-medium uppercase tracking-wide text-subtle">Percentiles</div>
          {(
            [
              ["ERA", p.era, fmt2],
              ["FIP", p.fip, fmt2],
              ["WHIP", p.whip, fmt2],
              ["K", p.k, fmt0],
              ["WAR", p.war, fmt1],
            ] as const
          ).map(([k, d, f]) => (
            <div key={k} className="grid grid-cols-[44px_1fr] items-center gap-2">
              <span className="text-xs text-secondary">{k}</span>
              <PercentileStrip dist={d} fmt={f} />
            </div>
          ))}
        </div>
        <div className="space-y-1.5">
          <div className="text-[11px] font-medium uppercase tracking-wide text-subtle">Chances</div>
          {odds.map(([k, v]) => (
            <div key={k} className="grid grid-cols-[150px_1fr] items-center gap-2 text-xs">
              <span className="text-secondary">{k}</span>
              <OddsBar p={v} tone={k === "Cy Young" ? "amber" : "emerald"} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Awards & leaders ────────────────────────────────────────────────────────

function usePeople(data: SeasonProjection) {
  return useMemo(() => {
    const m = new Map<number, { name: string; team: number; note: string }>();
    for (const h of data.hitters) m.set(h.id, { name: h.name, team: h.team, note: `${h.pos} · ${fmt1(h.war.mean)} WAR` });
    for (const p of data.pitchers) if (!m.has(p.id)) m.set(p.id, { name: p.name, team: p.team, note: `${p.role} · ${fmt2(p.era.pct[3])} ERA` });
    return m;
  }, [data]);
}

function OddsList({ title, list, people, tone = "amber" }: { title: string; list: AwardOdds[] | undefined; people: ReturnType<typeof usePeople>; tone?: "amber" | "emerald" | "sky" | "violet" }) {
  const rows = (list ?? []).slice(0, 8);
  const max = rows[0]?.p ?? 1;
  return (
    <section className="rounded-lg border border-border bg-surface p-3">
      <h3 className="mb-2 text-sm font-medium">{title}</h3>
      {rows.length ? (
        <ol className="space-y-1.5">
          {rows.map((r, i) => {
            const who = people.get(r.id);
            return (
              <li key={r.id} className="grid grid-cols-[16px_minmax(0,1.3fr)_1fr] items-center gap-2 text-xs">
                <span className="text-right font-mono text-[10px] text-subtle">{i + 1}</span>
                <span className="flex min-w-0 items-center gap-1.5">
                  <TeamLogo teamId={who?.team} size={16} />
                  <span className="truncate font-medium text-foreground">{who?.name ?? `#${r.id}`}</span>
                  <span className="hidden truncate text-[10px] text-subtle sm:inline">{who?.note}</span>
                </span>
                <OddsBar p={r.p} max={max} tone={tone} label={pct(r.p)} />
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="text-xs text-muted">No data.</p>
      )}
    </section>
  );
}

function Awards({ data }: { data: SeasonProjection }) {
  const people = usePeople(data);
  const awards: Array<[string, string]> = [
    ["mvp", "MVP"],
    ["cy", "Cy Young"],
    ["roy", "Rookie of the Year"],
    ["relief", "Reliever of the Year"],
    ["aaron", "Hank Aaron Award"],
  ];
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">Share of simulated seasons each player wins the award, voted with the franchise&apos;s award ballots.</p>
      {awards.map(([k, label]) => (
        <div key={k} className="grid gap-3 md:grid-cols-2">
          <OddsList title={`AL ${label}`} list={data.awards[`${k}:AL`]} people={people} />
          <OddsList title={`NL ${label}`} list={data.awards[`${k}:NL`]} people={people} />
        </div>
      ))}
    </div>
  );
}

function Leaders({ data }: { data: SeasonProjection }) {
  const people = usePeople(data);
  const stats: Array<[string, string, "amber" | "emerald" | "sky" | "violet"]> = [
    ["hr", "Home run leader", "amber"],
    ["avg", "Batting title", "violet"],
    ["ops", "OPS leader (qualified)", "sky"],
    ["rbi", "RBI leader", "amber"],
    ["sb", "Stolen base leader", "emerald"],
    ["war_b", "Position-player WAR leader", "emerald"],
    ["k", "Strikeout leader", "sky"],
    ["era", "ERA title (qualified)", "violet"],
    ["w", "Wins leader", "amber"],
    ["sv", "Saves leader", "emerald"],
    ["war_p", "Pitcher WAR leader", "emerald"],
  ];
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">Share of simulated seasons each player finishes first in his league (ties go to whoever got there first).</p>
      {stats.map(([k, label, tone]) => (
        <div key={k} className="grid gap-3 md:grid-cols-2">
          <OddsList title={`AL ${label}`} list={data.leaders[`${k}:AL`]} people={people} tone={tone} />
          <OddsList title={`NL ${label}`} list={data.leaders[`${k}:NL`]} people={people} tone={tone} />
        </div>
      ))}
    </div>
  );
}
