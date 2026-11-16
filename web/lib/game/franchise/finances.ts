/**
 * Club finances ($M): attendance from market, ballpark, winning, star power and
 * ticket price; gate, concessions, national + local media, sponsorship; revenue
 * sharing; playoff gates; payroll, CBT, operations and dead money; owner budget and mood.
 */
import { cbtTax, payroll } from "./contracts";
import { club, NATIONAL_MEDIA, refTicketPrice } from "./data";
import { clamp } from "./ratings";
import type { FRng } from "./rng";
import { DAY_MS } from "./schedule";
import type { Finances, League, TeamState } from "./types";

export const REVENUE_SHARE = 0.48;

export function newFinances(teamId: number, payrollM: number): Finances {
  const c = club(teamId);
  const rev = projectedRevenue(teamId, 0.5, refTicketPrice(teamId));
  return {
    gate: 0,
    concessions: 0,
    media: 0,
    sponsorship: 0,
    sharing: 0,
    playoff: 0,
    payroll: 0,
    tax: 0,
    operations: 0,
    deadMoney: 0,
    homeGames: 0,
    attendance: 0,
    cash: Math.round(40 + c.pop * 6),
    budget: Math.round(Math.max(payrollM * 1.04, rev * 0.48)),
    ownerMood: 60,
    cbtYears: 0,
    history: [],
  };
}

export const operationsCost = (teamId: number): number => 82 + club(teamId).pop * 3;
export const sponsorshipRevenue = (teamId: number, winPct: number): number => (12 + club(teamId).pop * 2.4) * (1 + (winPct - 0.5) * 1.2);

/** Expected home crowd for one date. */
export function attendance(league: League, t: TeamState, day: number, rng?: FRng): number {
  const c = club(t.id);
  const gp = t.w + t.l;
  const prev = t.fin.history[t.fin.history.length - 1];
  const prior = prev ? prev.wins / 162 : 0.5;
  const wp = gp >= 20 ? t.w / gp : (prior * (20 - gp) + t.w) / 20;
  let stars = 0;
  for (const p of Object.values(league.players)) if (p.team === t.id && p.status === "active" && p.ovr > 58) stars += p.ovr - 58;
  const dow = new Date(league.calendar.start + day * DAY_MS).getUTCDay();
  const weekend = dow === 5 || dow === 6 ? 0.1 : dow === 0 ? 0.06 : 0;
  const summer = day > 60 && day < 150 ? 0.04 : 0;
  const price = t.ticketPrice / refTicketPrice(t.id) - 1;
  const fill =
    0.44 +
    0.04 * Math.log2(c.pop + 1) +
    (wp - 0.5) * 1.5 +
    Math.min(0.12, stars * 0.004) +
    (c.park - 1) * 0.5 +
    weekend +
    summer -
    price * (price > 0 ? 0.6 : 0.35) +
    (rng ? rng.gauss(0, 0.035) : 0);
  return Math.round(c.capacity * clamp(fill, 0.18, 1));
}

/** Season revenue projection for budgeting (no playoffs), $M. */
export function projectedRevenue(teamId: number, winPct: number, price: number): number {
  const c = club(teamId);
  const fill = clamp(0.5 + 0.04 * Math.log2(c.pop + 1) + (winPct - 0.5) * 1.5 + (c.park - 1) * 0.5 - (price / refTicketPrice(teamId) - 1) * 0.5, 0.18, 1);
  const att = c.capacity * fill * 81;
  return (att * (price + 24)) / 1e6 + NATIONAL_MEDIA + c.localMedia + sponsorshipRevenue(teamId, winPct);
}

const seasonDays = (league: League) => league.calendar.endDay + 1;

/** Daily accruals: media, sponsorship, payroll, operations (regular season only). */
export function accrueDay(league: League): void {
  const days = seasonDays(league);
  for (const t of Object.values(league.teams)) {
    const gp = t.w + t.l;
    const wp = gp ? t.w / gp : 0.5;
    const f = t.fin;
    f.media += (NATIONAL_MEDIA + club(t.id).localMedia) / days;
    f.sponsorship += sponsorshipRevenue(t.id, wp) / days;
    // payroll() counts dead money too (it counts toward the tax line); book it once, under dead money.
    const dead = t.dead.reduce((s, d) => s + d.aav, 0);
    f.payroll += Math.max(0, payroll(league, t.id) - dead) / days;
    f.operations += operationsCost(t.id) / days;
    f.deadMoney += dead / days;
  }
}

