/**
 * Rules engine: count, outs, bases, innings, scoring, substitutions and box score.
 * Pure bookkeeping on top of physics results — no randomness of its own except
 * the CPU manager's bullpen decisions (seeded).
 *
 * Covers: walks / HBP force advances, strikeouts (incl. foul-tip K), foul-strike
 * rule, force & tag outs from plays, the third-out run rule (enforced in the play
 * resolver), 9 innings with skip-the-bottom when the home team leads, walk-offs
 * (only the winning run counts unless it's a home run), and extra innings with
 * the automatic runner on second.
 */
import { alignment, DEFAULT_REACTION, type Fielder } from "@/lib/game/play/defense";
import type { PlayResult } from "@/lib/game/play/resolvePlay";
import type { PitchContext, PitchResult } from "@/lib/game/engine/atBat";
import type { Park } from "@/lib/game/physics/park";
import { batSide, type BatterModel, type PitcherModel, type TeamModel } from "@/lib/game/ratings";
import type { Rng } from "@/lib/game/math";
import type { FieldPos } from "@/lib/game/types";

export interface Runner {
  playerId: number;
  sprint: number;
  /** Pitcher charged if this runner scores. */
  chargedTo: number;
}

export interface BatLine {
  pa: number;
  ab: number;
  h: number;
  d: number;
  t: number;
  hr: number;
  r: number;
  rbi: number;
  bb: number;
  k: number;
  hbp: number;
  sf: number;
}

export interface PitLine {
  outs: number;
  h: number;
  r: number;
  bb: number;
  k: number;
  hr: number;
  pitches: number;
  bf: number;
}

export interface Side {
  team: TeamModel;
  lineup: BatterModel[];
  idx: number;
  pitcher: PitcherModel;
  pitchCount: number;
  /** Outs recorded by the current pitcher this outing. */
  pitcherOuts: number;
  pitcherRuns: number;
  available: PitcherModel[];
  /** Bench players still eligible (nobody re-enters once he is out of the game). */
  bench: BatterModel[];
  /** Everyone who has held each batting-order slot, starter first (box score). */
  slots: BatterModel[][];
  /** Pitchers used, in order (box score). */
  staff: PitcherModel[];
}

/** A manager's move. `side` is the team making it. */
export type Substitution =
  | { kind: "pitcher"; side: "away" | "home"; inId: number }
  | { kind: "pinchHit"; side: "away" | "home"; inId: number }
  | { kind: "pinchRun"; side: "away" | "home"; base: 0 | 1 | 2; inId: number }
  | { kind: "defense"; side: "away" | "home"; outId: number; inId: number };

export type GameEventKind =
  | "pitch"
  | "walk"
  | "strikeout"
  | "hbp"
  | "wild_pitch"
  | "stolen_base"
  | "caught_stealing"
  | "in_play"
  | "inning_end"
  | "pitching_change"
  | "substitution"
  | "game_over";

export interface GameEvent {
  kind: GameEventKind;
  inning: number;
  top: boolean;
  text: string;
  batterId?: number;
  pitcherId?: number;
  runs?: number;
  play?: PlayResult;
  /** Steal events: the base the runner left (0 = first, 1 = second, 2 = third). */
  base?: 0 | 1 | 2;
}

export const emptyBat = (): BatLine => ({ pa: 0, ab: 0, h: 0, d: 0, t: 0, hr: 0, r: 0, rbi: 0, bb: 0, k: 0, hbp: 0, sf: 0 });
export const emptyPit = (): PitLine => ({ outs: 0, h: 0, r: 0, bb: 0, k: 0, hr: 0, pitches: 0, bf: 0 });

export class BaseballGame {
  inning = 1;
  top = true;
  outs = 0;
  balls = 0;
  strikes = 0;
  bases: [Runner | null, Runner | null, Runner | null] = [null, null, null];
  score = { away: 0, home: 0 };
  line: { away: number[]; home: number[] } = { away: [0], home: [] };
  final = false;
  away: Side;
  home: Side;
  bat = new Map<number, BatLine>();
  pit = new Map<number, PitLine>();
  names = new Map<number, string>();
  log: GameEvent[] = [];
  readonly regulation: number;

