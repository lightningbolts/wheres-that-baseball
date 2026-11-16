/**
 * Manual play: turn a franchise game into a Play Ball GameSession setup (rosters
 * built from the franchise's depth charts, current ratings layered onto each
 * player's physics template) and fold the finished box score back into the season.
 */
import type { GameSetup } from "@/lib/game/session/session";
import type { GameSession } from "@/lib/game/session/session";
import { teamModel, type TeamModel } from "@/lib/game/ratings";
import type { RosterFile, RosterPlayer, RosterTeam } from "@/lib/game/types";
import { hash32, FRng } from "./rng";
import { isHealthy } from "./roster";
import { applyGameResult } from "./season";
import { chooseStarter, gameLineup, relieverAvailable, type GameOutcome } from "./sim";
import { emptyBat, emptyPit, type BatLine, type League, type PitLine, type Player, type ScheduledGame } from "./types";

export type RosterIndex = Map<number, RosterPlayer>;

export function rosterIndex(rosters: RosterFile): RosterIndex {
  const idx: RosterIndex = new Map();
  for (const t of Object.values(rosters.teams)) for (const p of [...t.lineup, ...t.bench, ...t.rotation, ...t.bullpen]) if (!idx.has(p.id)) idx.set(p.id, p);
  return idx;
}

function fallbackTemplate(idx: RosterIndex, pitcher: boolean): RosterPlayer | undefined {
  for (const p of idx.values()) if (pitcher ? !!p.pitch?.arsenal?.length : !!p.bat) return p;
  return undefined;
}

/** A Play Ball roster entry for a franchise player: his template's physics with his current skills. */
export function rosterPlayerFor(p: Player, idx: RosterIndex, pos?: string): RosterPlayer {
  const base = (p.template != null ? idx.get(p.template) : undefined) ?? idx.get(p.id) ?? fallbackTemplate(idx, p.pitcher);
  const out: RosterPlayer = base
    ? structuredClone(base)
    : { id: p.id, name: p.name, num: null, pos: p.pos, bats: p.bats, throws: p.throws, heightIn: null, weight: null, age: p.age, zone: [null, null], sprint: 27, arm: 85 };
  out.id = p.id;
  out.name = p.name;
  out.age = p.age;
  out.bats = p.bats;
  out.throws = p.throws;
  out.pos = pos ?? p.pos;
  if (!p.real) out.num = null;
  if (p.bat && out.bat) {
    // The 3D game hits with contact, swing decisions and exit velocity, not with rate
    // stats: move those physics inputs by how far the player's current K / BB / HR rates
    // sit from the template's (development, aging and slumps all show up in play).
    const b0 = out.bat;
    const kBase = b0.k ?? p.bat0?.k ?? p.bat.k;
    const bbBase = b0.bb ?? p.bat0?.bb ?? p.bat.bb;
    const hrBase = b0.hr ?? p.bat0?.hr ?? p.bat.hr;
    const dK = p.bat.k - kBase;
    const dBB = p.bat.bb - bbBase;
    const dHR = p.bat.hr - hrBase;
    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
    const nudge = (v: number | null, d: number, lo: number, hi: number) => (v == null ? null : clamp(v + d, lo, hi));
    out.bat = {
      ...b0,
      pa: Math.max(b0.pa, 400),
      k: p.bat.k,
      bb: p.bat.bb,
      hr: p.bat.hr,
      // +5 pts of K% ≈ −2.5 pts zone contact, −4.5 pts chase contact.
      zContact: nudge(b0.zContact, -dK * 0.5, 0.6, 0.97),
      oContact: nudge(b0.oContact, -dK * 0.9, 0.3, 0.9),
      // +3 pts of BB% ≈ −3.6 pts chase rate.
      oSwing: nudge(b0.oSwing, -dBB * 1.2, 0.15, 0.5),
      // +1 pt of HR/PA ≈ +2.5 mph at the 90th percentile and a touch more lift.
      evP90: nudge(b0.evP90, dHR * 250, 95, 112),
      laMean: nudge(b0.laMean, dHR * 120, -5, 25),
    };
    out.sprint = p.bat.spd;
  }
  if (p.pit && out.pitch) out.pitch = { ...out.pitch, bf: Math.max(out.pitch.bf ?? 0, 400), k: p.pit.k, bb: p.pit.bb, stamina: p.pit.stam };
  return out;
}

