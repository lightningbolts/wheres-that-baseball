/**
 * Offseason: archive the season, service time, options, contract expirations
 * (free agency / arbitration tenders), retirements, development and aging, the
 * draft; then free agency; then a fresh schedule for the next season.
 */
import { advanceContract, arbSalary, optionExercised, payroll, preArbSalary, projectedWar } from "./contracts";
import { DOLLARS_PER_WAR } from "./data";
import { developPlayer, normalizeEnvironment, trackEnvironment } from "./development";
import { initFreeAgency, faFinished, faRound, freeAgents, signPlayer, askFor } from "./freeAgency";
import { resetLedger } from "./finances";
import { addGenerated, assignStrategies, expectedWins } from "./league";
import { clamp } from "./ratings";
import { FRng } from "./rng";
import { autoDepth, news, normalizeRoster, orgPlayers } from "./roster";
import { buildSchedule } from "./schedule";
import { sortTeams } from "./standings";
import type { League, Player } from "./types";

function retireChance(p: Player): number {
  if (p.age >= 41) return 1;
  if (!p.real && p.age >= 31 && p.ovr < 42) return 0.6;
  if (p.status === "fa" && p.age >= 33 && p.ovr < 46) return 0.55;
  if (p.age < 34) return 0;
  return clamp((p.age - 34) * 0.12 + (52 - p.ovr) * 0.035, 0, 0.95);
}

/** Templates for new draftees: reuse the physics templates of generated players already in the league. */
function poolFromLeague(league: League): Record<string, number[]> {
  const pool: Record<string, number[]> = { batL: [], batR: [], SPL: [], SPR: [], RPL: [], RPR: [] };
  for (const p of Object.values(league.players)) {
    if (!p.real || p.template == null) continue;
    const key = p.pitcher ? `${p.pos === "SP" ? "SP" : "RP"}${p.throws}` : p.bats === "L" ? "batL" : "batR";
    pool[key]?.push(p.template);
  }
  return pool;
}

export function startOffseason(league: League): void {
  if (league.phase !== "offseason") return;
  const rng = new FRng(league.rng);
  const season = league.season;
  const standings = sortTeams(league, Object.values(league.teams));
  trackEnvironment(league);
  for (const p of Object.values(league.players)) {
    if (p.status === "retired") continue;
    if (p.stats.bat || p.stats.pit) {
      p.history = [...(p.history ?? []), { season, team: p.team, bat: p.stats.bat, pit: p.stats.pit, ovr: p.ovr }].slice(-12);
    }
    const ab = p.stats.bat?.ab ?? 0;
    const outs = p.stats.pit?.outs ?? 0;
    p.service = Math.round((p.service + Math.min(1, p.mlbDays / 172)) * 100) / 100;
    p.rookie = !!p.rookie && ab < 130 && outs < 150 && p.mlbDays < 45;
    p.mlbDays = 0;
    if (p.optionedThisYear) p.options = Math.max(0, p.options - 1);
    p.optionedThisYear = false;
    p.stats = {};
    p.splits = undefined;
    p.post = undefined;
    p.pd = undefined;
    p.lastStart = undefined;
    p.streak = 0;
    if (p.injury) {
      p.injury.days -= 120;
      if (p.injury.days <= 0) p.injury = undefined;
    }
  }
  // Dead money rolls off.
  for (const t of Object.values(league.teams)) t.dead = t.dead.map((d) => ({ ...d, years: d.years - 1 })).filter((d) => d.years > 0);
  // Contracts.
  for (const p of Object.values(league.players)) {
    if (p.status === "retired" || p.status === "fa" || !p.team) continue;
    advanceContract(p.contract);
    if (p.contract.years > 0) continue;
    const t = league.teams[p.team];
    const opt = p.contract.option;
    if (opt) {
      const who = opt.type === "player" ? "player" : opt.type === "mutual" ? "mutual" : "club";
      if (optionExercised(p, opt)) {
        p.contract = { ...p.contract, aav: opt.salary, years: 1, salaries: [opt.salary], option: undefined, total: undefined, length: undefined };
        news(league, `${p.name}'s $${opt.salary.toFixed(1)}M ${who} option for ${season + 1} was exercised (${t.abbrev}).`, t.id, "signing");
        continue;
      }
      // Declined: the buyout is owed next season.
      if (opt.buyout > 0) t.dead.push({ aav: opt.buyout, years: 1, name: `${p.name} (buyout)` });
      news(league, `${p.name}'s ${who} option was declined${opt.buyout > 0 ? ` ($${opt.buyout.toFixed(1)}M buyout)` : ""} (${t.abbrev}).`, t.id, "signing");
      p.contract = { ...p.contract, option: undefined };
    }
    if (p.contract.kind === "minor" && !p.on40) {
      p.contract = { ...p.contract, years: 1, signed: season + 1 };
      continue;
    }
    if (p.service >= 6) {
      p.prevTeam = p.team;
      p.team = 0;
      p.status = "fa";
      p.on40 = false;
      news(league, `${p.name} (${t.abbrev}) became a free agent.`, t.id, "signing");
      continue;
    }
    if (p.service >= 3) {
      const sal = arbSalary(p);
      const worth = Math.max(0, projectedWar(p, 0)) * DOLLARS_PER_WAR;
      if (worth < sal * 0.75 && p.ovr < 50) {
        news(league, `${t.abbrev} non-tendered ${p.name}.`, t.id, "roster");
        p.prevTeam = p.team;
        p.team = 0;
        p.status = "fa";
        p.on40 = false;
        continue;
      }
      p.contract = { aav: sal, years: 1, kind: "arb", signed: season + 1 };
    } else p.contract = { aav: preArbSalary(p.service), years: 1, kind: "pre", signed: season + 1 };
  }
  // Retirements.
  for (const p of Object.values(league.players)) {
    if (p.status === "retired") continue;
    if (rng.chance(retireChance(p))) {
      if (p.real && p.ovr >= 50) news(league, `${p.name} announced his retirement.`, p.team || undefined, "info");
      p.status = "retired";
      p.team = 0;
      p.on40 = false;
    }
  }
  // Drop long-retired generated players to keep saves small.
  for (const p of Object.values(league.players)) if (p.status === "retired" && !p.real && !(p.history?.length)) delete league.players[p.id];
  // Development and aging.
  let breakout: { p: Player; d: number } | null = null;
  for (const p of Object.values(league.players)) {
    if (p.status === "retired") continue;
    const d = developPlayer(p, rng);
    p.age += 1;
    if (p.team === league.userTeam && (!breakout || d > breakout.d)) breakout = { p, d };
  }
  if (breakout && breakout.d >= 4) news(league, `Player development: ${breakout.p.name} improved by ${breakout.d} points this winter.`, league.userTeam, "info");
  // Draft: worst record picks first, 4 rounds.
  const pool = poolFromLeague(league);
  const order = [...standings].reverse();
  for (let round = 1; round <= 4; round += 1) {
    order.forEach((t, i) => {
      const tier = round === 1 && i < 8 ? "top" : round <= 2 ? "prospect" : "draft";
      const role = rng.chance(0.5) ? "bat" : rng.chance(0.65) ? "SP" : "RP";
      const p = addGenerated(league, rng, pool, t.id, role, tier);
      p.age = clamp(p.age, 18, 23);
      p.draft = { season, round };
      if (t.id === league.userTeam && round === 1) news(league, `Draft: you selected ${p.name} (${p.pos}, age ${p.age}, potential ${p.pot}) in round 1.`, t.id, "info");
    });
  }
  // A few new veteran free agents (released minor-league vets) refresh the pool.
  for (let i = 0; i < 15; i += 1) {
    const p = addGenerated(league, rng, pool, 0, i % 3 === 0 ? "SP" : i % 3 === 1 ? "RP" : "bat", "depth");
    p.age = 28 + rng.int(6);
    p.service = 3 + rng.int(4);
    p.rookie = false;
  }
  for (const t of Object.values(league.teams)) normalizeRoster(league, t.id, { offseason: true });
  league.rng = rng.s;
  initFreeAgency(league);
  news(league, `Free agency is open: ${freeAgents(league).length} players available.`, undefined, "info");
}

