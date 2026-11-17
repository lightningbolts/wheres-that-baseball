/**
 * Contracts: real players get their actual deals from franchise-contracts.json (built by
 * ml-engine/scripts/build_franchise_contracts.py from Baseball-Reference / Cot's payrolls):
 * per-season salaries, options, arbitration estimates and service time. Anyone missing from
 * that snapshot (unsigned free agents, minor leaguers) gets a deterministic, plausible deal
 * from age, value and estimated service time. Also payroll, the competitive balance tax,
 * arbitration and aging-curve projections.
 */
import { cbtThreshold, club, DOLLARS_PER_WAR, MIN_SALARY } from "./data";
import { clamp } from "./ratings";
import { hashUnit } from "./rng";
import type { Contract, ContractOption, League, Player } from "./types";

/** Expected change in overall grade over the next year at this age. */
export function agingDelta(age: number): number {
  if (age <= 22) return 3;
  if (age <= 24) return 2;
  if (age <= 26) return 1;
  if (age <= 29) return 0;
  if (age <= 31) return -0.8;
  if (age <= 33) return -1.6;
  if (age <= 35) return -2.6;
  return -3.6;
}

export function warFromOvr(p: Player, ovr: number): number {
  if (p.pitcher && p.pos === "RP") return (ovr - 42) / 9;
  return (ovr - 40) / 5;
}

/** Projected overall `years` seasons from now (growth capped by potential). */
export function projectedOvr(p: Player, years: number): number {
  let o = p.ovr;
  for (let y = 0; y < years; y += 1) {
    const d = agingDelta(p.age + y);
    o = d > 0 ? Math.min(Math.max(o, p.pot), o + d + (p.pot - o) * 0.15) : o + d;
  }
  return o;
}

export const projectedWar = (p: Player, years: number): number => warFromOvr(p, projectedOvr(p, years));

/** Open-market value for one season at this projection, $M. */
export const marketValue = (war: number): number => Math.max(MIN_SALARY, war * DOLLARS_PER_WAR * (war > 4 ? 1.08 : 1));

export function arbSalary(p: Player, war = projectedWar(p, 0)): number {
  const yr = clamp(Math.floor(p.service) - 2, 1, 3);
  const pct = [0.22, 0.36, 0.52][yr - 1];
  return Math.max(MIN_SALARY + 0.2 * yr, Math.round(pct * Math.max(0, war) * DOLLARS_PER_WAR * 10) / 10);
}

export const preArbSalary = (service: number): number => Math.round((MIN_SALARY + 0.03 * service) * 100) / 100;

export function estimateService(p: Player): number {
  const noise = hashUnit(p.id, "svc") * 2.5 - 1;
  return clamp(Math.round((p.age - 23.6 + noise) * 10) / 10, 0, Math.max(0, p.age - 20));
}

/** One player's entry in web/data/game/franchise-contracts.json. */
export interface ContractEntry {
  /** MLB club whose payroll lists him. */
  team: number;
  /** guar = guaranteed MLB deal; arb / pre = arbitration-eligible / pre-arbitration. */
  kind: "guar" | "arb" | "pre";
  /** MLB service time, years. */
  svc?: number;
  /** Guaranteed salary per season from the first franchise season, $M. */
  sal?: number[];
  /** MLBTR projected arbitration award, $M. */
  arb?: number;
  total?: number;
  len?: number;
  first?: number;
  last?: number;
  opt?: ContractOption & { season: number };
  summary?: string;
}

export interface ContractFile {
  season: number;
  built: string;
  source: string;
  players: Record<string, ContractEntry>;
  /** Real free agents this winter (elected free agency / released): MLBAM id → club they left. */
  fa?: Record<string, { from: number; date?: string | null }>;
  /** Players now in a different organization than the roster snapshot (trades, claims, signings). */
  org?: Record<string, number>;
}

const r2 = (x: number): number => Math.round(x * 100) / 100;

