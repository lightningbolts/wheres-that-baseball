import { describe, expect, it } from "vitest";
import contractsJson from "@/data/game/franchise-contracts.json";
import projJson from "@/data/game/franchise-proj.json";
import rosters from "@/data/game/rosters.json";
import type { RosterFile } from "@/lib/game/types";
import { advanceContract, cashPayroll, committed, contractSalary, optionExercised, payroll, realContract, remainingOwed, type ContractFile } from "./contracts";
import { createLeague } from "./league";
import type { ProjectionFile } from "./projections";
import { finishFreeAgency, startNextSeason, startOffseason } from "./offseason";
import { release } from "./roster";
import { simUntil } from "./season";
import { controlYears, salaryInYear } from "./trades";
import type { Player } from "./types";

const contracts = contractsJson as unknown as ContractFile;
const proj = projJson as unknown as ProjectionFile;
const league = createLeague(rosters as unknown as RosterFile, { userTeam: 147, seed: 5, proj, contracts });

/** Any real player in the league whose snapshot entry matches. */
const find = (pred: (p: Player) => boolean): Player | undefined => Object.values(league.players).find(pred);

describe("real contracts", () => {
  it("snapshot covers every club for the first franchise season", () => {
    expect(contracts.season).toBe(league.season);
    const teams = new Set(Object.values(contracts.players).map((e) => e.team));
    expect(teams.size).toBe(30);
    expect(Object.keys(contracts.players).length).toBeGreaterThan(900);
  });

  it("real players carry their actual deal and service time", () => {
    let matched = 0;
    for (const p of Object.values(league.players)) {
      const e = contracts.players[String(p.id)];
      if (!p.real || !e) continue;
      matched += 1;
      expect(p.contract.real).toBe(true);
      if (e.svc != null) expect(p.service).toBeCloseTo(e.svc, 3);
      if (e.kind === "guar") {
        expect(p.contract.salaries).toEqual(e.sal!.map((x) => Math.round(x * 100) / 100));
        expect(p.contract.years).toBe(e.sal!.length);
        if (e.total && e.len) expect(p.contract.aav).toBeCloseTo(e.total / e.len, 1);
      } else {
        expect(p.contract.years).toBe(1);
        expect(p.contract.kind).toBe(e.kind);
        if (e.arb) expect(p.contract.aav).toBeCloseTo(e.arb, 2);
      }
    }
    // Most of the league's real players are on a current 40-man payroll.
    const real = Object.values(league.players).filter((p) => p.real).length;
    expect(matched / real).toBeGreaterThan(0.7);
  });

  it("players missing from the snapshot get an estimated deal", () => {
    const est = Object.values(league.players).filter((p) => p.real && !contracts.players[String(p.id)]);
    for (const p of est) expect(p.contract.est).toBe(true);
  });

  it("payrolls land in a real-world range", () => {
    for (const t of Object.values(league.teams)) {
      const pay = payroll(league, t.id);
      expect(pay, t.abbrev).toBeGreaterThan(40);
      expect(pay, t.abbrev).toBeLessThan(450);
      expect(cashPayroll(league, t.id)).toBeGreaterThan(0);
    }
  });

  it("salaries roll forward a season at a time", () => {
    const p = find((x) => !!x.contract.salaries && x.contract.salaries.length >= 3 && new Set(x.contract.salaries).size > 1)!;
    expect(p).toBeDefined();
    const c = structuredClone(p.contract);
    const [, second] = c.salaries!;
    advanceContract(c);
    expect(c.years).toBe(p.contract.years - 1);
    expect(contractSalary(c)).toBe(second);
    expect(salaryInYear(p, 1)).toBe(second);
  });

  it("future commitments use actual salaries and option buyouts", () => {
    const ny = Object.values(league.players).filter((p) => p.team === 147 && p.contract.kind !== "minor");
    const want = ny.reduce((s, p) => s + (p.contract.years > 1 ? contractSalary(p.contract, 1) : p.contract.years === 1 && p.contract.option ? p.contract.option.buyout : 0), 0);
    const dead = league.teams[147].dead.filter((d) => d.years > 1).reduce((s, d) => s + d.aav, 0);
    expect(committed(league, 147, 1)).toBeCloseTo(want + dead, 5);
  });

  it("club options count as a year of control and get decided on value", () => {
    const p = find((x) => x.contract.option?.type === "team" && (x.contract.kind === "fa" || x.contract.kind === "ext"))!;
    expect(p).toBeDefined();
    expect(controlYears(p)).toBe(p.contract.years + 1);
    expect(salaryInYear(p, p.contract.years)).toBe(p.contract.option!.salary);
    expect(optionExercised(p, { type: "team", salary: 0.5, buyout: 0 })).toBe(true);
    expect(optionExercised(p, { type: "team", salary: 200, buyout: 0 })).toBe(false);
    // A player opts in when the market would pay him less.
    expect(optionExercised(p, { type: "player", salary: 200, buyout: 0 })).toBe(true);
  });

  it("realContract handles arbitration and pre-arb entries", () => {
    const p = find((x) => x.real)!;
    expect(realContract({ ...p, service: 3.1 }, { team: 147, kind: "arb", arb: 6.25 }, 2027)).toMatchObject({ aav: 6.25, years: 1, kind: "arb", real: true });
    expect(realContract({ ...p, service: 1 }, { team: 147, kind: "pre" }, 2027)).toMatchObject({ years: 1, kind: "pre", real: true });
    // Signed with under six years of service = an extension.
    const ext = realContract({ ...p, service: 5 }, { team: 147, kind: "guar", sal: [10, 12], total: 40, len: 4, first: 2025 }, 2027);
    expect(ext).toMatchObject({ kind: "ext", aav: 10, years: 2, salaries: [10, 12], signed: 2025 });
  });

  it("a season later: salaries advance and expiring options are decided", () => {
    const l = structuredClone(league);
    const deals = Object.values(l.players)
      .filter((p) => p.contract.salaries && p.contract.years >= 2)
      .map((p) => ({ id: p.id, years: p.contract.years, next: p.contract.salaries![1] }));
    const opts = Object.values(l.players).filter((p) => p.contract.option && p.contract.years === 1).map((p) => p.id);
    expect(opts.length).toBeGreaterThan(5);
    simUntil(l, "season");
    simUntil(l, "postseason");
    startOffseason(l);
    for (const d of deals) {
      const p = l.players[d.id];
      if (p.status === "retired" || p.status === "fa") continue;
      expect(p.contract.years).toBe(d.years - 1);
      expect(p.contract.salaries![0]).toBe(d.next);
      expect(p.contract.salaries!.length).toBe(p.contract.years);
    }
    for (const id of opts) {
      const p = l.players[id];
      expect(p.contract.option).toBeUndefined();
    }
    expect(l.news.some((n) => / option (for \d{4} was exercised|was declined)/.test(n.text))).toBe(true);
    finishFreeAgency(l);
    startNextSeason(l);
    expect(l.season).toBe(2028);
  });

  it("releasing a player books what's still owed", () => {
    const l = structuredClone(league);
    const p = Object.values(l.players).find((x) => x.team === l.userTeam && x.contract.salaries && x.contract.years >= 2)!;
    const owed = remainingOwed(p.contract);
    const before = l.teams[l.userTeam].dead.length;
    release(l, p.id);
    const d = l.teams[l.userTeam].dead[before];
    expect(d.years * d.aav).toBeCloseTo(owed, 1);
  });
});
