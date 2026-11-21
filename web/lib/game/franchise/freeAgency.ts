/**
 * Free agency. Offseason: expiring veterans hit the market with asking terms; each
 * "round" AI clubs bid within their budgets on players who fill a need, the user can
 * bid too, and players take the best offer once it clears their (falling) ask.
 * In season: unsigned players can be signed on one-year deals at their ask.
 */
import { askingTerms, committed, projectedWar } from "./contracts";
import { MIN_SALARY } from "./data";
import { clamp } from "./ratings";
import { FRng } from "./rng";
import { FORTY_MAX, fortyMan, isHuman, news, normalizeRoster, orgPlayers } from "./roster";
import type { FaOffer, League, Player } from "./types";

export const FA_ROUNDS = 10;

export const freeAgents = (league: League): Player[] => Object.values(league.players).filter((p) => p.status === "fa");

export function initFreeAgency(league: League): void {
  const ask: Record<number, { aav: number; years: number }> = {};
  for (const p of freeAgents(league)) ask[p.id] = askingTerms(p);
  league.fa = { round: 0, rounds: FA_ROUNDS, offers: {}, ask };
  league.phase = "freeagency";
}

export function askFor(league: League, p: Player): { aav: number; years: number } {
  if (league.phase !== "freeagency") return inSeasonAsk(p);
  return league.fa?.ask[p.id] ?? askingTerms(p);
}

export function signPlayer(league: League, p: Player, teamId: number, aav: number, years: number, inSeason = false): void {
  const t = league.teams[teamId];
  p.team = teamId;
  p.contract = { aav: Math.round(aav * 10) / 10, years, kind: aav > MIN_SALARY + 0.05 || years > 1 ? "fa" : "minor", signed: league.season };
  const mlbDeal = p.contract.kind === "fa" || p.ovr >= 45;
  p.on40 = mlbDeal;
  p.status = mlbDeal ? "active" : "minors";
  if (mlbDeal && fortyMan(league, teamId).length > FORTY_MAX) {
    // Make room: outright the least valuable minor leaguer on the 40-man.
    const cut = fortyMan(league, teamId)
      .filter((x) => x.status === "minors" && x.id !== p.id)
      .sort((a, b) => a.ovr - b.ovr)[0];
    if (cut) cut.on40 = false;
  }
  news(league, `${t.abbrev} signed ${p.name} (${years} yr${years > 1 ? "s" : ""}, $${p.contract.aav.toFixed(1)}M/yr).`, teamId, "signing");
  if (league.fa) delete league.fa.offers[p.id];
  normalizeRoster(league, teamId, { offseason: !inSeason });
}

export interface OfferCheck {
  ok: boolean;
  msg: string;
  /** 0–100 likelihood the player accepts as things stand. */
  interest: number;
}

export function offerInterest(league: League, p: Player, aav: number, years: number): number {
  const ask = askFor(league, p);
  const ratio = (aav / Math.max(0.5, ask.aav)) * (1 + clamp(years - ask.years, -2, 2) * 0.06);
  return Math.round(clamp((ratio - 0.8) * 250, 0, 100));
}

export function makeOffer(league: League, playerId: number, aav: number, years: number): OfferCheck {
  const p = league.players[playerId];
  if (!p || p.status !== "fa") return { ok: false, msg: "Not a free agent.", interest: 0 };
  if (aav < MIN_SALARY || years < 1 || years > 10) return { ok: false, msg: "Offer 1–10 years at the league minimum or more.", interest: 0 };
  const interest = offerInterest(league, p, aav, years);
  if (league.phase !== "freeagency") {
    // In season (or before free agency opens): sign now on accepting terms.
    if (interest < 60) return { ok: false, msg: `${p.name} wants about $${askFor(league, p).aav.toFixed(1)}M.`, interest };
    signPlayer(league, p, league.userTeam, aav, years, league.phase === "regular");
    return { ok: true, msg: `${p.name} signed!`, interest };
  }
  const fa = league.fa!;
  const offers = (fa.offers[p.id] ??= []).filter((o) => o.team !== league.userTeam);
  offers.push({ team: league.userTeam, aav, years, round: fa.round });
  fa.offers[p.id] = offers;
  return { ok: true, msg: `Offer to ${p.name} submitted (${interest}% interest).`, interest };
}

export function withdrawOffer(league: League, playerId: number): void {
  if (!league.fa?.offers[playerId]) return;
  league.fa.offers[playerId] = league.fa.offers[playerId].filter((o) => o.team !== league.userTeam);
}

