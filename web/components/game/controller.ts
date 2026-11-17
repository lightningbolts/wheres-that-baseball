/**
 * Pitch-by-pitch game flow for the 3D view: drives a GameSession from human input,
 * hands timelines to the scene's Playback, and exposes a HUD snapshot. Lives
 * outside React so per-frame scene code and input handlers share one source of truth.
 */
import * as THREE from "three";
import { capLogo, capLogoVersion, uniformFor } from "@/components/game/scene/character/uniforms";
import { buildTimeline, type Timeline } from "@/lib/game/anim/timeline";
import { buildPickoffTimeline } from "@/lib/game/anim/pickoff";
import { GameSession, type CommittedPickoff, type CommittedPitch, type GameSetup, type PitchInput, type PitchOutcome } from "@/lib/game/session/session";
import { DIFFICULTY, humanPitch, humanSwing, meterAt, pciHalfSize } from "@/lib/game/session/humanInput";
import { idealContactTime } from "@/lib/game/engine/atBat";
import { zoneContact, type PitchFlight } from "@/lib/game/physics/pitch";
import { legalSteals, type StealFrom } from "@/lib/game/ai/baserunning";
import type { GameEvent, Side, Substitution } from "@/lib/game/rules/game";
import { batSide, type BatterModel, type PitcherModel, type TeamModel } from "@/lib/game/ratings";
import { Rng, clamp } from "@/lib/game/math";
import { homeWinProbability } from "@/lib/mlb/winExpectancy";
import { getTeamColor } from "@/lib/mlb/teamColors";
import { beginTransition, walkUpLeft, type CamMode, type Playback } from "@/components/game/scene/playback";
import { camCut } from "@/components/game/scene/camera";
import type { PitchRecord } from "@/lib/game/stats/pitchLog";
import { MARK_COLOR, plateHud, type MarkKind, type PitchMark, type PlateHud } from "@/components/game/scene/view";
import { crowdState, scoreboardCanvas } from "@/components/game/scene/Ballpark";
import { zoneMiss, type AbsChallengerRole, type ZoneMissSide } from "@/lib/game/rules/abs";
import { sfx } from "@/components/game/audio";
import { crowdReaction, crowdRise, crowdVolume, type CrowdInput } from "@/lib/game/crowd/reaction";
import { saveGame, clearSave } from "@/components/game/save";

export type Phase = "aim" | "meter" | "ready" | "pitch" | "play" | "between" | "final" | "handoff" | "challenge" | "review" | "pickoff";

export interface HudSnapshot {
  phase: Phase;
  inning: number;
  top: boolean;
  outs: number;
  balls: number;
  strikes: number;
  bases: [boolean, boolean, boolean];
  score: { away: number; home: number };
  line: { away: number[]; home: number[] };
  batterName: string;
  batterLine: string;
  pitcherName: string;
  pitchCount: number;
  arsenal: Array<{ type: string; mph: number }>;
  pitchIdx: number;
  humanBatting: boolean;
  humanPitching: boolean;
  canSteal: boolean;
  stealOn: boolean;
  /** Bags whose runner the human may send on this pitch (0 = first, 1 = second, 2 = third). */
  stealOpts: number[];
  /** Bags the human pitcher may throw over to now (0 = first, 1 = second). */
  pickoffs: number[];
  /** Throw-overs / step-offs used this plate appearance (a third that misses is a balk). */
  disengagements: number;
  /** Runners sent (legal combination), by the bag they leave. */
  steals: number[];
  /** Who is on each base: name, number, sprint speed and SB record. */
  runners: Array<{ id: number; name: string; num: string | null; sprint: number; sb: number; cs: number } | null>;
  /** Squared to bunt: 0 = no, 1 = down the third-base line, 2 = toward first. */
  bunt: 0 | 1 | 2;
  canBunt: boolean;
  /** Live umpire call on the bases during a play. */
  call: { id: number; text: string; base: number; tone: "good" | "bad" | "neutral" } | null;
  power: boolean;
  meterStart: number | null;
  banner: { text: string; sub?: string; tone: "good" | "bad" | "neutral" } | null;
  log: Array<{ id: number; text: string }>;
  winProbHome: number;
  final: boolean;
  turbo: boolean;
  /** The pitch on its way / just thrown: type and speed, then what came of it. */
  readout: { id: number; type: string; mph: number; result: string | null; kind: MarkKind } | null;
  /** This at-bat's pitches (where each crossed the plate), oldest first. */
  pitches: PitchMark[];
  /** Statcast-style record of every pitch so far (a pitch shows once its play is over). */
  pitchLog: PitchRecord[];
  zone: { bottom: number; top: number };
  /** The human may make a substitution now (between pitches, his own club). */
  canManage: boolean;
  /** The human's pitcher is past his usual workload. */
  pitcherTired: boolean;
  /** Instant feedback on the human's swing (timing, bat vs ball) and on contact (exit velocity / launch angle). */
  feedback: {
    id: number;
    text: string;
    sub?: string;
    tone: "good" | "bad" | "neutral";
    /** Swing timing error, ms (negative = early). */
    timingMs?: number;
    /** Where the bat's coverage box was and where the ball crossed (Statcast px / pz, ft). */
    swing?: { pci: { px: number; pz: number; w: number; h: number }; ball: { px: number; pz: number }; zone: { bottom: number; top: number } };
  } | null;
  /** The picture is covered: the quick dip to black of a broadcast cut, or the inning bumper. */
  curtain: boolean;
  /** Between half-innings: the card that covers the teams changing sides. */
  bumper: { title: string; sub: string } | null;
  /** ABS challenges each club has left (null: no ABS this game). */
  abs: { away: number; home: number } | null;
  /** A human may challenge the umpire's call now: who, what was called, and when the window closes. */
  challenge: { side: "away" | "home"; call: "strike" | "ball"; until: number; ms: number } | null;
  /**
   * ABS review under way (either club, human or CPU): who asked, what was called, and —
   * once the zone has spoken — the verdict. Shown as one card, review then verdict.
   */
  review: {
    side: "away" | "home";
    name: string;
    by: AbsChallengerRole;
    call: "strike" | "ball";
    cpu: boolean;
    stage: "review" | "verdict";
    overturned: boolean | null;
    /** The overturn made it strike three / ball four. */
    flip: "strikeout" | "walk" | null;
    /** Good news for the player watching (null: two players or a CPU-only game). */
    good: boolean | null;
    /** Where the pitch crossed relative to the zone edge (shown with the verdict). */
    miss: { inches: number; inZone: boolean; side: ZoneMissSide | null };
  } | null;
  /** Two-player game. */
  twoPlayer: boolean;
  /** Two players: the controls are changing hands (the card says who is up). */
  handoff: { title: string; sub: string } | null;
  /** Two players: whose turn it is at the controls right now ("P1" = away, "P2" = home). */
  turn: { player: "P1" | "P2"; teamId: number; role: "pitch" | "bat" } | null;
}

/** A broadcast cut dips to black for this long before the shot changes (ms). */
const DIP_MS = 150;
/** How long the inning bumper holds the screen (ms). */
const BUMPER_MS = 800;

/** What the HUD shows of the game state. It trails the session, which knows a pitch's outcome before the pitch is shown. */
type Board = Pick<
  HudSnapshot,
  | "inning"
  | "top"
  | "outs"
  | "balls"
  | "strikes"
  | "bases"
  | "score"
  | "line"
  | "batterName"
  | "batterLine"
  | "pitcherName"
  | "pitchCount"
  | "arsenal"
  | "humanBatting"
  | "humanPitching"
  | "winProbHome"
  | "final"
  | "abs"
> & { runnerIds: (number | null)[] };

const markKind = (k: string): MarkKind => (k === "foul_tip" ? "swinging_strike" : k in MARK_COLOR ? (k as MarkKind) : "ball");
/** Gameday's call for a pitch put in play: out(s) (purple), no out or run(s) (blue). */
function inPlayCall(c: CommittedPitch): { kind: MarkKind; text: string } | null {
  const p = c.play;
  if (c.result.kind !== "in_play" || !p || p.foul) return null;
  if (p.runs.length) return { kind: p.hit === 0 && p.outs > 0 ? "in_play_out" : "in_play", text: "In play, run(s)" };
  if (p.hit === 0 && p.outs > 0) return { kind: "in_play_out", text: "In play, out(s)" };
  return { kind: "in_play", text: "In play, no out" };
}
/** A batted ball that lands foul is a foul (red), never "in play". */
const isFoulBall = (c: Pick<CommittedPitch, "result" | "play">) => c.result.kind === "foul" || (c.result.kind === "in_play" && !!c.play?.foul);
export const finalMark = (c: CommittedPitch) =>
  inPlayCall(c) ?? (isFoulBall(c) ? { kind: "foul" as MarkKind, text: RESULT_TEXT.foul ?? "Foul" } : { kind: markKind(c.result.kind), text: RESULT_TEXT[c.result.kind] ?? c.result.kind });
/** Approach ring on the zone: the whole flight for rookies, the last stretch on pro, off on all-star. */
const ASSIST_FROM: Record<GameSetup["difficulty"], number | null> = { rookie: 0, pro: 0.5, allstar: null };
/** Pre-pitch read on the catcher's setup: spot radius and how far its center may be off (ft). */
const HINT: Record<GameSetup["difficulty"], { r: number; jitter: number }> = {
  rookie: { r: 0.32, jitter: 0.06 },
  pro: { r: 0.48, jitter: 0.16 },
  allstar: { r: 0.62, jitter: 0.26 },
};