export interface ManualTeam {
  roster: RosterTeam;
  starter: Player | null;
}

/** Depth chart → RosterTeam: game-day lineup, bench, today's starter first, closer then setup first in the pen. */
export function buildRosterTeam(league: League, teamId: number, idx: RosterIndex, day: number, post = false): ManualTeam {
  const t = league.teams[teamId];
  const starter = chooseStarter(league, t, day, post ? 4 : 5);
  const lineup = gameLineup(league, t).slice(0, 9);
  const inLineup = new Set(lineup.map((x) => x.p.id));
  const active = Object.values(league.players).filter((p) => p.team === teamId && p.status === "active" && isHealthy(p));
  const bench = active.filter((p) => !p.pitcher && !inLineup.has(p.id)).sort((a, b) => b.ovr - a.ovr);
  const rotation = [starter, ...t.rotation.map((id) => league.players[id]).filter((p) => p && p.id !== starter?.id && p.status === "active")].filter(
    (p): p is Player => !!p && !!p.pit,
  );
  const rotIds = new Set(rotation.map((p) => p.id));
  const pen = active.filter((p) => p.pitcher && p.pit && !rotIds.has(p.id));
  const order = (p: Player) => (p.id === t.closer ? 0 : t.setup.includes(p.id) ? 1 : 2);
  pen.sort((a, b) => order(a) - order(b) || b.ovr - a.ovr);
  // Tired relievers sit, but keep enough arms to finish the game.
  const fresh = pen.filter((p) => relieverAvailable(p, day));
  const bullpen = fresh.length >= 4 ? fresh : pen;
  return {
    starter,
    roster: {
      teamId,
      lineup: lineup.map((x) => rosterPlayerFor(x.p, idx, x.pos)),
      bench: bench.map((p) => rosterPlayerFor(p, idx)),
      rotation: rotation.map((p) => rosterPlayerFor(p, idx)),
      bullpen: bullpen.map((p) => rosterPlayerFor(p, idx)),
    },
  };
}

export interface ManualGame {
  setup: GameSetup;
  teams: Map<number, TeamModel>;
  game: ScheduledGame;
}

/** Everything GameView needs to play a franchise game. Marks it pending on the league. */
export function buildManualGame(league: League, gameId: number, idx: RosterIndex): ManualGame | null {
  const g = league.schedule.find((x) => x.id === gameId);
  if (!g || g.result) return null;
  const resume = league.pending?.gameId === gameId ? league.pending : undefined;
  const away = resume?.away ?? buildRosterTeam(league, g.away, idx, g.day, !!g.ps).roster;
  const home = resume?.home ?? buildRosterTeam(league, g.home, idx, g.day, !!g.ps).roster;
  if (away.lineup.length < 9 || home.lineup.length < 9 || !away.rotation.length || !home.rotation.length) return null;
  const seed = resume ? resume.seed : hash32(league.seed, league.season, gameId, league.rng) >>> 0;
  league.pending = { gameId, seed, away, home };
  const human = g.home === league.userTeam ? "home" : g.away === league.userTeam ? "away" : "none";
  const setup: GameSetup = {
    awayTeamId: g.away,
    homeTeamId: g.home,
    human,
    innings: 9,
    seed,
    difficulty: league.settings.difficulty,
    awayStarter: 0,
    homeStarter: 0,
    manager: true,
    abs: true,
    postseason: !!g.ps,
  };
  const teams = new Map<number, TeamModel>([
    [g.away, teamModel(away)],
    [g.home, teamModel(home)],
  ]);
  return { setup, teams, game: g };
}

type SessionBat = { pa: number; ab: number; h: number; d: number; t: number; hr: number; r: number; rbi: number; bb: number; k: number; hbp: number; sf: number };
type SessionPit = { outs: number; h: number; r: number; bb: number; k: number; hr: number; pitches: number; bf: number };