/** A real player's actual contract from the snapshot (service time must already be set). */
export function realContract(p: Player, e: ContractEntry, season: number): Contract {
  if (e.kind === "guar" && e.sal?.length) {
    const salaries = e.sal.map(r2);
    const aav = e.total && e.len ? e.total / e.len : salaries.reduce((a, b) => a + b, 0) / salaries.length;
    const signed = e.first ?? season;
    // Signed before reaching free agency (six years of service) = an extension.
    const svcAtSigning = p.service - Math.max(0, season - signed);
    const option = e.opt && e.opt.season === season + salaries.length ? { type: e.opt.type, salary: r2(e.opt.salary), buyout: r2(e.opt.buyout) } : undefined;
    return {
      aav: r2(Math.max(MIN_SALARY, aav)),
      years: salaries.length,
      kind: svcAtSigning < 6 ? "ext" : "fa",
      signed,
      salaries,
      ...(option ? { option } : {}),
      ...(e.total ? { total: e.total } : {}),
      ...(e.len ? { length: e.len } : {}),
      real: true,
    };
  }
  if (e.kind === "arb") return { aav: e.arb ? r2(Math.max(MIN_SALARY, e.arb)) : arbSalary(p), years: 1, kind: "arb", signed: season, real: true };
  return { aav: preArbSalary(p.service), years: 1, kind: "pre", signed: season, real: true };
}

/** Salary paid `y` seasons from now under the current deal (guaranteed years only), $M. */
export const contractSalary = (c: Contract, y = 0): number => (y < c.years ? (c.salaries?.[y] ?? c.aav) : 0);

/** Guaranteed money still owed (all remaining seasons plus any option buyout), $M. */
export function remainingOwed(c: Contract): number {
  let sum = c.option?.buyout ?? 0;
  for (let y = 0; y < c.years; y += 1) sum += contractSalary(c, y);
  return Math.round(sum * 10) / 10;
}

/** End of a season: one year of the deal is used up. */
export function advanceContract(c: Contract): void {
  c.years -= 1;
  if (c.salaries) c.salaries = c.salaries.slice(1);
}

/**
 * Option decision when the guaranteed years run out. The club picks up a team (or vesting)
 * option when the player is worth more than the salary net of the buyout; a player exercises
 * his option when the open market would pay him less. Mutual options need both.
 */
export function optionExercised(p: Player, o: ContractOption): boolean {
  const worth = marketValue(Math.max(0, projectedWar(p, 0)));
  const clubYes = worth >= o.salary - o.buyout;
  const playerYes = askingTerms(p).aav < o.salary;
  if (o.type === "player") return playerYes;
  if (o.type === "mutual") return clubYes && playerYes;
  return clubYes;
}

/** A plausible current contract for a real player. */
export function synthContract(p: Player, season: number, teamId: number): Contract {
  const u = (k: string) => hashUnit(p.id, k);
  const war = projectedWar(p, 0);
  const s = p.service;
  if (s < 3) {
    if (war >= 3.5 && u("ext") < 0.3) {
      const years = 5 + Math.floor(u("len") * 4);
      return { aav: Math.round(marketValue(war) * 0.45 * 10) / 10, years, kind: "ext", signed: season - 1 };
    }
    return { aav: preArbSalary(s), years: 1, kind: "pre", signed: season };
  }
  if (s < 6) {
    if (war >= 2.5 && u("ext") < 0.25) {
      const years = 3 + Math.floor(u("len") * 5);
      return { aav: Math.round(marketValue(war) * 0.7 * 10) / 10, years, kind: "ext", signed: season - 1 };
    }
    return { aav: arbSalary(p, war), years: 1, kind: "arb", signed: season };
  }
  const elapsed = Math.floor(u("el") * Math.min(5, s - 5));
  const signAge = p.age - elapsed;
  // Value when he signed: a little better than now for veterans past their peak.
  const warThen = Math.max(0.2, war + elapsed * (p.age > 31 ? 0.3 : 0.08));
  let len: number;
  if (warThen >= 4.5 && signAge <= 31) len = 6 + Math.floor(u("len") * 5);
  else if (warThen >= 3 && signAge <= 33) len = 3 + Math.floor(u("len") * 3);
  else if (warThen >= 1.5) len = 1 + Math.floor(u("len") * 3);
  else len = 1;
  // Deals rarely run past 38.
  const years = clamp(len - elapsed, 1, Math.max(1, 39 - p.age));
  // Big markets pay up; small markets field cheaper veterans.
  const market = clamp(1 + (club(teamId).pop - 5) * 0.03, 0.78, 1.25);
  const aav = clamp(marketValue(Math.max(0.2, warThen - 0.6)) * (0.5 + u("aav") * 0.32) * market * (len >= 7 ? 0.92 : 1), MIN_SALARY, 43);
  return { aav: Math.round(aav * 10) / 10, years, kind: "fa", signed: season - elapsed };
}