export function recordGate(league: League, t: TeamState, att: number, playoff = false): void {
  const price = playoff ? t.ticketPrice * 2.4 : t.ticketPrice;
  const gate = (att * price) / 1e6;
  const conc = (att * 24) / 1e6;
  if (playoff) t.fin.playoff += gate + conc;
  else {
    t.fin.gate += gate;
    t.fin.concessions += conc;
    t.fin.homeGames += 1;
    t.fin.attendance += att;
  }
}

export const revenue = (f: Finances): number => f.gate + f.concessions + f.media + f.sponsorship + f.sharing + f.playoff;
export const expenses = (f: Finances): number => f.payroll + f.tax + f.operations + f.deadMoney;

/** Local revenue subject to sharing. */
const localRevenue = (t: TeamState) => t.fin.gate + t.fin.concessions + club(t.id).localMedia + t.fin.sponsorship;

/**
 * Close the books after the postseason: revenue sharing, luxury tax, cash, owner
 * mood and next season's budget.
 */
export function closeSeasonBooks(league: League, expectations: Record<number, number>): void {
  const teams = Object.values(league.teams);
  const avgLocal = teams.reduce((s, t) => s + localRevenue(t), 0) / teams.length;
  for (const t of teams) {
    const f = t.fin;
    f.sharing += REVENUE_SHARE * (avgLocal - localRevenue(t));
    const bill = cbtTax(payroll(league, t.id), league.season, f.cbtYears);
    f.tax += bill.tax;
    f.cbtYears = bill.over > 0 ? f.cbtYears + 1 : 0;
    const rev = revenue(f);
    const exp = expenses(f);
    const profit = rev - exp;
    f.cash += profit;
    const exp_w = expectations[t.id] ?? 81;
    const moodDelta = clamp((t.w - exp_w) * 1.2, -25, 25) + clamp(profit / 4, -15, 12) + (league.bracket?.champion === t.id ? 20 : 0);
    f.ownerMood = Math.round(clamp(f.ownerMood * 0.7 + 50 * 0.3 + moodDelta, 0, 100));
    f.history.push({
      season: league.season,
      revenue: Math.round(rev * 10) / 10,
      expenses: Math.round(exp * 10) / 10,
      profit: Math.round(profit * 10) / 10,
      payroll: Math.round(payroll(league, t.id) * 10) / 10,
      tax: Math.round(bill.tax * 10) / 10,
      wins: t.w,
      attendance: f.homeGames ? Math.round(f.attendance / f.homeGames) : 0,
    });
    // Next season's payroll budget: about half of revenue, more for a happy owner or contender.
    const base = rev - f.playoff * 0.5;
    const strat = t.strategy === "contend" ? 1.08 : t.strategy === "rebuild" ? 0.88 : 1;
    f.budget = Math.round(clamp(base * 0.56 * strat * (0.9 + f.ownerMood / 500) + Math.min(30, Math.max(-20, f.cash / 15)), 60, 360));
  }
}

export function resetLedger(f: Finances): void {
  f.gate = 0;
  f.concessions = 0;
  f.media = 0;
  f.sponsorship = 0;
  f.sharing = 0;
  f.playoff = 0;
  f.payroll = 0;
  f.tax = 0;
  f.operations = 0;
  f.deadMoney = 0;
  f.homeGames = 0;
  f.attendance = 0;
}

/** Projection for the current season (YTD extrapolated, sharing and tax estimated). */
export function seasonProjection(league: League, t: TeamState): { revenue: number; expenses: number; profit: number; tax: number; sharing: number } {
  const days = seasonDays(league);
  const frac = league.phase === "regular" ? clamp((league.day + 1) / days, 0.02, 1) : 1;
  const f = t.fin;
  const teams = Object.values(league.teams);
  const avgLocal = teams.reduce((s, x) => s + localRevenue(x), 0) / teams.length;
  const sharing = league.phase === "regular" ? (REVENUE_SHARE * (avgLocal - localRevenue(t))) / frac : f.sharing;
  const tax = league.phase === "regular" || league.phase === "postseason" ? cbtTax(payroll(league, t.id), league.season, f.cbtYears).tax : f.tax;
  const rev = (f.gate + f.concessions + f.media + f.sponsorship) / frac + f.playoff + sharing;
  const exp = (f.payroll + f.operations + f.deadMoney) / frac + tax;
  return { revenue: rev, expenses: exp, profit: rev - exp, tax, sharing };
}
