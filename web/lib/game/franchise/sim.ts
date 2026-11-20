/**
 * Fast stat-based game simulator (plate-appearance level). Each PA combines the
 * batter's and pitcher's per-PA rates with the log5 odds-ratio method, adjusted for
 * platoon, park, team defense and pitcher fatigue; batted balls become hits / outs
 * with baserunning advancement, double plays, sac flies, errors and steals. Starters
 * work to a stamina-based pitch limit, bullpens are run by leverage (closer / setup)
 * with day-to-day fatigue. Produces full box-score lines and W/L/SV decisions.
 * A full 2,430-game season runs in well under a second.
 */
import { club, LG } from "./data";
import { canPitch, clamp, defAt, isPosPlayer, tripleShare } from "./ratings";
import type { FRng } from "./rng";
import { isHealthy } from "./roster";
import { emptyBat, emptyPit, type BatLine, type League, type PitLine, type Player, type TeamState } from "./types";
import type { UmpCard } from "@/lib/game/umpires/scorecard";
import type { Play, PlayCode } from "./gamelog";

const log5 = (b: number, p: number, l: number): number => {
  const x = (b * p) / l;
  const y = ((1 - b) * (1 - p)) / (1 - l);
  return x / (x + y);
};

export interface SBat {
  p: Player;
  pos: string;
  line: BatLine;
}

export interface SPit {
  p: Player;
  line: PitLine;
  limit: number;
  outs: number;
  runs: number;
  pitches: number;
  starter: boolean;
  enteredLead: number;
  done: boolean;
}

interface Runner {
  b: SBat;
  pit: SPit;
  earned: boolean;
}

interface SimSide {
  team: TeamState;
  lineup: SBat[];
  idx: number;
  pitcher: SPit;
  pen: Player[];
  used: SPit[];
  /** Added to hits-per-ball-in-play against (− = good defense). */
  defAdj: number;
  catcherArm: number;
  runs: number;
  hits: number;
}

export interface GameOutcome {
  awayRuns: number;
  homeRuns: number;
  innings: number;
  bat: Map<number, BatLine>;
  pit: Map<number, PitLine>;
  /** Pitches thrown per pitcher (fatigue). */
  pitches: Map<number, number>;
  starters: [number, number];
  wp?: number;
  lp?: number;
  sv?: number;
  hits: [number, number];
  /** Plate umpire's scorecard. */
  uc?: UmpCard;
  /** Batting orders with positions, and pitchers in order of appearance: [away, home]. */
  order?: [Array<[number, string]>, Array<[number, string]>];
  staff?: [number[], number[]];
  /** Play-by-play (simmed games). */
  plays?: Play[];
}

// ---------------------------------------------------------------------------
// Availability

/** Relievers who pitched heavily or on consecutive days sit. */
export function relieverAvailable(p: Player, day: number): boolean {
  if (!isHealthy(p)) return false;
  const pd = p.pd ?? [];
  let y = 0;
  let y2 = 0;
  let last3 = 0;
  const days = new Set<number>();
  for (const [d, n] of pd) {
    if (d === day - 1) y += n;
    if (d === day - 2) y2 += n;
    if (d >= day - 3 && d < day) last3 += n;
    if (d >= day - 6 && d < day && n > 0) days.add(d);
  }
  if (y > 0 && y2 > 0) return false;
  if (y > 25) return false;
  if (last3 > 45) return false;
  // No more than three outings in a week (a reliever's arm needs the days off).
  if (days.size >= 3 && (y > 0 || y2 > 0)) return false;
  if (days.size >= 4) return false;
  if (p.lastStart != null && day - p.lastStart < 4) return false;
  return true;
}

export const starterRested = (p: Player, day: number, minGap = 5): boolean =>
  isHealthy(p) && (p.lastStart == null || day - p.lastStart >= minGap) && !(p.pd ?? []).some(([d, n]) => d >= day - 2 && n > 20);