  constructor(
    awayTeam: TeamModel,
    homeTeam: TeamModel,
    readonly park: Park,
    opts: { awayStarter?: number; homeStarter?: number; innings?: number } = {},
  ) {
    this.regulation = opts.innings ?? 9;
    this.away = this.makeSide(awayTeam, opts.awayStarter ?? 0);
    this.home = this.makeSide(homeTeam, opts.homeStarter ?? 0);
  }

  private makeSide(team: TeamModel, starterIdx: number): Side {
    const pitcher = team.rotation[starterIdx % Math.max(1, team.rotation.length)] ?? team.bullpen[0];
    for (const p of [...team.lineup, ...team.bench]) this.names.set(p.id, p.name);
    for (const p of [...team.rotation, ...team.bullpen]) this.names.set(p.id, p.name);
    return {
      team,
      lineup: team.lineup.slice(0, 9),
      idx: 0,
      pitcher,
      pitchCount: 0,
      pitcherOuts: 0,
      pitcherRuns: 0,
      available: team.bullpen.filter((p) => p.id !== pitcher.id),
      bench: [...team.bench],
      slots: team.lineup.slice(0, 9).map((b) => [b]),
      staff: [pitcher],
    };
  }

  get batting(): Side {
    return this.top ? this.away : this.home;
  }

  get fielding(): Side {
    return this.top ? this.home : this.away;
  }

  get batter(): BatterModel {
    const s = this.batting;
    return s.lineup[s.idx % s.lineup.length];
  }

  name(id: number): string {
    return this.names.get(id) ?? `#${id}`;
  }

  batLine(id: number): BatLine {
    let l = this.bat.get(id);
    if (!l) this.bat.set(id, (l = emptyBat()));
    return l;
  }

  pitLine(id: number): PitLine {
    let l = this.pit.get(id);
    if (!l) this.pit.set(id, (l = emptyPit()));
    return l;
  }

  pitchContext(): PitchContext {
    const f = this.fielding;
    return {
      pitcher: f.pitcher,
      batter: this.batter,
      side: batSide(this.batter, f.pitcher.throws),
      count: { balls: this.balls, strikes: this.strikes },
      outs: this.outs,
      pitchCount: f.pitchCount,
      runnersOn: this.bases.filter(Boolean).length,
      bases: [!!this.bases[0], !!this.bases[1], !!this.bases[2]],
      lateClose: this.inning >= this.regulation - 2 && Math.abs(this.score.home - this.score.away) <= 1,
      park: this.park,
    };
  }

  /** Defensive players with live positions for the current batter. */
  fielders(): Fielder[] {
    const f = this.fielding;
    const side = batSide(this.batter, f.pitcher.throws);
    const late = this.inning >= this.regulation && !this.top;
    const close = Math.abs(this.score.home - this.score.away) <= 1;
    const infieldIn = !!this.bases[2] && this.outs < 2 && late && close;
    const spots = alignment(side, !!this.bases[0], infieldIn);
    const byPos = new Map<FieldPos, BatterModel>();
    for (const b of f.lineup) if (b.pos !== "DH") byPos.set(b.pos, b);
    const out: Fielder[] = [];
    for (const pos of Object.keys(spots) as FieldPos[]) {
      if (pos === "P") {
        out.push({ pos, playerId: f.pitcher.id, p: spots.P, sprint: f.pitcher.sprint, arm: f.pitcher.arm, reaction: DEFAULT_REACTION.P, glove: f.pitcher.glove });
        continue;
      }
      const b = byPos.get(pos);
      out.push({
        pos,
        playerId: b?.id ?? -1,
        p: spots[pos],
        sprint: b?.sprint ?? 27,
        arm: b?.arm ?? 82,
        reaction: DEFAULT_REACTION[pos] + (b?.reactionAdj ?? 0),
        glove: b?.glove ?? 0.5,
      });
    }
    return out;
  }