const PITCH_NAMES: Record<string, string> = {
  FF: "4-Seam",
  SI: "Sinker",
  FC: "Cutter",
  SL: "Slider",
  ST: "Sweeper",
  CU: "Curve",
  KC: "Knuckle Curve",
  SV: "Slurve",
  CS: "Slow Curve",
  CH: "Changeup",
  FS: "Splitter",
  FO: "Forkball",
  SC: "Screwball",
  KN: "Knuckleball",
};
export const pitchName = (t: string) => PITCH_NAMES[t] ?? t;

const RESULT_TEXT: Record<string, string> = {
  ball: "Ball",
  called_strike: "Called strike",
  swinging_strike: "Swinging strike",
  foul: "Foul",
  foul_tip: "Foul tip",
  hbp: "Hit by pitch",
  in_play: "In play",
};

/** A manager's move as the human makes it (his own side is implied). */
export type SubMove = Substitution extends infer S ? (S extends Substitution ? Omit<S, "side"> : never) : never;

export interface ManagerBat {
  id: number;
  name: string;
  pos: string;
  natural: string;
  bats: "L" | "R" | "S";
  /** Has the platoon edge on the pitcher now on the mound (batting side only). */
  platoon: boolean | null;
  hr: number | null;
  pa: number;
  kPct: number | null;
  ev: number | null;
  sprint: number;
  glove: number;
}

export interface ManagerArm {
  id: number;
  name: string;
  throws: "L" | "R";
  kPct: number | null;
  bbPct: number | null;
  topMph: number;
  pitches: string[];
  stamina: number;
}

export interface ManagerView {
  allowed: boolean;
  /** The human's club is in the field (pitching changes / defense) or at bat (pinch hit / run). */
  fielding: boolean;
  pitcher: ManagerArm & { count: number; runs: number; tired: boolean };
  bullpen: ManagerArm[];
  bench: ManagerBat[];
  lineup: ManagerBat[];
  batterId: number | null;
  runners: Array<{ base: 0 | 1 | 2; id: number; name: string }>;
}

export class GameController {
  readonly pb: Playback;
  session: GameSession;
  private listeners = new Set<() => void>();
  private timers: ReturnType<typeof setTimeout>[] = [];
  /** Pitches in the log the HUD may show (the one being played out is held back). */
  private logShown = 0;
  private inputRng = new Rng((Date.now() & 0x7fffffff) || 7);
  private snap!: HudSnapshot;
  private phase: Phase = "between";
  /** Game state just before the committed pitch (for the crowd's read of the play). */
  private pre: Pick<CrowdInput, "top" | "inning" | "outsBefore" | "basesBefore" | "scoreBefore"> | null = null;
  private pitchIdx = 0;
  private power = false;
  private steals = new Set<StealFrom>();
  private bunt: 0 | 1 | 2 = 0;
  private call: HudSnapshot["call"] = null;
  private callId = 0;
  private meterStart: number | null = null;
  private swung = false;
  private flight: PitchFlight | null = null;
  private outcome: PitchOutcome | null = null;
  private banner: HudSnapshot["banner"] = null;
  private log: Array<{ id: number; text: string }> = [];
  private logId = 0;
  private readout: HudSnapshot["readout"] = null;
  private readoutId = 0;
  private feedback: HudSnapshot["feedback"] = null;
  private feedbackId = 0;
  /** The scoreboard canvas last drawn (the scene publishes it after the controller starts). */
  private boardCanvas: HTMLCanvasElement | null = null;
  /** Cap-logo load count the board was last drawn with (redraw once marks arrive). */
  private boardLogos = -1;
  private disposed = false;
  private board!: Board;
  private hud: PlateHud;
  /** All nine fielders; the scene's cast leaves the catcher out while the camera sits at his eyes. */
  private fielders: NonNullable<Playback["cast"]>["fielders"] = [];
  /** Fast-forward as the player set it; playback itself runs at normal speed while he is hitting. */
  private turbo = false;
  private pitchSeq = 0;
  /** Manager moves already put on screen when they were made. */
  private shown = new WeakSet<GameEvent>();
  private marked = false;
  private revealed = false;
  private curtain = false;
  private bumper: HudSnapshot["bumper"] = null;
  /** ABS challenge window open on the pitch just called. */
  private challengeWin: HudSnapshot["challenge"] = null;
  private challengeResolve: ((yes: boolean) => void) | null = null;
  /** ABS review card (see HudSnapshot.review) and the challenge counts from before it (no spoilers). */
  private review: HudSnapshot["review"] = null;
  private reviewAbs: { away: number; home: number } | null = null;
  /** The pitch is not yet in the book (waiting on a challenge): the HUD must not show it. */
  private provisional = false;
  /** Two players: the pitch the pitcher has locked in, waiting for the hitter. */
  private lockedPitch: PitchInput["pitch"] | null = null;
  private handoff: HudSnapshot["handoff"] = null;
  private handoffNext: (() => void) | null = null;

  readonly setup: GameSetup;

  constructor(
    setup: GameSetup,
    private teams: Map<number, TeamModel>,
    pb: Playback,
    inputs: PitchInput[] = [],
  ) {
    // New games get the current rules (throw-overs, Savant-rate CPU challenges). A resumed
    // game keeps the rules it was saved under: a save without the flags predates them, and
    // its recorded pitches must replay under the old behavior to come out the same.
    const fresh = !inputs.length;
    const pickoffs = setup.pickoffs ?? (fresh || inputs.some((i) => i.pickoff !== undefined));
    const cpuAbs = setup.cpuAbs ?? (fresh ? 2 : 1);
    this.setup = pickoffs === setup.pickoffs && cpuAbs === setup.cpuAbs ? setup : { ...setup, pickoffs, cpuAbs };
    setup = this.setup;
    this.pb = pb;
    this.session = inputs.length ? GameSession.replay(setup, inputs, teams) : new GameSession(setup, teams);
    this.hud = plateHud(pb);
    this.hud.marks = [];
    this.hud.assistFrom = ASSIST_FROM[setup.difficulty];
    this.refreshCast();
    this.board = this.readBoard();
    this.snap = this.buildSnap();
  }

  // ---------- subscription ----------
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  getSnapshot = (): HudSnapshot => this.snap;
  private emit() {
    this.snap = this.buildSnap();
    for (const l of this.listeners) l();
  }

  dispose() {
    this.disposed = true;
    this.timers.forEach(clearTimeout);
    this.timers = [];
    this.pb.onEnd = null;
    this.pb.cues = [];
  }

  private later(ms: number, fn: () => void) {
    const id = setTimeout(() => {
      if (!this.disposed) fn();
    }, ms);
    this.timers.push(id);
  }

  /** Switch camera: a cut snaps the camera and everybody's animation across it; otherwise the camera moves there. */
  private setCam(mode: CamMode, cut = true) {
    if (this.pb.cam === mode) return;
    this.pb.cam = mode;
    if (cut) this.pb.cutSeq += 1;
    this.syncCast();
  }

  /** Change the scene out of sight: dip to black, run `swap`, come back up. */
  private cover(swap: () => void, hold = DIP_MS) {
    this.curtain = true;
    this.emit();
    this.later(hold, () => {
      this.pb.curtain = 1;
      swap();
      this.later(50, () => this.uncover());
    });
  }

  /** A new timeline is about to start: anybody it puts somewhere else walks there instead of jumping. */
  private settle() {
    if (this.turbo || this.pb.turbo) this.pb.trans = null;
    else beginTransition(this.pb, { cut: false });
  }

  private uncover() {
    this.pb.curtain = 0;
    if (!this.curtain && !this.bumper) return;
    this.curtain = false;
    this.bumper = null;
    this.emit();
  }

  /**
   * On to the next pitch. Where the shot stays on the same side of the field the camera
   * moves and the players walk; a change of ends (or coming back from a ball in play,
   * with fielders all over the park) is a broadcast cut behind a quick dip to black.
   */
  private advance() {
    const s = this.session;
    const from = this.pb.cam;
    const to: CamMode = s.game.final ? "overview" : s.humanPitching ? "pitcher" : s.humanBatting ? "batter" : "broadcast";
    const cut = from !== to && (camCut(from, to) || from === "overview" || (from === "follow") !== (to === "overview"));
    if (cut && !this.turbo) this.cover(() => this.next(true));
    else this.next(cut);
  }

  /** Three out: a short bumper covers the teams changing sides, and the new half opens on a push-in. */
  private changeSides() {
    const g = this.session.game;
    const ord = ordinal(g.inning);
    this.bumper = { title: g.top ? `Middle of the ${ord}` : `End of the ${ord}`, sub: `${abbrevFor(g.top ? this.setup.homeTeamId : this.setup.awayTeamId)} coming to bat` };
    this.banner = null;
    this.cover(() => this.next(true, true), BUMPER_MS);
  }

  /** The catcher cam looks out from the catcher's own eyes, so he is not drawn in it. */
  private syncCast() {
    const c = this.pb.cast;
    if (!c) return;
    const hide = this.pb.cam === "batter";
    if (hide === (c.fielders !== this.fielders)) return;
    c.fielders = hide ? this.fielders.filter((f) => f.pos !== "C") : this.fielders;
  }

  // ---------- game flow ----------
  start() {
    // React StrictMode mounts, disposes and re-mounts in dev; re-arm on every start.
    this.disposed = false;
    sfx.startCrowd();
    this.drawScoreboard();
    if (this.session.game.final) {
      this.phase = "final";
      this.emit();
      return;
    }
    // Come up from black on the defense taking the field.
    this.cover(() => this.next(true, true), 400);
  }

