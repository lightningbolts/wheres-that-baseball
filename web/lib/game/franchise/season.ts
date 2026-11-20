/**
 * Day-by-day season engine: plays the day's games, applies results (standings,
 * stats, rotation turns, gates, injuries), runs the calendar (trade deadline,
 * end of regular season → awards + bracket, postseason → champion → offseason).
 */
import { buildGameLog, emitGameLog } from "./gamelog";
import { attendance, accrueDay, closeSeasonBooks, recordGate } from "./finances";
import { expectedWins } from "./league";
import { buildBracket, onPostseasonResult, schedulePostseasonDay } from "./postseason";
import { club } from "./data";
import { FRng, hash32 } from "./rng";
import { isHealthy, news, normalizeRoster, repairDepth } from "./roster";
import { chooseStarter, recordLines, simGame, type GameOutcome } from "./sim";
import { computeAwards, selectAllStars } from "./awards";
import { aiTradeTick } from "./trades";
import type { League, Player, ScheduledGame } from "./types";
import { ensureUmpires, plateUmp } from "./umpires";
import { simUmpCard, zoneRateEffect } from "@/lib/game/umpires/scorecard";

export const gamesOn = (league: League, day: number): ScheduledGame[] => league.schedule.filter((g) => g.day === day);

export function userGameToday(league: League): ScheduledGame | null {
  return gamesOn(league, league.day).find((g) => !g.result && (g.home === league.userTeam || g.away === league.userTeam)) ?? null;
}

export function nextUserGame(league: League): ScheduledGame | null {
  let best: ScheduledGame | null = null;
  for (const g of league.schedule) {
    if (g.result || (g.home !== league.userTeam && g.away !== league.userTeam)) continue;
    if (!best || g.day < best.day) best = g;
  }
  return best;
}

export const tradesOpen = (league: League): boolean =>
  league.phase === "offseason" || league.phase === "freeagency" || league.phase === "preseason" || (league.phase === "regular" && league.day <= league.calendar.deadlineDay);

const INJURIES_BAT = ["hamstring strain", "oblique strain", "ankle sprain", "wrist contusion", "back tightness", "knee sprain", "concussion", "calf strain", "fractured finger", "hip flexor strain", "shoulder strain"];
const INJURIES_PIT = ["shoulder inflammation", "elbow inflammation", "forearm strain", "lat strain", "oblique strain", "blister", "back spasms", "rotator cuff strain", "UCL sprain"];

function injure(league: League, p: Player, rng: FRng): void {
  const r = rng.next();
  const days = r < 0.55 ? 10 + rng.int(11) : r < 0.83 ? 20 + rng.int(26) : r < 0.96 ? 45 + rng.int(56) : 100 + rng.int(100);
  const list = p.pitcher ? INJURIES_PIT : INJURIES_BAT;
  let desc = rng.pick(list);
  if (days >= 120 && p.pitcher) desc = "UCL tear (Tommy John surgery)";
  const il = days >= 60 ? 60 : p.pitcher ? 15 : 10;
  p.injury = { days, desc, il };
  const t = league.teams[p.team];
  if (t) news(league, `${t.abbrev}: ${p.name} to the ${il}-day IL (${desc}, ~${days} days).`, t.id, "injury");
}

function rollInjuries(league: League, out: GameOutcome, rng: FRng, post: boolean): Set<number> {
  const hit = new Set<number>();
  const scale = post ? 0.5 : 1;
  const ageF = (p: Player) => 1 + Math.max(0, p.age - 30) * 0.06;
  for (const [id] of out.bat) {
    const p = league.players[id];
    if (p && isHealthy(p) && rng.chance(0.0024 * ageF(p) * scale)) {
      injure(league, p, rng);
      hit.add(p.team);
    }
  }
  for (const [id, l] of out.pit) {
    const p = league.players[id];
    if (p && isHealthy(p) && rng.chance((l.gs ? 0.011 : 0.005) * ageF(p) * scale)) {
      injure(league, p, rng);
      hit.add(p.team);
    }
  }
  return hit;
}