/** Pick today's starter: the rotation turn if rested, else the most-rested rotation arm, else an opener. */
export function chooseStarter(league: League, t: TeamState, day: number, minGap = 5): Player | null {
  const rot = t.rotation.map((id) => league.players[id]).filter((p) => p && p.team === t.id && p.status === "active");
  if (!rot.length) return null;
  const turn = rot[t.rotIdx % rot.length];
  // After an off day the ace is rested again when the No. 5 comes up: he takes the ball
  // and the fifth starter is skipped (how clubs get 33+ starts from their best arm).
  const ace = rot[0];
  if (rot.length >= 5 && turn === rot[rot.length - 1] && ace !== turn && starterRested(ace, day, minGap)) return ace;
  if (turn && starterRested(turn, day, minGap)) return turn;
  const rested = rot.filter((p) => starterRested(p, day, minGap)).sort((a, b) => (a.lastStart ?? -99) - (b.lastStart ?? -99));
  if (rested.length) return rested[0];
  const pen = activePitchers(league, t).filter((p) => !t.rotation.includes(p.id) && relieverAvailable(p, day));
  pen.sort((a, b) => (b.pit?.stam ?? 0) - (a.pit?.stam ?? 0));
  return pen[0] ?? rot.sort((a, b) => (a.lastStart ?? -99) - (b.lastStart ?? -99))[0];
}

function activePitchers(league: League, t: TeamState): Player[] {
  const out: Player[] = [];
  for (const p of Object.values(league.players)) if (p.team === t.id && p.status === "active" && canPitch(p)) out.push(p);
  return out;
}

