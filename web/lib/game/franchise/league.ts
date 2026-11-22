/** Build a new franchise league from the real rosters (plus generated depth and free agents). */
import type { RosterFile, RosterPlayer } from "@/lib/game/types";
import { MLB_TEAMS } from "@/lib/mlb/teams";
import { askingTerms, estimateService, payroll, realContract, synthContract, type ContractFile } from "./contracts";
import { refTicketPrice } from "./data";
import { talentEnv } from "./development";
import { newFinances, openingBudget } from "./finances";
import { freeAgents, initFreeAgency } from "./freeAgency";
import { generatePlayer, prospectProfile, type GenRole } from "./generate";
import { batSkillFrom, fieldPos, gradeScale, overall, pitSkillFrom, playerWar } from "./ratings";
import { FRng, hashUnit } from "./rng";
import { addRealProspects } from "./prospects";
import { projectRosterPlayer, type ProjectionFile } from "./projections";
import { autoDepth, isHuman, news, normalizeRoster, orgPlayers } from "./roster";
import { buildSchedule } from "./schedule";
import type { League, Player, Strategy, TeamState } from "./types";
import { ensureUmpires } from "./umpires";

export const FRANCHISE_VERSION = 1;
export const FIRST_SEASON = 2027;
export const GEN_ID_BASE = 9_000_000;

export interface NewLeagueOpts {
  userTeam: number;
  seed: number;
  difficulty?: League["settings"]["difficulty"];
  /** Multi-year projections; without them ratings come from 2026 alone. */
  proj?: ProjectionFile;
  /** Real contracts and service time; without them every deal is estimated. */
  contracts?: ContractFile;
  /** First season (default FIRST_SEASON); backtests start an earlier one. */
  season?: number;
  /** Seed each farm with its real MLB Pipeline top 30 (default true). */
  realProspects?: boolean;
}

/** Minor-league options left for a real player entering the franchise, from his service time. */
const startingOptions = (p: Player): number =>
  p.service >= 5 ? 0 : Math.max(0, 3 - Math.floor(p.service * 0.7 + hashUnit(p.id, "opt") * 1.2));

function realPlayer(rp0: RosterPlayer, kind: "lineup" | "bench" | "rotation" | "bullpen", teamId: number, ageShift: number, season: number, proj?: ProjectionFile, contracts?: ContractFile): Player {
  const pitcher = kind === "rotation" || kind === "bullpen";
  const rp = projectRosterPlayer(rp0, proj, pitcher);
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
  p.pot = Math.max(p.ovr, Math.min(80, Math.round(p.ovr + (young * (1.2 + hashUnit(p.id, "pot") * 1.6) - 1) * gradeScale(p))));
  // Real deal and service time when the payroll snapshot lists him; otherwise estimated.
  const deal = contracts?.season === season ? contracts.players[String(rp.id)] : undefined;
  p.service = deal?.svc ?? estimateService(p);
  p.options = startingOptions(p);
  p.contract = deal ? realContract(p, deal, season) : { ...synthContract(p, season, teamId), est: true };
  p.rookie = p.service < 1;
  // MLB rookie limits (130 AB / 50 IP) from the real career totals when known.
  const career = proj?.players[String(rp.id)];
  if (career) p.rookie = (career.bat?.career ?? 0) < 145 && (career.pit?.career ?? 0) < 215;
  return p;
}

export function teamStrength(league: League, teamId: number): number {
  const org = orgPlayers(league, teamId).filter((p) => p.status === "active" || p.status === "il");
  const hitters = org.filter((p) => !p.pitcher).map(playerWar).sort((a, b) => b - a).slice(0, 10);
  const sps = org.filter((p) => p.pitcher && p.pos === "SP").map(playerWar).sort((a, b) => b - a).slice(0, 5);
  const rps = org.filter((p) => p.pitcher && p.pos === "RP").map(playerWar).sort((a, b) => b - a).slice(0, 7);
  return hitters.reduce((s, x, i) => s + x * (i < 9 ? 1 : 0.4), 0) + sps.reduce((s, x) => s + x, 0) + rps.reduce((s, x) => s + x, 0);
}