  private emit(e: Omit<GameEvent, "inning" | "top">): GameEvent {
    const ev = { ...e, inning: this.inning, top: this.top };
    this.log.push(ev);
    return ev;
  }

  private addRuns(scorers: number[], rbiBatter: number | null, homeRun = false): number {
    if (!scorers.length) return 0;
    let allowed = scorers.length;
    // Every run scores on a walk-off home run; otherwise the game ends with the winning run.
    const walkoffZone = !homeRun && !this.top && this.inning >= this.regulation;
    if (walkoffZone) {
      const needed = this.score.away - this.score.home + 1;
      if (needed > 0) allowed = Math.min(allowed, needed);
    }
    return this.creditRuns(scorers.slice(0, allowed), rbiBatter);
  }

  private creditRuns(scorers: number[], rbiBatter: number | null): number {
    const side = this.top ? "away" : "home";
    for (const id of scorers) {
      this.score[side] += 1;
      this.line[side][this.line[side].length - 1] += 1;
      this.batLine(id).r += 1;
      const charged = this.chargedFor.get(id) ?? this.fielding.pitcher.id;
      this.pitLine(charged).r += 1;
      if (charged === this.fielding.pitcher.id) this.fielding.pitcherRuns += 1;
      this.chargedFor.delete(id);
    }
    if (rbiBatter != null) this.batLine(rbiBatter).rbi += scorers.length;
    return scorers.length;
  }

  /** Which pitcher each baserunner is charged to. */
  private chargedFor = new Map<number, number>();

  private forceAdvance(batter: BatterModel): number[] {
    const scorers: number[] = [];
    const r = (id: number, sprint: number): Runner => ({ playerId: id, sprint, chargedTo: this.fielding.pitcher.id });
    const [b1, b2, b3] = this.bases;
    if (b1) {
      if (b2) {
        if (b3) scorers.push(b3.playerId);
        this.bases[2] = b2;
      }
      this.bases[1] = b1;
    }
    this.bases[0] = r(batter.id, batter.sprint);
    this.chargedFor.set(batter.id, this.fielding.pitcher.id);
    return scorers;
  }

  private endPA(): void {
    this.balls = 0;
    this.strikes = 0;
    this.batting.idx = (this.batting.idx + 1) % this.batting.lineup.length;
  }

  /** Resolve a steal of second by the runner on first. */
  applySteal(safe: boolean): GameEvent[] {
    return this.applySteals([{ from: 0, safe }]);
  }

  /**
   * Resolve steal attempts, lead runner first (0 = from first, 1 = second, 2 = third).
   * A runner whose next base is still held (and not vacated by a leg already applied) is skipped.
   */
  applySteals(legs: { from: 0 | 1 | 2; safe: boolean }[]): GameEvent[] {
    if (this.final) return [];
    const events: GameEvent[] = [];
    const sorted = [...legs].sort((a, b) => b.from - a.from);
    const label = ["second", "third", "home"];
    for (const leg of sorted) {
      if (this.final || this.outs >= 3) break;
      const r = this.bases[leg.from];
      if (!r) continue;
      if (leg.from < 2 && this.bases[leg.from + 1]) continue;
      this.bases[leg.from] = null;
      const name = this.names.get(r.playerId) ?? "The runner";
      const double = sorted.length > 1 ? " (double steal)" : "";
      if (leg.safe) {
        if (leg.from === 2) {
          this.addRuns([r.playerId], null);
          events.push(this.emit({ kind: "stolen_base", base: 2, runs: 1, text: `${name} steals home!${double}` }));
          const after = this.afterPlay();
          events.push(...after);
          if (this.final) break;
        } else {
          this.bases[leg.from + 1] = r;
          events.push(this.emit({ kind: "stolen_base", base: leg.from, text: `${name} steals ${label[leg.from]}!${double}` }));
        }
      } else {
        this.recordOuts(1);
        events.push(this.emit({ kind: "caught_stealing", base: leg.from, text: `${name} is caught stealing ${label[leg.from]}.` }));
        const after = this.afterPlay();
        events.push(...after);
        if (after.length) break;
      }
    }
    return events;
  }