/** Positional need: how much this FA would upgrade the club's weakest comparable regular. */
function upgrade(league: League, teamId: number, p: Player): number {
  const org = orgPlayers(league, teamId).filter((x) => x.on40 || x.status === "active");
  const same = org.filter((x) => (p.pitcher ? x.pitcher && x.pos === p.pos : !x.pitcher)).sort((a, b) => b.ovr - a.ovr);
  const slots = p.pitcher ? (p.pos === "SP" ? 5 : 7) : 10;
  const nth = same[slots - 1];
  return p.ovr - (nth?.ovr ?? 30);
}

function aiBids(league: League, rng: FRng): void {
  const fa = league.fa!;
  const pool = freeAgents(league).sort((a, b) => projectedWar(b, 0) - projectedWar(a, 0));
  const teams = rng.shuffle(Object.values(league.teams).filter((t) => !isHuman(league, t.id)));
  for (const t of teams) {
    let room = t.fin.budget - committed(league, t.id, 0);
    // Pending bids count against the budget.
    for (const offers of Object.values(fa.offers)) for (const o of offers) if (o.team === t.id) room -= o.aav;
    let made = 0;
    for (const p of pool) {
      if (made >= 2 || room < MIN_SALARY) break;
      const ask = fa.ask[p.id] ?? askingTerms(p);
      if ((fa.offers[p.id] ?? []).some((o) => o.team === t.id)) continue;
      const up = upgrade(league, t.id, p);
      if (up < 2 && !(p.ovr >= 55 && t.strategy === "contend")) continue;
      if (t.strategy === "rebuild" && p.age >= 31 && ask.years > 1) continue;
      const aav = Math.round(ask.aav * rng.range(0.82, 1.1) * 10) / 10;
      if (aav > room) continue;
      const years = clamp(ask.years + (rng.chance(0.3) ? (rng.chance(0.5) ? 1 : -1) : 0), 1, 10);
      (fa.offers[p.id] ??= []).push({ team: t.id, aav, years, round: fa.round });
      room -= aav;
      made += 1;
    }
  }
}

function offerScore(league: League, p: Player, o: FaOffer): number {
  const ask = league.fa!.ask[p.id] ?? askingTerms(p);
  const t = league.teams[o.team];
  const exp = league.expected?.[o.team] ?? 81;
  const yearsPref = p.age >= 30 ? 0.08 : 0.03;
  return o.aav * (1 + clamp(o.years - ask.years, -3, 3) * yearsPref) + (exp - 81) * 0.06 + (p.prevTeam === o.team ? 0.4 : 0) + (t.strategy === "contend" ? 0.3 : 0);
}

/** Advance free agency one round. Returns players signed this round. */
export function faRound(league: League): number[] {
  if (league.phase !== "freeagency" || !league.fa) return [];
  const rng = new FRng(league.rng);
  const fa = league.fa;
  aiBids(league, rng);
  const signed: number[] = [];
  for (const p of freeAgents(league)) {
    const offers = fa.offers[p.id];
    if (!offers?.length) continue;
    const ask = fa.ask[p.id] ?? askingTerms(p);
    const best = offers.reduce((a, b) => (offerScore(league, p, b) > offerScore(league, p, a) ? b : a));
    const lastCall = fa.round >= fa.rounds - 1;
    const patience = 1 - fa.round * 0.035;
    const threshold = ask.aav * patience * rng.range(0.9, 1.02);
    if (best.aav >= threshold || lastCall || (offers.length >= 3 && rng.chance(0.35))) {
      if (best.team === league.userTeam) news(league, `${p.name} accepted your offer!`, league.userTeam, "signing");
      signPlayer(league, p, best.team, best.aav, best.years);
      signed.push(p.id);
    }
  }
  // Unsigned asks soften.
  for (const p of freeAgents(league)) {
    const a = fa.ask[p.id] ?? askingTerms(p);
    fa.ask[p.id] = { aav: Math.max(MIN_SALARY, Math.round(a.aav * 0.94 * 10) / 10), years: a.years > 1 && fa.round >= 5 ? a.years - 1 : a.years };
  }
  fa.round += 1;
  league.rng = rng.s;
  return signed;
}

export const faFinished = (league: League): boolean => !league.fa || league.fa.round >= league.fa.rounds;

/** In-season signing at the player's (one-year) ask. */
export function inSeasonAsk(p: Player): { aav: number; years: number } {
  const a = askingTerms(p);
  return { aav: Math.max(MIN_SALARY, Math.round(a.aav * 0.6 * 10) / 10), years: 1 };
}
