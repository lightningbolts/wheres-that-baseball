/**
 * Interactive game session. A pitch runs in phases so a human can act between them:
 *   prepare() → throw(input) → swing(input) → [throw choice] → commit(throwBase)
 * Every pitch's human inputs are recorded; replaying them with the same seed
 * reproduces the game exactly (save / resume = setup + inputs).
 */
import { CPU, cpuChoosePitch, cpuDecideSwing } from "@/lib/game/ai/cpu";
import { cpuWantsSteal, resolveSteal, stealRace, withPitchSpeed, type StealFrom, type StealRace } from "@/lib/game/ai/baserunning";
import {
  resolveSwingPhase,
  throwPitchPhase,
  type PitchContext,
  type PitchDecision,
  type PitchResult,
  type SwingDecision,
} from "@/lib/game/engine/atBat";
import { resolvePlay, type Base, type PlayResult, type ThrowOption } from "@/lib/game/play/resolvePlay";
import { chargeBunt, type Fielder } from "@/lib/game/play/defense";
import { BaseballGame, type GameEvent, type Runner, type Substitution } from "@/lib/game/rules/game";
import { batSide, teamModel, type TeamModel } from "@/lib/game/ratings";
import { buildPark, homeVenueForTeam } from "@/lib/game/physics/park";
import { Rng } from "@/lib/game/math";
import type { FieldPos, RosterFile } from "@/lib/game/types";

export type HumanSide = "away" | "home" | "none";
export type Difficulty = "rookie" | "pro" | "allstar";

export interface GameSetup {
  awayTeamId: number;
  homeTeamId: number;
  human: HumanSide;
  innings: number;
  seed: number;
  difficulty: Difficulty;
  awayStarter: number;
  homeStarter: number;
  tempF?: number;
  /**
   * Managers on: the human runs his own club's bullpen and bench, and the CPU makes
   * late-game pinch-hit / pinch-run moves. Absent on games saved before substitutions
   * existed, which keep the old rules so they replay unchanged.
   */
  manager?: boolean;
}

/** Everything a human decided on one pitch. `cpu` = that pitch was auto-played. */
export interface PitchInput {
  cpu?: boolean;
  pitch?: PitchDecision;
  swing?: SwingDecision;
  /** Legacy: steal of second by the runner on first (same as steals: [0]). */
  steal?: boolean;
  /** Runners sent on this pitch, by the base they leave (0 = first … 2 = third). */
  steals?: StealFrom[];
  /** Human throw target (null = hold the ball); absent = let the AI throw. */
  throwBase?: Base | null;
  /** Human substitutions made before this pitch, in order. */
  subs?: Substitution[];
}

export interface ThrowPrompt {
  options: ThrowOption[];
  fielded: { pos: FieldPos; t: number };
}

export interface PitchOutcome {
  ctx: PitchContext;
  result: PitchResult;
  play?: PlayResult;
  /** Fielders and runners at the moment of the pitch (for animation). */
  fielders: Fielder[];
  runners: [Runner | null, Runner | null, Runner | null];
  battingSide: "L" | "R";
  steal: StealRace | null;
  throwPrompt?: ThrowPrompt;
}

export interface CommittedPitch extends PitchOutcome {
  events: GameEvent[];
}

interface Pending {
  input: PitchInput;
  ctx: PitchContext;
  pre: GameEvent[];
  steal: StealRace | null;
  decision?: PitchDecision;
  flight?: PitchResult["flight"];
  outcome?: PitchOutcome;
  playRng?: Rng;
}

export function teamsFromRosters(file: RosterFile): Map<number, TeamModel> {
  const m = new Map<number, TeamModel>();
  for (const t of Object.values(file.teams)) m.set(t.teamId, teamModel(t));
  return m;
}

export class GameSession {
  readonly game: BaseballGame;
  readonly rng: Rng;
  readonly inputs: PitchInput[] = [];
  private pending: Pending | null = null;

  constructor(
    readonly setup: GameSetup,
    teams: Map<number, TeamModel>,
  ) {
    const away = teams.get(setup.awayTeamId);
    const home = teams.get(setup.homeTeamId);
    if (!away || !home) throw new Error("Unknown team in game setup");
    this.rng = new Rng(setup.seed);
    this.game = new BaseballGame(away, home, buildPark(homeVenueForTeam(home.teamId), setup.tempF ?? 72), {
      awayStarter: setup.awayStarter,
      homeStarter: setup.homeStarter,
      innings: setup.innings,
    });
  }