  private recordOuts(n: number): void {
    this.outs += n;
    this.pitLine(this.fielding.pitcher.id).outs += n;
    this.fielding.pitcherOuts += n;
  }

  /** Apply one physical pitch result (and its resolved play, for balls in play). */
  apply(result: PitchResult, play?: PlayResult): GameEvent[] {
    if (this.final) return [];
    const events: GameEvent[] = [];
    const b = this.batter;
    const p = this.fielding.pitcher;
    const pl = this.pitLine(p.id);
    const bl = this.batLine(b.id);
    this.fielding.pitchCount += 1;
    pl.pitches += 1;
    const finishPA = () => {
      bl.pa += 1;
      pl.bf += 1;
      this.endPA();
    };

    let kind = result.kind;
    if (kind === "in_play" && play?.foul) kind = "foul";

    switch (kind) {
      case "ball": {
        this.balls += 1;
        if (this.balls >= 4) {
          bl.bb += 1;
          pl.bb += 1;
          const scored = this.forceAdvance(b);
          events.push(this.emit({ kind: "walk", text: `${b.name} walks.`, batterId: b.id, pitcherId: p.id }));
          this.addRuns(scored, b.id);
          finishPA();
        } else if (result.wildPitch && this.bases.some(Boolean)) {
          const scored = this.bases[2] ? [this.bases[2].playerId] : [];
          this.bases = [null, this.bases[0], this.bases[1]];
          events.push(this.emit({ kind: "wild_pitch", text: "Ball, in the dirt — it gets away! Runners move up." }));
          this.addRuns(scored, null);
        } else events.push(this.emit({ kind: "pitch", text: "Ball." }));
        break;
      }
      case "hbp": {
        bl.hbp += 1;
        const scored = this.forceAdvance(b);
        events.push(this.emit({ kind: "hbp", text: `${b.name} is hit by the pitch.`, batterId: b.id, pitcherId: p.id }));
        this.addRuns(scored, b.id);
        finishPA();
        break;
      }
      case "called_strike":
      case "swinging_strike":
      case "foul_tip": {
        this.strikes += 1;
        if (this.strikes >= 3) {
          bl.k += 1;
          bl.ab += 1;
          pl.k += 1;
          this.recordOuts(1);
          const how = kind === "called_strike" ? "called out on strikes" : "strikes out swinging";
          events.push(this.emit({ kind: "strikeout", text: `${b.name} ${how}.`, batterId: b.id, pitcherId: p.id }));
          finishPA();
        } else events.push(this.emit({ kind: "pitch", text: kind === "called_strike" ? "Called strike." : kind === "foul_tip" ? "Foul tip." : result.bunt ? "Misses the bunt." : "Swinging strike." }));
        break;
      }
      case "foul": {
        // A two-strike foul bunt is strike three.
        if (this.strikes === 2 && result.bunt) {
          this.strikes = 3;
          bl.k += 1;
          bl.ab += 1;
          pl.k += 1;
          this.recordOuts(1);
          events.push(this.emit({ kind: "strikeout", text: `${b.name} bunts foul with two strikes — strike three.`, batterId: b.id, pitcherId: p.id }));
          finishPA();
          break;
        }
        if (this.strikes < 2) this.strikes += 1;
        events.push(this.emit({ kind: "pitch", text: result.bunt ? "Bunted foul." : "Foul ball." }));
        break;
      }
      case "in_play": {
        if (!play) throw new Error("in_play result requires a resolved play");
        events.push(this.applyPlay(b, p, play));
        finishPA();
        break;
      }
    }

    events.push(...this.afterPlay());
    return events;
  }

