/** Build a new franchise league from the real rosters (plus generated depth and free agents). */
import type { RosterFile, RosterPlayer } from "@/lib/game/types";
import { MLB_TEAMS } from "@/lib/mlb/teams";
import { estimateService, payroll, synthContract } from "./contracts";
import { refTicketPrice } from "./data";
import { talentEnv } from "./development";
import { newFinances } from "./finances";
import { generatePlayer, prospectProfile, type GenRole } from "./generate";
import { batSkillFrom, fieldPos, overall, pitSkillFrom, playerWar } from "./ratings";
import { FRng, hashUnit } from "./rng";
import { normalizeRoster, orgPlayers } from "./roster";
import { buildSchedule } from "./schedule";
import type { League, Player, Strategy, TeamState } from "./types";

export const FRANCHISE_VERSION = 1;
export const FIRST_SEASON = 2027;
export const GEN_ID_BASE = 9_000_000;

export interface NewLeagueOpts {
  userTeam: number;
  seed: number;
  difficulty?: League["settings"]["difficulty"];
}

function realPlayer(rp: RosterPlayer, kind: "lineup" | "bench" | "rotation" | "bullpen", teamId: number, ageShift: number, season: number): Player {
  const pitcher = kind === "rotation" || kind === "bullpen";
  const p: Player = {
    id: rp.id,
    name: rp.name,
    age: (rp.age ?? 28) + ageShift,
    bats: (rp.bats ?? "R") as Player["bats"],
    throws: (rp.throws ?? "R") as Player["throws"],
    pos: pitcher ? (kind === "rotation" ? "SP" : "RP") : fieldPos(rp.pos),
    pitcher,
    bat: pitcher ? undefined : batSkillFrom(rp),
    pit: pitcher ? pitSkillFrom(rp) : undefined,
    ovr: 0,
    pot: 0,
    service: 0,
    options: 0,
    contract: { aav: 0.8, years: 1, kind: "pre", signed: season },
    team: teamId,
    status: "active",
    on40: true,
    real: true,
    template: rp.id,
    mlbDays: 0,
    stats: {},
  };
  // A starter with reliever stamina in the data still starts for his club.
  if (p.pit && kind === "rotation" && p.pit.stam < 60) p.pit.stam = 75;
  p.bat0 = p.bat ? { ...p.bat } : undefined;
  p.pit0 = p.pit ? { ...p.pit } : undefined;
  p.ovr = overall(p);
  const young = Math.max(0, 27 - p.age);
  p.pot = Math.max(p.ovr, Math.round(p.ovr + young * (1.2 + hashUnit(p.id, "pot") * 1.6) - 1));
  p.service = estimateService(p);
  p.options = p.service >= 5 ? 0 : Math.max(0, 3 - Math.floor(p.service * 0.7 + hashUnit(p.id, "opt") * 1.2));
  p.contract = synthContract(p, season, teamId);
  p.rookie = p.service < 1;
  return p;
}

export function teamStrength(league: League, teamId: number): number {
  const org = orgPlayers(league, teamId).filter((p) => p.status === "active" || p.status === "il");
  const hitters = org.filter((p) => !p.pitcher).map(playerWar).sort((a, b) => b - a).slice(0, 10);
  const sps = org.filter((p) => p.pitcher && p.pos === "SP").map(playerWar).sort((a, b) => b - a).slice(0, 5);
  const rps = org.filter((p) => p.pitcher && p.pos === "RP").map(playerWar).sort((a, b) => b - a).slice(0, 7);
  return hitters.reduce((s, x, i) => s + x * (i < 9 ? 1 : 0.4), 0) + sps.reduce((s, x) => s + x, 0) + rps.reduce((s, x) => s + x, 0);
}