export interface BoxInput {
  awayRuns: number;
  homeRuns: number;
  innings: number;
  bat: Map<number, SessionBat>;
  pit: Map<number, SessionPit>;
  /** Pitchers used in order, per side. */
  awayStaff: number[];
  homeStaff: number[];
}

export function boxFromSession(session: GameSession, awayRuns: number, homeRuns: number): BoxInput {
  const g = session.game;
  return {
    awayRuns,
    homeRuns,
    innings: g.inning,
    bat: g.bat,
    pit: g.pit,
    awayStaff: g.away.staff.map((p) => p.id),
    homeStaff: g.home.staff.map((p) => p.id),
  };
}

/** Convert a Play Ball box score into a franchise outcome (decisions by simple scorer's rules). */
export function outcomeFromBox(box: BoxInput): GameOutcome {
  const bat = new Map<number, BatLine>();
  for (const [id, l] of box.bat) {
    bat.set(id, { ...emptyBat(), g: 1, pa: l.pa, ab: l.ab, h: l.h, d: l.d, t: l.t, hr: l.hr, r: l.r, rbi: l.rbi, bb: l.bb, k: l.k, hbp: l.hbp, sf: l.sf });
  }
  const pit = new Map<number, PitLine>();
  const pitches = new Map<number, number>();
  for (const staff of [box.awayStaff, box.homeStaff]) {
    staff.forEach((id, i) => {
      const l = box.pit.get(id);
      if (!l) return;
      pit.set(id, { ...emptyPit(), g: 1, gs: i === 0 ? 1 : 0, outs: l.outs, h: l.h, r: l.r, er: l.r, bb: l.bb, k: l.k, hr: l.hr, bf: l.bf, pit: l.pitches });
      pitches.set(id, l.pitches);
    });
  }
  const homeWon = box.homeRuns > box.awayRuns;
  const win = homeWon ? box.homeStaff : box.awayStaff;
  const lose = homeWon ? box.awayStaff : box.homeStaff;
  const outsOf = (id: number) => pit.get(id)?.outs ?? 0;
  let wp: number | undefined;
  if (win.length) {
    wp = outsOf(win[0]) >= 15 ? win[0] : win.slice(1).reduce<number | undefined>((best, id) => (best == null || outsOf(id) > outsOf(best) ? id : best), undefined) ?? win[0];
  }
  const lp = lose.length ? lose.reduce((a, b) => ((pit.get(b)?.r ?? 0) > (pit.get(a)?.r ?? 0) ? b : a)) : undefined;
  const last = win[win.length - 1];
  const margin = Math.abs(box.homeRuns - box.awayRuns);
  const sv = last != null && last !== wp && margin <= 3 && outsOf(last) >= 3 ? last : undefined;
  if (wp != null) pit.get(wp)!.w = 1;
  if (lp != null) pit.get(lp)!.l = 1;
  if (sv != null) pit.get(sv)!.sv = 1;
  let ah = 0;
  let hh = 0;
  for (const id of box.homeStaff) ah += box.pit.get(id)?.h ?? 0;
  for (const id of box.awayStaff) hh += box.pit.get(id)?.h ?? 0;
  return {
    awayRuns: box.awayRuns,
    homeRuns: box.homeRuns,
    innings: Math.max(9, box.innings),
    bat,
    pit,
    pitches,
    starters: [box.awayStaff[0] ?? 0, box.homeStaff[0] ?? 0],
    wp,
    lp,
    sv,
    hits: [ah, hh],
  };
}

/** Record a finished manual game into the season (standings, stats, gate, fatigue). */
export function recordManualResult(league: League, gameId: number, box: BoxInput): boolean {
  const g = league.schedule.find((x) => x.id === gameId);
  if (!g || g.result || box.awayRuns === box.homeRuns) return false;
  const rng = new FRng(league.rng);
  applyGameResult(league, g, outcomeFromBox(box), rng, true);
  league.rng = rng.s;
  league.pending = undefined;
  return true;
}