  private applyPlay(b: BatterModel, p: PitcherModel, play: PlayResult): GameEvent {
    const bl = this.batLine(b.id);
    const pl = this.pitLine(p.id);
    const sacFly = play.sacFly && play.runs.length > 0;
    if (!sacFly) bl.ab += 1;
    else bl.sf += 1;
    if (play.hit > 0) {
      bl.h += 1;
      pl.h += 1;
      if (play.hit === 2) bl.d += 1;
      if (play.hit === 3) bl.t += 1;
      if (play.hit === 4) {
        bl.hr += 1;
        pl.hr += 1;
      }
    }
    const old = this.bases;
    const runnerById = new Map<number, Runner>();
    for (const r of old) if (r) runnerById.set(r.playerId, r);
    this.chargedFor.set(b.id, p.id);
    const next: [Runner | null, Runner | null, Runner | null] = [null, null, null];
    for (const r of play.runners) {
      if (r.out || r.to === 4) continue;
      const prev = runnerById.get(r.playerId);
      next[r.to - 1] = prev ?? { playerId: b.id, sprint: b.sprint, chargedTo: p.id };
    }
    for (const r of play.runners) if (r.out) this.chargedFor.delete(r.playerId);
    this.bases = next;
    this.recordOuts(play.outs);
    // No RBI on errors-only runs or double plays.
    const rbiBatter = play.error || play.doublePlay ? null : b.id;
    const runs = this.addRuns(play.runs, rbiBatter, play.hit === 4);
    return this.emit({
      kind: "in_play",
      text: describePlay(this, b, play, runs),
      batterId: b.id,
      pitcherId: p.id,
      runs,
      play,
    });
  }

  private afterPlay(): GameEvent[] {
    const events: GameEvent[] = [];
    // Walk-off.
    if (!this.top && this.inning >= this.regulation && this.score.home > this.score.away) {
      this.final = true;
      events.push(this.emit({ kind: "game_over", text: `Walk-off! ${this.score.away}-${this.score.home} final.` }));
      return events;
    }
    if (this.outs >= 3) {
      events.push(this.emit({ kind: "inning_end", text: `End of the ${this.top ? "top" : "bottom"} of the ${ordinal(this.inning)}.` }));
      this.nextHalf();
      if (this.final) events.push(this.emit({ kind: "game_over", text: `Final: ${this.score.away}-${this.score.home}.` }));
    }
    return events;
  }

  private nextHalf(): void {
    this.outs = 0;
    this.balls = 0;
    this.strikes = 0;
    this.bases = [null, null, null];
    this.chargedFor.clear();
    if (this.top) {
      // Skip the bottom half if the home team already leads in the last inning.
      if (this.inning >= this.regulation && this.score.home > this.score.away) {
        this.final = true;
        return;
      }
      this.top = false;
      this.line.home.push(0);
    } else {
      if (this.inning >= this.regulation && this.score.home !== this.score.away) {
        this.final = true;
        return;
      }
      this.top = true;
      this.inning += 1;
      this.line.away.push(0);
    }
    // Extra innings: the batter before the leadoff man starts on second.
    if (this.inning > this.regulation) {
      const s = this.batting;
      const prev = s.lineup[(s.idx + s.lineup.length - 1) % s.lineup.length];
      this.bases[1] = { playerId: prev.id, sprint: prev.sprint, chargedTo: this.fielding.pitcher.id };
      // Automatic runner is unearned; still charged for bookkeeping.
      this.chargedFor.set(prev.id, this.fielding.pitcher.id);
    }
  }