  /**
   * Set up the next pitch. `cut`: the shot changes with a cut, so nobody walks across it.
   * `opening`: a half-inning starts (the defense takes the field, the camera pushes in).
   */
  private next(cut = false, opening = false) {
    const s = this.session;
    if (s.game.final) {
      this.phase = "final";
      this.setCam("overview", cut);
      clearSave();
      this.board = this.readBoard();
      this.emit();
      return;
    }
    const { events: pre } = s.prepare();
    for (const e of pre) {
      if (this.shown.has(e)) continue;
      this.shown.add(e);
      this.pushLog(e);
      this.banner = { text: e.kind === "pitching_change" ? "Pitching change" : "Substitution", sub: e.text, tone: "neutral" };
      this.later(2200, () => {
        if (this.banner?.sub === e.text) {
          this.banner = null;
          this.emit();
        }
      });
    }
    // Everyone walks from where the last play left him to where this one starts.
    if (this.turbo) this.pb.trans = null;
    else beginTransition(this.pb, { cut, takeField: opening });
    if (opening && !this.turbo) this.pb.introAt = this.pb.now;
    this.refreshCast();
    this.pb.timeline = null;
    this.pb.paused = false;
    this.pb.slow = null;
    this.pb.hitstop = 0;
    this.pb.cues = [];
    this.pb.onEnd = null;
    this.pb.turbo = this.turbo;
    this.swung = false;
    this.marked = false;
    this.revealed = false;
    this.flight = null;
    this.outcome = null;
    this.steals.clear();
    this.bunt = 0;
    this.call = null;
    // Last pitch's swing / contact readout is stale once the next pitch is set up.
    this.feedback = null;
    this.hud.hint = null;
    if (scoreboardCanvas.canvas !== this.boardCanvas || this.boardLogos !== capLogoVersion()) this.drawScoreboard();
    this.board = this.readBoard();
    // A fresh count is a new at-bat: its pitch chart starts empty.
    if (s.game.balls === 0 && s.game.strikes === 0 && this.hud.marks.length) this.hud.marks = [];
    const seq = (this.pitchSeq += 1);
    const ctx = s.currentContext!;
    const a = this.pb.aim;
    a.zoneBottom = ctx.batter.zoneBottom;
    a.zoneTop = ctx.batter.zoneTop;
    a.showZone = true;
    this.hud.zoneHiddenUntil = null;
    this.hud.zoneHeldFrom = null;
    this.lockedPitch = null;
    this.challengeWin = null;
    this.challengeResolve = null;
    this.review = null;
    this.reviewAbs = null;
    this.provisional = false;
    if (s.humanPitching) {
      this.setCam("pitcher", cut || this.turbo);
      this.phase = "aim";
      if (this.twoPlayer && this.setup.hidePitch) {
        const pitcherSide = s.game.top ? "home" : "away";
        this.openHandoff(`${this.player(pitcherSide)} pitching`, `${abbrevFor(s.game.batting.team.teamId)} hitter, look away while the pitch is picked.`, () => {});
      }
      this.pitchIdx = Math.min(this.pitchIdx, ctx.pitcher.arsenal.length - 1);
      a.kind = "target";
      a.visible = true;
      a.w = 0;
      a.h = 0;
      if (Math.abs(a.px) > 2 || a.pz < 0.5 || a.pz > 4.5) {
        a.px = 0;
        a.pz = (ctx.batter.zoneBottom + ctx.batter.zoneTop) / 2;
      }
    } else if (s.humanBatting) {
      this.setCam("batter", cut || this.turbo);
      this.phase = "ready";
      a.kind = "pci";
      a.visible = true;
      this.applyPci();
      // The pitcher waits for the batter: the action button calls for the pitch, so
      // there is time to set the aim, pick a power swing or send the runner.
    } else {
      this.setCam("broadcast", cut || this.turbo);
      this.phase = "ready";
      a.visible = false;
      // The pitcher waits for a new batter to step in (and for a new half-inning to come up on screen).
      const pitchWhenSet = (ms: number) =>
        this.later(ms, () => {
          if (this.phase !== "ready" || this.pitchSeq !== seq) return;
          const left = this.turbo ? 0 : walkUpLeft(this.pb);
          if (left > 0.05) pitchWhenSet(left * 1000);
          else this.throwPitch({});
        });
      pitchWhenSet(this.turbo ? 150 : opening ? 1500 : 700);
    }
    // The CPU pitcher may throw over before he goes home (a step of its own).
    const po = s.cpuPickoff;
    if (po != null) {
      this.phase = "pickoff";
      const throwWhenSet = (ms: number) =>
        this.later(ms, () => {
          if (this.phase !== "pickoff" || this.pitchSeq !== seq) return;
          const left = this.turbo ? 0 : walkUpLeft(this.pb);
          if (left > 0.05) throwWhenSet(left * 1000);
          else this.runPickoff(po);
        });
      throwWhenSet(this.turbo ? 150 : opening ? 1700 : 1000);
    }
    this.emit();
  }

  /** The human pitcher throws over to `from` (default: the runner on first, else second). */
  pickoff(from?: StealFrom) {
    if (this.phase !== "aim" || !this.session.humanPitching) return;
    const t = this.session.pickoffTargets;
    const f = from ?? t[0];
    if (f == null || !t.includes(f)) return;
    sfx.unlock();
    this.runPickoff(f);
  }

  /** Play a throw-over: commit it, stage the throw (and any rundown), then move on. */
  private runPickoff(from: StealFrom) {
    const s = this.session;
    const g = s.game;
    const pre = { top: g.top, inning: g.inning, outsBefore: g.outs, basesBefore: [!!g.bases[0], !!g.bases[1], !!g.bases[2]] as [boolean, boolean, boolean], scoreBefore: { ...g.score } };
    const k = s.pickoff(from);
    if (!k) return;
    this.pre = pre;
    this.revealed = false;
    this.phase = "pickoff";
    this.banner = null;
    this.hud.hint = null;
    this.pb.aim.visible = false;
    this.pb.aim.showZone = false;
    const tl = buildPickoffTimeline(k);
    this.settle();
    this.pb.timeline = tl;
    this.pb.T = 0;
    this.pb.slow = null;
    this.pb.turbo = this.turbo;
    // From the catcher's eyes (he isn't drawn there) the play shot is a cut, not a glide.
    this.setCam("follow", this.pb.cam === "batter");
    this.syncCast();
    const rundown = k.outcome === "rundown_out" || k.outcome === "rundown_safe";
    const cues: Playback["cues"] = [];
    if (rundown && !this.turbo) {
      // Hung up: the whole park comes up while he's caught in between.
      cues.push({
        T: tl.callT - 2.6,
        fn: () => {
          crowdState.excite = Math.max(crowdState.excite, 0.35);
          crowdState.away = Math.max(crowdState.away, 0.35);
          sfx.swell(0.45, 2.5);
        },
      });
    }
    cues.push({
      T: tl.callT,
      fn: () => {
        if (k.outcome !== "safe" || k.events.some((e) => e.kind === "balk")) sfx.call(k.outcome === "out" || k.outcome === "rundown_out");
        this.revealPickoff(k);
        this.emit();
      },
    });
    this.pb.cues = cues;
    this.pb.onEnd = () => this.finishPickoff(k);
    this.emit();
  }

  private revealPickoff(k: CommittedPickoff) {
    if (this.revealed) return;
    this.revealed = true;
    for (const e of k.events) {
      if (this.shown.has(e)) continue;
      this.shown.add(e);
      this.pushLog(e);
    }
    const solo = this.setup.human === "away" || this.setup.human === "home";
    const offenseHuman = this.setup.human !== "none" && (this.setup.human === "away") === !!this.pre?.top;
    const tone = (goodForOffense: boolean): "good" | "bad" | "neutral" => (!solo ? "neutral" : goodForOffense === offenseHuman ? "good" : "bad");
    const id = (this.callId += 1);
    const out = k.outcome === "out" || k.outcome === "rundown_out";
    const balk = k.events.find((e) => e.kind === "balk");
    const base = balk ? k.from + 2 : k.outcome === "rundown_safe" || k.outcome === "error" ? k.from + 2 : k.from + 1;
    this.call = { id, text: balk ? "BALK" : out ? "OUT" : "SAFE", base, tone: tone(!out) };
    this.later(1400, () => {
      if (this.call?.id !== id) return;
      this.call = null;
      this.emit();
    });
    const main = k.events.find((e) => e.kind === "picked_off" || e.kind === "balk" || e.kind === "pickoff_error");
    if (main) {
      const text =
        main.kind === "balk"
          ? "Balk!"
          : main.kind === "pickoff_error"
            ? k.outcome === "rundown_safe"
              ? "Rundown breaks down — safe!"
              : "Pickoff throw gets away!"
            : k.outcome === "rundown_out"
              ? "Run down — out!"
              : "Picked off!";
      this.banner = { text, sub: main.text, tone: tone(main.kind !== "picked_off") };
    }
    this.react(k);
    this.board = this.readBoard();
    this.drawScoreboard();
  }

  private finishPickoff(k: CommittedPickoff) {
    const s = this.session;
    this.revealPickoff(k);
    saveGame(this.setup, s.inputs);
    this.phase = "between";
    this.emit();
    const inningOver = k.events.some((e) => e.kind === "inning_end");
    const big = k.outcome !== "safe" || k.events.some((e) => e.kind === "balk");
    if (s.game.final) {
      this.later(this.turbo ? 600 : 1800, () => this.advance());
      return;
    }
    this.later(this.turbo ? 200 : inningOver ? 900 : big ? 1300 : 150, () => {
      if (inningOver && !this.turbo) {
        this.changeSides();
        return;
      }
      this.banner = null;
      if (inningOver) this.next(true, true);
      else this.advance();
    });
  }

  private get twoPlayer(): boolean {
    return this.setup.human === "both";
  }

  private player(side: "away" | "home"): string {
    return `${side === "away" ? "P1" : "P2"} (${abbrevFor(side === "away" ? this.setup.awayTeamId : this.setup.homeTeamId)})`;
  }