/** Apply a finished game (simmed or played manually) to the league. */
export function applyGameResult(league: League, g: ScheduledGame, out: GameOutcome, rng: FRng, manual = false): void {
  const post = !!g.ps;
  const away = league.teams[g.away];
  const home = league.teams[g.home];
  // Postseason dates sell out.
  const att = post ? club(home.id).capacity : attendance(league, home, g.day, rng);
  g.result = { as: out.awayRuns, hs: out.homeRuns, inn: out.innings, wp: out.wp, lp: out.lp, sv: out.sv, manual: manual || undefined, att };
  if (out.uc) g.uc = out.uc;
  recordLines(league, out, g.day, post);
  if (!post) {
    const homeWon = out.homeRuns > out.awayRuns;
    away.rs += out.awayRuns;
    away.ra += out.homeRuns;
    home.rs += out.homeRuns;
    home.ra += out.awayRuns;
    if (homeWon) {
      home.w += 1;
      home.hw += 1;
      away.l += 1;
    } else {
      away.w += 1;
      home.l += 1;
      home.hl += 1;
    }
    home.last = [...home.last, homeWon ? "W" : "L"].slice(-20);
    away.last = [...away.last, homeWon ? "L" : "W"].slice(-20);
    recordGate(league, home, att);
  } else {
    recordGate(league, home, att, true);
    onPostseasonResult(league, g);
  }
  // Rotation turns.
  for (const [t, sp] of [
    [away, out.starters[0]],
    [home, out.starters[1]],
  ] as const) {
    const i = t.rotation.indexOf(sp);
    t.rotIdx = i >= 0 ? (i + 1) % Math.max(1, t.rotation.length) : (t.rotIdx + 1) % Math.max(1, t.rotation.length);
    // Catchers who sat get their legs back.
    for (const p of Object.values(league.players)) if (p.team === t.id && p.pos === "C" && !out.bat.has(p.id)) p.streak = 0;
  }
  for (const tid of rollInjuries(league, out, rng, post)) normalizeRoster(league, tid);
  if (league.pending?.gameId === g.id) league.pending = undefined;
}

export function playScheduledGame(league: League, g: ScheduledGame, rng: FRng): GameOutcome {
  const away = league.teams[g.away];
  const home = league.teams[g.home];
  const post = !!g.ps;
  const minGap = post ? 4 : 5;
  if (g.ump == null) ensureUmpires(league);
  const ump = plateUmp(g);
  const out = simGame({
    league,
    away,
    home,
    day: g.day,
    rng,
    awayStarter: chooseStarter(league, away, g.day, minGap),
    homeStarter: chooseStarter(league, home, g.day, minGap),
    postseason: post,
    zone: ump ? zoneRateEffect(ump) : undefined,
  });
  if (ump) {
    // Its own stream, so the scorecard never shifts the league's dice.
    let pitches = 0;
    for (const n of out.pitches.values()) pitches += n;
    out.uc = simUmpCard(ump, pitches, out.innings, new FRng(hash32(league.seed, league.season, g.id, "ump-card")));
  }
  applyGameResult(league, g, out, rng);
  const log = buildGameLog(g, league.season, out, (id) => league.players[id]?.name);
  if (log) emitGameLog(log);
  return out;
}

/** Postseason: schedule today's games if needed (idempotent). */
export function prepareDay(league: League): void {
  if (league.phase === "postseason") schedulePostseasonDay(league);
  // Plate umpires for any game without one (new postseason games, older saves).
  ensureUmpires(league);
  if (league.settings.autoRoster && (league.phase === "regular" || league.phase === "postseason")) repairDepth(league, league.userTeam);
}