  /** CPU manager: pull tired or shelled pitchers between batters. */
  managePitching(rng: Rng, manual: "away" | "home" | null = null): GameEvent | null {
    if (this.final) return null;
    // The human runs his own bullpen.
    if (manual && (manual === "home") === this.top) return null;
    const f = this.fielding;
    const p = f.pitcher;
    const isStarter = f.team.rotation.some((x) => x.id === p.id);
    const tired = f.pitchCount >= p.stamina + 6 || (f.pitchCount >= p.stamina && rng.chance(0.35));
    const shelled = f.pitcherRuns >= (isStarter ? 6 : 3);
    const reliefDone = !isStarter && f.pitcherOuts >= 3 && this.outs === 0 && this.balls === 0 && this.strikes === 0 && f.pitchCount > 12;
    if (!(tired || shelled || reliefDone) || f.available.length === 0) return null;
    const lead = this.top ? this.score.home - this.score.away : this.score.away - this.score.home;
    // Save the top reliever (most appearances ≈ closer) for late, close games.
    const closerTime = this.inning >= this.regulation && lead > 0 && lead <= 3;
    const pool = closerTime ? f.available : f.available.length > 1 ? f.available.slice(1) : f.available;
    const next = closerTime ? pool[0] : pool[0];
    return this.bringIn(f, next);
  }

  private bringIn(f: Side, next: PitcherModel): GameEvent {
    const p = f.pitcher;
    f.available = f.available.filter((x) => x.id !== next.id);
    f.pitcher = next;
    f.staff.push(next);
    f.pitchCount = 0;
    f.pitcherOuts = 0;
    f.pitcherRuns = 0;
    return this.emit({ kind: "pitching_change", text: `Pitching change: ${next.name} replaces ${p.name}.`, pitcherId: next.id });
  }

  /** Whether a substitution is legal right now (between pitches). */
  canSubstitute(sub: Substitution): boolean {
    if (this.final) return false;
    const side = sub.side === "away" ? this.away : this.home;
    switch (sub.kind) {
      case "pitcher":
        return side === this.fielding && side.available.some((p) => p.id === sub.inId);
      case "pinchHit":
        return side === this.batting && side.bench.some((b) => b.id === sub.inId);
      case "pinchRun": {
        const r = this.bases[sub.base];
        return side === this.batting && !!r && side.bench.some((b) => b.id === sub.inId) && side.lineup.some((b) => b.id === r.playerId);
      }
      case "defense":
        return side.bench.some((b) => b.id === sub.inId) && side.lineup.some((b) => b.id === sub.outId);
    }
  }

  /** Make a substitution. The new man takes over the old one's batting slot and position. */
  substitute(sub: Substitution): GameEvent | null {
    if (!this.canSubstitute(sub)) return null;
    const side = sub.side === "away" ? this.away : this.home;
    if (sub.kind === "pitcher") return this.bringIn(side, side.available.find((p) => p.id === sub.inId)!);
    const inc = side.bench.find((b) => b.id === sub.inId)!;
    const outId = sub.kind === "pinchHit" ? this.batter.id : sub.kind === "pinchRun" ? this.bases[sub.base]!.playerId : sub.outId;
    const slot = side.lineup.findIndex((b) => b.id === outId);
    const out = side.lineup[slot];
    const sub2: BatterModel = { ...inc, pos: out.pos };
    side.lineup[slot] = sub2;
    side.bench = side.bench.filter((b) => b.id !== inc.id);
    side.slots[slot].push(sub2);
    let text: string;
    if (sub.kind === "pinchRun") {
      const r = this.bases[sub.base]!;
      this.bases[sub.base] = { ...r, playerId: inc.id, sprint: inc.sprint };
      const charged = this.chargedFor.get(out.id);
      if (charged != null) {
        this.chargedFor.delete(out.id);
        this.chargedFor.set(inc.id, charged);
      }
      text = `${inc.name} pinch-runs for ${out.name} at ${["first", "second", "third"][sub.base]}.`;
    } else if (sub.kind === "pinchHit") text = `${inc.name} pinch-hits for ${out.name}.`;
    else text = `Defensive change: ${inc.name} replaces ${out.name}${out.pos === "DH" ? "" : ` at ${out.pos}`}.`;
    return this.emit({ kind: "substitution", text, batterId: inc.id });
  }