/**
 * Wins per point of roster WAR above the league mean, fit on simulated seasons (6 leagues × 30
 * clubs: slope 1.07, residual SD 6.8 wins ≈ pure 162-game luck). The old 0.85 squeezed clubs
 * toward .500.
 */
const WINS_PER_WAR = 1.05;

/** Full-season win expectation (162 games) for every club from its current roster. */
function talentWins(league: League): Record<number, number> {
  const s = Object.values(league.teams).map((t) => [t.id, teamStrength(league, t.id)] as const);
  const mean = s.reduce((a, [, v]) => a + v, 0) / s.length;
  const out: Record<number, number> = {};
  for (const [id, v] of s) out[id] = Math.max(40, Math.min(122, 81 + (v - mean) * WINS_PER_WAR));
  return out;
}

/** Expected wins from roster strength (the preseason projection, stored as league.expected). */
export function expectedWins(league: League): Record<number, number> {
  const t = talentWins(league);
  const out: Record<number, number> = {};
  for (const id of Object.keys(t)) out[+id] = Math.round(t[+id]);
  return out;
}

/**
 * Rest-of-season projection: wins so far plus the remaining regular-season games at the
 * current roster's talent level (trades, injuries and development count; past luck doesn't).
 */
export function projectedRecord(league: League): Record<number, { w: number; l: number; left: number }> {
  const t = talentWins(league);
  const left: Record<number, number> = {};
  for (const g of league.schedule) {
    if (g.ps || g.result) continue;
    left[g.home] = (left[g.home] ?? 0) + 1;
    left[g.away] = (left[g.away] ?? 0) + 1;
  }
  const out: Record<number, { w: number; l: number; left: number }> = {};
  for (const team of Object.values(league.teams)) {
    const n = left[team.id] ?? 0;
    const w = Math.round(team.w + (n * t[team.id]) / 162);
    out[team.id] = { w, l: team.w + team.l + n - w, left: n };
  }
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
  const season = opts.season ?? FIRST_SEASON;
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
    gradeV: GRADE_V,
  };
  const ageShift = season - rosters.season;
  const pool = templatePool(rosters);
  const deals = opts.contracts?.season === season ? opts.contracts : undefined;
  // Winter moves: who changed organizations since the roster snapshot.
  const homeOf = (id: number, listed: number): number => {
    const org = deals?.org?.[String(id)];
    return org && MLB_TEAMS.some((m) => m.id === org) ? org : listed;
  };
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
        const had = league.players[rp.id];
        if (had) {
          // A two-way player listed twice (lineup and staff): keep both roles on one player.
          if ((kind === "rotation" || kind === "bullpen") && !had.pit && rp.pitch?.arsenal?.length && had.team === mt.id) {
            const asPitcher = realPlayer(rp, kind, mt.id, ageShift, season, opts.proj, opts.contracts);
            had.pit = asPitcher.pit;
            had.pit0 = asPitcher.pit0;
            had.twoWay = true;
            if (kind === "rotation") t.rotation.push(had.id);
          }
          continue;
        }
        const home = homeOf(rp.id, mt.id);
        const p = realPlayer(rp, kind, home, ageShift, season, opts.proj, opts.contracts);
        league.players[p.id] = p;
        if (home !== mt.id) continue;
        if (kind === "lineup") t.lineup.push({ id: p.id, pos: p.pos === "SP" || p.pos === "RP" ? "DH" : (p.pos as TeamState["lineup"][number]["pos"]) });
        if (kind === "rotation") t.rotation.push(p.id);
      }
    }
    // Two-way players the snapshot lists only as hitters (Ohtani as "TWP" on the bench):
    // give them their projected pitching role too.
    for (const rp of [...rt.lineup, ...rt.bench]) {
      const had = league.players[rp.id];
      const pp = opts.proj?.players[String(rp.id)]?.pit;
      if (!had || had.pit || had.team !== mt.id || rp.pos !== "TWP" || !pp || pp.bf < 100) continue;
      const starter = (pp.gsShare ?? 0) >= 0.5;
      const asPitcher = realPlayer(rp, starter ? "rotation" : "bullpen", mt.id, ageShift, season, opts.proj, opts.contracts);
      had.pit = asPitcher.pit;
      had.pit0 = asPitcher.pit0;
      had.twoWay = true;
      if (starter) t.rotation.push(had.id);
    }
    // Current 40-man players the 2026 snapshot missed (stars hurt for much of the year).
    for (const xp of opts.proj?.extras[String(mt.id)] ?? []) {
      if (league.players[xp.id]) continue;
      const p = realPlayer(xp, xp.role, homeOf(xp.id, mt.id), ageShift, season, opts.proj, opts.contracts);
      p.template = pickTemplate(pool, p);
      league.players[p.id] = p;
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
    // The real farm system: MLB Pipeline's top 30, the best upper-level arms and bats on the 40-man.
    if (opts.realProspects !== false) addRealProspects(league, rng, mt.id);
    const farm = orgPlayers(league, mt.id)
      .filter((x) => x.prospect && !x.on40 && x.status === "minors")
      .sort((a, b) => (a.prospect!.rank - b.prospect!.rank));
    for (const x of farm) {
      if (orgPlayers(league, mt.id).filter((y) => y.on40).length >= 38) break;
      const lvl = x.prospect!.level;
      if (lvl === "MLB" || (lvl === "AAA" && x.prospect!.rank <= 15)) {
        x.on40 = true;
        x.contract = { aav: 0.8, years: 1, kind: "pre", signed: season };
      }
    }
    // Organizational depth around them: 40-man filler, then non-roster minor leaguers.
    const fortyTiers: Array<[GenRole, Parameters<typeof prospectProfile>[1], Player["pos"]?]> = [
      ["SP", "depth"],
      ["SP", "depth"],
      ["RP", "depth"],
      ["RP", "depth"],
      ["RP", "depth"],
      ["bat", "depth", "C"],
      ["bat", "depth", "SS"],
      ["bat", "depth", "CF"],
      ["bat", "depth"],
      ["RP", "depth"],
    ];
    for (const [role, tier, pos] of fortyTiers) if (orgPlayers(league, mt.id).filter((x) => x.on40).length < 40) addGenerated(league, rng, pool, mt.id, role, tier, { on40: true, pos });
    const minorTiers: Array<[GenRole, Parameters<typeof prospectProfile>[1], Player["pos"]?]> = [
      ["SP", "depth"],
      ["RP", "depth"],
      ["RP", "depth"],
      ["bat", "depth", "C"],
      ["bat", "depth"],
      ["bat", "depth"],
    ];
    for (const [role, tier, pos] of minorTiers) addGenerated(league, rng, pool, mt.id, role, tier, { pos });
    for (const x of orgPlayers(league, mt.id)) if (x.prospect && x.template == null) x.template = pickTemplate(pool, x);
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
    autoDepth(league, t.id);
    t.fin = newFinances(t.id, payroll(league, t.id));
  }
  assignStrategies(league);
  league.expected = expectedWins(league);
  // The run environment is fixed from the real talent base, before anyone leaves in free agency.
  league.env = talentEnv(league) ?? undefined;
  league.news = [{ day: 0, text: `Welcome to the ${season} season. You are the GM of the ${league.teams[opts.userTeam].name}.`, team: opts.userTeam, kind: "info" }];
  if (deals?.fa && openRealMarket(league, deals)) {
    initFreeAgency(league);
    league.opening = true;
    league.news.push({
      day: 0,
      text: `The ${season - 1}-${String(season).slice(2)} free-agent market is open: ${freeAgents(league).filter((p) => p.real).length} real free agents are unsigned. Bid on them, then start the season.`,
      team: opts.userTeam,
      kind: "info",
    });
  }
  league.rng = rng.s;
  ensureUmpires(league);
  return league;
}

