"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fmtDate } from "@/lib/game/franchise/schedule";
import {
  seasonCrews,
  umpGameLog,
  umpTotals,
} from "@/lib/game/franchise/umpires";
import { UMPIRES, umpById } from "@/lib/game/umpires/data";
import {
  describeMiss,
  pct,
  type UmpTotals,
} from "@/lib/game/umpires/scorecard";
import { cn } from "@/lib/utils";
import { f2, pct1, StatTable, type Col } from "../StatTable";
import {
  Card,
  Segmented,
  SmallBtn,
  Stat,
  Table,
  TeamDot,
  td,
  th,
  type TabProps,
} from "../ui";

interface Row {
  id: number;
  name: string;
  chief: boolean;
  g: number;
  n: number;
  miss: number;
  acc: number;
  xacc: number;
  aax: number;
  cons: number;
  fav: number;
  impact: number;
}

/** Fewer games than this and the rate leaders ignore him. */
const QUAL_GAMES = 5;

const signedRuns = (v: number) =>
  `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}`;

function rowsFrom(
  totals: Map<number, UmpTotals> | Record<number, UmpTotals>,
): Row[] {
  const entries =
    totals instanceof Map
      ? [...totals.entries()]
      : Object.entries(totals).map(([k, v]) => [Number(k), v] as const);
  const out: Row[] = [];
  for (const [id, t] of entries) {
    const u = umpById(id);
    if (!u || !t.n) continue;
    const acc = pct(t.ok, t.n);
    const xacc = pct(t.xa, t.n);
    out.push({
      id,
      name: u.name,
      chief: !!u.chief,
      g: t.g,
      n: t.n,
      miss: t.n - t.ok,
      acc,
      xacc,
      aax: acc - xacc,
      cons: pct(t.con, t.n),
      fav: t.fav,
      impact: t.g ? t.absFav / t.g : 0,
    });
  }
  return out;
}