  /**
   * CPU manager, offense: late and close, send up a better bat off the bench against
   * this pitcher, and a faster runner for a slow one carrying the tying / winning run.
   * Deterministic (no dice), so it never shifts the game's random stream.
   */
  manageLineup(cpuSide: "away" | "home" | "both"): GameEvent[] {
    if (this.final) return [];
    const side = this.batting;
    const name = this.top ? "away" : "home";
    if (cpuSide !== "both" && cpuSide !== name) return [];
    const lead = this.top ? this.score.away - this.score.home : this.score.home - this.score.away;
    if (this.inning < 7 || lead > 1 || lead < -3) return [];
    const events: GameEvent[] = [];
    // Pinch runner: slow runner who is the tying or winning run in scoring position.
    for (const base of [2, 1] as const) {
      const r = this.bases[base];
      if (!r || r.sprint >= 26.5) continue;
      const runsAhead = this.bases.slice(base + 1).filter(Boolean).length;
      if (lead + runsAhead + 1 < 0 || lead + runsAhead + 1 > 1) continue;
      const fast = [...side.bench].sort((a, b) => b.sprint - a.sprint)[0];
      if (fast && fast.sprint >= r.sprint + 1.5) {
        const e = this.substitute({ kind: "pinchRun", side: name, base, inId: fast.id });
        if (e) events.push(e);
      }
    }
    // Pinch hitter: a clearly better bat for this matchup (once per slot).
    const cur = this.batter;
    const slot = side.lineup.findIndex((b) => b.id === cur.id);
    if (slot >= 0 && side.slots[slot].length === 1 && side.bench.length > 1) {
      const hand = this.fielding.pitcher.throws;
      const value = (b: BatterModel) => {
        const plat = batSide(b, hand) !== hand ? 0.035 : 0;
        return b.zContact * 0.6 + b.batSpeedMph / 100 + plat - b.oSwing * 0.3;
      };
      const best = [...side.bench].sort((a, b) => value(b) - value(a))[0];
      if (best && value(best) > value(cur) + 0.06 && cur.pos !== "C") {
        const e = this.substitute({ kind: "pinchHit", side: name, inId: best.id });
        if (e) events.push(e);
      }
    }
    return events;
  }
}

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

const POS_NAME: Record<string, string> = {
  P: "the pitcher",
  C: "the catcher",
  "1B": "first",
  "2B": "second",
  "3B": "third",
  SS: "short",
  LF: "left",
  CF: "center",
  RF: "right",
};

function describePlay(game: BaseballGame, b: BatterModel, play: PlayResult, runs: number): string {
  const where = play.fieldedBy ? POS_NAME[play.fieldedBy] : "the field";
  let s: string;
  if (play.hit === 4) s = `${b.name} homers${runs > 1 ? ` (${runs} run${runs > 1 ? "s" : ""})` : ""}!`;
  else if (play.hit === 3) s = `${b.name} triples to ${where}.`;
  else if (play.hit === 2) s = `${b.name} doubles to ${where}.`;
  else if (play.hit === 1) s = `${b.name} singles to ${where}.`;
  else if (play.error) s = `${b.name} reaches on an error (${play.scoring}).`;
  else if (play.doublePlay) s = `${b.name} grounds into a double play (${play.scoring}).`;
  else if (play.fieldersChoice) s = `${b.name} reaches on a fielder's choice.`;
  else if (play.caught) s = `${b.name} ${play.scoring.startsWith("P") ? "pops out" : play.scoring.startsWith("L") ? "lines out" : "flies out"} to ${where}${play.sacFly ? " (sac fly)" : ""}.`;
  else s = `${b.name} grounds out (${play.scoring}).`;
  const scorers = play.runs.slice(0, runs).filter((id) => id !== b.id).map((id) => game.name(id));
  if (scorers.length) s += ` ${scorers.join(", ")} score${scorers.length > 1 ? "" : "s"}.`;
  return s;
}