function endRegularSeason(league: League): void {
  const awards = computeAwards(league);
  league.awards.push(awards);
  for (const lg of ["AL", "NL"] as const) {
    const n = (id: number) => (id ? `${league.players[id]?.name} (${league.teams[league.players[id]?.team]?.abbrev ?? "FA"})` : "—");
    news(league, `${lg} MVP: ${n(awards.mvp[lg])} · Cy Young: ${n(awards.cy[lg])} · Rookie of the Year: ${n(awards.roy[lg])}`, undefined, "award");
    news(league, `${lg} Hank Aaron Award: ${n(awards.aaron?.[lg]?.id ?? 0)} · Reliever of the Year: ${n(awards.relief?.[lg]?.id ?? 0)}`, undefined, "award");
  }
  league.phase = "postseason";
  league.bracket = buildBracket(league);
  for (const p of Object.values(league.players)) p.post = undefined;
  const seeds = league.bracket.seeds;
  const userIn = seeds.AL.includes(league.userTeam) || seeds.NL.includes(league.userTeam);
  news(league, userIn ? `The ${league.teams[league.userTeam].name} are in the postseason!` : `The ${league.teams[league.userTeam].name} missed the postseason.`, league.userTeam, "info");
}

function endOfDay(league: League, rng: FRng): void {
  const touched = new Set<number>();
  for (const p of Object.values(league.players)) {
    if (p.injury && p.injury.days > 0) {
      p.injury.days -= 1;
      if (p.injury.days <= 0 && p.team) touched.add(p.team);
    }
    if (league.phase === "regular" && p.status === "active") p.mlbDays += 1;
  }
  for (const tid of touched) normalizeRoster(league, tid);
  // An auto-managed club re-checks its lineup and rotation daily (regulars back, nobody out of position).
  if (league.settings.autoRoster && !touched.has(league.userTeam)) repairDepth(league, league.userTeam);
  if (league.phase === "regular") {
    accrueDay(league);
    if (league.day >= 14 && league.day <= league.calendar.deadlineDay && league.day % 6 === 3) aiTradeTick(league, rng);
    if (league.day === league.calendar.asb[0] - 1 && !league.allStars?.[league.season]) selectAllStars(league);
    if (league.day === league.calendar.deadlineDay) news(league, "The trade deadline has passed. No more trades until the offseason.", undefined, "info");
  }
}

/**
 * Finish today: sim every unplayed game (the user's too, unless played manually
 * first), then roll the calendar forward one day.
 */
export function advanceDay(league: League): void {
  const rng = new FRng(league.rng);
  prepareDay(league);
  for (const g of gamesOn(league, league.day)) if (!g.result) playScheduledGame(league, g, rng);
  endOfDay(league, rng);
  league.day += 1;
  if (league.phase === "regular" && league.day > league.calendar.endDay && league.schedule.every((g) => g.ps || g.result)) {
    endRegularSeason(league);
  }
  if (league.phase === "postseason") {
    if (league.bracket?.champion) {
      const champ = league.teams[league.bracket.champion];
      news(league, `The ${champ.name} are the ${league.season} World Series champions!`, champ.id, "award");
      closeSeasonBooks(league, league.expected ?? expectedWins(league));
      league.phase = "offseason";
    } else prepareDay(league);
  }
  league.rng = rng.s;
}

export type SimTarget = "day" | "week" | "deadline" | "season" | "postseason" | "series";

export function simDone(league: League, target: SimTarget, startDay: number): boolean {
  switch (target) {
    case "day":
      return league.day > startDay;
    case "week":
      return league.day >= startDay + 7 || league.phase !== "regular";
    case "deadline":
      return league.phase !== "regular" || league.day > league.calendar.deadlineDay;
    case "season":
      return league.phase !== "regular";
    case "postseason":
      return league.phase !== "postseason" && league.phase !== "regular";
    case "series":
      return league.phase !== "postseason" || league.day > startDay;
  }
}

/** Synchronous multi-day sim (tests / workers). `stopAtUserGame` halts on a day the user plays. */
export function simUntil(league: League, target: SimTarget, opts: { stopAtUserGame?: boolean; maxDays?: number } = {}): number {
  const start = league.day;
  let n = 0;
  while (!simDone(league, target, start) && n < (opts.maxDays ?? 400)) {
    if (league.phase !== "regular" && league.phase !== "postseason") break;
    if (opts.stopAtUserGame && n > 0 && userGameToday(league)) break;
    advanceDay(league);
    n += 1;
  }
  return n;
}
