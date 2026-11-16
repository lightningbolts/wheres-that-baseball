"use client";

import { useState } from "react";
import { avg, battingLeaders, batWar, era, fip, fmt3, ipStr, k9, obp, ops, pitchingLeaders, pitWar, slg, whip, type BatStatKey, type PitStatKey } from "@/lib/game/franchise/stats";
import type { League, Player } from "@/lib/game/franchise/types";
import type { MLBLeague } from "@/lib/mlb/teams";
import { cn } from "@/lib/utils";
import { Card, Segmented, Table, TeamDot, td, th, type TabProps } from "../ui";

const BAT: Array<{ k: BatStatKey; label: string; fmt: (v: number) => string }> = [
  { k: "avg", label: "AVG", fmt: fmt3 },
  { k: "hr", label: "HR", fmt: String },
  { k: "rbi", label: "RBI", fmt: String },
  { k: "ops", label: "OPS", fmt: fmt3 },
  { k: "sb", label: "SB", fmt: String },
  { k: "war", label: "WAR", fmt: (v) => v.toFixed(1) },
];
const PIT: Array<{ k: PitStatKey; label: string; fmt: (v: number) => string }> = [
  { k: "era", label: "ERA", fmt: (v) => v.toFixed(2) },
  { k: "w", label: "W", fmt: String },
  { k: "k", label: "SO", fmt: String },
  { k: "sv", label: "SV", fmt: String },
  { k: "whip", label: "WHIP", fmt: (v) => v.toFixed(2) },
  { k: "war", label: "WAR", fmt: (v) => v.toFixed(1) },
];

function Leader({ league, rows, fmt }: { league: League; rows: Array<{ id: number; value: number }>; fmt: (v: number) => string }) {
  return (
    <ol className="space-y-0.5 text-sm">
      {rows.map((r, i) => {
        const p = league.players[r.id];
        const t = league.teams[p?.team];
        return (
          <li key={r.id} className={cn("flex items-center justify-between gap-2", p?.team === league.userTeam && "text-emerald-500")}>
            <span className="truncate">
              <span className="mr-1 text-muted">{i + 1}.</span>
              {p?.name} {t && <span className="text-xs text-secondary">{t.abbrev}</span>}
            </span>
            <span className="tabular-nums">{fmt(r.value)}</span>
          </li>
        );
      })}
      {!rows.length && <li className="text-secondary">No qualifiers yet.</li>}
    </ol>
  );
}