/**
 * Upgrades a save made before the real-contract snapshot existed (or made before it loaded):
 * real players still on a synthesized deal get their actual contract and service time.
 * Only during the snapshot's own season — after that the save's contracts have moved on.
 * Deals signed in-game (free agents, minor-league signings) are kept. Returns how many changed.
 */
export const GRADE_V = 2;

/**
 * Saves made before pitchers got their own grade scale: their overall (and the potential
 * gap above it) are regraded, and depth charts rebuilt so the new grades order the staffs.
 * Returns whether anything changed.
 */
export function migrateGrades(league: League): boolean {
  if ((league.gradeV ?? 1) >= GRADE_V) return false;
  for (const p of Object.values(league.players)) {
    if (!p.pitcher) continue;
    const ovr = overall(p);
    p.pot = Math.max(ovr, Math.min(80, Math.round(ovr + (p.pot - p.ovr) * gradeScale(p))));
    p.ovr = ovr;
  }
  for (const t of Object.values(league.teams)) {
    if (!isHuman(league, t.id) || league.settings.autoRoster) autoDepth(league, t.id);
  }
  league.gradeV = GRADE_V;
  return true;
}

export function applyRealContracts(league: League, file: ContractFile | undefined): number {
  if (!file || file.season !== league.season) return 0;
  // From the offseason on, service time has advanced and next season's arb / pre-arb deals are
  // written (still under this season's number): the snapshot no longer describes the league.
  if (league.phase !== "regular" && league.phase !== "postseason") return 0;
  const before = new Map(Object.values(league.teams).map((t) => [t.id, payroll(league, t.id)]));
  let changed = 0;
  for (const p of Object.values(league.players)) {
    if (!p.real || !p.team || p.status === "fa" || p.contract.real) continue;
    if (file.fa?.[String(p.id)]) continue;
    const signedHere = !p.contract.est && (p.contract.kind === "fa" || p.contract.kind === "minor") && p.contract.signed === league.season;
    if (signedHere) continue;
    const e = file.players[String(p.id)];
    if (!e) continue;
    if (e.svc != null && e.svc !== p.service) {
      p.service = e.svc;
      p.options = startingOptions(p);
    }
    p.contract = realContract(p, e, league.season);
    changed += 1;
  }
  // The opening budget was set from the estimated payroll: move it by what the real one changes.
  if (changed) {
    for (const t of Object.values(league.teams)) {
      const was = before.get(t.id) ?? 0;
      t.fin.budget += openingBudget(t.id, payroll(league, t.id)) - openingBudget(t.id, was);
    }
  }
  return changed;
}