  /** Two players: hold the screen on a card until the next player presses the action button. */
  private openHandoff(title: string, sub: string, then: () => void) {
    this.handoff = { title, sub };
    this.handoffNext = then;
    this.phase = "handoff";
    this.emit();
  }

  private closeHandoff() {
    const next = this.handoffNext;
    const was = this.handoff;
    this.handoff = null;
    this.handoffNext = null;
    if (!was) return;
    // Back to the aim the card interrupted, unless the continuation sets its own phase.
    this.phase = this.lockedPitch ? "ready" : "aim";
    next?.();
    this.emit();
  }

  /**
   * Two players: the pitcher has his pitch locked in. Hand the controls to the hitter,
   * on the catcher's-eye camera, with the coverage box back in the middle of the zone
   * (it shared the pitcher's target, which would give the location away).
   */
  private toHitter() {
    const s = this.session;
    const ctx = s.currentContext!;
    const a = this.pb.aim;
    const go = () => {
      this.setCam("batter", true);
      a.kind = "pci";
      a.visible = true;
      a.px = 0;
      a.pz = (ctx.batter.zoneBottom + ctx.batter.zoneTop) / 2;
      this.applyPci();
      this.phase = "ready";
      this.emit();
    };
    a.visible = false;
    if (this.setup.hidePitch) {
      const batSide = s.game.top ? "away" : "home";
      this.cover(() => {
        go();
        this.openHandoff(`${this.player(batSide)} batting`, "The pitch is set. Take the controls and press the action button.", () => {});
      });
    } else this.cover(go);
  }

  private applyPci() {
    const { w, h } = pciHalfSize(this.power, this.setup.difficulty, this.session.currentContext?.batter);
    this.pb.aim.w = w;
    this.pb.aim.h = h;
  }

  /** Fake take of the pitch, so the flight can be shown before the swing is known. */
  private pitchOnlyTimeline(flight: PitchFlight): Timeline {
    const s = this.session;
    const ctx = s.currentContext!;
    const fake: CommittedPitch = {
      ctx,
      result: { kind: "ball", flight, decision: { pitchIdx: 0, targetPx: 0, targetPz: 0, commandMult: 1 }, swing: { swing: false, timingErrMs: 0, verticalErrFt: 0, alongErrFt: 0 }, inZone: false },
      fielders: s.game.fielders(),
      runners: [...s.game.bases] as CommittedPitch["runners"],
      battingSide: ctx.side,
      steal: null,
      events: [],
    };
    const tl = buildTimeline(fake);
    return { ...tl, endT: Infinity };
  }

  private throwPitch(input: PitchInput) {
    const s = this.session;
    const flight = s.throw(input);
    this.flight = flight;
    this.hud.cross = { px: flight.px, pz: flight.pz };
    this.readout = null;
    this.pb.aim.showZone = true;
    // All-Star: the zone comes off through the windup and the flight, back once the ball is in the mitt.
    this.hud.zoneHiddenUntil = this.setup.difficulty === "allstar" ? flight.cross.t + 0.35 : null;
    if (s.humanPitching && !s.humanBatting) this.pb.aim.visible = false;
    if (s.humanBatting) {
      const tl = this.pitchOnlyTimeline(flight);
      this.settle();
      this.pb.timeline = tl;
      // The pitch always comes in at the difficulty's speed, fast-forward or not.
      this.pb.turbo = false;
      this.pb.T = tl.releaseT - (this.turbo ? 0.8 : 1.25);
      // As the pitcher comes set, the batter reads where the catcher is setting up:
      // the general direction of the pitch (its target, not where it will end up).
      const d = s.currentDecision;
      if (d) {
        const h = HINT[this.setup.difficulty];
        const ang = this.inputRng.range(0, Math.PI * 2);
        const off = h.jitter * Math.sqrt(this.inputRng.next());
        this.hud.hint = { px: d.targetPx + Math.cos(ang) * off, pz: d.targetPz + Math.sin(ang) * off, r: h.r, from: this.pb.T, to: tl.releaseT + 0.12 };
      }
      // Ease into slow motion during the windup, so the ball flies at one constant
      // speed from the hand to the plate instead of visibly decelerating mid-flight.
      this.pb.slow = { from: tl.releaseT - 0.55, to: flight.cross.t + 0.2, rate: DIFFICULTY[this.setup.difficulty].timeScale };
      this.pb.cues = [
        // Squared around: the bunt is put down as the ball gets to him.
        { T: idealContactTime(flight) - 0.08, fn: () => this.bunt && this.swing(null) },
        { T: flight.cross.t, fn: () => this.markPitch(flight, "pending") },
        { T: flight.cross.t + 0.1, fn: () => this.swing(null) },
      ];
      // Rookies are told what is coming out of the hand; everyone else has to read it.
      if (this.setup.difficulty === "rookie") this.pb.cues.unshift({ T: tl.releaseT, fn: () => this.showReadout(flight) });
      this.pb.onEnd = null;
      this.phase = "pitch";
      this.emit();
      return;
    }
    const outcome = s.swing({});
    this.pb.T = -1.6;
    this.pb.slow = null;
    this.phase = "pitch";
    this.afterSwing(outcome, true);
  }

  /** Pitch type and speed chip (the result is filled in once the pitch is decided). */
  private showReadout(flight: PitchFlight, kind: MarkKind = "pending", result: string | null = null) {
    const cur = this.readout;
    if (cur && cur.kind === kind && cur.result === result) return;
    this.readout = { id: cur?.id ?? (this.readoutId += 1), type: flight.type, mph: Math.round(flight.releaseSpeedMph), result, kind };
    this.emit();
  }

  /** Drop (or settle) this pitch's marker on the zone where it crossed the plate. */
  private markPitch(flight: PitchFlight, kind: MarkKind) {
    const marks = this.hud.marks;
    if (this.marked && marks.length) {
      const last = marks[marks.length - 1];
      if (last.kind !== kind) marks[marks.length - 1] = { ...last, kind };
    } else {
      this.marked = true;
      const n = (marks[marks.length - 1]?.n ?? 0) + 1;
      // A pitch that only clipped the zone deeper over the plate is drawn where it did.
      const a = this.pb.aim;
      const at = zoneContact(flight, a.zoneBottom, a.zoneTop) ?? { px: flight.px, pz: flight.pz };
      marks.push({ n, px: at.px, pz: at.pz, kind, type: flight.type, mph: Math.round(flight.releaseSpeedMph) });
      this.hud.markAt = this.pb.now;
    }
    if (kind === "pending") this.showReadout(flight);
    this.emit();
  }

  /** Human swing (pressT = flight time) or take (null). */
  swing(pressT: number | null) {
    // No pitch pending: the play already went into the book (a CPU batter's third out
    // flips the half, so "human batting" can turn true while that pitch still plays out).
    if (this.phase !== "pitch" || this.swung || !this.flight || !this.session.humanBatting || !this.session.currentContext) return;
    if (pressT != null && pressT < this.flight.samples[0].t - 0.15) return; // way before the ball is out of the hand
    this.swung = true;
    const s = this.session;
    const ctx = s.currentContext!;
    const a = this.pb.aim;
    if (this.bunt) {
      // Squared around: a press pulls the bat back (take); otherwise he bunts it where he aimed.
      const pull = pressT != null;
      const aimDeg = this.bunt === 1 ? (ctx.side === "R" ? -27 : -24) : ctx.side === "L" ? 25 : 22;
      const bw = pull
        ? { swing: false, timingErrMs: 0, verticalErrFt: 0, alongErrFt: 0 }
        : { swing: true, bunt: true, buntAimDeg: aimDeg, timingErrMs: 0, verticalErrFt: 0, alongErrFt: 0 };
      if (pull) this.bunt = 0;
      const outcome = s.swing({ swing: bw });
      this.afterSwing(outcome, false);
      return;
    }
    const sw = humanSwing(
      { pressT, pciPx: a.px, pciPz: a.pz, power: this.power },
      this.flight,
      ctx.batter,
      ctx.side,
      this.setup.difficulty,
      this.inputRng,
    );
    if (pressT != null && sw.swing) {
      const e = sw.timingErrMs;
      const off = Math.abs(e);
      const id = (this.feedbackId += 1);
      this.feedback = {
        id,
        text: off <= 7 ? "Perfect timing" : off <= 18 ? (e < 0 ? "A touch early" : "A touch late") : e < 0 ? "Early" : "Late",
        tone: off <= 7 ? "good" : off <= 18 ? "neutral" : "bad",
        timingMs: e,
        swing: {
          pci: { px: a.px, pz: a.pz, w: a.w, h: a.h },
          ball: { px: this.flight.px, pz: this.flight.pz },
          zone: { bottom: a.zoneBottom, top: a.zoneTop },
        },
      };
      this.later(2600, () => {
        if (this.feedback?.id !== id) return;
        this.feedback = null;
        this.emit();
      });
    }
    const outcome = s.swing({ swing: sw });
    this.afterSwing(outcome, false, pressT ?? undefined);
  }