  /** Rebuild a session by replaying recorded inputs (save → resume). */
  static replay(setup: GameSetup, inputs: PitchInput[], teams: Map<number, TeamModel>): GameSession {
    const s = new GameSession(setup, teams);
    for (const input of inputs) {
      if (s.game.final) break;
      s.prepare(input.cpu);
      for (const sub of input.subs ?? []) s.substitute(sub);
      s.throw(input);
      s.swing(input);
      s.commit(input.throwBase);
    }
    return s;
  }

  get humanBatting(): boolean {
    const h = this.setup.human;
    return h !== "none" && (h === "away") === this.game.top;
  }

  get humanPitching(): boolean {
    const h = this.setup.human;
    return h !== "none" && (h === "home") === this.game.top;
  }

  get stage(): "idle" | "prepared" | "thrown" | "swung" {
    const p = this.pending;
    if (!p) return "idle";
    if (p.outcome) return "swung";
    if (p.flight) return "thrown";
    return "prepared";
  }

  get currentContext(): PitchContext | null {
    return this.pending?.ctx ?? null;
  }

  /** The pitch now thrown: type and intended target (where the catcher set up), or null. */
  get currentDecision(): PitchDecision | null {
    return this.pending?.flight ? (this.pending.decision ?? null) : null;
  }

  /** Bullpen moves happen here, before the pitch. Idempotent until the pitch is committed. */
  prepare(auto = false): { ctx: PitchContext; events: GameEvent[] } {
    if (this.pending) return { ctx: this.pending.ctx, events: this.pending.pre };
    const mgr = !!this.setup.manager;
    const human = this.setup.human === "none" ? null : this.setup.human;
    const pre: GameEvent[] = [];
    const change = this.game.managePitching(this.rng, mgr ? human : null);
    if (change) pre.push(change);
    if (mgr) pre.push(...this.game.manageLineup(human === null ? "both" : human === "home" ? "away" : "home"));
    const ctx = this.game.pitchContext();
    this.pending = { input: auto ? { cpu: true } : {}, ctx, pre, steal: null };
    return { ctx, events: this.pending.pre };
  }

  /** Which side the human manages (null when the CPU plays both). */
  get humanSide(): "away" | "home" | null {
    return this.setup.human === "none" ? null : this.setup.human;
  }

  /**
   * Make a substitution before the pitch (the human's managing moves). Recorded with
   * the pitch so replays reproduce it. Returns the event, or null if not allowed now.
   */
  substitute(sub: Substitution): GameEvent | null {
    if (this.pending?.flight) return null;
    const p = this.pending ?? (this.prepare(), this.pending!);
    const e = this.game.substitute(sub);
    if (!e) return null;
    p.ctx = this.game.pitchContext();
    p.pre.push(e);
    (p.input.subs ??= []).push(sub);
    return e;
  }

  /** Release the pitch. Human pitchers pass their decision; CPU decides otherwise. */
  throw(input: PitchInput = {}): PitchResult["flight"] {
    const p = this.pending ?? (this.prepare(input.cpu), this.pending!);
    if (p.flight) return p.flight;
    const auto = !!(input.cpu || p.input.cpu);
    p.input.cpu = auto || undefined;
    const humanOffense = this.humanBatting && !auto;
    const humanDefense = this.humanPitching && !auto;
    const human = input.steals?.length ? input.steals : input.steal ? ([0] as StealFrom[]) : null;
    const wants = humanOffense ? human : cpuWantsSteal(this.game, this.rng);
    p.steal = wants?.length ? stealRace(this.game, wants) : null;
    if (humanOffense && p.steal) p.input.steals = p.steal.legs.map((l) => l.from);
    let decision: PitchDecision;
    if (humanDefense && input.pitch) {
      decision = input.pitch;
      p.input.pitch = input.pitch;
    } else decision = cpuChoosePitch(p.ctx, this.rng);
    p.decision = decision;
    p.flight = throwPitchPhase(p.ctx, decision, this.rng);
    if (p.steal) p.steal = withPitchSpeed(p.steal, p.flight.releaseSpeedMph);
    return p.flight;
  }

