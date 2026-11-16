"use client";

import { useState } from "react";
import { committed, payroll } from "@/lib/game/franchise/contracts";
import { askFor, freeAgents, makeOffer, offerInterest, withdrawOffer } from "@/lib/game/franchise/freeAgency";
import type { Player } from "@/lib/game/franchise/types";
import { cn } from "@/lib/utils";
import { Btn, Card, money, Ovr, Segmented, signed, SmallBtn, Stat, Table, td, th, type TabProps } from "../ui";

type Filter = "all" | "bat" | "SP" | "RP";

export function FreeAgencyTab({ league, act }: TabProps) {
  const me = league.userTeam;
  const t = league.teams[me];
  const [filter, setFilter] = useState<Filter>("all");
  const [pick, setPick] = useState<number | null>(null);
  const [aav, setAav] = useState(5);
  const [years, setYears] = useState(1);
  const offseason = league.phase === "freeagency";
  const pool = freeAgents(league)
    .filter((p) => (filter === "all" ? true : filter === "bat" ? !p.pitcher : p.pos === filter))
    .sort((a, b) => b.ovr - a.ovr)
    .slice(0, 150);
  const myOffers = offseason ? Object.entries(league.fa?.offers ?? {}).filter(([, os]) => os.some((o) => o.team === me)) : [];
  const pay = payroll(league, me);
  const next = offseason ? committed(league, me, 0) : pay;
  const room = t.fin.budget - next - myOffers.reduce((s, [, os]) => s + (os.find((o) => o.team === me)?.aav ?? 0), 0);
  const sel: Player | null = pick != null ? league.players[pick] : null;
  const interest = sel && sel.status === "fa" ? offerInterest(league, sel, aav, years) : 0;

  const choose = (p: Player) => {
    const ask = askFor(league, p);
    setPick(p.id);
    setAav(ask.aav);
    setYears(ask.years);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label={offseason ? "Committed next year" : "Payroll"} value={money(next)} />
        <Stat label="Budget" value={money(t.fin.budget)} sub="set by the owner" />
        <Stat label="Room" value={signed(room)} sub={offseason ? "after your open offers" : undefined} />
        <Stat label="Market" value={offseason ? `Round ${(league.fa?.round ?? 0) + 1}/${league.fa?.rounds ?? 10}` : "In season"} sub={`${freeAgents(league).length} free agents`} />
      </div>
      <p className="text-xs text-secondary">
        {offseason
          ? "Make offers, then advance free agency a round at a time. Players sign with the best offer once it beats their asking price, which drops each round. Rival clubs bid too."
          : "Unsigned free agents will sign one-year deals now if you meet their asking price."}
      </p>

      {sel && sel.status === "fa" && (
        <Card title={`Offer: ${sel.name}`} right={<SmallBtn onClick={() => setPick(null)}>Close</SmallBtn>}>
          <div className="flex flex-wrap items-end gap-3 text-sm">
            <div className="text-secondary">
              {sel.pos}, age {sel.age}, OVR {sel.ovr} · asking {money(askFor(league, sel).aav)} × {askFor(league, sel).years}
            </div>
            <label className="flex flex-col text-xs text-secondary">
              $M per year
              <input type="number" min={0.8} step={0.5} value={aav} onChange={(e) => setAav(Number(e.target.value))} className="w-24 rounded border border-border bg-background px-2 py-1 text-sm text-foreground" />
            </label>
            <label className="flex flex-col text-xs text-secondary">
              Years
              <input type="number" min={1} max={10} value={years} onChange={(e) => setYears(Number(e.target.value))} className="w-16 rounded border border-border bg-background px-2 py-1 text-sm text-foreground" />
            </label>
            <div className={cn("text-sm", interest >= 60 ? "text-emerald-500" : interest >= 30 ? "text-amber-500" : "text-red-500")}>Interest {interest}%</div>
            <Btn
              tone="primary"
              onClick={() => {
                act((l) => makeOffer(l, sel.id, aav, years).msg);
              }}
            >
              {offseason ? "Submit offer" : "Sign"}
            </Btn>
          </div>
          {aav > room && <p className="mt-2 text-xs text-amber-500">This puts you over the owner&apos;s budget. Losses hurt the owner&apos;s mood (and next year&apos;s budget).</p>}
        </Card>
      )}

      {myOffers.length > 0 && (
        <Card title="Your open offers">
          <ul className="space-y-1 text-sm">
            {myOffers.map(([id, os]) => {
              const p = league.players[Number(id)];
              const o = os.find((x) => x.team === me)!;
              const rivals = os.length - 1;
              return (
                <li key={id} className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{p?.name}</span>
                  <span className="text-secondary">
                    {money(o.aav)} × {o.years} · {rivals} rival offer{rivals === 1 ? "" : "s"}
                  </span>
                  <SmallBtn
                    onClick={() =>
                      act((l) => {
                        withdrawOffer(l, Number(id));
                        return "Offer withdrawn.";
                      })
                    }
                  >
                    Withdraw
                  </SmallBtn>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <Card
        title="Free agents"
        right={
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { v: "all", label: "All" },
              { v: "bat", label: "Hitters" },
              { v: "SP", label: "SP" },
              { v: "RP", label: "RP" },
            ]}
          />
        }
      >
        <div className="max-h-[36rem] overflow-y-auto">
          <Table>
            <thead>
              <tr>
                <th className={th}>Player</th>
                <th className={th}>Pos</th>
                <th className={th}>Age</th>
                <th className={th}>OVR</th>
                <th className={th}>Asking</th>
                {offseason && <th className={th}>Offers</th>}
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {pool.map((p) => {
                const ask = askFor(league, p);
                const n = league.fa?.offers[p.id]?.length ?? 0;
                return (
                  <tr key={p.id} className={cn(pick === p.id && "bg-emerald-500/10")}>
                    <td className={cn(td, "whitespace-nowrap")}>
                      {p.name}
                      {p.prevTeam && <span className="text-xs text-muted"> ex-{league.teams[p.prevTeam]?.abbrev}</span>}
                    </td>
                    <td className={td}>{p.pos}</td>
                    <td className={td}>{p.age}</td>
                    <td className={td}>
                      <Ovr v={p.ovr} />
                    </td>
                    <td className={cn(td, "whitespace-nowrap")}>
                      {money(ask.aav)} × {ask.years}
                    </td>
                    {offseason && <td className={td}>{n}</td>}
                    <td className={td}>
                      <SmallBtn onClick={() => choose(p)}>{offseason ? "Offer" : "Sign"}</SmallBtn>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
