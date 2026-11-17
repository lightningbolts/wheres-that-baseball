"use client";

import { useState } from "react";
import { remainingOwed } from "@/lib/game/franchise/contracts";
import { activateFromIL, callUp, dfa, fortyMan, optionDown, orgPlayers, placeOnIL, release, repairDepth, ACTIVE_MAX, FORTY_MAX, type TxResult } from "@/lib/game/franchise/roster";
import { avg, era, ipStr, ops } from "@/lib/game/franchise/stats";
import type { League, Player } from "@/lib/game/franchise/types";
import { cn } from "@/lib/utils";
import { Card, contractStr, injuryStr, Ovr, SmallBtn, Table, td, th, type Act, type TabProps } from "../ui";

function statLine(p: Player): string {
  if (p.pitcher && p.stats.pit?.outs) {
    const s = p.stats.pit;
    return `${s.w}-${s.l}${s.sv ? `, ${s.sv} SV` : ""}, ${era(s).toFixed(2)} ERA, ${ipStr(s)} IP, ${s.k} K`;
  }
  if (!p.pitcher && p.stats.bat?.pa) {
    const s = p.stats.bat;
    return `${avg(s).toFixed(3).replace(/^0/, "")}, ${s.hr} HR, ${s.rbi} RBI, ${ops(s).toFixed(3).replace(/^0/, "")} OPS`;
  }
  return "—";
}

function tx(act: Act, fn: (l: League) => TxResult, teamId: number) {
  act((l) => {
    const r = fn(l);
    if (r.ok) repairDepth(l, teamId);
    return r.msg;
  });
}

function Rows({ league, players, act, kind }: { league: League; players: Player[]; act: Act; kind: "active" | "il" | "minors40" | "minors" }) {
  const [confirm, setConfirm] = useState<number | null>(null);
  const me = league.userTeam;
  return (
    <Table>
      <thead>
        <tr>
          <th className={th}>Player</th>
          <th className={th}>Pos</th>
          <th className={th}>Age</th>
          <th className={th}>OVR</th>
          <th className={th}>POT</th>
          <th className={th}>Contract</th>
          <th className={th}>Svc / Opt</th>
          <th className={th}>{league.phase === "regular" || league.phase === "postseason" ? `${league.season} stats` : "Last"}</th>
          <th className={th}>Moves</th>
        </tr>
      </thead>
      <tbody>
        {players.map((p) => {
          const inj = injuryStr(p);
          return (
            <tr key={p.id}>
              <td className={cn(td, "whitespace-nowrap")}>
                <div className="font-medium">{p.name}</div>
                <div className="text-[11px] text-secondary">
                  {p.bats}/{p.throws}
                  {p.rookie ? " · rookie" : ""}
                  {p.draft ? ` · ${p.draft.season} draft rd ${p.draft.round}` : ""}
                  {inj ? <span className="text-red-500"> · {inj}</span> : null}
                </div>
              </td>
              <td className={td}>{p.pos}</td>
              <td className={td}>{p.age}</td>
              <td className={td}>
                <Ovr v={p.ovr} />
              </td>
              <td className={td}>
                <Ovr v={p.pot} className="font-normal" />
              </td>
              <td className={cn(td, "whitespace-nowrap")}>{contractStr(p)}</td>
              <td className={cn(td, "whitespace-nowrap text-secondary")}>
                {p.service.toFixed(1)} / {p.options}
              </td>
              <td className={cn(td, "whitespace-nowrap text-xs")}>{statLine(p)}</td>
              <td className={cn(td, "whitespace-nowrap")}>
                <div className="flex gap-1">
                  {kind === "active" && (
                    <>
                      {inj && <SmallBtn onClick={() => tx(act, (l) => placeOnIL(l, p.id), me)}>IL</SmallBtn>}
                      <SmallBtn onClick={() => tx(act, (l) => optionDown(l, p.id), me)}>Option</SmallBtn>
                    </>
                  )}
                  {kind === "il" && <SmallBtn onClick={() => tx(act, (l) => activateFromIL(l, p.id), me)}>Activate</SmallBtn>}
                  {(kind === "minors40" || kind === "minors") && <SmallBtn onClick={() => tx(act, (l) => callUp(l, p.id), me)}>Call up</SmallBtn>}
                  {p.on40 && <SmallBtn onClick={() => tx(act, (l) => dfa(l, p.id), me)}>DFA</SmallBtn>}
                  {confirm === p.id ? (
                    <SmallBtn
                      className="border-red-500/50 text-red-500"
                      onClick={() => {
                        setConfirm(null);
                        tx(act, (l) => release(l, p.id), me);
                      }}
                    >
                      Release ({p.contract.aav > 0.85 && p.contract.kind !== "minor" ? `eat $${remainingOwed(p.contract).toFixed(1)}M` : "free"})?
                    </SmallBtn>
                  ) : (
                    <SmallBtn onClick={() => setConfirm(p.id)}>Release</SmallBtn>
                  )}
                </div>
              </td>
            </tr>
          );
        })}
        {!players.length && (
          <tr>
            <td className={td} colSpan={9}>
              <span className="text-secondary">None.</span>
            </td>
          </tr>
        )}
      </tbody>
    </Table>
  );
}

export function RosterTab({ league, act }: TabProps) {
  const me = league.userTeam;
  const org = orgPlayers(league, me).sort((a, b) => Number(a.pitcher) - Number(b.pitcher) || b.ovr - a.ovr);
  const active = org.filter((p) => p.status === "active");
  const il = org.filter((p) => p.status === "il");
  const m40 = org.filter((p) => p.status === "minors" && p.on40);
  const minors = org.filter((p) => p.status === "minors" && !p.on40).sort((a, b) => b.pot - a.pot);
  const forty = fortyMan(league, me).length;
  const pitchers = active.filter((p) => p.pitcher).length;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className={cn(active.length !== ACTIVE_MAX && "text-amber-500")}>
          Active {active.length}/{ACTIVE_MAX} ({pitchers} pitchers)
        </span>
        <span className={cn(forty > FORTY_MAX && "text-red-500")}>
          40-man {forty}/{FORTY_MAX}
        </span>
        <label className="ml-auto flex items-center gap-1.5 text-xs text-secondary">
          <input
            type="checkbox"
            checked={league.settings.autoRoster}
            onChange={(e) => {
              const v = e.target.checked;
              act((l) => {
                l.settings.autoRoster = v;
                return v ? "Injury replacements and IL returns will be handled for you." : "You'll handle IL returns yourself.";
              });
            }}
          />
          Auto-manage IL moves
        </label>
      </div>
      <p className="text-xs text-secondary">
        Option sends a player to Triple-A (needs options, under 5 years of service). DFA removes him from the 40-man: other clubs may claim him on waivers.
        Releasing a player keeps his salary on your books as dead money. Open spots are filled automatically when you sim.
      </p>
      <Card title="Active roster">
        <Rows league={league} players={active} act={act} kind="active" />
      </Card>
      {il.length > 0 && (
        <Card title="Injured list">
          <Rows league={league} players={il} act={act} kind="il" />
        </Card>
      )}
      <Card title="Triple-A: 40-man">
        <Rows league={league} players={m40} act={act} kind="minors40" />
      </Card>
      <Card title="Minor leaguers and prospects">
        <Rows league={league} players={minors} act={act} kind="minors" />
      </Card>
    </div>
  );
}