/** Expected wins from roster strength (≈ 48 + total WAR, spread to MLB-like range). */
export function expectedWins(league: League): Record<number, number> {
  const s = Object.values(league.teams).map((t) => [t.id, teamStrength(league, t.id)] as const);
  const mean = s.reduce((a, [, v]) => a + v, 0) / s.length;
  const out: Record<number, number> = {};
  for (const [id, v] of s) out[id] = Math.round(81 + (v - mean) * 0.85);
  return out;
}

export function assignStrategies(league: League): void {
  const exp = expectedWins(league);
  const ranked = Object.keys(exp).map(Number).sort((a, b) => exp[b] - exp[a]);
  ranked.forEach((id, i) => {
    const s: Strategy = i < 12 ? "contend" : i >= 22 ? "rebuild" : "neutral";
    league.teams[id].strategy = s;
  });
}

export function templatePool(rosters: RosterFile): Record<string, number[]> {
  const pool: Record<string, number[]> = { batL: [], batR: [], SPL: [], SPR: [], RPL: [], RPR: [] };
  for (const t of Object.values(rosters.teams)) {
    for (const p of [...t.lineup, ...t.bench]) if (p.bat) pool[p.bats === "L" ? "batL" : "batR"].push(p.id);
    for (const p of t.rotation) if (p.pitch) pool[p.throws === "L" ? "SPL" : "SPR"].push(p.id);
    for (const p of t.bullpen) if (p.pitch) pool[p.throws === "L" ? "RPL" : "RPR"].push(p.id);
  }
  return pool;
}

export function pickTemplate(pool: Record<string, number[]>, p: Player): number | undefined {
  const key = p.pitcher ? `${p.pos === "SP" ? "SP" : "RP"}${p.throws}` : p.bats === "L" ? "batL" : "batR";
  const list = pool[key]?.length ? pool[key] : pool[p.pitcher ? "RPR" : "batR"];
  return list?.length ? list[Math.floor(hashUnit(p.id, "tmpl") * list.length)] : undefined;
}

export function addGenerated(league: League, rng: FRng, pool: Record<string, number[]>, team: number, role: GenRole, tier: Parameters<typeof prospectProfile>[1], opts: { on40?: boolean; pos?: Player["pos"] } = {}): Player {
  const prof = prospectProfile(rng, tier);
  const id = league.nextId++;
  const p = generatePlayer(rng, { id, role, age: prof.age, ovr: prof.ovr, pot: prof.pot, team, pos: opts.pos });
  p.template = pickTemplate(pool, p);
  p.on40 = !!opts.on40;
  p.status = team === 0 ? "fa" : "minors";
  p.rookie = true;
  if (p.on40) p.contract = { aav: 0.8, years: 1, kind: "pre", signed: league.season };
  league.players[id] = p;
  return p;
}