  /** The defense fields and throws on its own: the play is committed and simply played out. */
  private afterSwing(outcome: PitchOutcome, fresh: boolean, swingStartT?: number) {
    this.outcome = outcome;
    const g = this.session.game;
    this.pre = { top: g.top, inning: g.inning, outsBefore: g.outs, basesBefore: [!!g.bases[0], !!g.bases[1], !!g.bases[2]], scoreBefore: { ...g.score } };
    // ABS: a human club may challenge this call. The pitch plays out as called and the
    // book waits on the decision (a runner going makes the throw part of it: no window).
    const challenger = outcome.steal ? null : this.session.humanChallenger;
    if (challenger) {
      const provisional: CommittedPitch = { ...outcome, events: [] };
      this.provisional = true;
      // No zone from the moment the ball reaches the plate until the club decides.
      this.hud.zoneHeldFrom = outcome.result.flight.cross.t;
      const tl = buildTimeline(provisional, { swingStartT });
      this.pb.turbo = this.turbo;
      this.mountTimeline(tl, fresh, provisional);
      this.pb.onEnd = () => this.openChallenge(challenger, outcome.result.kind === "called_strike" ? "strike" : "ball");
      this.emit();
      return;
    }
    // A CPU club taps for a review: the pitch plays out as called, then the same review.
    const cpu = outcome.steal ? null : this.session.cpuChallenger;
    if (cpu) {
      const provisional: CommittedPitch = { ...outcome, events: [] };
      this.provisional = true;
      const tl = buildTimeline(provisional, { swingStartT });
      this.pb.turbo = this.turbo;
      this.mountTimeline(tl, fresh, provisional);
      this.pb.onEnd = () => {
        this.reviewAbs = this.session.game.abs ? { ...this.session.game.abs } : null;
        this.provisional = false;
        this.revealed = false;
        this.runReview(this.session.commit(), true);
      };
      this.emit();
      return;
    }
    const committed = this.session.commit();
    const tl = buildTimeline(committed, { swingStartT });
    this.pb.turbo = this.turbo;
    this.mountTimeline(tl, fresh, committed);
    this.pb.onEnd = () => this.finish(committed);
    this.emit();
  }

  /** The umpire has called it: the human club gets a few seconds to tap the helmet. */
  private openChallenge(side: "away" | "home", call: "strike" | "ball") {
    if (this.challengeWin) return;
    const ms = this.turbo ? 2500 : 5000;
    this.phase = "challenge";
    this.challengeWin = { side, call, until: performance.now() + ms, ms };
    this.challengeResolve = (yes) => {
      this.challengeWin = null;
      this.challengeResolve = null;
      // Decided: the zone comes back (for the review, or before the next pitch).
      this.hud.zoneHeldFrom = null;
      this.provisional = false;
      this.revealed = false;
      this.reviewAbs = this.session.game.abs ? { ...this.session.game.abs } : null;
      const committed = this.session.commit(undefined, yes);
      if (yes) {
        this.runReview(committed, false);
        return;
      }
      this.phase = "between";
      this.finish(committed);
    };
    const seq = this.pitchSeq;
    this.later(ms, () => {
      if (this.pitchSeq === seq && this.challengeWin) this.decideChallenge(false);
    });
    this.emit();
  }

  /**
   * The ABS review, for either club: the challenger taps, the park murmurs while the
   * zone is checked (the call hangs on screen with the pitch's mark), then the verdict —
   * and the fans whose club it helps let the building know.
   */
  private runReview(committed: CommittedPitch, cpu: boolean) {
    const abs = committed.events.find((e) => e.kind === "abs_challenge");
    if (!abs?.abs) {
      this.phase = "between";
      this.finish(committed);
      return;
    }
    const a = abs.abs;
    const g = this.session.game;
    const name = /challenge by (.+?):/.exec(abs.text)?.[1] ?? a.by;
    const solo = this.setup.human === "away" || this.setup.human === "home";
    const challengerIsMine = solo && this.setup.human === a.side;
    const flip = a.overturned ? (a.strikeout ? "strikeout" : a.walk ? "walk" : null) : null;
    const miss = zoneMiss(committed.result.flight, committed.ctx.batter.zoneBottom, committed.ctx.batter.zoneTop);
    this.review = { side: a.side, name, by: a.by, call: a.call, cpu, stage: "review", overturned: null, flip: null, good: null, miss };
    this.phase = "review";
    // Everyone sees where it crossed while the zone is consulted.
    this.pb.aim.showZone = true;
    this.hud.zoneHiddenUntil = null;
    this.hud.zoneHeldFrom = null;
    // The murmur builds: both sets of fans on edge, more so when the count is on the line.
    const big = a.call === "strike" ? committed.ctx.count.strikes === 2 : committed.ctx.count.balls === 3;
    const late = abs.inning >= g.regulation - 1;
    const tension = Math.min(0.6, 0.25 + (big ? 0.15 : 0) + (late ? 0.12 : 0));
    crowdState.excite = Math.max(crowdState.excite, tension * 0.5);
    crowdState.away = Math.max(crowdState.away, tension * 0.5);
    sfx.swell(tension * 0.6, 2.6);
    this.emit();
    const seq = this.pitchSeq;
    const hold = this.turbo ? 700 : big || late ? 2600 : 2000;
    this.later(hold, () => {
      if (this.pitchSeq !== seq || !this.review) return;
      this.review = { ...this.review, stage: "verdict", overturned: a.overturned, flip, good: solo ? challengerIsMine === a.overturned : null };
      this.reviewAbs = null;
      // The zone's verdict: a strike gets the punch-out call.
      if (committed.result.kind === "called_strike") sfx.call(true);
      else sfx.call(false);
      this.reveal(committed);
      this.emit();
      this.later(this.turbo ? 500 : flip ? 1700 : 1200, () => {
        if (this.pitchSeq !== seq) return;
        this.review = null;
        this.phase = "between";
        this.finish(committed);
      });
    });
  }

  /** Challenge the call (true) or let it stand (false). */
  decideChallenge(yes: boolean) {
    if (this.phase !== "challenge" || !this.challengeResolve) return;
    sfx.unlock();
    this.challengeResolve(yes);
  }

  private mountTimeline(tl: Timeline, fresh: boolean, c: CommittedPitch) {
    const T = fresh ? tl.releaseT - (this.turbo ? 0.9 : 1.25) : this.pb.T;
    this.settle();
    this.pb.timeline = tl;
    this.pb.T = T;
    const cues = this.pb.cues.filter((q) => q.done);
    const r = c.result;
    const flight = r.flight;
    const cross = flight.cross.t;
    // A ball in play is called (out / no out) once the play is over, not at contact.
    const foulBall = isFoulBall(c);
    const kind: MarkKind = foulBall ? "foul" : r.kind === "in_play" ? "pending" : markKind(r.kind);
    const settle = () => {
      this.markPitch(flight, kind);
      this.showReadout(flight, kind, foulBall ? (RESULT_TEXT.foul ?? "Foul") : (RESULT_TEXT[r.kind] ?? r.kind));
    };
    // Pitching or watching: the pitch is called as it leaves the hand.
    if (fresh) cues.push({ T: tl.releaseT, fn: () => this.showReadout(flight) });
    if (tl.contactT != null) {
      const ev = r.contact?.exitSpeedMph ?? 70;
      const la = r.contact?.launchAngleDeg ?? 0;
      cues.push({
        T: tl.contactT,
        // Land playback exactly on contact so the frame the crack fires on shows bat on ball.
        snap: true,
        fn: () => {
          const tip = r.kind === "foul_tip";
          if (tip) sfx.foulTip();
          else sfx.crack(ev);
          // Sell the contact: a beat of hit-stop, a flash at the ball, a camera kick.
          const power = clamp((ev - 60) / 50, 0, 1);
          const fx = this.pb.fx;
          const at = tl.swing?.aim;
          if (at) fx.flashP.set(at.x, at.y, at.z);
          fx.flashAge = 0;
          fx.flashPower = tip ? 0.15 : 0.35 + 0.9 * power;
          if (!tip) {
            if (!this.pb.turbo) this.pb.hitstop = 0.035 + 0.06 * power;
            // The camera only feels the ones that are really hit (95 mph and up), and only for a moment.
            if (ev >= HARD_HIT_MPH && tl.inPlay) {
              const hard = clamp((ev - HARD_HIT_MPH) / 15, 0, 1);
              fx.shake = Math.max(fx.shake, 0.03 + 0.07 * hard);
              fx.punch = Math.max(fx.punch, 0.2 + 0.4 * hard);
            }
          }
          if (!tip && r.contact) {
            const stat = `${ev.toFixed(0)} mph · ${Math.round(la)}°`;
            const id = this.feedback?.id ?? (this.feedbackId += 1);
            this.feedback = this.feedback ? { ...this.feedback, sub: stat } : { id, text: stat, tone: "neutral" };
            // The contact readout belongs to this ball only: it never carries into the next pitch.
            this.later(3200, () => {
              if (this.feedback?.id !== id) return;
              this.feedback = null;
              this.emit();
            });
          }
          if (tl.inPlay) {
            this.pb.cam = "follow";
            this.syncCast();
            this.pb.aim.visible = false;
            this.pb.aim.showZone = false;
            this.phase = "play";
            // The crowd rises at the crack on a deep drive, before anyone knows if it's caught.
            const rise = crowdRise(ev, la, r.path?.distance ?? null, !(this.pre?.top ?? true));
            crowdState.excite = Math.max(crowdState.excite, rise.home * 0.6);
            crowdState.away = Math.max(crowdState.away, rise.away * 0.6);
            sfx.swell(Math.max(0.15, crowdVolume(rise)), 2.5);
          }
          settle();
          this.emit();
        },
      });
    } else cues.push({ T: cross, fn: settle });
    if (tl.contactT == null || r.kind === "foul_tip") {
      cues.push({
        T: cross + 0.04,
        fn: () => {
          if (r.kind !== "hbp") sfx.mitt();
          if (r.kind === "called_strike") {
            sfx.call(true);
            this.pb.fx.umpCallAt = this.pb.now + 0.12;
          }
          // The call is in: count, outs and the strikeout / walk banner go up right away
          // (a steal still has its throw to play out first).
          if (!c.steal) this.reveal(c);
          this.emit();
        },
      });
    }
    this.liveCues(tl, c, cues);
    this.pb.cues = cues;
    // After the ball is past the plate, real-time playback.
    if (this.pb.slow) this.pb.slow.to = Math.min(this.pb.slow.to, tl.contactT ?? this.pb.slow.to);
  }

