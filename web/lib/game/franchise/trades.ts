/**
 * Trades: surplus value (projected WAR × $/WAR − salary over years of control),
 * weighted by the club's direction (contenders want WAR now, rebuilders want
 * cheap youth and shed salary). AI GMs evaluate offers, build counter-offers and
 * trade among themselves until the deadline.
 */
import { arbSalary, projectedWar } from "./contracts";
import { DOLLARS_PER_WAR, MIN_SALARY } from "./data";
import { clamp } from "./ratings";
import type { FRng } from "./rng";
import { autoDepth, news, normalizeRoster, orgPlayers } from "./roster";
import { leaveTeam } from "./splits";
import type { League, Player } from "./types";

export function controlYears(p: Player): number {
  const k = p.contract.kind;
  if (k === "fa" || k === "ext") return p.contract.years;
  return clamp(6 - Math.floor(p.service), 1, 6);
}

export function salaryInYear(p: Player, y: number): number {
  const k = p.contract.kind;
  if ((k === "fa" || k === "ext") && y < p.contract.years) return p.contract.aav;
  if (y === 0) return p.contract.aav;
  const svc = p.service + y;
  if (svc < 3) return MIN_SALARY;
  return arbSalary({ ...p, service: svc }, Math.max(0, projectedWar(p, y)));
}

/** Surplus value of a player to a club, $M. */
export function tradeValue(league: League, p: Player, teamId: number): number {
  const strat = league.teams[teamId]?.strategy ?? "neutral";
  const frac = league.phase === "regular" ? clamp(1 - league.day / Math.max(1, league.calendar.endDay), 0.05, 1) : league.phase === "postseason" ? 0.02 : 1;
  const years = Math.min(7, controlYears(p));
  let v = 0;
  for (let y = 0; y < years; y += 1) {
    let war = Math.max(0, projectedWar(p, y));
    if (y === 0) war *= frac;
    const w = strat === "contend" ? (y === 0 ? 1.5 : 0.85 ** y) : strat === "rebuild" ? (y === 0 ? 0.5 : 0.97 ** y) : 0.92 ** y;
    const sal = salaryInYear(p, y) * (y === 0 ? frac : 1) * (strat === "rebuild" ? 1.15 : 1);
    v += w * war * DOLLARS_PER_WAR - sal * 0.93 ** y;
  }
  // Prospects carry bust risk.
  if (!p.on40 && p.ovr < 45) v *= 0.8;
  if (p.injury && p.injury.days > 60) v *= 0.6;
  return Math.round(v * 10) / 10;
}

export interface TradeProposal {
  /** User's club. */
  from: number;
  to: number;
  give: number[];
  get: number[];
}

export interface TradeEval {
  ok: boolean;
  accept: boolean;
  /** AI's net gain, $M. */
  gain: number;
  valueIn: number;
  valueOut: number;
  msg: string;
}

const margins = { rookie: 0.5, pro: 2, allstar: 4 };

export function evaluateTrade(league: League, t: TradeProposal): TradeEval {
  const bad = (msg: string): TradeEval => ({ ok: false, accept: false, gain: 0, valueIn: 0, valueOut: 0, msg });
  if (league.phase === "postseason") return bad("Trades are frozen during the postseason.");
  if (league.phase === "regular" && league.day > league.calendar.deadlineDay) return bad("The trade deadline has passed.");
  if (!t.give.length && !t.get.length) return bad("Add players to the deal.");
  for (const id of t.give) if (league.players[id]?.team !== t.from) return bad("You can only trade your own players.");
  for (const id of t.get) if (league.players[id]?.team !== t.to) return bad("That player is not on their roster.");
  const ai = league.teams[t.to];
  const valueIn = t.give.reduce((s, id) => s + tradeValue(league, league.players[id], t.to), 0);
  const valueOut = t.get.reduce((s, id) => s + tradeValue(league, league.players[id], t.to), 0);
  const need = Math.max(margins[league.settings.difficulty] ?? 2, Math.abs(valueOut) * 0.08);
  const gain = valueIn - valueOut;
  const accept = gain >= need;
  let msg: string;
  if (accept) msg = `${ai.abbrev} accept.`;
  else if (gain > -need * 2) msg = `${ai.abbrev}: "Close, but we need a little more."`;
  else if (gain > -25) msg = `${ai.abbrev}: "Not enough value coming back."`;
  else msg = `${ai.abbrev}: "Not a chance."`;
  return { ok: true, accept, gain, valueIn, valueOut, msg };
}