export function UmpiresTab({ league }: TabProps) {
  const seasons = useMemo(
    () => [
      league.season,
      ...(league.umpHist ?? [])
        .map((h) => h.season)
        .filter((s) => s !== league.season)
        .sort((a, b) => b - a),
    ],
    [league.season, league.umpHist],
  );
  const [season, setSeason] = useState(league.season);
  const [sel, setSel] = useState<number | null>(null);
  const current = season === league.season;
  const rows = useMemo(() => {
    if (current) return rowsFrom(umpTotals(league));
    const h = league.umpHist?.find((x) => x.season === season);
    return h ? rowsFrom(h.totals) : [];
  }, [league, season, current]);
  const qual = rows.filter((r) => r.g >= QUAL_GAMES);
  const best = qual.length
    ? qual.reduce((a, b) => (b.acc > a.acc ? b : a))
    : null;
  const worst = qual.length
    ? qual.reduce((a, b) => (b.acc < a.acc ? b : a))
    : null;
  const steady = qual.length
    ? qual.reduce((a, b) => (b.cons > a.cons ? b : a))
    : null;
  const league3 = useMemo(() => {
    const n = rows.reduce((s, r) => s + r.n, 0);
    const miss = rows.reduce((s, r) => s + r.miss, 0);
    const x = rows.reduce((s, r) => s + r.xacc * r.n, 0);
    return n
      ? {
          acc: 1 - miss / n,
          xacc: x / n,
          games: rows.reduce((s, r) => s + r.g, 0),
        }
      : null;
  }, [rows]);
  const bigMiss = useMemo(() => {
    if (!current) return null;
    let best: { g: (typeof league.schedule)[number]; inches: number } | null =
      null;
    for (const g of league.schedule)
      if (g.uc?.big && (!best || g.uc.big.in > best.inches))
        best = { g, inches: g.uc.big.in };
    return best;
  }, [league, current]);

  const name = (r: Row) => (
    <button
      type="button"
      onClick={() => setSel(r.id === sel ? null : r.id)}
      className={cn(
        "text-left hover:underline",
        r.id === sel && "font-semibold text-emerald-500",
      )}
    >
      {r.name}
      {r.chief && (
        <span className="ml-1 text-[10px] uppercase text-muted">CC</span>
      )}
    </button>
  );

  const cols: Array<Col<Row>> = [
    {
      key: "name",
      label: "Umpire",
      get: (r) => r.name,
      text: true,
      render: name,
      sticky: true,
    },
    { key: "g", label: "G", title: "Games behind the plate", get: (r) => r.g },
    { key: "n", label: "Calls", title: "Called pitches", get: (r) => r.n },
    {
      key: "miss",
      label: "Missed",
      title: "Incorrect calls",
      get: (r) => r.miss,
      low: true,
    },
    {
      key: "acc",
      label: "Acc",
      title: "Correct calls / called pitches",
      get: (r) => r.acc,
      fmt: pct1,
      rate: true,
    },
    {
      key: "xacc",
      label: "xAcc",
      title: "What a league-average umpire gets on the same pitches",
      get: (r) => r.xacc,
      fmt: pct1,
      rate: true,
    },
    {
      key: "aax",
      label: "AAx",
      title: "Accuracy above expected",
      get: (r) => r.aax,
      fmt: (v) => `${v >= 0 ? "+" : "−"}${(Math.abs(v) * 100).toFixed(1)}`,
      rate: true,
    },
    {
      key: "cons",
      label: "Consistency",
      title: "Calls that fit his own zone that day",
      get: (r) => r.cons,
      fmt: pct1,
      rate: true,
    },
    {
      key: "impact",
      label: "Impact/G",
      title: "Runs swung by missed calls per game, either way",
      get: (r) => r.impact,
      fmt: f2,
      low: true,
      rate: true,
    },
    {
      key: "fav",
      label: "Favor",
      title: "Net runs the misses gave the home club (− = the visitors)",
      get: (r) => r.fav,
      fmt: signedRuns,
    },
  ];

  const selUmp = sel != null ? umpById(sel) : undefined;
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (sel != null)
      logRef.current?.scrollIntoView?.({
        behavior: "smooth",
        block: "nearest",
      });
  }, [sel]);
  const log = useMemo(
    () => (sel != null && current ? umpGameLog(league, sel) : []),
    [league, sel, current],
  );
  const crewOf = useMemo(() => {
    if (sel == null) return null;
    const crews = seasonCrews(league.seed, league.season);
    return crews.find((c) => c.includes(sel)) ?? null;
  }, [league.seed, league.season, sel]);
  const next = useMemo(
    () =>
      sel != null && current
        ? league.schedule
            .filter((g) => g.ump === sel && !g.result)
            .sort((a, b) => a.day - b.day)[0]
        : undefined,
    [league, sel, current],
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          label="League accuracy"
          value={league3 ? pct1(league3.acc) : "—"}
          sub={
            league3
              ? `expected ${pct1(league3.xacc)} · ${league3.games} games`
              : "no games yet"
          }
        />
        <Stat
          label="Most accurate"
          value={best ? best.name : "—"}
          sub={
            best ? `${pct1(best.acc)} · ${best.g} G` : `min ${QUAL_GAMES} games`
          }
        />
        <Stat
          label="Least accurate"
          value={worst ? worst.name : "—"}
          sub={
            worst
              ? `${pct1(worst.acc)} · ${worst.g} G`
              : `min ${QUAL_GAMES} games`
          }
        />
        <Stat
          label="Most consistent"
          value={steady ? steady.name : "—"}
          sub={
            steady
              ? `${pct1(steady.cons)} · ${steady.g} G`
              : `min ${QUAL_GAMES} games`
          }
        />
      </div>
      {bigMiss && (
        <p className="text-xs text-secondary">
          Biggest miss of the season:{" "}
          <span className="text-foreground">
            {umpById(bigMiss.g.ump)?.name}
          </span>
          , {describeMiss(bigMiss.g.uc!.big!)} (
          {league.teams[bigMiss.g.away]?.abbrev} @{" "}
          {league.teams[bigMiss.g.home]?.abbrev},{" "}
          {fmtDate(league.calendar, bigMiss.g.day)}).
        </p>
      )}
      <Card
        title={`Umpire scorecards · ${season}`}
        right={
          seasons.length > 1 ? (
            <Segmented
              value={String(season)}
              onChange={(v) => {
                setSeason(Number(v));
                setSel(null);
              }}
              options={seasons.map((s) => ({ v: String(s), label: String(s) }))}
            />
          ) : undefined
        }
      >
        <StatTable
          rows={rows}
          cols={cols}
          defaultSort="acc"
          isQual={(r) => r.g >= QUAL_GAMES}
          highlight={(r) => r.id === sel}
          pageSize={80}
          empty="No games umpired yet this season."
        />
        <p className="mt-2 text-xs text-muted">
          Home-plate umpires, every called pitch checked against the ABS zone.
          Click a name for his game log. CC = crew chief. Rate leaders need{" "}
          {QUAL_GAMES} games. {UMPIRES.length} umpires on staff.
        </p>
      </Card>
      <div ref={logRef} className="scroll-mt-4">
        {selUmp && (
          <Card
            title={`${selUmp.name} · game log`}
            right={
              <SmallBtn
                onClick={() => setSel(null)}
                aria-label="Close game log"
              >
                Close
              </SmallBtn>
            }
          >
            <div className="mb-2 text-xs text-secondary">
              {crewOf && (
                <>Crew: {crewOf.map((id) => umpById(id)?.name).join(", ")}. </>
              )}
              {next && (
                <>
                  Next plate assignment: {league.teams[next.away]?.abbrev} @{" "}
                  {league.teams[next.home]?.abbrev},{" "}
                  {fmtDate(league.calendar, next.day)}.
                </>
              )}
            </div>
            {log.length ? (
              <Table>
                <thead>
                  <tr>
                    <th className={th}>Date</th>
                    <th className={th}>Game</th>
                    <th className={cn(th, "text-right")}>Calls</th>
                    <th className={cn(th, "text-right")}>Missed</th>
                    <th className={cn(th, "text-right")}>Acc</th>
                    <th className={cn(th, "text-right")}>xAcc</th>
                    <th className={cn(th, "text-right")}>Cons</th>
                    <th
                      className={cn(th, "text-right")}
                      title="Net runs to the home club"
                    >
                      Favor
                    </th>
                    <th className={th}>Biggest miss</th>
                  </tr>
                </thead>
                <tbody>
                  {log.map((g) => {
                    const c = g.uc!;
                    const a = league.teams[g.away];
                    const h = league.teams[g.home];
                    const fav =
                      c.fav === 0
                        ? "—"
                        : `${Math.abs(c.fav).toFixed(2)} ${c.fav > 0 ? h.abbrev : a.abbrev}`;
                    return (
                      <tr key={g.id}>
                        <td
                          className={cn(td, "whitespace-nowrap text-secondary")}
                        >
                          {fmtDate(league.calendar, g.day)}
                        </td>
                        <td className={cn(td, "whitespace-nowrap")}>
                          {g.ps && (
                            <span className="mr-1 rounded bg-emerald-500/15 px-1 text-[10px] uppercase text-emerald-500">
                              {g.ps}
                            </span>
                          )}
                          <TeamDot id={a.id} abbrev={a.abbrev} /> {g.result?.as}
                          , <TeamDot id={h.id} abbrev={h.abbrev} />{" "}
                          {g.result?.hs}
                          {g.result?.manual ? " ★" : ""}
                        </td>
                        <td className={cn(td, "text-right")}>{c.n}</td>
                        <td className={cn(td, "text-right")}>{c.n - c.ok}</td>
                        <td className={cn(td, "text-right")}>
                          {pct1(pct(c.ok, c.n))}
                        </td>
                        <td className={cn(td, "text-right text-secondary")}>
                          {pct1(pct(c.xa, c.n))}
                        </td>
                        <td className={cn(td, "text-right")}>
                          {pct1(pct(c.con, c.n))}
                        </td>
                        <td className={cn(td, "whitespace-nowrap text-right")}>
                          {fav}
                        </td>
                        <td
                          className={cn(
                            td,
                            "whitespace-nowrap text-xs text-secondary",
                          )}
                        >
                          {c.big ? describeMiss(c.big) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            ) : (
              <p className="text-sm text-secondary">
                {current
                  ? "No games behind the plate yet."
                  : "Game logs are kept for the current season only."}
              </p>
            )}
            <p className="mt-2 text-xs text-muted">
              ★ played manually (scored pitch by pitch); simmed games are scored
              from the umpire&apos;s tendencies.
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}