/** Game-day lineup: the depth chart, giving a tired catcher a day off. */
export function gameLineup(league: League, t: TeamState): Array<{ p: Player; pos: string }> {
  const out = t.lineup.map((s) => ({ p: league.players[s.id], pos: s.pos as string })).filter((x) => x.p && x.p.status === "active" && isHealthy(x.p));
  const c = out.find((x) => x.pos === "C");
  if (c && (c.p.streak ?? 0) >= 6) {
    const backup = Object.values(league.players).find(
      (p) => p.team === t.id && p.status === "active" && p.pos === "C" && p.id !== c.p.id && isHealthy(p) && !out.some((x) => x.p.id === p.id),
    );
    if (backup) c.p = backup;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Game

export interface SimInput {
  league: League;
  away: TeamState;
  home: TeamState;
  day: number;
  rng: FRng;
  awayStarter?: Player | null;
  homeStarter?: Player | null;
  /** Postseason: shorter starter leash, aces on 4 days' rest. */
  postseason?: boolean;
  /** Plate umpire's zone: strikeout / walk multipliers (absent = average umpire). */
  zone?: { k: number; bb: number };
}

function makePit(p: Player, starter: boolean, lead: number, rng: FRng, post: boolean): SPit {
  const stam = p.pit?.stam ?? 25;
  // Good starters get a longer leash (they're the best option on the mound); poor ones a shorter one.
  const trust = starter ? clamp((p.ovr - 50) * 0.45, -6, 9) : 0;
  const limit = starter ? Math.max(35, stam + trust + rng.gauss(0, 7) - (p.age >= 35 ? 4 : 0) - (post ? 4 : 0)) : Math.min(40, stam + 8);
  return { p, line: emptyPit(), limit, outs: 0, runs: 0, pitches: 0, starter, enteredLead: lead, done: false };
}

function buildSide(league: League, t: TeamState, starter: Player | null, day: number, rng: FRng, post: boolean): SimSide {
  const lu = gameLineup(league, t);
  const lineup: SBat[] = lu.map(({ p, pos }) => ({ p, pos, line: emptyBat() }));
  // Thin rosters (should not happen after normalizeRoster): pad with anyone active.
  if (lineup.length < 9) {
    for (const p of Object.values(league.players)) {
      if (lineup.length >= 9) break;
      if (p.team === t.id && p.status === "active" && isPosPlayer(p) && !lineup.some((x) => x.p.id === p.id)) lineup.push({ p, pos: "DH", line: emptyBat() });
    }
  }
  let defRuns = 0;
  let arm = 0;
  for (const s of lineup) {
    if (s.pos === "DH") continue;
    const d = defAt(s.p, s.pos as never);
    defRuns += d == null ? -12 : d;
    if (s.pos === "C") arm = (s.p.bat?.def ?? 0) * 0.004;
  }
  const sp = starter ?? activePitchers(league, t)[0];
  const pen = activePitchers(league, t).filter((p) => p.id !== sp.id && !t.rotation.includes(p.id) && relieverAvailable(p, day));
  // Order: closer, setup, then the rest by quality.
  pen.sort((a, b) => roleRank(t, a) - roleRank(t, b) || b.ovr - a.ovr);
  const pitcher = makePit(sp, true, 0, rng, post);
  return { team: t, lineup, idx: 0, pitcher, pen, used: [pitcher], defAdj: -defRuns / 3200, catcherArm: arm, runs: 0, hits: 0 };
}

const roleRank = (t: TeamState, p: Player) => (p.id === t.closer ? 0 : t.setup.includes(p.id) ? 1 : 2);

export function simGame(input: SimInput): GameOutcome {
  const { league, day, rng } = input;
  const post = !!input.postseason;
  const park = club(input.home.id);
  const away = buildSide(league, input.away, input.awayStarter ?? null, day, rng, post);
  const home = buildSide(league, input.home, input.homeStarter ?? null, day, rng, post);
  const parkHr = park.hr;
  const parkHit = 1 + (park.run - 1) * 0.35;
  const parkXbh = 1 + (park.run - 1) * 0.6;
  const zoneK = input.zone?.k ?? 1;
  const zoneBB = input.zone?.bb ?? 1;

  let wpCand: SPit | null = null;
  let lpCand: SPit | null = null;
  let leader: 0 | 1 | 2 = 0; // 1 away, 2 home

  const lead = (s: SimSide) => (s === away ? away.runs - home.runs : home.runs - away.runs);

  // Play-by-play. Recording never touches the dice.
  const plays: Play[] = [];
  let curHalf = 2;
  const mask = (b: Array<Runner | null>) => (b[0] ? 1 : 0) | (b[1] ? 2 : 0) | (b[2] ? 4 : 0);
  const note = (code: PlayCode, who: number, pid: number, outs: number, b: Array<Runner | null>, scored: number[] = []) =>
    plays.push([curHalf, code, who, pid, Math.min(3, outs), mask(b), away.runs, home.runs, ...scored]);

  const checkLead = (batting: SimSide, fielding: SimSide) => {
    const now: 0 | 1 | 2 = away.runs > home.runs ? 1 : home.runs > away.runs ? 2 : 0;
    if (now !== leader) {
      // Blown save / hold bookkeeping for the pitcher on the mound.
      const fp = fielding.pitcher;
      if (!fp.starter && fp.enteredLead >= 1 && fp.enteredLead <= 3 && lead(fielding) <= 0 && !fp.done) {
        fp.line.bs = 1;
        fp.done = true;
      }
      if (now !== 0) {
        wpCand = batting.pitcher;
        lpCand = fielding.pitcher;
      } else {
        wpCand = null;
        lpCand = null;
      }
      leader = now;
    }
  };

  const changePitcher = (f: SimSide, inning: number, outs: number, basesEmpty: boolean, opp: SimSide) => {
    const cur = f.pitcher;
    const l = lead(f);
    const lateClose = inning >= 7 && Math.abs(l) <= 2;
    const saveSpot = inning >= 9 && l >= 1 && l <= 3;
    const startOfInning = outs === 0 && basesEmpty;
    let pull = false;
    if (cur.starter) {
      const hardLimit = cur.pitches >= cur.limit;
      const softLimit = startOfInning && cur.pitches >= cur.limit - 14;
      const shelled = cur.runs >= 6 || (cur.runs >= 5 && cur.pitches > 70) || (cur.runs >= 4 && inning >= 6 && lateClose);
      pull = hardLimit || softLimit || shelled || (startOfInning && saveSpot && cur.pitches > 85);
    } else {
      pull =
        (startOfInning && cur.outs >= 3 && !(inning > 9 && cur.outs < 6 && cur.pitches < 25)) ||
        cur.pitches >= cur.limit ||
        cur.runs >= 3 ||
        (startOfInning && saveSpot && f.team.closer != null && cur.p.id !== f.team.closer && f.pen.some((p) => p.id === f.team.closer));
    }
    if (!pull || !f.pen.length) return;
    let next: Player | undefined;
    const closer = f.pen.find((p) => p.id === f.team.closer);
    const setups = f.pen.filter((p) => f.team.setup.includes(p.id));
    const others = f.pen.filter((p) => p.id !== f.team.closer && !f.team.setup.includes(p.id));
    if (saveSpot && closer) next = closer;
    else if (inning >= 9 && l === 0 && closer) next = closer;
    else if (inning >= 10 && Math.abs(l) <= 1) next = closer ?? setups[0] ?? others[0];
    else if ((inning === 8 || (inning >= 7 && lateClose)) && l >= -1 && l <= 3) next = setups[0] ?? others[0] ?? closer;
    else if (lateClose) next = others[0] ?? setups[0];
    else if (inning <= 5) {
      // Long relief: the most stamina among the lesser arms (the good ones are saved for late).
      const long = others.slice(Math.floor(others.length / 2));
      next = [...(long.length ? long : others)].sort((a, b) => (b.pit?.stam ?? 0) - (a.pit?.stam ?? 0))[0];
    } else next = others[others.length - 1] ?? others[0];
    if (!next) next = others[0] ?? setups[0] ?? (inning >= 9 ? closer : undefined);
    if (!next) return;
    // Hold credit for a reliever leaving with the lead intact.
    if (!cur.starter && cur.enteredLead >= 1 && cur.enteredLead <= 3 && l >= 1 && cur.outs > 0 && !cur.line.bs) cur.line.hld = 1;
    cur.done = true;
    f.pen = f.pen.filter((p) => p.id !== next!.id);
    const sp = makePit(next, false, l, rng, post);
    f.pitcher = sp;
    f.used.push(sp);
    plays.push([curHalf, "PC", next.id, cur.p.id, outs, 0, away.runs, home.runs]);
    void opp;
  };

  const pa = (bat: SimSide, fld: SimSide, bases: Array<Runner | null>, outsIn: number, walkoffInning: boolean): { outs: number; runs: number; bases: Array<Runner | null> } => {
    const b = bat.lineup[bat.idx % bat.lineup.length];
    bat.idx += 1;
    const pit = fld.pitcher;
    const bs = b.p.bat!;
    const ps = pit.p.pit!;
    const bh = b.p.bats === "S" ? (pit.p.throws === "L" ? "R" : "L") : b.p.bats;
    const same = bh === pit.p.throws;
    // Fatigue past the pitch limit; third time through the order.
    const over = Math.max(0, pit.pitches - pit.limit * 0.85) / 30;
    const tto = pit.starter && bat.idx > 18 ? 1.04 : 1;
    const kP = log5(bs.k, ps.k, LG.k) * (same ? 1.05 : 0.97) * (1 - over * 0.15) * zoneK;
    const bbP = log5(bs.bb, ps.bb, LG.bb) * (1 + over * 0.25) * (same ? 1 : 1.02) * zoneBB;
    const hrP = log5(bs.hr, ps.hr, LG.hr) * parkHr * (same ? 0.88 : 1.05) * (1 + over * 0.3) * tto;
    const hbpP = LG.hbp;
    const bl = b.line;
    const pl = pit.line;
    bl.pa += 1;
    pl.bf += 1;
    let outs = outsIn;
    let runs = 0;
    // Bottom of the ninth or later: the game ends the moment the home side goes ahead, so
    // no run past the winning one counts (a home run is the exception: every runner scores).
    let cap = walkoffInning ? fld.runs - bat.runs + 1 : Infinity;
    const scored: number[] = [];
    let code: PlayCode = "GO";
    const score = (r: Runner | null, rbi = true) => {
      if (!r || runs >= cap) return;
      runs += 1;
      scored.push(r.b.p.id);
      r.b.line.r += 1;
      r.pit.line.r += 1;
      r.pit.runs += 1;
      if (r.earned) r.pit.line.er += 1;
      if (rbi) bl.rbi += 1;
    };
    const me: Runner = { b, pit, earned: true };
    let nb: Array<Runner | null> = [...bases];
    const r = rng.next();
    let pitches: number;
    if (r < kP) {
      bl.ab += 1;
      bl.k += 1;
      pl.k += 1;
      outs += 1;
      pitches = 4.8;
      code = "K";
    } else if (r < kP + bbP + hbpP) {
      const hbp = r >= kP + bbP;
      if (hbp) {
        bl.hbp += 1;
        pitches = 3.4;
        code = "HBP";
      } else {
        bl.bb += 1;
        pl.bb += 1;
        pitches = 5.7;
        code = "BB";
      }
      // Force advances.
      if (nb[0]) {
        if (nb[1]) {
          if (nb[2]) score(nb[2]);
          nb[2] = nb[1];
        }
        nb[1] = nb[0];
      }
      nb[0] = me;
    } else if (r < kP + bbP + hbpP + hrP) {
      bl.ab += 1;
      bl.h += 1;
      bl.hr += 1;
      pl.h += 1;
      pl.hr += 1;
      cap = Infinity;
      for (const x of nb) score(x);
      score(me);
      nb = [null, null, null];
      pitches = 3.4;
      code = "HR";
    } else {
      pitches = 3.3;
      bl.ab += 1;
      const babip = Math.min(0.42, log5(bs.babip, ps.babip, LG.babip) * 0.975 * parkHit * (same ? 0.985 : 1.01) + fld.defAdj + over * 0.01);
      if (rng.next() < babip) {
        bl.h += 1;
        pl.h += 1;
        const xb = rng.next() < bs.xbh * parkXbh;
        const two = outs === 2;
        if (!xb) {
          code = "1B";
          // Single.
          const r1 = nb[0];
          const r2 = nb[1];
          const r3 = nb[2];
          nb = [me, null, null];
          score(r3);
          if (r2) {
            if (rng.chance(Math.min(0.95, Math.max(0.3, 0.58 + (r2.b.p.bat!.spd - 27) * 0.05 + (two ? 0.25 : 0))))) score(r2);
            else nb[2] = r2;
          }
          if (r1) {
            if (!nb[2] && rng.chance(Math.min(0.6, Math.max(0.08, 0.27 + (r1.b.p.bat!.spd - 27) * 0.05 + (two ? 0.08 : 0))))) nb[2] = r1;
            else nb[1] = r1;
          }
        } else if (rng.next() < tripleShare(bs.spd) * (input.home.id === 115 || input.home.id === 111 ? 1.5 : 1)) {
          bl.t += 1;
          code = "3B";
          for (const x of nb) score(x);
          nb = [null, null, me];
        } else {
          bl.d += 1;
          code = "2B";
          const r1 = nb[0];
          score(nb[2]);
          score(nb[1]);
          nb = [null, me, null];
          if (r1) {
            if (rng.chance(Math.min(0.85, Math.max(0.2, 0.42 + (r1.b.p.bat!.spd - 27) * 0.06 + (two ? 0.2 : 0))))) score(r1);
            else nb[2] = r1;
          }
        }
      } else if (rng.next() < 0.015) {
        // Reached on error: everyone moves up a base; runs and the batter unearned.
        code = "E";
        const r3 = nb[2];
        if (r3) {
          r3.earned = false;
          score(r3, false);
        }
        nb = [{ ...me, earned: false }, nb[0], nb[1]];
      } else {
        const gb = rng.next() < Math.max(0.3, 0.45 - (bs.hr - LG.hr) * 3);
        if (gb) {
          if (nb[0] && outs < 2 && rng.chance(Math.max(0.15, 0.4 - (bs.spd - 27) * 0.05))) {
            // Double play.
            code = "DP";
            outs += 2;
            pitches = 3.1;
            const r2 = nb[1];
            const r3 = nb[2];
            nb = [null, null, null];
            if (outs < 3) {
              score(r3, false);
              nb[2] = r2;
            }
          } else {
            outs += 1;
            if (outs < 3) {
              const r1 = nb[0];
              const r2 = nb[1];
              const r3 = nb[2];
              if (r1 && rng.chance(0.3)) {
                // Fielder's choice: lead runner forced, batter safe.
                code = "FC";
                nb = [me, null, null];
                if (r2) nb[2] = r2;
                if (r3) {
                  if (r2) score(r3);
                  else nb[2] = r3;
                }
              } else {
                nb = [null, r1, null];
                if (r3) {
                  if (r2 || rng.chance(0.5)) score(r3);
                  else nb[2] = r3;
                }
                if (r2) {
                  if (!nb[2] && rng.chance(0.6)) nb[2] = r2;
                  else if (!nb[2]) nb[2] = r2;
                  else nb[1] = r2;
                }
              }
            }
          }
        } else {
          code = "FO";
          outs += 1;
          if (outs < 3 && nb[2] && outsIn < 2 && rng.chance(0.5 + (nb[2].b.p.bat!.spd - 27) * 0.04)) {
            bl.ab -= 1;
            bl.sf += 1;
            code = "SF";
            score(nb[2]);
            nb[2] = null;
          }
          if (outs < 3 && nb[1] && !nb[2] && rng.chance(0.22)) {
            nb[2] = nb[1];
            nb[1] = null;
          }
        }
      }
    }
    const thrown = Math.max(1, Math.round(pitches + rng.gauss(0, 1.3)));
    pit.pitches += thrown;
    pl.pit += thrown;
    if (outs > outsIn) {
      const o = Math.min(3, outs) - outsIn;
      pl.outs += o;
      pit.outs += o;
    }
    bat.runs += runs;
    if (bl.h && runs >= 0) bat.hits = bat.lineup.reduce((s, x) => s + x.line.h, 0);
    note(code, b.p.id, pit.p.id, outs, nb, scored);
    return { outs, runs, bases: nb };
  };

  const steal = (bat: SimSide, fld: SimSide, bases: Array<Runner | null>, outs: number): { outs: number; bases: Array<Runner | null> } => {
    const r1 = bases[0];
    const r2 = bases[1];
    if (r1 && !r2) {
      const s = r1.b.p.bat!;
      if (rng.chance(Math.min(0.4, s.sbA * 5.5))) {
        if (rng.chance(Math.max(0.4, s.sbS - fld.catcherArm))) {
          r1.b.line.sb += 1;
          const nb = [null, r1, bases[2]];
          note("SB", r1.b.p.id, fld.pitcher.p.id, outs, nb);
          return { outs, bases: nb };
        }
        r1.b.line.cs += 1;
        fld.pitcher.line.outs += 1;
        fld.pitcher.outs += 1;
        const nb = [null, null, bases[2]];
        note("CS", r1.b.p.id, fld.pitcher.p.id, outs + 1, nb);
        return { outs: outs + 1, bases: nb };
      }
    } else if (r2 && !bases[2] && outs < 2) {
      const s = r2.b.p.bat!;
      if (rng.chance(Math.min(0.1, s.sbA * 0.7))) {
        if (rng.chance(Math.max(0.4, s.sbS + 0.03 - fld.catcherArm))) {
          r2.b.line.sb += 1;
          const nb = [bases[0], null, r2];
          note("SB", r2.b.p.id, fld.pitcher.p.id, outs, nb);
          return { outs, bases: nb };
        }
        r2.b.line.cs += 1;
        fld.pitcher.line.outs += 1;
        fld.pitcher.outs += 1;
        const nb = [bases[0], null, null];
        note("CS", r2.b.p.id, fld.pitcher.p.id, outs + 1, nb);
        return { outs: outs + 1, bases: nb };
      }
    }
    return { outs, bases };
  };

  const half = (bat: SimSide, fld: SimSide, inning: number, bottom: boolean): boolean => {
    curHalf = inning * 2 + (bottom ? 1 : 0);
    let outs = 0;
    let bases: Array<Runner | null> = [null, null, null];
    // Regular-season extras start with a runner on second; postseason extras do not.
    if (inning > 9 && !post) {
      const prev = bat.lineup[(bat.idx - 1 + bat.lineup.length * 10) % bat.lineup.length];
      bases[1] = { b: prev, pit: fld.pitcher, earned: false };
    }
    let guard = 0;
    while (outs < 3 && guard++ < 60) {
      changePitcher(fld, inning, outs, !bases[0] && !bases[1] && !bases[2], bat);
      // The automatic runner is charged to whoever is pitching.
      if (bases[1] && !bases[1].earned && inning > 9 && !post) bases[1].pit = fld.pitcher;
      if (outs < 2 || bases[0]) {
        const st = steal(bat, fld, bases, outs);
        outs = st.outs;
        bases = st.bases;
        if (outs >= 3) break;
      }
      const res = pa(bat, fld, bases, outs, bottom && inning >= 9);
      outs = res.outs;
      bases = res.bases;
      if (res.runs) checkLead(bat, fld);
      if (bottom && inning >= 9 && home.runs > away.runs) return true;
    }
    return false;
  };

  let inning = 1;
  for (; inning < 40; inning += 1) {
    half(away, home, inning, false);
    if (inning >= 9 && home.runs > away.runs) break;
    const walkoff = half(home, away, inning, true);
    if (walkoff) break;
    if (inning >= 9 && home.runs !== away.runs) break;
  }

  // Box score maps and decisions.
  const bat = new Map<number, BatLine>();
  const pit = new Map<number, PitLine>();
  const pitches = new Map<number, number>();
  for (const s of [away, home]) {
    for (const b of s.lineup) {
      b.line.g = 1;
      bat.set(b.p.id, b.line);
    }
    s.used.forEach((sp, i) => {
      sp.line.g = 1;
      if (i === 0) sp.line.gs = 1;
      pit.set(sp.p.id, sp.line);
      pitches.set(sp.p.id, sp.pitches);
    });
  }
  const homeWon = home.runs > away.runs;
  const win = homeWon ? home : away;
  const lose = homeWon ? away : home;
  let wp = wpCand as SPit | null;
  if (!wp || !win.used.includes(wp)) wp = win.used[0];
  if (wp.starter && wp.outs < 15 && win.used.length > 1) {
    wp = win.used.slice(1).reduce((a, b) => (b.outs > a.outs ? b : a), win.used[1]);
  }
  let lp = lpCand as SPit | null;
  if (!lp || !lose.used.includes(lp)) lp = lose.used.reduce((a, b) => (b.runs > a.runs ? b : a), lose.used[0]);
  wp.line.w = 1;
  lp.line.l = 1;
  let sv: SPit | undefined;
  const fin = win.used[win.used.length - 1];
  if (fin !== wp && !fin.starter && ((fin.enteredLead >= 1 && fin.enteredLead <= 3 && fin.outs >= 3) || (fin.enteredLead >= 1 && fin.outs >= 9) || (fin.enteredLead >= 1 && fin.outs >= 1 && fin.enteredLead <= 2 && inning >= 9))) {
    sv = fin;
    fin.line.sv = 1;
    fin.line.hld = 0;
  }
  if (wp.line.hld) wp.line.hld = 0;
  return {
    awayRuns: away.runs,
    homeRuns: home.runs,
    innings: Math.min(inning, 39),
    bat,
    pit,
    pitches,
    starters: [away.used[0].p.id, home.used[0].p.id],
    wp: wp.p.id,
    lp: lp.p.id,
    sv: sv?.p.id,
    hits: [away.lineup.reduce((s, x) => s + x.line.h, 0), home.lineup.reduce((s, x) => s + x.line.h, 0)],
    order: [away.lineup.map((b) => [b.p.id, b.pos] as [number, string]), home.lineup.map((b) => [b.p.id, b.pos] as [number, string])],
    staff: [away.used.map((x) => x.p.id), home.used.map((x) => x.p.id)],
    plays,
  };
}

// ---------------------------------------------------------------------------
// Applying a result to season stats

export function addBat(into: BatLine, l: BatLine): void {
  for (const k of Object.keys(l) as Array<keyof BatLine>) into[k] += l[k];
}

export function addPit(into: PitLine, l: PitLine): void {
  for (const k of Object.keys(l) as Array<keyof PitLine>) into[k] += l[k];
}

export function recordLines(league: League, out: Pick<GameOutcome, "bat" | "pit" | "pitches">, day: number, post: boolean): void {
  for (const [id, l] of out.bat) {
    const p = league.players[id];
    if (!p) continue;
    const bucket = post ? (p.post ??= {}) : p.stats;
    addBat((bucket.bat ??= emptyBat()), l);
    if (p.pos === "C") p.streak = (p.streak ?? 0) + 1;
  }
  for (const [id, l] of out.pit) {
    const p = league.players[id];
    if (!p) continue;
    const bucket = post ? (p.post ??= {}) : p.stats;
    addPit((bucket.pit ??= emptyPit()), l);
    const n = out.pitches.get(id) ?? l.pit;
    p.pd = [...(p.pd ?? []).filter(([d]) => d >= day - 4), [day, n]];
    if (l.gs) p.lastStart = day;
  }
}