  /** Swing (or take). Human batters pass their swing; CPU decides otherwise. */
  swing(input: PitchInput = {}): PitchOutcome {
    const p = this.pending;
    if (!p?.flight || !p.decision) throw new Error("swing() before throw()");
    if (p.outcome) return p.outcome;
    const humanOffense = this.humanBatting && !p.input.cpu;
    let swing: SwingDecision;
    if (humanOffense) {
      swing = input.swing ?? { swing: false, timingErrMs: 0, verticalErrFt: 0, alongErrFt: 0 };
      p.input.swing = swing;
    } else swing = cpuDecideSwing(p.ctx, p.flight, this.rng);
    const result = resolveSwingPhase(p.ctx, p.decision, p.flight, swing, this.rng);
    const fielders = result.bunt ? chargeBunt(this.game.fielders()) : this.game.fielders();
    const runners = [...this.game.bases] as PitchOutcome["runners"];
    const battingSide = batSide(p.ctx.batter, p.ctx.pitcher.throws);
    const outcome: PitchOutcome = { ctx: p.ctx, result, fielders, runners, battingSide, steal: p.steal };
    if (result.kind === "in_play" && result.path && result.contact) {
      const humanDefense = this.humanPitching && !p.input.cpu;
      p.playRng = this.rng.clone();
      let prompt: ThrowPrompt | undefined;
      outcome.play = this.resolve(outcome, p.playRng.clone(), humanDefense ? (options, fielded) => {
        if (!prompt && options.length) prompt = { options, fielded };
        return undefined;
      } : undefined);
      if (prompt) outcome.throwPrompt = prompt;
    }
    p.outcome = outcome;
    return outcome;
  }

  private resolve(o: PitchOutcome, rng: Rng, chooseThrow?: Parameters<typeof resolvePlay>[0]["chooseThrow"]): PlayResult {
    const b = o.ctx.batter;
    const bases = o.runners;
    return resolvePlay({
      path: o.result.path!,
      park: this.game.park,
      fielders: o.fielders,
      runners: bases.map((r, i) =>
        r ? { playerId: r.playerId, sprint: r.sprint, going: !!o.steal?.legs.some((l) => l.from === i) } : null,
      ) as Parameters<typeof resolvePlay>[0]["runners"],
      batter: { playerId: b.id, sprint: b.sprint, bats: o.battingSide, bunt: !!o.result.bunt },
      outs: this.game.outs,
      rng,
      chooseThrow,
      launch: { ev: o.result.contact!.exitSpeedMph ?? 0, la: o.result.contact!.launchAngleDeg ?? 0 },
    });
  }

  /**
   * Apply the pitch to the game. For a human defense with a throw prompt, pass the
   * chosen base (or null to hold); undefined keeps the AI's throw.
   */
  commit(throwBase?: Base | null): CommittedPitch {
    const p = this.pending;
    if (!p?.outcome) throw new Error("commit() before swing()");
    const o = p.outcome;
    // Resolution consumes the RNG exactly like the headless sim: the play's own draws
    // come from a clone, then the main stream skips past them deterministically.
    if (o.result.kind === "in_play" && o.play && p.playRng) {
      if (throwBase !== undefined && o.throwPrompt) {
        p.input.throwBase = throwBase;
        o.play = this.resolve(o, p.playRng.clone(), () => throwBase);
      }
      this.rng.next();
    }
    const events = [...p.pre, ...this.game.apply(o.result, o.play)];
    const noContact =
      o.result.kind === "called_strike" || o.result.kind === "swinging_strike" || (o.result.kind === "ball" && !o.result.wildPitch);
    // Runners still on the bags they left (the pitch didn't end the half or move them) race the throw.
    if (o.steal && noContact && !this.game.final && o.steal.legs.every((l) => this.game.bases[l.from]?.playerId === l.runnerId)) {
      events.push(...this.game.applySteals(resolveSteal(o.steal, this.rng)));
    }
    this.inputs.push(p.input);
    this.pending = null;
    return { ...o, events };
  }

  /** Auto-play one pitch with the CPU on both sides. */
  autoPitch(): CommittedPitch {
    this.prepare(true);
    this.throw({ cpu: true });
    this.swing({ cpu: true });
    return this.commit();
  }

  /** Quick-sim to the end of the current half-inning (or the game). */
  simHalfInning(): CommittedPitch[] {
    const key = `${this.game.inning}${this.game.top}`;
    const out: CommittedPitch[] = [];
    while (!this.game.final && `${this.game.inning}${this.game.top}` === key) out.push(this.autoPitch());
    return out;
  }
}

export { CPU };