/**
 * Real players who are free agents right now (elected free agency / released this winter)
 * leave their 2026 clubs for the open market. Clubs keep the budgets their payrolls earned.
 * Returns whether anyone was moved.
 */
function openRealMarket(league: League, deals: ContractFile): boolean {
  let moved = 0;
  const touched = new Set<number>();
  for (const [key, info] of Object.entries(deals.fa ?? {})) {
    const p = league.players[Number(key)];
    if (!p || !p.real || p.status === "fa" || !p.team) continue;
    const t = league.teams[p.team];
    p.prevTeam = p.team;
    touched.add(p.team);
    t.lineup = t.lineup.filter((s) => s.id !== p.id);
    t.rotation = t.rotation.filter((id) => id !== p.id);
    t.setup = t.setup.filter((id) => id !== p.id);
    if (t.closer === p.id) t.closer = null;
    p.team = 0;
    p.status = "fa";
    p.on40 = false;
    p.contract = { ...askingTerms(p), kind: "fa", signed: league.season, est: true };
    if (info.from && info.from !== p.prevTeam && league.teams[info.from]) p.prevTeam = info.from;
    moved += 1;
  }
  for (const id of touched) {
    normalizeRoster(league, id, { offseason: true });
    autoDepth(league, id);
  }
  if (moved) news(league, `${moved} players hit free agency this winter.`, undefined, "signing");
  return moved > 0;
}
