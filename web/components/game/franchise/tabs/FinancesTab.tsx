"use client";

import { useState } from "react";
import { cbtTax, committed, payroll } from "@/lib/game/franchise/contracts";
import { club, refTicketPrice } from "@/lib/game/franchise/data";
import { attendance, expenses, revenue, seasonProjection } from "@/lib/game/franchise/finances";
import { cn } from "@/lib/utils";
import { Btn, Card, money, signed, Stat, Table, TeamDot, td, th, type TabProps } from "../ui";

function Line({ label, v, neg }: { label: string; v: number; neg?: boolean }) {
  return (
    <div className="flex justify-between border-b border-border/50 py-1 text-sm">
      <span className="text-secondary">{label}</span>
      <span className={cn("tabular-nums", neg && "text-red-500")}>{neg ? `−${money(v)}` : money(v)}</span>
    </div>
  );
}

export function FinancesTab({ league, act }: TabProps) {
  const me = league.userTeam;
  const t = league.teams[me];
  const f = t.fin;
  const [price, setPrice] = useState(t.ticketPrice);
  const ref = refTicketPrice(me);
  const cap = club(me).capacity;
  const proj = seasonProjection(league, t);
  const pay = payroll(league, me);
  const bill = cbtTax(pay, league.season, f.cbtYears);
  const crowdAt = (p: number) => attendance(league, { ...t, ticketPrice: p }, Math.max(0, league.day));
  const crowd = crowdAt(price);
  const ranks = Object.values(league.teams)
    .map((x) => ({ t: x, pay: payroll(league, x.id) }))
    .sort((a, b) => b.pay - a.pay);
  const mood = f.ownerMood;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Projected profit" value={signed(proj.profit)} sub={`${money(proj.revenue)} rev · ${money(proj.expenses)} exp`} />
        <Stat label="Payroll (CBT)" value={money(pay)} sub={`#${ranks.findIndex((r) => r.t.id === me) + 1} in MLB`} />
        <Stat label="Luxury tax" value={money(bill.tax)} sub={bill.over > 0 ? `${money(bill.over)} over, ${Math.round(bill.rate * 100)}% rate` : `${money(bill.threshold - pay)} under the line`} />
        <Stat label="Owner" value={`${mood}/100`} sub={mood >= 70 ? "Delighted" : mood >= 50 ? "Content" : mood >= 30 ? "Restless" : "Furious"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={league.phase === "regular" ? "This season so far" : "This season"}>
          <Line label="Gate" v={f.gate} />
          <Line label="Concessions & parking" v={f.concessions} />
          <Line label="Media rights" v={f.media} />
          <Line label="Sponsorship" v={f.sponsorship} />
          {f.playoff > 0 && <Line label="Postseason gate" v={f.playoff} />}
          {f.sharing !== 0 && <Line label={f.sharing >= 0 ? "Revenue sharing (received)" : "Revenue sharing (paid)"} v={Math.abs(f.sharing)} neg={f.sharing < 0} />}
          <Line label="Player payroll" v={f.payroll} neg />
          <Line label="Operations" v={f.operations} neg />
          {f.deadMoney > 0 && <Line label="Dead money" v={f.deadMoney} neg />}
          {f.tax > 0 && <Line label="Luxury tax" v={f.tax} neg />}
          <div className="flex justify-between pt-2 text-sm font-semibold">
            <span>Net</span>
            <span>{signed(revenue(f) - expenses(f))}</span>
          </div>
          <p className="mt-2 text-xs text-secondary">Revenue sharing and the luxury tax are settled after the World Series. Cash on hand: {signed(f.cash)}.</p>
        </Card>

        <Card title="Tickets">
          <div className="space-y-3 text-sm">
            <div className="flex items-baseline justify-between">
              <span className="text-secondary">Average ticket</span>
              <span className="text-xl font-semibold tabular-nums">${price}</span>
            </div>
            <input
              type="range"
              min={Math.round(ref * 0.5)}
              max={Math.round(ref * 2)}
              value={price}
              onChange={(e) => setPrice(Number(e.target.value))}
              className="w-full accent-emerald-600"
              aria-label="Ticket price"
            />
            <div className="flex justify-between text-xs text-secondary">
              <span>League-typical for your market: ${ref}</span>
              <span>Capacity {cap.toLocaleString()}</span>
            </div>
            <div className="rounded-md border border-border p-2 text-xs">
              Expected crowd at ${price}: <b>{crowd.toLocaleString()}</b> ({Math.round((crowd / cap) * 100)}%) · gate per game {money((crowd * (price + 24)) / 1e6)}
              <div className="text-secondary">
                At ${t.ticketPrice} (current): {crowdAt(t.ticketPrice).toLocaleString()} · {money((crowdAt(t.ticketPrice) * (t.ticketPrice + 24)) / 1e6)}
              </div>
            </div>
            <Btn
              tone="primary"
              disabled={price === t.ticketPrice}
              onClick={() =>
                act((l) => {
                  l.teams[me].ticketPrice = price;
                  return `Ticket price set to $${price}.`;
                })
              }
            >
              Set price
            </Btn>
            <p className="text-xs text-secondary">Winning, stars and summer weekends fill seats. Higher prices earn more per fan but thin the crowd.</p>
          </div>
        </Card>

        <Card title="Commitments">
          <Line label={`${league.season} payroll`} v={pay} />
          {[1, 2, 3, 4].map((y) => (
            <Line key={y} label={`${league.season + y} committed`} v={committed(league, me, y)} />
          ))}
          <Line label="Owner's payroll budget" v={f.budget} />
          {t.dead.length > 0 && (
            <div className="mt-2 text-xs text-secondary">Dead money: {t.dead.map((d) => `${d.name} ${money(d.aav)} × ${d.years}`).join(", ")}</div>
          )}
          <p className="mt-2 text-xs text-secondary">
            CBT threshold {money(bill.threshold)}. Base tax 20% (30% second year over, 50% third+), plus surcharges beyond $20M and $40M and 60% above $60M.
          </p>
        </Card>
      </div>

      {f.history.length > 0 && (
        <Card title="History">
          <Table>
            <thead>
              <tr>
                {["Season", "W", "Attendance", "Revenue", "Expenses", "Profit", "Payroll", "Tax"].map((h) => (
                  <th key={h} className={th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...f.history].reverse().map((h) => (
                <tr key={h.season}>
                  <td className={td}>{h.season}</td>
                  <td className={td}>{h.wins}</td>
                  <td className={td}>{h.attendance.toLocaleString()}</td>
                  <td className={td}>{money(h.revenue)}</td>
                  <td className={td}>{money(h.expenses)}</td>
                  <td className={cn(td, h.profit >= 0 ? "text-emerald-500" : "text-red-500")}>{signed(h.profit)}</td>
                  <td className={td}>{money(h.payroll)}</td>
                  <td className={td}>{money(h.tax)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      <Card title="League payrolls">
        <div className="grid gap-x-6 sm:grid-cols-2 lg:grid-cols-3">
          {ranks.map((r, i) => (
            <div key={r.t.id} className={cn("flex justify-between border-b border-border/50 py-1 text-sm", r.t.id === me && "text-emerald-500")}>
              <span>
                <span className="mr-1 text-muted">{i + 1}.</span>
                <TeamDot id={r.t.id} abbrev={r.t.abbrev} />
              </span>
              <span className={cn("tabular-nums", r.pay > bill.threshold && "text-amber-500")}>{money(r.pay)}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