  /**
   * The scorebug and the bases panel follow the play as it happens: each runner shows
   * up on the bag he reaches, outs and runs tick the moment the ball (or the tag) beats
   * a runner or a runner crosses the plate, and the umpire's call flashes on the bases.
   */
  private liveCues(tl: Timeline, c: CommittedPitch, cues: Playback["cues"]) {
    const offense = this.setup.human !== "none" && (this.setup.human === "away") === this.board.top;
    const solo = this.setup.human === "away" || this.setup.human === "home";
    const tone = (goodForOffense: boolean): "good" | "bad" | "neutral" => (!solo ? "neutral" : goodForOffense === offense ? "good" : "bad");
    const flash = (text: string, base: number, good: boolean) => {
      const id = (this.callId += 1);
      this.call = { id, text, base, tone: tone(good) };
      this.later(1300, () => {
        if (this.call?.id !== id) return;
        this.call = null;
        this.emit();
      });
    };
    const side = this.board.top ? "away" : "home";
    const play = c.play;
    if (play && !play.foul && tl.contactT != null) {
      const at = new Map<number, number>();
      c.runners.forEach((r, i) => r && at.set(r.playerId, i + 1));
      const scored = new Set(play.runs);
      const events = play.events;
      const callAt = (id: number, t: number) => events.find((e) => e.playerId === id && Math.abs(e.t - t) < 0.2 && (e.type === "force_out" || e.type === "tag_out" || e.type === "safe"));
      const legs = [...play.runners].filter((r) => r.to !== r.from || r.out).sort((a, b) => a.t - b.t);
      for (const r of legs) {
        cues.push({
          T: tl.contactT + Math.max(0.05, r.t),
          fn: () => {
            const b = this.board;
            // The third out ends the half: nobody reaches a base (or scores) after it.
            if (b.outs >= 3) return;
            at.delete(r.playerId);
            let outs = b.outs;
            const score = { ...b.score };
            const line = { away: [...b.line.away], home: [...b.line.home] };
            if (r.out) outs = Math.min(3, outs + 1);
            else if (r.to === 4) {
              if (scored.has(r.playerId)) {
                score[side] += 1;
                line[side][line[side].length - 1] = (line[side][line[side].length - 1] ?? 0) + 1;
              }
            } else at.set(r.playerId, r.to);
            const ids: (number | null)[] = [null, null, null];
            if (outs < 3) for (const [id, base] of at) if (base >= 1 && base <= 3) ids[base - 1] = id;
            this.board = { ...b, outs, score, line, runnerIds: ids, bases: [ids[0] != null, ids[1] != null, ids[2] != null] };
            const ev = callAt(r.playerId, r.t);
            if (r.out) flash("OUT", r.to, false);
            else if (r.to === 4 && scored.has(r.playerId)) flash("RUN SCORES", 4, true);
            else if (ev?.type === "safe") flash("SAFE", r.to, true);
            this.emit();
          },
        });
      }
    }
    // A steal: the call comes with the throw (or the tag at the plate).
    const steals = c.events.filter((e) => e.kind === "stolen_base" || e.kind === "caught_stealing").sort((a, b) => (b.base ?? 0) - (a.base ?? 0));
    if (steals.length && tl.contactT == null) {
      const lead = steals[0];
      const T = tl.receive.t + (lead.base === 2 ? 0.7 : lead.base === 1 ? 1.62 : 1.86);
      cues.push({
        T,
        fn: () => {
          const safe = lead.kind === "stolen_base";
          flash(safe ? "SAFE" : "OUT", (lead.base ?? 0) + 2, safe);
          this.reveal(c);
          this.emit();
        },
      });
    }
  }

  /** Put a committed pitch on the HUD: count / outs / score, play-by-play and the banner. */
  private reveal(c: CommittedPitch) {
    if (this.revealed || this.provisional) return;
    this.revealed = true;
    const important = c.events.filter((e) => e.kind !== "pitch" && !this.shown.has(e));
    for (const e of important) this.pushLog(e);
    this.banner = this.bannerFor(c, important);
    this.react(c);
    this.board = this.readBoard();
    this.drawScoreboard();
  }

  /** The crowd's answer to the play: home fans cheer their team and groan at the other one. */
  private react(c: Pick<CommittedPitch, "events" | "play">) {
    if (!this.pre) return;
    const g = this.session.game;
    const r = crowdReaction({ ...this.pre, events: c.events, play: c.play, regulation: g.regulation, scoreAfter: { ...g.score } });
    if (r.home > 0) crowdState.excite = Math.max(crowdState.excite, r.home);
    if (r.away > 0) crowdState.away = Math.max(crowdState.away, r.away);
    // The bed goes back down when the home crowd has nothing to cheer.
    if (r.homeGroan > 0) crowdState.excite = Math.min(crowdState.excite, 0.05);
    if (r.awayGroan > 0) crowdState.away = Math.min(crowdState.away, 0.05);
    const vol = crowdVolume(r);
    if (vol > 0.05) sfx.swell(vol, 1.5 + 4.5 * vol);
    if (r.homeGroan > 0) sfx.groan(r.homeGroan * 0.9);
  }

  private finish(c: CommittedPitch) {
    const s = this.session;
    this.logShown = s.pitchLog.length;
    const r = c.result;
    const early = this.revealed;
    const fm = finalMark(c);
    this.markPitch(r.flight, fm.kind);
    this.showReadout(r.flight, fm.kind, fm.text);
    this.reveal(c);
    const important = c.events.some((e) => e.kind !== "pitch");
    saveGame(this.setup, s.inputs);
    const inningOver = c.events.some((e) => e.kind === "inning_end");
    this.phase = "between";
    // The finished play stays on screen (everyone where he ended up) until the next
    // pitch is set up, so players never pop back to their positions in view.
    this.pb.slow = null;
    if (s.game.final) {
      this.emit();
      this.later(this.turbo ? 600 : 1800, () => this.advance());
      return;
    }
    this.emit();
    // A call that went up as the pitch crossed has already had its moment on screen.
    // Outs move on quickly: the banner stays up while the next pitch is set.
    const out = !c.play?.hit && !c.play?.error && !c.play?.runs.length && c.events.some((e) => e.kind === "in_play" || e.kind === "strikeout" || e.kind === "caught_stealing");
    const wait = this.turbo
      ? 250
      : inningOver
        ? early ? 500 : 850
        : out
          ? early ? 350 : 600
          : important ? (early ? 550 : 1300) : 300;
    this.later(wait, () => {
      if (inningOver && !this.turbo) {
        this.changeSides();
        return;
      }
      this.banner = null;
      if (inningOver) this.next(true, true);
      else this.advance();
    });
  }

  private bannerFor(c: CommittedPitch, events: GameEvent[]): HudSnapshot["banner"] {
    const play = c.play;
    const offenseHuman = this.session.setup.human !== "none" && (this.session.setup.human === "away") === !!events[0]?.top;
    const solo = this.setup.human === "away" || this.setup.human === "home";
    const toneFor = (goodForOffense: boolean) => (!solo ? "neutral" : goodForOffense === offenseHuman ? "good" : "bad");
    const abs = c.events.find((e) => e.kind === "abs_challenge");
    const ko = events.find((e) => e.kind === "strikeout");
    if (ko) return { text: abs?.abs?.overturned ? "Overturned — strikeout" : "Strikeout", sub: abs ? `${abs.text} ${ko.text}` : ko.text, tone: toneFor(false) };
    const bb = events.find((e) => e.kind === "walk" || e.kind === "hbp");
    if (bb) return { text: bb.kind === "walk" ? (abs?.abs?.overturned ? "Overturned — walk" : "Walk") : "Hit by pitch", sub: abs && bb.kind === "walk" ? `${abs.text} ${bb.text}` : bb.text, tone: toneFor(true) };
    if (abs?.abs) {
      // Good for the club that challenged when it won.
      const challengerOffense = (abs.abs.side === "away") === abs.top;
      return { text: abs.abs.overturned ? "ABS: call overturned" : "ABS: call stands", sub: abs.text, tone: toneFor(challengerOffense === abs.abs.overturned) };
    }
    const ip = events.find((e) => e.kind === "in_play");
    if (ip && play) {
      const big = ["Out", "Single", "Double", "Triple", "Home run!"][play.hit] ?? "In play";
      const text = play.hit ? big : play.doublePlay ? "Double play" : play.error ? "Error" : play.fieldersChoice ? "Fielder's choice" : "Out";
      const ev = c.result.contact?.exitSpeedMph;
      const la = c.result.contact?.launchAngleDeg;
      const dist = c.result.path?.firstLanding ? Math.hypot(c.result.path.firstLanding.p.x, c.result.path.firstLanding.p.z) : null;
      const stat = ev ? `${ev.toFixed(1)} mph · ${Math.round(la ?? 0)}°${dist && play.hit === 4 ? "" : dist ? ` · ${Math.round(dist)} ft` : ""}` : "";
      return { text, sub: [ip.text, stat].filter(Boolean).join(" — "), tone: toneFor(play.hit > 0 || play.error || play.runs.length > 0) };
    }
    const misc = events.find((e) => e.kind === "stolen_base" || e.kind === "caught_stealing" || e.kind === "wild_pitch");
    if (misc) return { text: misc.kind === "stolen_base" ? "Stolen base" : misc.kind === "caught_stealing" ? "Caught stealing" : "Wild pitch", sub: misc.text, tone: toneFor(misc.kind !== "caught_stealing") };
    // Routine balls, strikes and fouls go to the pitch readout, not the banner.
    return null;
  }