export function createLeague(rosters: RosterFile, opts: NewLeagueOpts): League {
  const season = FIRST_SEASON;
  const rng = new FRng(opts.seed);
  const sched = buildSchedule(season, opts.seed);
  const league: League = {
    version: FRANCHISE_VERSION,
    seed: opts.seed,
    rng: 0,
    season,
    userTeam: opts.userTeam,
    day: 0,
    phase: "regular",
    calendar: sched.calendar,
    players: {},
    teams: {},
    schedule: sched.games,
    news: [],
    awards: [],
    champions: [],
    nextId: GEN_ID_BASE,
    nextGameId: sched.games.length + 1,
    settings: { difficulty: opts.difficulty ?? "pro", autoRoster: true },
    tradeLog: [],
  };
  const ageShift = season - rosters.season;
  const pool = templatePool(rosters);
  for (const mt of MLB_TEAMS) {
    const rt = rosters.teams[String(mt.id)];
    const t: TeamState = {
      id: mt.id,
      abbrev: mt.abbrev,
      name: mt.name,
      league: mt.league,
      division: mt.division,
      lineup: [],
      rotation: [],
      rotIdx: 0,
      closer: null,
      setup: [],
      w: 0,
      l: 0,
      rs: 0,
      ra: 0,
      hw: 0,
      hl: 0,
      last: [],
      ticketPrice: refTicketPrice(mt.id),
      strategy: "neutral",
      fin: newFinances(mt.id, 0),
      dead: [],
    };
    league.teams[mt.id] = t;
    if (!rt) continue;
    for (const kind of ["lineup", "bench", "rotation", "bullpen"] as const) {
      for (const rp of rt[kind]) {
        if (league.players[rp.id]) continue;
        const p = realPlayer(rp, kind, mt.id, ageShift, season);
        league.players[p.id] = p;
        if (kind === "lineup") t.lineup.push({ id: p.id, pos: p.pos === "SP" || p.pos === "RP" ? "DH" : (p.pos as TeamState["lineup"][number]["pos"]) });
        if (kind === "rotation") t.rotation.push(p.id);
      }
    }
    const pen = rt.bullpen.map((p) => league.players[p.id]).filter((p) => p && p.team === mt.id);
    const sv = (id: number) => rt.bullpen.find((x) => x.id === id)?.sav?.sv ?? 0;
    pen.sort((a, b) => sv(b.id) - sv(a.id) || b.ovr - a.ovr);
    t.closer = pen[0]?.id ?? null;
    t.setup = pen
      .slice(1)
      .sort((a, b) => b.ovr - a.ovr)
      .slice(0, 2)
      .map((p) => p.id);
    // Organizational depth: 40-man depth and prospects, then non-roster minor leaguers.
    const fortyTiers: Array<[GenRole, Parameters<typeof prospectProfile>[1], Player["pos"]?]> = [
      ["SP", "depth"],
      ["SP", "prospect"],
      ["SP", "top"],
      ["RP", "depth"],
      ["RP", "depth"],
      ["RP", "prospect"],
      ["bat", "depth", "C"],
      ["bat", "depth", "SS"],
      ["bat", "depth", "CF"],
      ["bat", "prospect"],
      ["bat", "prospect"],
      ["bat", "top"],
      ["bat", "depth"],
      ["RP", "depth"],
    ];
    for (const [role, tier, pos] of fortyTiers) addGenerated(league, rng, pool, mt.id, role, tier, { on40: true, pos });
    const minorTiers: Array<[GenRole, Parameters<typeof prospectProfile>[1], Player["pos"]?]> = [
      ["SP", "prospect"],
      ["SP", "draft"],
      ["SP", "depth"],
      ["RP", "depth"],
      ["RP", "draft"],
      ["RP", "depth"],
      ["bat", "prospect"],
      ["bat", "draft"],
      ["bat", "draft"],
      ["bat", "depth", "C"],
      ["bat", "depth"],
      ["bat", "depth"],
    ];
    for (const [role, tier, pos] of minorTiers) addGenerated(league, rng, pool, mt.id, role, tier, { pos });
  }
  // Unsigned veterans (in-season free-agent pool).
  for (let i = 0; i < 45; i += 1) {
    const role: GenRole = i % 3 === 0 ? "SP" : i % 3 === 1 ? "RP" : "bat";
    const p = addGenerated(league, rng, pool, 0, role, "depth");
    p.age = 29 + rng.int(7);
    p.service = Math.max(1, p.age - 25 + rng.int(3));
    p.options = 0;
    p.rookie = false;
  }
  for (const t of Object.values(league.teams)) {
    normalizeRoster(league, t.id, { offseason: true });
    t.fin = newFinances(t.id, payroll(league, t.id));
  }
  assignStrategies(league);
  league.expected = expectedWins(league);
  league.env = talentEnv(league) ?? undefined;
  league.news = [{ day: 0, text: `Welcome to the ${season} season. You are the GM of the ${league.teams[opts.userTeam].name}.`, team: opts.userTeam, kind: "info" }];
  league.rng = rng.s;
  return league;
}
