"use client";

import { useMemo, useState } from "react";
import { payroll } from "@/lib/game/franchise/contracts";
import { orgPlayers } from "@/lib/game/franchise/roster";
import { tradesOpen } from "@/lib/game/franchise/season";
import { evaluateTrade, executeTrade, suggestPackage, tradeValue } from "@/lib/game/franchise/trades";
import type { League, Player } from "@/lib/game/franchise/types";
import { cn } from "@/lib/utils";
import { Btn, Card, contractStr, money, Ovr, Table, TeamDot, td, th, type TabProps } from "../ui";

const STRAT = { contend: "Contending: wants proven players now", neutral: "Middle of the pack", rebuild: "Rebuilding: wants young, cheap talent" };

function PickList({ league, players, picked, toggle, valueFor }: { league: League; players: Player[]; picked: number[]; toggle: (id: number) => void; valueFor: number }) {
  return (
    <div className="max-h-[26rem] overflow-y-auto">
      <Table>
        <thead>
          <tr>
            <th className={th} />
            <th className={th}>Player</th>
            <th className={th}>Age</th>
            <th className={th}>OVR/POT</th>
            <th className={th}>Contract</th>
            <th className={th} title="Surplus value to the other club">Value</th>
          </tr>
        </thead>
        <tbody>
          {players.map((p) => {
            const on = picked.includes(p.id);
            return (
              <tr key={p.id} className={cn("cursor-pointer hover:bg-hover", on && "bg-emerald-500/10")} onClick={() => toggle(p.id)}>
                <td className={td}>
                  <input type="checkbox" readOnly checked={on} />
                </td>
                <td className={cn(td, "whitespace-nowrap")}>
                  {p.name} <span className="text-xs text-secondary">{p.pos}</span>
                  {p.status !== "active" && <span className="text-xs text-muted"> · {p.status === "il" ? "IL" : p.on40 ? "AAA" : "minors"}</span>}
                </td>
                <td className={td}>{p.age}</td>
                <td className={td}>
                  <Ovr v={p.ovr} />/<Ovr v={p.pot} className="font-normal" />
                </td>
                <td className={cn(td, "whitespace-nowrap text-xs")}>{contractStr(p)}</td>
                <td className={cn(td, "text-xs")}>{money(tradeValue(league, p, valueFor))}</td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </div>
  );
}

export function TradesTab({ league, act }: TabProps) {
  const me = league.userTeam;
  const others = useMemo(() => Object.values(league.teams).filter((t) => t.id !== me).sort((a, b) => a.name.localeCompare(b.name)), [league.teams, me]);
  const [partner, setPartner] = useState<number>(others[0]?.id ?? 0);
  const [give, setGive] = useState<number[]>([]);
  const [get, setGet] = useState<number[]>([]);
  const [hint, setHint] = useState<string | null>(null);
  const open = tradesOpen(league);
  const pt = league.teams[partner];

  const tradeable = (id: number) => orgPlayers(league, id).filter((p) => p.on40 || p.status === "active" || p.pot >= 50 || p.ovr >= 45);
  const theirs = tradeable(partner).sort((a, b) => b.ovr - a.ovr);
  const mine = tradeable(me).sort((a, b) => b.ovr - a.ovr);
  const giveOk = give.filter((id) => league.players[id]?.team === me);
  const getOk = get.filter((id) => league.players[id]?.team === partner);
  const ev = giveOk.length || getOk.length ? evaluateTrade(league, { from: me, to: partner, give: giveOk, get: getOk }) : null;
  const payDelta = getOk.reduce((s, id) => s + league.players[id].contract.aav, 0) - giveOk.reduce((s, id) => s + league.players[id].contract.aav, 0);
  const tog = (arr: number[], set: (v: number[]) => void, id: number) => set(arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);
  const recent = league.tradeLog.slice(-12).reverse();

  return (
    <div className="space-y-4">
      {!open && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
          {league.phase === "postseason" ? "Trades are frozen during the postseason." : "The trade deadline has passed. Trading reopens in the offseason."}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm text-secondary" htmlFor="partner">
          Trade with
        </label>
        <select
          id="partner"
          className="min-w-0 max-w-full rounded border border-border bg-background px-2 py-1 text-sm"
          value={partner}
          onChange={(e) => {
            setPartner(Number(e.target.value));
            setGet([]);
            setHint(null);
          }}
        >
          {others.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.w}-{t.l})
            </option>
          ))}
        </select>
        {pt && <span className="text-xs text-secondary">{STRAT[pt.strategy]} · payroll {money(payroll(league, pt.id))}</span>}
      </div>

      <Card
        title="Proposal"
        right={
          <div className="flex flex-wrap gap-2">
            <Btn
              disabled={!getOk.length || !open}
              onClick={() => {
                const pkg = suggestPackage(league, partner, me, getOk);
                if (!pkg) setHint(`${pt.abbrev} don't see a package from your organization that works.`);
                else {
                  setGive(pkg);
                  setHint(pkg.length ? `${pt.abbrev} would consider this package.` : "They'd give that away for nothing.");
                }
              }}
            >
              What would it take?
            </Btn>
            <Btn
              tone="primary"
              disabled={!ev?.accept || !open}
              onClick={() => {
                act((l) => {
                  executeTrade(l, me, partner, giveOk, getOk);
                  return "Trade complete!";
                });
                setGive([]);
                setGet([]);
                setHint(null);
              }}
            >
              Make trade
            </Btn>
          </div>
        }
      >
        <div className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <div className="text-xs uppercase tracking-wider text-secondary">You send</div>
            {giveOk.map((id) => league.players[id].name).join(", ") || <span className="text-muted">nobody</span>}
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-secondary">You get</div>
            {getOk.map((id) => league.players[id].name).join(", ") || <span className="text-muted">nobody</span>}
          </div>
        </div>
        {ev && (
          <div className="mt-3 space-y-1 text-sm">
            <div className={cn(ev.accept ? "text-emerald-500" : "text-amber-500")}>{ev.msg}</div>
            {ev.ok && (
              <div className="text-xs text-secondary">
                Value to {pt.abbrev}: receiving {money(ev.valueIn)}, giving up {money(ev.valueOut)} · your payroll {payDelta >= 0 ? "+" : "−"}
                {money(Math.abs(payDelta))}
              </div>
            )}
          </div>
        )}
        {hint && <div className="mt-1 text-xs text-secondary">{hint}</div>}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={<TeamDot id={partner} abbrev={`${pt?.abbrev ?? ""} players`} />}>
          <PickList league={league} players={theirs} picked={getOk} toggle={(id) => tog(get, setGet, id)} valueFor={partner} />
        </Card>
        <Card title="Your players">
          <PickList league={league} players={mine} picked={giveOk} toggle={(id) => tog(give, setGive, id)} valueFor={partner} />
        </Card>
      </div>

      {recent.length > 0 && (
        <Card title="Recent trades">
          <ul className="space-y-1 text-sm">
            {recent.map((t, i) => (
              <li key={i} className="text-secondary">
                <span className="text-foreground">{t.season}</span> {league.teams[t.a].abbrev} get {t.aGets.map((id) => league.players[id]?.name ?? "?").join(", ") || "nothing"}; {league.teams[t.b].abbrev} get{" "}
                {t.bGets.map((id) => league.players[id]?.name ?? "?").join(", ") || "nothing"}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
