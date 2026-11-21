"use client";

import { useEffect, useMemo, useState } from "react";
import { pitchName } from "@/components/game/controller";
import { PITCH_TYPE_COLOR, recordKind, recordText, StatcastPanel } from "@/components/game/PitchTracker";
import { MARK_COLOR } from "@/components/game/scene/view";
import { TeamLogo } from "@/components/ui/TeamLogo";
import { getGameLog, type BoxSide, type GameLog, type Play, type TextPlay } from "@/lib/game/franchise/gamelog";
import { rosterIndex } from "@/lib/game/franchise/manual";
import { pitchLogPlayers, simPitchLog } from "@/lib/game/franchise/pitchReplay";
import { fmtDate } from "@/lib/game/franchise/schedule";
import type { PitchRecord } from "@/lib/game/stats/pitchLog";
import type { League } from "@/lib/game/franchise/types";
import { umpById } from "@/lib/game/umpires/data";
import { cn } from "@/lib/utils";
import { useProfiles } from "./Profiles";
import { td, th } from "./ui";

const ord = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
const ip = (outs: number) => `${Math.floor(outs / 3)}.${outs % 3}`;

/** A stable pick for a play's wording (the sim records what happened, not where it went). */
const pick = <T,>(seed: number, xs: T[]): T => xs[Math.abs(Math.imul(seed ^ 0x9e3779b9, 2654435761) >>> 7) % xs.length];

const OF = ["left field", "center field", "right field", "left-center", "right-center"];
const IF = ["shortstop", "second base", "third base", "first base", "the pitcher"];

/** Plain-English description of a simmed play. */
function describe(p: Play, seed: number, name: (id: number) => string, last?: PitchRecord): string {
  const [, code, who, pit] = p;
  const b = name(who);
  const scored = p.slice(8) as number[];
  const runs = scored.length ? ` ${scored.map(name).join(", ")} ${scored.length > 1 ? "score" : "scores"}.` : "";
  switch (code) {
    case "K":
      return `${b} strikes out ${last ? (last.called ? "looking" : last.result === "foul_tip" ? "on a foul tip" : "swinging") : pick(seed, ["swinging", "swinging", "looking"])}.`;
    case "BB":
      return `${b} walks.${runs}`;
    case "HBP":
      return `${b} is hit by a pitch.${runs}`;
    case "1B":
      return `${b} singles to ${pick(seed, ["left field", "center field", "right field", "left field", "right field", "shallow center"])}.${runs}`;
    case "2B":
      return `${b} doubles ${pick(seed, ["down the left-field line", "to left-center", "to right-center", "down the right-field line", "to deep center"])}.${runs}`;
    case "3B":
      return `${b} triples to ${pick(seed, ["right-center", "the right-field corner", "left-center"])}.${runs}`;
    case "HR":
      return `${b} homers to ${pick(seed, OF)}${last?.dist ? `, ${last.dist} ft` : ""}${scored.length === 4 ? " — a grand slam" : scored.length > 1 ? ` (${scored.length} runs)` : ""}.`;
    case "E":
      return `${b} reaches on a ${pick(seed, ["fielding", "throwing"])} error by the ${pick(seed + 1, ["shortstop", "third baseman", "second baseman", "first baseman", "left fielder", "right fielder"])}.${runs}`;
    case "GO":
      return `${b} grounds out to ${pick(seed, IF)}.${runs}`;
    case "FC":
      return `${b} reaches on a fielder's choice; the lead runner is forced out.${runs}`;
    case "DP":
      return `${b} grounds into a ${pick(seed, ["6-4-3", "4-6-3", "5-4-3", "6-3"])} double play.${runs}`;
    case "FO":
      return `${b} ${pick(seed, ["flies out to", "flies out to", "lines out to", "pops out to"])} ${pick(seed + 1, [...OF, "shortstop", "second base"])}.`;
    case "SF":
      return `${b} hits a sacrifice fly to ${pick(seed, OF)}.${runs}`;
    case "SB":
      return `${b} steals ${!(p[5] & 1) && p[5] & 2 && !(p[5] & 4) ? "second" : p[5] & 4 && !(p[5] & 2) ? "third" : "a base"}.`;
    case "CS":
      return `${b} is caught stealing.`;
    case "PC":
      return `Pitching change: ${b} replaces ${name(pit)}.`;
  }
}

interface Row {
  half: number;
  text: string;
  as: number;
  hs: number;
  outs?: number;
  key: boolean;
  /** Plate appearance number in the pitch log (simmed games). */
  pa?: number;
}

