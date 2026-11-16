"use client";

import { useMemo, useState } from "react";
import { fmtDate } from "@/lib/game/franchise/schedule";
import { gamesOn } from "@/lib/game/franchise/season";
import { divisionStandings, gamesBack, lastTen, streak } from "@/lib/game/franchise/standings";
import type { League, ScheduledGame } from "@/lib/game/franchise/types";
import { cn } from "@/lib/utils";
import { Btn, Card, Segmented, Stat, Table, TeamDot, td, th, type TabProps } from "../ui";

function GameRow({ league, g, onPlay }: { league: League; g: ScheduledGame; onPlay?: (id: number) => void }) {
  const me = league.userTeam;
  const home = g.home === me;
  const opp = league.teams[home ? g.away : g.home];
  const r = g.result;
  const won = r ? (home ? r.hs > r.as : r.as > r.hs) : null;
  const n = (id?: number) => (id ? league.players[id]?.name.split(" ").slice(-1)[0] : null);
  return (
    <tr>
      <td className={cn(td, "whitespace-nowrap text-secondary")}>{fmtDate(league.calendar, g.day)}</td>
      <td className={cn(td, "whitespace-nowrap")}>
        {g.ps && <span className="mr-1 rounded bg-emerald-500/15 px-1 text-[10px] uppercase text-emerald-500">{g.ps}</span>}
        {home ? "vs" : "@"} <TeamDot id={opp.id} abbrev={opp.abbrev} />
      </td>
      <td className={cn(td, "whitespace-nowrap")}>
        {r ? (
          <span className={won ? "text-emerald-500" : "text-red-500"}>
            {won ? "W" : "L"} {home ? `${r.hs}-${r.as}` : `${r.as}-${r.hs}`}
            {r.inn > 9 ? ` (${r.inn})` : ""}
            {r.manual ? " ★" : ""}
          </span>
        ) : g.day === league.day && onPlay ? (
          <Btn tone="primary" className="px-2 py-0.5 text-xs" onClick={() => onPlay(g.id)}>
            Play
          </Btn>
        ) : (
          <span className="text-muted">—</span>
        )}
      </td>
      <td className={cn(td, "whitespace-nowrap text-xs text-secondary")}>
        {r && [r.wp && `W: ${n(r.wp)}`, r.lp && `L: ${n(r.lp)}`, r.sv && `S: ${n(r.sv)}`].filter(Boolean).join(" · ")}
      </td>
    </tr>
  );
}

export function Dashboard({ league, onPlay }: TabProps & { onPlay: (id: number) => void }) {
  const me = league.teams[league.userTeam];
  const [view, setView] = useState<"upcoming" | "results" | "all">("upcoming");
  const mine = useMemo(() => league.schedule.filter((g) => g.home === me.id || g.away === me.id).sort((a, b) => a.day - b.day), [league.schedule, me.id]);
  const shown = view === "upcoming" ? mine.filter((g) => !g.result).slice(0, 15) : view === "results" ? mine.filter((g) => g.result).slice(-20).reverse() : mine;
  const div = divisionStandings(league, me.league, me.division);
  const leader = div[0];
  const today = gamesOn(league, league.day);
  const yesterday = gamesOn(league, league.day - 1).filter((g) => g.result);
  const board = today.some((g) => g.result) ? today : yesterday;
  const rd = me.rs - me.ra;
  const news = league.news.slice(-40).reverse();
  const exp = league.expected?.[me.id];

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Record" value={`${me.w}-${me.l}`} sub={exp ? `projected ${exp} W` : undefined} />
          <Stat label="Run diff" value={`${rd >= 0 ? "+" : ""}${rd}`} sub={`${me.rs} RS · ${me.ra} RA`} />
          <Stat label="Division" value={leader.id === me.id ? "1st" : `${gamesBack(leader, me).toFixed(1)} GB`} sub={`${me.league} ${me.division}`} />
          <Stat label="Streak / L10" value={streak(me) || "—"} sub={lastTen(me)} />
        </div>
        <Card
          title="Schedule"
          right={
            <Segmented
              value={view}
              onChange={setView}
              options={[
                { v: "upcoming", label: "Upcoming" },
                { v: "results", label: "Results" },
                { v: "all", label: "Full" },
              ]}
            />
          }
        >
          <div className={cn(view === "all" && "max-h-[28rem] overflow-y-auto")}>
            <Table>
              <tbody>
                {shown.map((g) => (
                  <GameRow key={g.id} league={league} g={g} onPlay={onPlay} />
                ))}
                {!shown.length && (
                  <tr>
                    <td className={td} colSpan={4}>
                      <span className="text-secondary">No games.</span>
                    </td>
                  </tr>
                )}
              </tbody>
            </Table>
          </div>
          <p className="mt-2 text-xs text-muted">★ played manually</p>
        </Card>
        {board.length > 0 && (
          <Card title={board === today ? "Today's scores" : "Yesterday's scores"}>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {board.map((g) => {
                const a = league.teams[g.away];
                const h = league.teams[g.home];
                return (
                  <div key={g.id} className="rounded-md border border-border px-2 py-1 text-xs tabular-nums">
                    <div className="flex justify-between">
                      <TeamDot id={a.id} abbrev={a.abbrev} />
                      <span>{g.result?.as ?? ""}</span>
                    </div>
                    <div className="flex justify-between">
                      <TeamDot id={h.id} abbrev={h.abbrev} />
                      <span>{g.result?.hs ?? ""}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        )}
      </div>
      <div className="space-y-4">
        <Card title={`${me.league} ${me.division}`}>
          <Table>
            <thead>
              <tr>
                <th className={th}>Team</th>
                <th className={th}>W</th>
                <th className={th}>L</th>
                <th className={th}>GB</th>
              </tr>
            </thead>
            <tbody>
              {div.map((t) => (
                <tr key={t.id} className={cn(t.id === me.id && "bg-emerald-500/10")}>
                  <td className={td}>
                    <TeamDot id={t.id} abbrev={t.abbrev} />
                  </td>
                  <td className={td}>{t.w}</td>
                  <td className={td}>{t.l}</td>
                  <td className={td}>{t.id === leader.id ? "—" : gamesBack(leader, t).toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
        <Card title="News">
          <ul className="max-h-[32rem] space-y-1.5 overflow-y-auto text-sm">
            {news.map((n, i) => (
              <li key={i} className={cn("border-b border-border/50 pb-1.5", n.team === me.id && "text-foreground", n.team !== me.id && "text-secondary")}>
                {n.text}
              </li>
            ))}
            {!news.length && <li className="text-secondary">Nothing yet.</li>}
          </ul>
        </Card>
      </div>
    </div>
  );
}