function TeamBatting({ league, players }: { league: League; players: Player[] }) {
  const rows = players.filter((p) => p.stats.bat?.pa).sort((a, b) => (b.stats.bat?.pa ?? 0) - (a.stats.bat?.pa ?? 0));
  return (
    <Table>
      <thead>
        <tr>
          {["Player", "G", "PA", "AVG", "OBP", "SLG", "HR", "RBI", "R", "SB", "BB", "SO", "WAR"].map((h) => (
            <th key={h} className={th}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => {
          const s = p.stats.bat!;
          return (
            <tr key={p.id}>
              <td className={cn(td, "whitespace-nowrap")}>
                {p.name} <span className="text-xs text-secondary">{p.pos}</span>
                
              </td>
              <td className={td}>{s.g}</td>
              <td className={td}>{s.pa}</td>
              <td className={td}>{fmt3(avg(s))}</td>
              <td className={td}>{fmt3(obp(s))}</td>
              <td className={td}>{fmt3(slg(s))}</td>
              <td className={td}>{s.hr}</td>
              <td className={td}>{s.rbi}</td>
              <td className={td}>{s.r}</td>
              <td className={td}>{s.sb}</td>
              <td className={td}>{s.bb}</td>
              <td className={td}>{s.k}</td>
              <td className={td}>{batWar(p, s).toFixed(1)}</td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}

function TeamPitching({ players }: { players: Player[] }) {
  const rows = players.filter((p) => p.stats.pit?.outs).sort((a, b) => (b.stats.pit?.outs ?? 0) - (a.stats.pit?.outs ?? 0));
  return (
    <Table>
      <thead>
        <tr>
          {["Pitcher", "G", "GS", "W", "L", "SV", "HLD", "IP", "ERA", "FIP", "WHIP", "K/9", "SO", "BB", "HR", "WAR"].map((h) => (
            <th key={h} className={th}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => {
          const s = p.stats.pit!;
          return (
            <tr key={p.id}>
              <td className={cn(td, "whitespace-nowrap")}>{p.name}</td>
              <td className={td}>{s.g}</td>
              <td className={td}>{s.gs}</td>
              <td className={td}>{s.w}</td>
              <td className={td}>{s.l}</td>
              <td className={td}>{s.sv}</td>
              <td className={td}>{s.hld}</td>
              <td className={td}>{ipStr(s)}</td>
              <td className={td}>{era(s).toFixed(2)}</td>
              <td className={td}>{fip(s).toFixed(2)}</td>
              <td className={td}>{whip(s).toFixed(2)}</td>
              <td className={td}>{k9(s).toFixed(1)}</td>
              <td className={td}>{s.k}</td>
              <td className={td}>{s.bb}</td>
              <td className={td}>{s.hr}</td>
              <td className={td}>{pitWar(s).toFixed(1)}</td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}

export function StatsTab({ league }: TabProps) {
  const [lg, setLg] = useState<"MLB" | MLBLeague>("MLB");
  const [view, setView] = useState<"leaders" | "team" | "awards">("leaders");
  const scope = lg === "MLB" ? undefined : lg;
  const mine = Object.values(league.players).filter((p) => p.team === league.userTeam);
  const name = (id: number) => {
    const p = league.players[id];
    return p ? `${p.name} (${league.teams[p.team]?.abbrev ?? "FA"})` : "—";
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { v: "leaders", label: "League leaders" },
            { v: "team", label: "My team" },
            { v: "awards", label: "Awards & history" },
          ]}
        />
        {view === "leaders" && (
          <Segmented
            value={lg}
            onChange={setLg}
            options={[
              { v: "MLB", label: "MLB" },
              { v: "AL", label: "AL" },
              { v: "NL", label: "NL" },
            ]}
          />
        )}
      </div>
      {view === "leaders" && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {BAT.map((b) => (
            <Card key={b.k} title={b.label}>
              <Leader league={league} rows={battingLeaders(league, b.k, scope, 8)} fmt={b.fmt} />
            </Card>
          ))}
          {PIT.map((b) => (
            <Card key={`p${b.k}`} title={`${b.label} (pitching)`}>
              <Leader league={league} rows={pitchingLeaders(league, b.k, scope, 8)} fmt={b.fmt} />
            </Card>
          ))}
        </div>
      )}
      {view === "team" && (
        <>
          <Card title="Batting">
            <TeamBatting league={league} players={mine} />
          </Card>
          <Card title="Pitching">
            <TeamPitching players={mine} />
          </Card>
        </>
      )}
      {view === "awards" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Awards">
            {league.awards.length ? (
              <Table>
                <thead>
                  <tr>
                    <th className={th}>Year</th>
                    <th className={th}>Lg</th>
                    <th className={th}>MVP</th>
                    <th className={th}>Cy Young</th>
                    <th className={th}>Rookie</th>
                  </tr>
                </thead>
                <tbody>
                  {[...league.awards].reverse().flatMap((a) =>
                    (["AL", "NL"] as const).map((x) => (
                      <tr key={`${a.season}${x}`}>
                        <td className={td}>{a.season}</td>
                        <td className={td}>{x}</td>
                        <td className={cn(td, "whitespace-nowrap")}>{name(a.mvp[x])}</td>
                        <td className={cn(td, "whitespace-nowrap")}>{name(a.cy[x])}</td>
                        <td className={cn(td, "whitespace-nowrap")}>{name(a.roy[x])}</td>
                      </tr>
                    )),
                  )}
                </tbody>
              </Table>
            ) : (
              <p className="text-sm text-secondary">Awards are announced when the regular season ends.</p>
            )}
          </Card>
          <Card title="Champions">
            {league.champions.length ? (
              <ul className="space-y-1 text-sm">
                {[...league.champions].reverse().map((c) => (
                  <li key={c.season} className="flex items-center gap-2">
                    <span className="text-secondary">{c.season}</span>
                    <TeamDot id={c.team} abbrev={league.teams[c.team]?.name ?? String(c.team)} />
                    <span className="text-xs text-secondary">over {league.teams[c.runnerUp]?.abbrev}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-secondary">No champions crowned yet.</p>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