  private pushLog(e: GameEvent) {
    if (!e.text) return;
    this.log = [{ id: (this.logId += 1), text: e.text }, ...this.log].slice(0, 40);
  }

  // ---------- human controls ----------
  setAim(px: number, pz: number) {
    if (this.phase === "aim" || this.phase === "ready" || (this.phase === "pitch" && !this.swung)) {
      this.pb.aim.px = clamp(px, -2.2, 2.2);
      this.pb.aim.pz = clamp(pz, -0.3, 5.2);
    }
  }

  nudgeAim(dx: number, dz: number) {
    this.setAim(this.pb.aim.px + dx, this.pb.aim.pz + dz);
  }

  /** Primary action: lock target / stop meter / swing. */
  primary() {
    sfx.unlock();
    if (this.phase === "handoff") {
      this.closeHandoff();
      return;
    }
    // Space during the challenge window accepts the call.
    if (this.phase === "challenge") {
      this.decideChallenge(false);
      return;
    }
    if (this.phase === "aim") {
      this.phase = "meter";
      this.meterStart = performance.now();
      this.emit();
      return;
    }
    if (this.phase === "meter" && this.meterStart != null) {
      const m = meterAt((performance.now() - this.meterStart) / 1000);
      this.meterStart = null;
      const decision = humanPitch(this.pitchIdx, this.pb.aim.px, this.pb.aim.pz, m, this.setup.difficulty);
      this.banner = null;
      if (this.twoPlayer) {
        // The hitter is a person too: he gets the controls before the ball is released.
        this.lockedPitch = decision;
        this.phase = "between";
        this.toHitter();
        return;
      }
      this.throwPitch({ pitch: decision });
      return;
    }
    if (this.phase === "pitch") this.swing(this.pb.T);
    // Ready to hit: call for the pitch without waiting for the pitcher.
    else if (this.phase === "ready" && this.session.humanBatting) {
      const pitch = this.lockedPitch ?? undefined;
      this.lockedPitch = null;
      this.throwPitch({ steals: this.legalSteals(), pitch });
    }
  }

  cancelAim() {
    if (this.phase === "meter") {
      this.phase = "aim";
      this.meterStart = null;
      this.emit();
    }
  }

  selectPitch(i: number) {
    const ctx = this.session.currentContext;
    if (!ctx || i < 0 || i >= ctx.pitcher.arsenal.length) return;
    if (this.phase !== "aim" && this.phase !== "meter") return;
    this.pitchIdx = i;
    this.emit();
  }

  togglePower() {
    this.power = !this.power;
    this.applyPci();
    this.emit();
  }

  /**
   * Send (or hold) a runner. With no base given: the lead runner who can go, then every
   * runner (double / triple steal), then nobody.
   */
  toggleSteal(from?: number) {
    const opts = this.stealOpts();
    if (!opts.length) return;
    if (from == null) {
      const lead = Math.max(...opts) as StealFrom;
      const all = legalSteals(this.session.game.bases, [0, 1, 2]);
      if (!this.steals.size) this.steals = new Set([lead]);
      else if (this.steals.size < all.length && all.length > 1) this.steals = new Set(all);
      else this.steals.clear();
    } else {
      const f = from as StealFrom;
      if (!opts.includes(f)) return;
      if (this.steals.has(f)) {
        this.steals.delete(f);
        // A trailing runner can't go into an occupied bag once the runner ahead is held.
        for (const t of [...this.steals]) if (!legalSteals(this.session.game.bases, [...this.steals]).includes(t)) this.steals.delete(t);
      } else {
        this.steals.add(f);
        // Sending a trailing runner into an occupied bag sends the runner ahead too.
        const b = this.session.game.bases;
        for (let k = f + 1; k <= 2 && b[k]; k += 1) this.steals.add(k as StealFrom);
      }
    }
    this.emit();
  }

  /** Square around to bunt: off → down the third-base line → toward first → off. */
  toggleBunt() {
    if (!this.canBunt()) return;
    this.bunt = this.bunt === 0 ? 1 : this.bunt === 1 ? 2 : 0;
    this.emit();
  }

  private canBunt(): boolean {
    return this.session.humanBatting && (this.phase === "ready" || (this.phase === "pitch" && !this.swung));
  }

  private stealOpts(): StealFrom[] {
    const g = this.session.game;
    if (!this.session.humanBatting || this.phase !== "ready" || g.outs >= 3) return [];
    return ([0, 1, 2] as StealFrom[]).filter((f) => g.bases[f]);
  }

  private legalSteals(): StealFrom[] {
    return legalSteals(this.session.game.bases, [...this.steals]);
  }

  toggleTurbo() {
    this.turbo = !this.turbo;
    // Never fast-forward a pitch the player still has to hit.
    this.pb.turbo = this.turbo && !(this.phase === "pitch" && this.session.humanBatting && !this.swung);
    this.emit();
  }

  /** Quick-sim the rest of the half-inning with the CPU on both sides. */
  simHalf() {
    if (this.phase === "final" || this.phase === "pitch" || this.phase === "play" || this.phase === "challenge" || this.phase === "review" || this.phase === "pickoff") return;
    this.handoff = null;
    this.handoffNext = null;
    this.lockedPitch = null;
    this.timers.forEach(clearTimeout);
    this.timers = [];
    this.uncover();
    this.pb.trans = null;
    const pitches = this.session.simHalfInning();
    for (const c of pitches) for (const e of c.events) if (e.kind !== "pitch") this.pushLog(e);
    saveGame(this.setup, this.session.inputs);
    this.drawScoreboard();
    this.banner = { text: "Half-inning simulated", tone: "neutral" };
    this.feedback = null;
    this.readout = null;
    this.hud.marks = [];
    this.phase = "between";
    this.pitchSeq += 1;
    this.pb.timeline = null;
    this.pb.cutSeq += 1;
    this.pb.cam = "overview";
    this.pb.aim.visible = false;
    this.pb.aim.showZone = false;
    this.refreshCast();
    this.board = this.readBoard();
    this.emit();
    this.later(900, () => {
      this.banner = null;
      if (this.turbo) this.next(true, true);
      else this.cover(() => this.next(true, true));
    });
  }

  // ---------- managing ----------
  /** The club the human manages now: in a two-player game, whoever has the controls. */
  private myName(): "away" | "home" | null {
    const h = this.session.humanSide;
    if (h !== "both") return h;
    const g = this.session.game;
    const pitching = this.phase === "aim" || this.phase === "meter";
    return (g.top === pitching) ? "home" : "away";
  }

  private mySide(): Side | null {
    const h = this.myName();
    return h ? this.session.game[h] : null;
  }

  private canManage(): boolean {
    return !!this.mySide() && !this.session.game.final && (this.phase === "aim" || this.phase === "ready");
  }

  private pitcherTired(): boolean {
    const side = this.mySide();
    const g = this.session.game;
    if (!side || side !== g.fielding || !this.setup.manager) return false;
    return side.pitchCount >= side.pitcher.stamina - 5 || side.pitcherRuns >= 5;
  }

  /** What the manager panel shows: the human club's bullpen, bench, lineup and runners. */
  managerView(): ManagerView | null {
    const side = this.mySide();
    if (!side) return null;
    const g = this.session.game;
    const fielding = side === g.fielding;
    const oppHand = fielding ? null : g.fielding.pitcher.throws;
    const bat = (b: BatterModel) => {
      const r = b.raw.bat;
      return {
        id: b.id,
        name: b.name,
        pos: b.pos as string,
        natural: b.raw.pos,
        bats: b.bats,
        platoon: oppHand ? batSide(b, oppHand) !== oppHand : null,
        // rosters.json batting k / bb / hr are per-PA rates: show the season HR count.
        hr: r?.hr != null && r.pa ? Math.round(r.hr * r.pa) : null,
        pa: r?.pa ?? 0,
        kPct: r?.k ?? null,
        ev: r?.evMean ?? null,
        sprint: b.sprint,
        glove: b.glove,
      };
    };
    const pit = (p: PitcherModel) => {
      const r = p.raw.pitch;
      return {
        id: p.id,
        name: p.name,
        throws: p.throws,
        // Per-BF rates already.
        kPct: r?.k ?? null,
        bbPct: r?.bb ?? null,
        topMph: Math.round(Math.max(...p.arsenal.map((a) => a.speedMph ?? 0))),
        pitches: p.arsenal.map((a) => a.type),
        stamina: p.stamina,
      };
    };
    return {
      allowed: this.canManage(),
      fielding,
      pitcher: { ...pit(side.pitcher), count: side.pitchCount, runs: side.pitcherRuns, tired: this.pitcherTired() },
      bullpen: side.available.map(pit),
      bench: side.bench.map(bat),
      lineup: side.lineup.map(bat),
      batterId: fielding ? null : g.batter.id,
      runners: fielding ? [] : g.bases.map((r, i) => (r ? { base: i as 0 | 1 | 2, id: r.playerId, name: g.name(r.playerId) } : null)).filter((x) => x !== null),
    };
  }

  /** Make a manager's move for the human's club. */
  substitute(sub: SubMove): boolean {
    const side = this.myName();
    if (!side || !this.canManage()) return false;
    const e = this.session.substitute({ ...sub, side } as Substitution);
    if (!e) return false;
    this.shown.add(e);
    this.pushLog(e);
    sfx.unlock();
    // New pitcher / batter / runner / fielder: rebuild who is on the field and the zone.
    this.refreshCast();
    const ctx = this.session.currentContext!;
    const a = this.pb.aim;
    a.zoneBottom = ctx.batter.zoneBottom;
    a.zoneTop = ctx.batter.zoneTop;
    if (this.session.humanBatting) this.applyPci();
    if (this.session.humanPitching) this.pitchIdx = Math.min(this.pitchIdx, ctx.pitcher.arsenal.length - 1);
    this.banner = { text: sub.kind === "pitcher" ? "Pitching change" : "Substitution", sub: e.text, tone: "neutral" };
    const text = e.text;
    this.later(2200, () => {
      if (this.banner?.sub === text) {
        this.banner = null;
        this.emit();
      }
    });
    this.board = this.readBoard();
    this.drawScoreboard();
    this.emit();
    return true;
  }