export function executeTrade(league: League, a: number, b: number, aGives: number[], bGives: number[]): void {
  for (const id of aGives) {
    leaveTeam(league.players[id]);
    league.players[id].team = b;
  }
  for (const id of bGives) {
    leaveTeam(league.players[id]);
    league.players[id].team = a;
  }
  const names = (ids: number[]) => ids.map((id) => league.players[id].name).join(", ") || "cash considerations";
  news(league, `TRADE: ${league.teams[a].abbrev} send ${names(aGives)} to ${league.teams[b].abbrev} for ${names(bGives)}.`, a, "trade");
  league.tradeLog.push({ day: league.day, season: league.season, a, b, aGets: bGives, bGets: aGives });
  for (const tid of [a, b]) {
    // Remove traded players from the old depth chart.
    const t = league.teams[tid];
    const mine = (id: number) => league.players[id]?.team === tid;
    t.lineup = t.lineup.filter((s) => mine(s.id));
    t.rotation = t.rotation.filter(mine);
    t.setup = t.setup.filter(mine);
    if (t.closer != null && !mine(t.closer)) t.closer = null;
    normalizeRoster(league, tid, { offseason: league.phase !== "regular" });
    if (tid !== league.userTeam) autoDepth(league, tid);
  }
}

/** What the AI would ask for from the user's org to give up `want`. */
export function suggestPackage(league: League, ai: number, user: number, want: number[], exclude: number[] = []): number[] | null {
  const out0 = want.reduce((s, id) => s + tradeValue(league, league.players[id], ai), 0);
  const need = out0 + Math.max(margins[league.settings.difficulty] ?? 2, Math.abs(out0) * 0.08) + 0.5;
  const cands = orgPlayers(league, user)
    .filter((p) => !exclude.includes(p.id) && !want.includes(p.id))
    .map((p) => ({ p, v: tradeValue(league, p, ai) }))
    .filter((x) => x.v > 0.5)
    .sort((x, y) => x.v - y.v);
  if (need <= 0) return [];
  const single = cands.find((x) => x.v >= need);
  if (single) return [single.p.id];
  const out: number[] = [];
  let sum = 0;
  for (const x of [...cands].reverse()) {
    if (out.length >= 4) break;
    out.push(x.p.id);
    sum += x.v;
    if (sum >= need) return out;
  }
  return null;
}

/** AI-to-AI deals: contenders buy veterans from rebuilders with prospects. */
export function aiTradeTick(league: League, rng: FRng): void {
  if (!rng.chance(0.55)) return;
  const teams = Object.values(league.teams).filter((t) => t.id !== league.userTeam);
  const buyers = teams.filter((t) => t.strategy === "contend");
  const sellers = teams.filter((t) => t.strategy === "rebuild" || (t.strategy === "neutral" && t.w < t.l - 6));
  if (!buyers.length || !sellers.length) return;
  const buyer = rng.pick(buyers);
  const seller = rng.pick(sellers);
  const targets = orgPlayers(league, seller.id)
    .filter((p) => p.status === "active" && p.age >= 26 && p.ovr >= 50 && controlYears(p) <= 3 && !p.injury)
    .sort((a, b) => tradeValue(league, b, buyer.id) - tradeValue(league, a, buyer.id));
  for (const target of targets.slice(0, 3)) {
    // Buyer must actually improve: compare with his weakest regular at the spot.
    const mine = orgPlayers(league, buyer.id).filter((p) => p.status === "active" && p.pitcher === target.pitcher && (target.pitcher ? p.pos === target.pos : true));
    const worst = mine.sort((a, b) => a.ovr - b.ovr)[target.pitcher ? 0 : Math.min(mine.length - 1, 4)];
    if (worst && worst.ovr >= target.ovr - 2) continue;
    const pkg = suggestPackage(league, seller.id, buyer.id, [target.id]);
    if (!pkg?.length) continue;
    const buyerGives = pkg.reduce((s, id) => s + tradeValue(league, league.players[id], buyer.id), 0);
    if (tradeValue(league, target, buyer.id) < buyerGives - 3) continue;
    executeTrade(league, buyer.id, seller.id, pkg, [target.id]);
    return;
  }
}