function rows(log: GameLog, name: (id: number) => string, paOfPlay?: Array<number | null>, byPa?: Map<number, PitchRecord[]>): Row[] {
  if (log.text) return log.text.map((t: TextPlay, i) => ({ half: t[0], text: t[1], as: t[2], hs: t[3], key: i > 0 && (t[2] !== log.text![i - 1][2] || t[3] !== log.text![i - 1][3]) }));
  const plays = log.plays ?? [];
  return plays.map((p, i) => {
    const prev = plays[i - 1];
    return {
      half: p[0],
      text: describe(p, log.id * 977 + i, name, paOfPlay?.[i] != null ? byPa?.get(paOfPlay[i]!)?.at(-1) : undefined),
      as: p[6],
      hs: p[7],
      outs: p[1] === "PC" ? undefined : p[4],
      key: !!prev ? p[6] !== prev[6] || p[7] !== prev[7] : p[6] + p[7] > 0,
      pa: paOfPlay?.[i] ?? undefined,
    };
  });
}

function BoxTables({ side, abbrev, teamId, log, dec }: { side: BoxSide; abbrev: string; teamId: number; log: GameLog; dec: Record<number, string> }) {
  const { openPlayer } = useProfiles();
  const nm = (id: number) => log.names[id] ?? `#${id}`;
  const link = (id: number, extra?: string) => (
    <button type="button" className="text-left hover:underline" onClick={() => openPlayer(id)}>
      {nm(id)}
      {extra && <span className="ml-1 text-secondary">{extra}</span>}
    </button>
  );
  const tot = side.bat.reduce((a, r) => a.map((v, i) => v + (r[i + 2] as number)), [0, 0, 0, 0, 0, 0]);
  const notes = (k: 8 | 9 | 10 | 11, label: string) => {
    const xs = side.bat.filter((r) => r[k] > 0).map((r) => `${nm(r[0]).split(" ").slice(-1)[0]}${r[k] > 1 ? ` ${r[k]}` : ""}`);
    return xs.length ? `${label}: ${xs.join(", ")}` : null;
  };
  return (
    <div className="min-w-0 space-y-2">
      <h4 className="flex items-center gap-1.5 text-sm font-semibold">
        <TeamLogo teamId={teamId} size={16} />
        {abbrev}
      </h4>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs tabular-nums">
          <thead>
            <tr>
              <th className={th}>Batters</th>
              {["AB", "R", "H", "RBI", "BB", "K"].map((h) => (
                <th key={h} className={cn(th, "text-right")}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {side.bat.map((r) => (
              <tr key={r[0]}>
                <td className={cn(td, "whitespace-nowrap py-1")}>{link(r[0], r[1])}</td>
                {[r[2], r[3], r[4], r[5], r[6], r[7]].map((v, i) => (
                  <td key={i} className={cn(td, "py-1 text-right")}>
                    {v}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="font-semibold">
              <td className={cn(td, "py-1")}>Totals</td>
              {tot.map((v, i) => (
                <td key={i} className={cn(td, "py-1 text-right")}>
                  {v}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-[11px] leading-snug text-secondary">{[notes(9, "2B"), notes(10, "3B"), notes(8, "HR"), notes(11, "SB")].filter(Boolean).join(" · ")}</p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs tabular-nums">
          <thead>
            <tr>
              <th className={th}>Pitchers</th>
              {["IP", "H", "R", "ER", "BB", "K", "HR", "PC"].map((h) => (
                <th key={h} className={cn(th, "text-right")}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {side.pit.map((r) => (
              <tr key={r[0]}>
                <td className={cn(td, "whitespace-nowrap py-1")}>{link(r[0], dec[r[0]])}</td>
                {[ip(r[1]), r[2], r[3], r[4], r[5], r[6], r[7], r[8]].map((v, i) => (
                  <td key={i} className={cn(td, "py-1 text-right")}>
                    {v}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** One plate appearance, pitch by pitch (under its play-by-play line). */
function PitchList({ ps }: { ps: PitchRecord[] }) {
  return (
    <ol className="mb-1.5 ml-1 mt-0.5 space-y-0.5 border-l border-border pl-3 text-xs tabular-nums">
      {ps.map((p) => (
        <li key={p.n} className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white" style={{ backgroundColor: MARK_COLOR[recordKind(p)] }}>
            {p.paPitch}
          </span>
          <span className="min-w-[9.5rem]">{recordText(p)}</span>
          <span className="w-7 text-secondary">
            {p.balls}-{p.strikes}
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: PITCH_TYPE_COLOR[p.type] ?? "#9ca3af" }} />
            {p.mph.toFixed(1)} mph {pitchName(p.type)}
          </span>
          <span className="text-secondary">{Math.round(p.spinRpm)} rpm</span>
          {p.ev != null && (
            <span className="text-secondary">
              EV {p.ev.toFixed(1)} · LA {p.la}° · {p.dist} ft{p.barrel ? " · barrel" : ""}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

/** A finished franchise game: line score, box score, play-by-play and pitch-by-pitch Statcast log. */
export function GameDetail({ league, slot, id }: { league: League; slot: number; id: number }) {
  const g = league.schedule.find((x) => x.id === id);
  const [log, setLog] = useState<GameLog | null | undefined>(undefined);
  const [tab, setTab] = useState<"plays" | "box" | "statcast">("plays");
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  const { openTeam, rosters } = useProfiles();
  const idx = useMemo(() => (rosters ? rosterIndex(rosters) : null), [rosters]);
  // Played games keep their own tracked pitches; simmed ones replay theirs (with the real
  // arsenals once the rosters are in).
  const replay = useMemo(() => {
    if (!log) return null;
    if (log.pitches) return { pitches: log.pitches, paOfPlay: undefined };
    if (rosters === undefined) return null;
    const who = pitchLogPlayers(league.players, idx, log.names);
    return simPitchLog(log, who);
  }, [log, rosters, idx, league.players]);
  const byPa = useMemo(() => {
    const m = new Map<number, PitchRecord[]>();
    for (const p of replay?.pitches ?? []) m.set(p.pa, [...(m.get(p.pa) ?? []), p]);
    return m;
  }, [replay]);
  const toggle = (pa: number) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(pa)) n.delete(pa);
      else n.add(pa);
      return n;
    });
  useEffect(() => {
    let alive = true;
    setLog(undefined);
    void getGameLog(slot, league.season, id).then((l) => alive && setLog(l));
    return () => {
      alive = false;
    };
  }, [slot, league.season, id]);

  if (!g) return <p className="text-sm text-secondary">Game not found.</p>;
  const a = league.teams[g.away];
  const h = league.teams[g.home];
  const r = g.result;
  const ump = umpById(g.ump);
  const pname = (pid?: number) => (pid ? (log?.names[pid] ?? league.players[pid]?.name ?? `#${pid}`) : null);
  const dec: Record<number, string> = {};
  if (r?.wp) dec[r.wp] = "(W)";
  if (r?.lp) dec[r.lp] = "(L)";
  if (r?.sv) dec[r.sv] = "(S)";
  const inn = log ? Math.max(log.inn, log.line[0].length, log.line[1].length) : 9;
  const hits = (s: BoxSide) => s.bat.reduce((n, b) => n + b[4], 0);
  const list = log ? rows(log, (pid) => log.names[pid] ?? league.players[pid]?.name ?? `#${pid}`, replay?.paOfPlay, byPa) : [];
  const halves: Array<{ half: number; rows: Row[] }> = [];
  for (const row of list) {
    if (!halves.length || halves[halves.length - 1].half !== row.half) halves.push({ half: row.half, rows: [] });
    halves[halves.length - 1].rows.push(row);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-lg font-semibold">
          <button type="button" className="hover:underline" onClick={() => openTeam(a.id)}>
            {a.name}
          </button>{" "}
          {r?.as ?? ""} <span className="text-secondary">@</span>{" "}
          <button type="button" className="hover:underline" onClick={() => openTeam(h.id)}>
            {h.name}
          </button>{" "}
          {r?.hs ?? ""}
          {r && r.inn > 9 ? <span className="ml-1 text-sm text-secondary">({r.inn})</span> : null}
        </h3>
        <p className="text-xs text-secondary">
          {fmtDate(league.calendar, g.day)}
          {g.ps ? ` · ${g.ps.toUpperCase()}` : ""}
          {r?.att ? ` · Att. ${r.att.toLocaleString()}` : ""}
          {ump ? ` · HP: ${ump.name}` : ""}
          {r?.manual ? " · played manually" : ""}
        </p>
      </div>
      <p className="text-xs text-secondary">{[r?.wp && `W: ${pname(r.wp)}`, r?.lp && `L: ${pname(r.lp)}`, r?.sv && `S: ${pname(r.sv)}`].filter(Boolean).join(" · ")}</p>

      {log === undefined && <p className="text-sm text-secondary">Loading…</p>}
      {log === null && (
        <p className="rounded-lg border border-border px-3 py-2 text-sm text-secondary">
          No box score, play-by-play or pitch log for this game: it was played before game logs were recorded (or on another device). Every game from now on has one.
        </p>
      )}
      {log && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] border-collapse text-center text-xs tabular-nums">
              <thead>
                <tr>
                  <th className={cn(th, "text-left")}>Team</th>
                  {Array.from({ length: inn }, (_, i) => (
                    <th key={i} className={cn(th, "text-center")}>
                      {i + 1}
                    </th>
                  ))}
                  <th className={cn(th, "text-center")}>R</th>
                  <th className={cn(th, "text-center")}>H</th>
                </tr>
              </thead>
              <tbody>
                {([0, 1] as const).map((s) => {
                  const t = s === 0 ? a : h;
                  const line = log.line[s];
                  const played = s === 0 ? inn : Math.max(...halves.filter((x) => x.half % 2 === 1).map((x) => Math.floor(x.half / 2)), 0);
                  return (
                    <tr key={s}>
                      <td className={cn(td, "text-left font-semibold")}>
                        <span className="inline-flex items-center gap-1.5">
                          <TeamLogo teamId={t.id} size={14} />
                          {t.abbrev}
                        </span>
                      </td>
                      {Array.from({ length: inn }, (_, i) => (
                        <td key={i} className={td}>
                          {s === 1 && i + 1 > played ? "x" : (line[i] ?? 0)}
                        </td>
                      ))}
                      <td className={cn(td, "font-bold")}>{s === 0 ? log.as : log.hs}</td>
                      <td className={td}>{hits(log.box[s])}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex gap-1 text-sm">
            {(["plays", "box", "statcast"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setTab(k)}
                className={cn("rounded-md px-3 py-1", tab === k ? "bg-foreground text-background" : "text-secondary hover:text-foreground")}
              >
                {k === "plays" ? "Play-by-play" : k === "box" ? "Box score" : "Statcast"}
              </button>
            ))}
          </div>

          {tab === "box" && (
            <div className="grid gap-5 md:grid-cols-2">
              <BoxTables side={log.box[0]} abbrev={a.abbrev} teamId={a.id} log={log} dec={dec} />
              <BoxTables side={log.box[1]} abbrev={h.abbrev} teamId={h.id} log={log} dec={dec} />
            </div>
          )}

          {tab === "statcast" &&
            (replay?.pitches.length ? (
              <StatcastPanel log={replay.pitches} teams={{ away: a.abbrev, home: h.abbrev }} />
            ) : (
              <p className="text-sm text-secondary">{replay === null && rosters === undefined ? "Loading…" : "No pitch log for this game."}</p>
            ))}

          {tab === "plays" && (
            <div className="space-y-3">
              {byPa.size > 0 && <p className="text-xs text-secondary">Click a plate appearance to see it pitch by pitch.</p>}
              {halves.map(({ half, rows: rs }) => {
                const top = half % 2 === 0;
                const t = top ? a : h;
                const last = rs[rs.length - 1];
                const before = halves[halves.indexOf(halves.find((x) => x.half === half)!) - 1]?.rows.at(-1);
                const runs = top ? last.as - (before?.as ?? 0) : last.hs - (before?.hs ?? 0);
                return (
                  <div key={half}>
                    <div className="mb-1 flex items-center justify-between border-b border-border pb-1 text-xs font-semibold uppercase tracking-wide text-secondary">
                      <span className="inline-flex items-center gap-1.5">
                        <TeamLogo teamId={t.id} size={14} />
                        {top ? "Top" : "Bottom"} {ord(Math.floor(half / 2))} · {t.abbrev} batting
                      </span>
                      <span>
                        {runs} {runs === 1 ? "run" : "runs"} · {a.abbrev} {last.as}, {h.abbrev} {last.hs}
                      </span>
                    </div>
                    <ul className="space-y-0.5 text-sm">
                      {rs.map((row, i) => {
                        const ps = row.pa != null ? byPa.get(row.pa) : undefined;
                        const shown = row.pa != null && open.has(row.pa);
                        const body = (
                          <>
                            <span className="flex-1">
                              {ps && <span className="mr-1 inline-block w-2.5 text-[10px] text-muted">{shown ? "▾" : "▸"}</span>}
                              {row.text}
                              {ps && <span className="ml-1.5 text-xs font-normal text-muted">({ps.length})</span>}
                            </span>
                            {row.outs != null && <span className="shrink-0 text-xs text-muted">{row.outs} out</span>}
                            {row.key && (
                              <span className="shrink-0 text-xs tabular-nums text-secondary">
                                {row.as}-{row.hs}
                              </span>
                            )}
                          </>
                        );
                        return (
                          <li key={i} className={cn(row.key && "font-semibold")}>
                            {ps ? (
                              <button type="button" className="flex w-full gap-2 text-left hover:text-foreground/80" aria-expanded={shown} onClick={() => toggle(row.pa!)}>
                                {body}
                              </button>
                            ) : (
                              <div className="flex gap-2">{body}</div>
                            )}
                            {shown && ps && <PitchList ps={ps} />}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