/**
 * CBT payroll: 40-man salaries, plus guaranteed (major-league) deals of players the club
 * outrighted but still pays, plus dead money, $M. Uses each deal's AAV, as the real tax does
 * (cashPayroll() and committed() count the actual salaries).
 */
export function payroll(league: League, teamId: number): number {
  let sum = 0;
  for (const p of Object.values(league.players)) {
    if (p.team !== teamId || p.status === "retired") continue;
    if (p.on40 || p.status === "active" || p.status === "il" || p.contract.kind !== "minor") sum += p.contract.aav;
  }
  for (const d of league.teams[teamId]?.dead ?? []) sum += d.aav;
  return Math.round(sum * 10) / 10;
}

/** Cash payroll this season: actual salaries (front- or back-loaded deals differ from AAV) plus dead money, $M. */
export function cashPayroll(league: League, teamId: number): number {
  let sum = 0;
  for (const p of Object.values(league.players)) {
    if (p.team !== teamId || p.status === "retired") continue;
    if (p.on40 || p.status === "active" || p.status === "il" || p.contract.kind !== "minor") sum += contractSalary(p.contract);
  }
  for (const d of league.teams[teamId]?.dead ?? []) sum += d.aav;
  return Math.round(sum * 10) / 10;
}

/** Committed salary for future seasons (years ahead ≥ 1), $M. */
export function committed(league: League, teamId: number, yearsAhead: number): number {
  let sum = 0;
  for (const p of Object.values(league.players)) {
    if (p.team !== teamId || p.status === "retired") continue;
    if (p.contract.years > yearsAhead && p.contract.kind !== "minor") sum += contractSalary(p.contract, yearsAhead);
    else if (p.contract.years === yearsAhead && p.contract.option && p.contract.kind !== "minor") sum += p.contract.option.buyout;
  }
  for (const d of league.teams[teamId]?.dead ?? []) if (d.years > yearsAhead) sum += d.aav;
  return sum;
}

export interface TaxBill {
  threshold: number;
  over: number;
  rate: number;
  surcharge: number;
  tax: number;
}

/** Competitive balance tax: base rate by consecutive years over, plus tiered surcharges. */
export function cbtTax(payrollM: number, season: number, priorYearsOver: number): TaxBill {
  const threshold = cbtThreshold(season);
  const over = Math.max(0, payrollM - threshold);
  const rate = priorYearsOver >= 2 ? 0.5 : priorYearsOver === 1 ? 0.3 : 0.2;
  if (over <= 0) return { threshold, over: 0, rate, surcharge: 0, tax: 0 };
  const tier = (lo: number, hi: number) => Math.max(0, Math.min(over, hi) - lo);
  const surcharge = tier(20, 40) * 0.12 + tier(40, 60) * (priorYearsOver >= 1 ? 0.45 : 0.425) + tier(60, 1e9) * 0.6;
  return { threshold, over, rate, surcharge, tax: Math.round((over * rate + surcharge) * 10) / 10 };
}

/** Free-agent asking terms from projected value and age. */
export function askingTerms(p: Player): { aav: number; years: number } {
  const war = projectedWar(p, 0);
  const years = war < 1 ? 1 : p.age <= 29 && war >= 4 ? 7 : p.age <= 31 && war >= 3 ? 5 : p.age <= 33 && war >= 2 ? 3 : war >= 1.5 ? 2 : 1;
  let total = 0;
  for (let y = 0; y < years; y += 1) total += marketValue(projectedWar(p, y));
  const aav = clamp(total / years, MIN_SALARY, 50);
  return { aav: Math.round(aav * 10) / 10, years };
}

export const fmtM = (m: number): string => (Math.abs(m) >= 1 ? `$${m.toFixed(1)}M` : `$${Math.round(m * 1000)}K`);
