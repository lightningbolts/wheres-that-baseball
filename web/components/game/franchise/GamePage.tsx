"use client";

import { Fragment, useMemo, type ReactNode } from "react";
import { TeamLogo } from "@/components/ui/TeamLogo";
import { describePlay, errors, isPA, lineScore, PLAY, unpackPlay, type BoxBat, type BoxPit, type GameBox, type Play } from "@/lib/game/franchise/boxscore";
import { fmtDate } from "@/lib/game/franchise/schedule";
import type { League, ScheduledGame } from "@/lib/game/franchise/types";
import { venueNameForTeam } from "@/lib/game/physics/park";
import { cn } from "@/lib/utils";
import { ipFmt } from "./StatTable";

const ORD = ["th", "st", "nd", "rd"];
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : (ORD[n % 10] ?? "th")}`;
const robStr = (b: number) => `${b & 1 ? "1" : "-"}${b & 2 ? "2" : "-"}${b & 4 ? "3" : "-"}`;
const ROUND: Record<string, string> = { wc: "Wild Card Series", ds: "Division Series", lcs: "League Championship Series", ws: "World Series" };

interface Row {
  i: number;
  play: Play;
  /** Score before the play [away, home], outs and runners before. */
  score: [number, number];
  outs: number;
  bases: number | null;
  /** Pitcher change before this play (new pitcher's box index). */
  change: { from: number; to: number } | null;
}

/** Walk the plays once: score, outs and runners before each, pitching changes. */
function rows(box: GameBox, post: boolean): Row[] {
  const out: Row[] = [];
  const score: [number, number] = [0, 0];
  const cur: [number, number] = [0, 0];
  let half = -1;
  let outs = 0;
  let bases: number | null = 0;
  box.pbp.forEach((v, i) => {
    const play = unpackPlay(v);
    const h = (play.inning - 1) * 2 + (play.bottom ? 1 : 0);
    if (h !== half) {
      half = h;
      outs = 0;
      // Regular-season extras start with a runner on second.
      bases = box.manual ? null : play.inning > 9 && !post ? 2 : 0;
    }
    const fld = play.bottom ? 0 : 1;
    const change = play.pitcher !== cur[fld] ? { from: cur[fld], to: play.pitcher } : null;
    cur[fld] = play.pitcher;
    out.push({ i, play, score: [score[0], score[1]], outs, bases, change });
    score[play.bottom ? 1 : 0] += play.runs;
    outs = play.outs;
    bases = box.manual ? null : play.bases;
  });
  return out;
}

export function GamePage({ league, game, openPlayer, openTeam }: { league: League; game: ScheduledGame; openPlayer: (id: number) => void; openTeam: (id: number) => void }) {
  const r = game.result;
  const box = game.box;
  const away = league.teams[game.away];
  const home = league.teams[game.home];
  const post = !!game.ps;
  const plays = useMemo(() => (box ? rows(box, post) : []), [box, post]);
  if (!r) return <p className="text-sm text-secondary">This game hasn&apos;t been played yet.</p>;

  const name = (id: number) => league.players[id]?.name ?? "—";
  const P = ({ id, className }: { id: number; className?: string }) => (
    <button type="button" className={cn("text-left hover:text-emerald-500 hover:underline", className)} onClick={() => openPlayer(id)}>
      {name(id)}
    </button>
  );
  const T = ({ id, children, className }: { id: number; children: ReactNode; className?: string }) => (
    <button type="button" className={cn("text-left hover:text-emerald-500 hover:underline", className)} onClick={() => openTeam(id)}>
      {children}
    </button>
  );
  const awayWon = r.as > r.hs;
  const series = post ? league.bracket?.series.find((s) => s.id === game.ps) : undefined;
  const venue = game.site ?? venueNameForTeam(home.id);
  const line = box ? lineScore(box) : null;
  const err = box ? errors(box) : [0, 0];
  const hits = box ? box.bat.map((s) => s.reduce((n, b) => n + b[4], 0)) : [0, 0];
  const n = line ? line[0].length : r.inn;

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {[
            [away, r.as, awayWon],
            [home, r.hs, !awayWon],
          ].map(([t, runs, won]) => {
            const tm = t as typeof away;
            return (
              <div key={tm.id} className="flex items-center gap-2">
                <T id={tm.id}>
                  <TeamLogo teamId={tm.id} size={36} title={tm.abbrev} />
                </T>
                <div>
                  <T id={tm.id}>
                    <span className={cn("text-lg font-semibold", won ? "text-foreground" : "text-secondary")}>{tm.name}</span>
                  </T>
                </div>
                <span className={cn("text-3xl font-extrabold tabular-nums", won ? "text-foreground" : "text-muted")}>{runs as number}</span>
              </div>
            );
          })}
        </div>
        <p className="text-xs text-secondary">
          {fmtDate(league.calendar, game.day, true)}
          {series && ` · ${ROUND[series.round] ?? "Postseason"}`}
          {venue && ` · ${venue}`}
          {r.att ? ` · Attendance ${r.att.toLocaleString()}` : ""}
          {r.inn > 9 ? ` · ${r.inn} innings` : ""}
          {r.manual ? " · ★ played in the ballpark" : ""}
        </p>
      </header>

      <div className="-mx-1 overflow-x-auto px-1">
        <table className="min-w-max border-collapse text-sm tabular-nums">
          <thead>
            <tr className="text-[11px] text-secondary">
              <th className="px-2 py-1 text-left font-medium" />
              {Array.from({ length: n }, (_, i) => (
                <th key={i} className="w-7 px-1 py-1 text-center font-medium">
                  {i + 1}
                </th>
              ))}
              <th className="w-8 border-l border-border px-1 py-1 text-center font-semibold">R</th>
              <th className="w-8 px-1 py-1 text-center font-semibold">H</th>
              <th className="w-8 px-1 py-1 text-center font-semibold">E</th>
            </tr>
          </thead>
          <tbody>
            {[away, home].map((t, s) => (
              <tr key={t.id} className="border-t border-border/60">
                <td className="whitespace-nowrap px-2 py-1 font-medium">
                  <T id={t.id} className="inline-flex items-center gap-1.5">
                    <TeamLogo teamId={t.id} size={16} title={t.abbrev} />
                    {t.abbrev}
                  </T>
                </td>
                {Array.from({ length: n }, (_, i) => {
                  const v = line?.[s][i];
                  return (
                    <td key={i} className="px-1 py-1 text-center">
                      {v == null ? (s === 1 && line ? "x" : "") : v}
                    </td>
                  );
                })}
                <td className="border-l border-border px-1 py-1 text-center font-bold">{s ? r.hs : r.as}</td>
                <td className="px-1 py-1 text-center">{box ? hits[s] : ""}</td>
                <td className="px-1 py-1 text-center">{box ? err[s] : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-1 text-xs text-secondary">
          {r.wp && (
            <>
              WP: <P id={r.wp} />
            </>
          )}
          {r.lp && (
            <>
              {" · "}LP: <P id={r.lp} />
            </>
          )}
          {r.sv && (
            <>
              {" · "}SV: <P id={r.sv} />
            </>
          )}
        </p>
      </div>

      {!box ? (
        <p className="text-sm text-secondary">No box score was kept for this game (it was played before box scores were recorded).</p>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            {[away, home].map((t, s) => (
              <BattingBox key={t.id} title={<><T id={t.id}>{t.name}</T> Batting</>} rows={box.bat[s as 0 | 1]} P={P} />
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {[away, home].map((t, s) => (
              <PitchingBox key={t.id} title={<><T id={t.id}>{t.name}</T> Pitching</>} rows={box.pit[s as 0 | 1]} P={P} dec={r} />
            ))}
          </div>
          <ScoringPlays box={box} rows={plays} league={league} game={game} P={P} T={T} />
          <PlayByPlay box={box} rows={plays} league={league} game={game} P={P} T={T} />
        </>
      )}
    </div>
  );
}

type PComp = (props: { id: number; className?: string }) => ReactNode;
type TComp = (props: { id: number; children: ReactNode; className?: string }) => ReactNode;

const thc = "border-b border-border px-1.5 py-1 text-right text-[11px] font-semibold uppercase tracking-wide text-secondary";
const tdc = "border-b border-border/40 px-1.5 py-[3px] text-right";

function BattingBox({ title, rows, P }: { title: ReactNode; rows: BoxBat[]; P: PComp }) {
  const tot = rows.reduce((t, b) => t.map((v, i) => v + (b[i + 2] as number)), [0, 0, 0, 0, 0, 0]);
  const notes: Array<[string, number]> = [
    ["2B", 9],
    ["3B", 10],
    ["HR", 8],
    ["SB", 11],
    ["CS", 12],
    ["HBP", 13],
    ["SF", 14],
  ];
  return (
    <section>
      <h3 className="mb-1 text-sm font-semibold">{title}</h3>
      <table className="w-full border-collapse text-[13px] tabular-nums">
        <thead>
          <tr>
            <th className={cn(thc, "text-left")}>Batting</th>
            {["AB", "R", "H", "RBI", "BB", "SO"].map((h) => (
              <th key={h} className={thc}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => (
            <tr key={b[0]} className="hover:bg-hover/60">
              <td className={cn(tdc, "text-left")}>
                <P id={b[0]} /> <span className="text-[11px] text-muted">{b[1]}</span>
              </td>
              {[2, 3, 4, 5, 6, 7].map((k) => (
                <td key={k} className={tdc}>
                  {b[k]}
                </td>
              ))}
            </tr>
          ))}
          <tr className="font-semibold">
            <td className={cn(tdc, "text-left")}>Team Totals</td>
            {tot.map((v, i) => (
              <td key={i} className={tdc}>
                {v}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      <div className="mt-1 space-y-0.5 text-[11px] text-secondary">
        {notes.map(([label, k]) => {
          const who = rows.filter((b) => (b[k] as number) > 0);
          if (!who.length) return null;
          return (
            <p key={label}>
              <b>{label}:</b>{" "}
              {who.map((b, i) => (
                <Fragment key={b[0]}>
                  {i > 0 && "; "}
                  <P id={b[0]} />
                  {(b[k] as number) > 1 ? ` (${b[k]})` : ""}
                </Fragment>
              ))}
              .
            </p>
          );
        })}
      </div>
    </section>
  );
}

function PitchingBox({ title, rows, P, dec }: { title: ReactNode; rows: BoxPit[]; P: PComp; dec: { wp?: number; lp?: number; sv?: number } }) {
  const tot = rows.reduce((t, p) => t.map((v, i) => v + p[i + 1]), [0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const tag = (id: number) => (id === dec.wp ? ", W" : id === dec.lp ? ", L" : id === dec.sv ? ", S" : "");
  const cells = (p: number[]) => [ipFmt(p[0] / 3), p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8]];
  return (
    <section>
      <h3 className="mb-1 text-sm font-semibold">{title}</h3>
      <table className="w-full border-collapse text-[13px] tabular-nums">
        <thead>
          <tr>
            <th className={cn(thc, "text-left")}>Pitching</th>
            {["IP", "H", "R", "ER", "BB", "SO", "HR", "Pit", "BF"].map((h) => (
              <th key={h} className={thc}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p[0]} className="hover:bg-hover/60">
              <td className={cn(tdc, "text-left")}>
                <P id={p[0]} />
                <span className="text-secondary">{tag(p[0])}</span>
              </td>
              {cells(p.slice(1)).map((v, i) => (
                <td key={i} className={tdc}>
                  {v}
                </td>
              ))}
            </tr>
          ))}
          <tr className="font-semibold">
            <td className={cn(tdc, "text-left")}>Team Totals</td>
            {cells(tot).map((v, i) => (
              <td key={i} className={tdc}>
                {v}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </section>
  );
}

interface PlaysProps {
  box: GameBox;
  rows: Row[];
  league: League;
  game: ScheduledGame;
  P: PComp;
  T: TComp;
}

/** Names of everyone in the box, longest first, for linking names inside play text. */
function boxNames(box: GameBox, league: League): Array<[string, number]> {
  const ids = new Set<number>();
  for (const side of [0, 1] as const) {
    for (const b of box.bat[side]) ids.add(b[0]);
    for (const q of box.pit[side]) ids.add(q[0]);
  }
  return [...ids].map((id) => [league.players[id]?.name ?? "", id] as [string, number]).filter(([n]) => n.length > 3).sort((a, b) => b[0].length - a[0].length);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Text with each player's full name turned into a profile link. */
function linkNames(text: string, names: Array<[string, number]>, P: PComp): ReactNode {
  if (!names.length) return text;
  const byName = new Map(names);
  const re = new RegExp(`(${names.map(([n]) => escapeRe(n)).join("|")})`, "g");
  const parts = text.split(re);
  if (parts.length === 1) return text;
  return parts.map((part, i) => {
    const id = i % 2 === 1 ? byName.get(part) : undefined;
    return id != null ? <P key={i} id={id} /> : part;
  });
}

function playText(box: GameBox, row: Row, game: ScheduledGame, league: League, P: PComp, names: Array<[string, number]>): ReactNode {
  if (box.txt) return linkNames(box.txt[row.i], names, P);
  const p = row.play;
  if (p.code === PLAY.SB || p.code === PLAY.CS) {
    // The runner went from first to second unless first was empty before the play.
    const bag = row.bases != null && row.bases & 1 ? "2B" : "3B";
    const rid = batterId(box, p);
    const runner = rid != null ? <P id={rid} /> : "Runner";
    return (
      <>
        {runner} {p.code === PLAY.SB ? "steals" : "caught stealing"} {bag}
      </>
    );
  }
  const base = describePlay(p, game.id * 131 + row.i);
  if (p.code === PLAY.HR || !p.runs) return base;
  return `${base}; ${p.runs} run${p.runs > 1 ? "s" : ""} score${p.runs > 1 ? "" : "s"}`;
}

const batterId = (box: GameBox, p: Play) => box.bat[p.bottom ? 1 : 0][p.batter]?.[0];
const pitcherId = (box: GameBox, p: Play, idx = p.pitcher) => box.pit[p.bottom ? 0 : 1][idx]?.[0];

function ScoringPlays({ box, rows, league, game, P, T }: PlaysProps) {
  const names = useMemo(() => (box.txt ? boxNames(box, league) : []), [box, league]);
  const scoring = rows.filter((r) => r.play.runs > 0);
  if (!scoring.length) return null;
  const abbr = [league.teams[game.away].abbrev, league.teams[game.home].abbrev];
  return (
    <section>
      <h3 className="mb-1 text-sm font-semibold">Scoring Plays</h3>
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr>
            {["Inn", "Score", "Batter", "Play Description"].map((h) => (
              <th key={h} className={cn(thc, "text-left")}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {scoring.map((r) => {
            const after: [number, number] = [r.score[0] + (r.play.bottom ? 0 : r.play.runs), r.score[1] + (r.play.bottom ? r.play.runs : 0)];
            const b = batterId(box, r.play);
            return (
              <tr key={r.i}>
                <td className={cn(tdc, "whitespace-nowrap text-left text-secondary")}>
                  {r.play.bottom ? "b" : "t"}
                  {r.play.inning}
                </td>
                <td className={cn(tdc, "whitespace-nowrap text-left tabular-nums")}>
                  <T id={game.away}>{abbr[0]}</T> {after[0]}, <T id={game.home}>{abbr[1]}</T> {after[1]}
                </td>
                <td className={cn(tdc, "whitespace-nowrap text-left")}>{b != null && <P id={b} />}</td>
                <td className={cn(tdc, "text-left")}>{playText(box, r, game, league, P, names)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function PlayByPlay({ box, rows, league, game, P, T }: PlaysProps) {
  const names = useMemo(() => (box.txt ? boxNames(box, league) : []), [box, league]);
  const away = league.teams[game.away];
  const home = league.teams[game.home];
  const out: ReactNode[] = [];
  let half = "";
  for (const r of rows) {
    const p = r.play;
    const key = `${p.inning}${p.bottom}`;
    const bat = p.bottom ? home : away;
    const fld = p.bottom ? away : home;
    if (key !== half) {
      half = key;
      const [a, h] = r.score;
      const leader = a > h ? away : home;
      const lead = a === h ? <>Tied {a}-{h}</> : <><T id={leader.id}>{leader.name}</T> {Math.max(a, h)}-{Math.min(a, h)}</>;
      const pid = pitcherId(box, p);
      out.push(
        <tr key={`h${key}`} className="bg-hover/70">
          <td colSpan={7} className="px-1.5 py-1 text-xs font-semibold">
            {p.bottom ? "Bottom" : "Top"} of the {ordinal(p.inning)}, <T id={bat.id}>{bat.name}</T> Batting, {lead}, <T id={fld.id}>{fld.abbrev}</T>&apos;{fld.abbrev.endsWith("s") ? "" : "s"} {pid != null ? <P id={pid} /> : "—"} facing
          </td>
        </tr>,
      );
    } else if (r.change) {
      const from = pitcherId(box, p, r.change.from);
      const to = pitcherId(box, p, r.change.to);
      out.push(
        <tr key={`c${r.i}`}>
          <td colSpan={7} className="border-b border-border/40 px-1.5 py-[3px] text-xs italic text-secondary">
            Pitching change: {to != null ? <P id={to} /> : "—"} replaces {from != null ? <P id={from} /> : "—"}.
          </td>
        </tr>,
      );
    }
    const b = batterId(box, p);
    const pid = pitcherId(box, p);
    const pa = isPA(p.code);
    out.push(
      <tr key={r.i} className={cn("hover:bg-hover/60", p.runs > 0 && "bg-emerald-500/[0.07]")}>
        <td className={cn(tdc, "whitespace-nowrap text-left text-secondary")}>
          {p.bottom ? "b" : "t"}
          {p.inning}
        </td>
        <td className={cn(tdc, "whitespace-nowrap text-left tabular-nums")}>
          {r.score[0]}-{r.score[1]}
        </td>
        <td className={cn(tdc, "text-center")}>{r.outs}</td>
        <td className={cn(tdc, "text-center font-mono text-[12px]")}>{r.bases == null ? "" : robStr(r.bases)}</td>
        <td className={cn(tdc, "whitespace-nowrap text-left")}>{b != null && pa ? <P id={b} /> : ""}</td>
        <td className={cn(tdc, "whitespace-nowrap text-left")}>{pid != null && pa ? <P id={pid} className="text-secondary" /> : ""}</td>
        <td className={cn(tdc, "text-left", p.runs > 0 && "font-semibold")}>{playText(box, r, game, league, P, names)}</td>
      </tr>,
    );
  }
  return (
    <section>
      <h3 className="mb-1 text-sm font-semibold">Play by Play</h3>
      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full min-w-[640px] border-collapse text-[13px]">
          <thead>
            <tr>
              {["Inn", "Score", "Out", "RoB", "Batter", "Pitcher", "Play Description"].map((h) => (
                <th key={h} className={cn(thc, h === "Out" || h === "RoB" ? "text-center" : "text-left")}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{out}</tbody>
        </table>
      </div>
      <p className="mt-1 text-[11px] text-muted">Score is away-home before the play. RoB = runners on base before the play.</p>
    </section>
  );
}

const name = (league: League, id: number) => league.players[id]?.name ?? "—";