  private canSteal(): boolean {
    return this.stealOpts().length > 0;
  }

  private runnersInfo(): HudSnapshot["runners"] {
    const g = this.session.game;
    const lineup = [...g.batting.lineup, ...g.batting.team.bench];
    return this.board.runnerIds.map((id) => {
      if (id == null) return null;
      const b = lineup.find((x) => x.id === id);
      return { id, name: b?.name ?? g.names.get(id) ?? "Runner", num: b?.num ?? null, sprint: b?.sprint ?? 27, sb: b?.raw.sav?.sb ?? 0, cs: b?.raw.sav?.cs ?? 0 };
    });
  }

  // ---------- scene state ----------
  private refreshCast() {
    const g = this.session.game;
    const fieldTeam = g.fielding.team.teamId;
    const batTeam = g.batting.team.teamId;
    const homeId = g.home.team.teamId;
    const uni = (teamId: number) => {
      const u = uniformFor(teamId, teamId === homeId, new THREE.Color(getTeamColor(teamId)).getHex());
      return { jersey: new THREE.Color(u.jersey), accent: new THREE.Color(u.cap), uni: u };
    };
    const ctx = this.session.currentContext ?? g.pitchContext();
    this.fielders = g.fielders().map((f) => ({ pos: f.pos, p: f.p, id: f.playerId }));
    this.pb.cast = {
      field: uni(fieldTeam),
      bat: uni(batTeam),
      pitcherHand: g.fielding.pitcher.throws,
      batterHand: ctx.side,
      fielders: this.fielders,
      runners: g.bases.map((r, i) => (r ? { id: r.playerId, base: (i + 1) as 1 | 2 | 3 } : null)),
      batterId: ctx.batter.id,
    };
    this.syncCast();
  }

  private readBoard(): Board {
    const s = this.session;
    const g = s.game;
    const ctx = s.currentContext ?? g.pitchContext();
    const bl = g.bat.get(ctx.batter.id);
    const batterLine = bl && bl.pa ? `${bl.h}-${bl.ab}${bl.hr ? `, ${bl.hr} HR` : ""}${bl.bb ? `, ${bl.bb} BB` : ""}` : "First AB";
    const wp = g.final
      ? g.score.home > g.score.away
        ? 1
        : 0
      : homeWinProbability({
          inning: Math.min(g.inning, 9),
          halfInning: g.top ? "top" : "bottom",
          outs: Math.min(2, g.outs),
          onFirst: !!g.bases[0],
          onSecond: !!g.bases[1],
          onThird: !!g.bases[2],
          awayScore: g.score.away,
          homeScore: g.score.home,
        });
    return {
      inning: g.inning,
      top: g.top,
      outs: g.outs,
      balls: g.balls,
      strikes: g.strikes,
      // Three out: the half is over and the bases are cleared, like a broadcast scorebug.
      bases: g.outs >= 3 ? [false, false, false] : [!!g.bases[0], !!g.bases[1], !!g.bases[2]],
      runnerIds: g.outs >= 3 ? [null, null, null] : g.bases.map((r) => r?.playerId ?? null),
      score: { ...g.score },
      line: { away: [...g.line.away], home: [...g.line.home] },
      batterName: ctx.batter.name,
      batterLine,
      pitcherName: ctx.pitcher.name,
      pitchCount: g.fielding.pitchCount,
      arsenal: ctx.pitcher.arsenal.map((p) => ({ type: p.type, mph: Math.round(p.speedMph ?? 0) })),
      humanBatting: s.humanBatting,
      humanPitching: s.humanPitching,
      winProbHome: wp,
      final: g.final,
      abs: this.reviewAbs ?? (g.abs ? { ...g.abs } : null),
    };
  }

  private buildSnap(): HudSnapshot {
    const a = this.pb.aim;
    if (this.phase !== "pitch" && this.phase !== "play") this.logShown = this.session.pitchLog.length;
    return {
      ...this.board,
      phase: this.phase,
      pitchIdx: this.pitchIdx,
      canSteal: this.canSteal(),
      stealOn: this.steals.size > 0,
      stealOpts: this.stealOpts(),
      pickoffs: this.phase === "aim" && this.session.humanPitching ? this.session.pickoffTargets : [],
      disengagements: this.session.game.disengagements,
      steals: this.legalSteals(),
      runners: this.runnersInfo(),
      bunt: this.bunt,
      canBunt: this.canBunt(),
      call: this.call,
      power: this.power,
      meterStart: this.meterStart,
      banner: this.banner,
      log: this.log,
      turbo: this.turbo,
      readout: this.readout,
      pitches: this.hud.marks.slice(),
      pitchLog: this.session.pitchLog.slice(0, this.logShown),
      zone: { bottom: a.zoneBottom, top: a.zoneTop },
      feedback: this.feedback,
      canManage: this.canManage(),
      curtain: this.curtain,
      bumper: this.bumper,
      pitcherTired: this.pitcherTired(),
      challenge: this.challengeWin,
      review: this.review,
      twoPlayer: this.twoPlayer,
      handoff: this.handoff,
      turn: this.turnInfo(),
    };
  }

  private turnInfo(): HudSnapshot["turn"] {
    if (!this.twoPlayer || this.phase === "final") return null;
    const g = this.session.game;
    const pitching = this.phase === "aim" || this.phase === "meter" || (this.phase === "handoff" && !this.lockedPitch);
    const side: "away" | "home" = g.top === pitching ? "home" : "away";
    return { player: side === "away" ? "P1" : "P2", teamId: side === "away" ? this.setup.awayTeamId : this.setup.homeTeamId, role: pitching ? "pitch" : "bat" };
  }

  private drawScoreboard() {
    const c = scoreboardCanvas.canvas;
    const tex = scoreboardCanvas.texture;
    if (!c || !tex) return;
    this.boardCanvas = c;
    this.boardLogos = capLogoVersion();
    const g = this.session.game;
    const x = c.getContext("2d")!;
    const W = c.width;
    const H = c.height;
    // An LED line score: big, bright digits that read from the far end of the park.
    const bg = x.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#10151c");
    bg.addColorStop(1, "#06080b");
    x.fillStyle = bg;
    x.fillRect(0, 0, W, H);
    x.strokeStyle = "#2a3340";
    x.lineWidth = 4;
    x.strokeRect(2, 2, W - 4, H - 4);
    const innings = Math.max(9, g.line.away.length, g.line.home.length);
    const left = 132;
    const colW = (W - left - 70) / innings;
    const rowY = [H * 0.5, H * 0.84];
    x.textAlign = "center";
    x.textBaseline = "middle";
    x.font = `bold ${Math.round(H * 0.15)}px ui-monospace, Menlo, monospace`;
    x.fillStyle = "#9fb3c8";
    for (let i = 0; i < innings; i += 1) x.fillText(String(i + 1), left + colW * (i + 0.5), H * 0.17);
    x.fillStyle = "#ffd75e";
    x.fillText("R", W - 36, H * 0.17);
    const rows: Array<["away" | "home", number]> = [
      ["away", rowY[0]],
      ["home", rowY[1]],
    ];
    for (const [side, y] of rows) {
      const team = side === "away" ? g.away.team.teamId : g.home.team.teamId;
      x.fillStyle = getTeamColor(team);
      x.fillRect(8, y - H * 0.13, left - 16, H * 0.26);
      // The club's real mark beside its abbreviation (the abbreviation alone until it loads).
      const logo = capLogo(team);
      const s = H * 0.24;
      if (logo) {
        const k = s / Math.max(logo.naturalWidth, logo.naturalHeight);
        const lw = logo.naturalWidth * k;
        const lh = logo.naturalHeight * k;
        x.drawImage(logo, 12 + (s - lw) / 2, y - lh / 2, lw, lh);
      }
      x.fillStyle = "#fff";
      x.font = `bold ${Math.round(H * 0.15)}px ui-sans-serif, system-ui, sans-serif`;
      x.fillText(abbrevFor(team), logo ? (12 + s + left - 8) / 2 : left / 2, y + 1);
      x.font = `bold ${Math.round(H * 0.22)}px ui-monospace, Menlo, monospace`;
      x.fillStyle = "#f4f1e6";
      const arr = g.line[side];
      for (let i = 0; i < arr.length; i += 1) x.fillText(String(arr[i]), left + colW * (i + 0.5), y + 1);
      x.fillStyle = "#ffd75e";
      x.font = `bold ${Math.round(H * 0.26)}px ui-monospace, Menlo, monospace`;
      x.fillText(String(g.score[side]), W - 36, y + 1);
    }
    x.textAlign = "start";
    x.textBaseline = "alphabetic";
    tex.needsUpdate = true;
  }
}

/** Balls hit at least this hard get a touch of camera shake at contact. */
const HARD_HIT_MPH = 95;

function ordinal(n: number): string {
  const t = n % 100;
  const s = t >= 11 && t <= 13 ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th";
  return `${n}${s}`;
}

/** Team abbreviation lookup is injected by the view (keeps this module data-free). */
let abbrevFor = (teamId: number) => String(teamId);
export function setAbbrevLookup(fn: (teamId: number) => string) {
  abbrevFor = fn;
}

export { idealContactTime };
