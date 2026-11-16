"use client";

import { divisionStandings, gamesBack, lastTen, pct, streak, wildCardRace } from "@/lib/game/franchise/standings";
import type { MLBDivision, MLBLeague } from "@/lib/mlb/teams";
import type { TeamState } from "@/lib/game/franchise/types";
import { cn } from "@/lib/utils";
import { Card, Table, TeamDot, td, th, type TabProps } from "../ui";

const DIVS: MLBDivision[] = ["East", "Central", "West"];

function Rows({ teams, me, gb }: { teams: TeamState[]; me: number; gb: (t: TeamState) => string }) {
  return (
    <Table>
      <thead>
        <tr>
          <th className={th}>Team</th>
          <th className={th}>W</th>
          <th className={th}>L</th>
          <th className={th}>Pct</th>
          <th className={th}>GB</th>
          <th className={th}>Diff</th>
          <th className={th}>Strk</th>
          <th className={th}>L10</th>
        </tr>
      </thead>
      <tbody>
        {teams.map((t) => (
          <tr key={t.id} className={cn(t.id === me && "bg-emerald-500/10")}>
            <td className={td}>
              <TeamDot id={t.id} abbrev={t.abbrev} />
            </td>
            <td className={td}>{t.w}</td>
            <td className={td}>{t.l}</td>
            <td className={td}>{pct(t).toFixed(3).replace(/^0/, "")}</td>
            <td className={td}>{gb(t)}</td>
            <td className={cn(td, t.rs - t.ra >= 0 ? "text-emerald-500" : "text-red-500")}>
              {t.rs - t.ra >= 0 ? "+" : ""}
              {t.rs - t.ra}
            </td>
            <td className={td}>{streak(t) || "—"}</td>
            <td className={td}>{lastTen(t)}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export function StandingsTab({ league }: TabProps) {
  const me = league.userTeam;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {(["AL", "NL"] as MLBLeague[]).map((lg) => {
        const wc = wildCardRace(league, lg);
        return (
          <div key={lg} className="space-y-4">
            {DIVS.map((d) => {
              const rows = divisionStandings(league, lg, d);
              return (
                <Card key={d} title={`${lg} ${d}`}>
                  <Rows teams={rows} me={me} gb={(t) => (t.id === rows[0].id ? "—" : gamesBack(rows[0], t).toFixed(1))} />
                </Card>
              );
            })}
            <Card title={`${lg} Wild Card`}>
              <Rows teams={wc.map((x) => x.t)} me={me} gb={(t) => {
                const g = wc.find((x) => x.t.id === t.id)?.gb ?? 0;
                return g === 0 ? "—" : g < 0 ? `+${(-g).toFixed(1)}` : g.toFixed(1);
              }} />
              <p className="mt-2 text-xs text-secondary">Division winners plus three wild cards per league reach the postseason; the top two seeds get a bye.</p>
            </Card>
          </div>
        );
      })}
    </div>
  );
}