/** Run the remaining free-agency rounds. */
export function finishFreeAgency(league: League): void {
  let guard = 0;
  while (!faFinished(league) && guard++ < 20) faRound(league);
  // Leftover useful veterans take one-year deals with clubs that need them.
  const rng = new FRng(league.rng);
  const teams = Object.values(league.teams).filter((t) => t.id !== league.userTeam);
  for (const p of freeAgents(league).sort((a, b) => b.ovr - a.ovr)) {
    if (p.ovr < 47) break;
    const t = rng.pick(teams);
    if (payroll(league, t.id) + 3 > t.fin.budget * 1.05) continue;
    signPlayer(league, p, t.id, Math.max(0.8, askFor(league, p).aav * 0.6), 1);
  }
  league.rng = rng.s;
}

export function startNextSeason(league: League): void {
  if (league.phase !== "freeagency" && league.phase !== "preseason") return;
  if (!faFinished(league)) finishFreeAgency(league);
  league.season += 1;
  const { calendar, games } = buildSchedule(league.season, league.seed + league.season, 1);
  league.calendar = calendar;
  league.schedule = games;
  league.nextGameId = games.length + 1;
  league.day = 0;
  league.phase = "regular";
  league.bracket = undefined;
  league.fa = undefined;
  league.pending = undefined;
  for (const t of Object.values(league.teams)) {
    t.w = t.l = t.rs = t.ra = t.hw = t.hl = 0;
    t.last = [];
    t.rotIdx = 0;
    resetLedger(t.fin);
  }
  for (const t of Object.values(league.teams)) {
    normalizeRoster(league, t.id, { offseason: true });
    if (t.id !== league.userTeam) autoDepth(league, t.id);
  }
  // Rookie eligibility for the new season.
  for (const p of Object.values(league.players)) if (p.service < 1 && p.status !== "retired") p.rookie = p.rookie ?? true;
  normalizeEnvironment(league);
  assignStrategies(league);
  league.expected = expectedWins(league);
  news(league, `Opening Day ${league.season}! ${league.teams[league.userTeam].name} projected for ${league.expected[league.userTeam]} wins.`, league.userTeam, "info");
}

export const orgSize = (league: League, teamId: number): number => orgPlayers(league, teamId).length;
