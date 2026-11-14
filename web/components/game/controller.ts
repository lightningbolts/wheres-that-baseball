/**
 * Pitch-by-pitch game flow for the 3D view: drives a GameSession from human input,
 * hands timelines to the scene's Playback, and exposes a HUD snapshot. Lives
 * outside React so per-frame scene code and input handlers share one source of truth.
 */
import * as THREE from "three";
import { buildTimeline, type Timeline } from "@/lib/game/anim/timeline";
import { GameSession, type CommittedPitch, type GameSetup, type PitchInput, type PitchOutcome } from "@/lib/game/session/session";
import { DIFFICULTY, humanPitch, humanSwing, meterAt, pciHalfSize } from "@/lib/game/session/humanInput";
import { idealContactTime } from "@/lib/game/engine/atBat";
import type { PitchFlight } from "@/lib/game/physics/pitch";
import type { GameEvent } from "@/lib/game/rules/game";
import type { TeamModel } from "@/lib/game/ratings";
import { Rng, clamp } from "@/lib/game/math";
import { homeWinProbability } from "@/lib/mlb/winExpectancy";
import { getTeamColor } from "@/lib/mlb/teamColors";
import type { CamMode, Playback } from "@/components/game/scene/playback";
import { MARK_COLOR, plateHud, type MarkKind, type PitchMark, type PlateHud } from "@/components/game/scene/view";
import { crowdState, scoreboardCanvas } from "@/components/game/scene/Ballpark";
import { sfx } from "@/components/game/audio";
import { saveGame, clearSave } from "@/components/game/save";

export type Phase = "aim" | "meter" | "ready" | "pitch" | "play" | "between" | "final";

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
  zone: { bottom: number; top: number };
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
}

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
>;

const markKind = (k: string): MarkKind => (k === "foul_tip" ? "swinging_strike" : k in MARK_COLOR ? (k as MarkKind) : "ball");
/** Approach ring on the zone: the whole flight for rookies, the last stretch on pro, off on all-star. */
const ASSIST_FROM: Record<GameSetup["difficulty"], number | null> = { rookie: 0, pro: 0.45, allstar: null };

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

export class GameController {
  readonly pb: Playback;
  session: GameSession;
  private listeners = new Set<() => void>();
  private timers: ReturnType<typeof setTimeout>[] = [];
  private inputRng = new Rng((Date.now() & 0x7fffffff) || 7);
  private snap!: HudSnapshot;
  private phase: Phase = "between";
  private pitchIdx = 0;
  private power = false;
  private stealOn = false;
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
  private disposed = false;
  private board!: Board;
  private hud: PlateHud;
  /** All nine fielders; the scene's cast leaves the catcher out while the camera sits at his eyes. */
  private fielders: NonNullable<Playback["cast"]>["fielders"] = [];
  /** Fast-forward as the player set it; playback itself runs at normal speed while he is hitting. */
  private turbo = false;
  private pitchSeq = 0;
  private marked = false;
  private revealed = false;

  constructor(
    readonly setup: GameSetup,
    private teams: Map<number, TeamModel>,
    pb: Playback,
    inputs: PitchInput[] = [],
  ) {
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

  /** Switch camera; a change of camera is a cut, and the scene snaps animation across it. */
  private setCam(mode: CamMode) {
    if (this.pb.cam === mode) return;
    this.pb.cam = mode;
    this.pb.cutSeq += 1;
    this.syncCast();
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
    this.later(400, () => this.next());
  }

  private next() {
    const s = this.session;
    if (s.game.final) {
      this.phase = "final";
      this.setCam("overview");
      clearSave();
      this.board = this.readBoard();
      this.emit();
      return;
    }
    s.prepare();
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
    this.stealOn = false;
    this.board = this.readBoard();
    // A fresh count is a new at-bat: its pitch chart starts empty.
    if (s.game.balls === 0 && s.game.strikes === 0 && this.hud.marks.length) this.hud.marks = [];
    const seq = (this.pitchSeq += 1);
    const ctx = s.currentContext!;
    const a = this.pb.aim;
    a.zoneBottom = ctx.batter.zoneBottom;
    a.zoneTop = ctx.batter.zoneTop;
    a.showZone = true;
    if (s.humanPitching) {
      this.setCam("pitcher");
      this.phase = "aim";
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
      this.setCam("batter");
      this.phase = "ready";
      a.kind = "pci";
      a.visible = true;
      this.applyPci();
      // The pitcher comes set on his own; the action button calls for the pitch sooner.
      this.later(this.turbo ? 350 : 1000, () => {
        if (this.phase === "ready" && this.pitchSeq === seq) this.throwPitch({ steal: this.stealOn });
      });
    } else {
      this.setCam("broadcast");
      this.phase = "ready";
      a.visible = false;
      this.later(this.turbo ? 150 : 700, () => {
        if (this.phase === "ready" && this.pitchSeq === seq) this.throwPitch({});
      });
    }
    this.emit();
  }

  private applyPci() {
    const { w, h } = pciHalfSize(this.power, this.setup.difficulty);
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
    this.readout = null;
    this.pb.aim.showZone = true;
    if (s.humanPitching) this.pb.aim.visible = false;
    if (s.humanBatting) {
      const tl = this.pitchOnlyTimeline(flight);
      this.pb.timeline = tl;
      // The pitch always comes in at the difficulty's speed, fast-forward or not.
      this.pb.turbo = false;
      this.pb.T = tl.releaseT - (this.turbo ? 0.8 : 1.25);
      this.pb.slow = { from: tl.releaseT, to: flight.cross.t + 0.2, rate: DIFFICULTY[this.setup.difficulty].timeScale };
      this.pb.cues = [
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
      marks.push({ n, px: flight.px, pz: flight.pz, kind, type: flight.type, mph: Math.round(flight.releaseSpeedMph) });
      this.hud.markAt = this.pb.now;
    }
    if (kind === "pending") this.showReadout(flight);
    this.emit();
  }

  /** Human swing (pressT = flight time) or take (null). */
  swing(pressT: number | null) {
    if (this.phase !== "pitch" || this.swung || !this.flight || !this.session.humanBatting) return;
    if (pressT != null && pressT < this.flight.samples[0].t - 0.15) return; // way before the ball is out of the hand
    this.swung = true;
    const s = this.session;
    const ctx = s.currentContext!;
    const a = this.pb.aim;
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
    const committed = this.session.commit();
    const tl = buildTimeline(committed, { swingStartT });
    this.pb.turbo = this.turbo;
    this.mountTimeline(tl, fresh, committed);
    this.pb.onEnd = () => this.finish(committed);
    this.emit();
  }

  private mountTimeline(tl: Timeline, fresh: boolean, c: CommittedPitch) {
    const T = fresh ? tl.releaseT - (this.turbo ? 0.9 : 1.25) : this.pb.T;
    this.pb.timeline = tl;
    this.pb.T = T;
    const cues = this.pb.cues.filter((q) => q.done);
    const r = c.result;
    const flight = r.flight;
    const cross = flight.cross.t;
    const kind = markKind(r.kind);
    const settle = () => {
      this.markPitch(flight, kind);
      this.showReadout(flight, kind, RESULT_TEXT[r.kind] ?? r.kind);
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
            fx.shake = Math.max(fx.shake, tl.inPlay ? 0.05 + 0.15 * power : 0.04);
            fx.punch = Math.max(fx.punch, tl.inPlay ? 0.3 + 0.7 * power : 0.2);
          }
          if (!tip && r.contact) {
            const stat = `${ev.toFixed(0)} mph · ${Math.round(la)}°`;
            this.feedback = this.feedback ? { ...this.feedback, sub: stat } : { id: (this.feedbackId += 1), text: stat, tone: "neutral" };
          }
          if (tl.inPlay) {
            this.pb.cam = "follow";
            this.syncCast();
            this.pb.aim.visible = false;
            this.pb.aim.showZone = false;
            this.phase = "play";
            sfx.swell(ev > 100 ? 0.6 : 0.25, 2.5);
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
    this.pb.cues = cues;
    // After the ball is past the plate, real-time playback.
    if (this.pb.slow) this.pb.slow.to = Math.min(this.pb.slow.to, tl.contactT ?? this.pb.slow.to);
  }

  /** Put a committed pitch on the HUD: count / outs / score, play-by-play and the banner. */
  private reveal(c: CommittedPitch) {
    if (this.revealed) return;
    this.revealed = true;
    const important = c.events.filter((e) => e.kind !== "pitch");
    for (const e of important) this.pushLog(e);
    this.banner = this.bannerFor(c, important);
    if (c.play?.hit === 4) {
      crowdState.excite = 1;
      sfx.swell(1, 6);
    } else if (c.play && c.play.hit > 0) {
      crowdState.excite = Math.max(crowdState.excite, 0.35);
      sfx.swell(0.45, 3);
    } else if (important.some((e) => e.kind === "strikeout")) sfx.swell(0.3, 2);
    this.board = this.readBoard();
    this.drawScoreboard();
  }

  private finish(c: CommittedPitch) {
    const s = this.session;
    const r = c.result;
    const early = this.revealed;
    this.markPitch(r.flight, markKind(r.kind));
    this.showReadout(r.flight, markKind(r.kind), RESULT_TEXT[r.kind] ?? r.kind);
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
      this.later(this.turbo ? 600 : 1800, () => this.next());
      return;
    }
    if (inningOver) this.setCam("overview");
    this.emit();
    // A call that went up as the pitch crossed has already had its moment on screen.
    const wait = this.turbo ? 250 : inningOver ? (early ? 1700 : 2400) : important ? (early ? 550 : 1300) : 300;
    this.later(wait, () => {
      this.banner = null;
      this.next();
    });
  }

  private bannerFor(c: CommittedPitch, events: GameEvent[]): HudSnapshot["banner"] {
    const play = c.play;
    const offenseHuman = this.session.setup.human !== "none" && (this.session.setup.human === "away") === !!events[0]?.top;
    const toneFor = (goodForOffense: boolean) =>
      this.setup.human === "none" ? "neutral" : goodForOffense === offenseHuman ? "good" : "bad";
    const ko = events.find((e) => e.kind === "strikeout");
    if (ko) return { text: "Strikeout", sub: ko.text, tone: toneFor(false) };
    const bb = events.find((e) => e.kind === "walk" || e.kind === "hbp");
    if (bb) return { text: bb.kind === "walk" ? "Walk" : "Hit by pitch", sub: bb.text, tone: toneFor(true) };
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
      this.throwPitch({ pitch: decision });
      return;
    }
    if (this.phase === "pitch") this.swing(this.pb.T);
    // Ready to hit: call for the pitch without waiting for the pitcher.
    else if (this.phase === "ready" && this.session.humanBatting) this.throwPitch({ steal: this.stealOn });
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

  toggleSteal() {
    if (!this.canSteal()) return;
    this.stealOn = !this.stealOn;
    this.emit();
  }

  toggleTurbo() {
    this.turbo = !this.turbo;
    // Never fast-forward a pitch the player still has to hit.
    this.pb.turbo = this.turbo && !(this.phase === "pitch" && this.session.humanBatting && !this.swung);
    this.emit();
  }

  /** Quick-sim the rest of the half-inning with the CPU on both sides. */
  simHalf() {
    if (this.phase === "final" || this.phase === "pitch" || this.phase === "play") return;
    this.timers.forEach(clearTimeout);
    this.timers = [];
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
      this.next();
    });
  }

  private canSteal(): boolean {
    const g = this.session.game;
    return this.session.humanBatting && this.phase === "ready" && !!g.bases[0] && !g.bases[1] && g.outs < 3;
  }

  // ---------- scene state ----------
  private refreshCast() {
    const g = this.session.game;
    const fieldTeam = g.fielding.team.teamId;
    const batTeam = g.batting.team.teamId;
    const homeId = g.home.team.teamId;
    const uni = (teamId: number) => ({
      jersey: new THREE.Color(teamId === homeId ? "#f3f2ec" : "#a9aeb6"),
      accent: new THREE.Color(getTeamColor(teamId)),
    });
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
      bases: [!!g.bases[0], !!g.bases[1], !!g.bases[2]],
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
    };
  }

  private buildSnap(): HudSnapshot {
    const a = this.pb.aim;
    return {
      ...this.board,
      phase: this.phase,
      pitchIdx: this.pitchIdx,
      canSteal: this.canSteal(),
      stealOn: this.stealOn,
      power: this.power,
      meterStart: this.meterStart,
      banner: this.banner,
      log: this.log,
      turbo: this.turbo,
      readout: this.readout,
      pitches: this.hud.marks.slice(),
      zone: { bottom: a.zoneBottom, top: a.zoneTop },
      feedback: this.feedback,
    };
  }

  private drawScoreboard() {
    const c = scoreboardCanvas.canvas;
    const tex = scoreboardCanvas.texture;
    if (!c || !tex) return;
    const g = this.session.game;
    const x = c.getContext("2d")!;
    x.fillStyle = "#0b0d10";
    x.fillRect(0, 0, c.width, c.height);
    x.font = "bold 20px ui-monospace, monospace";
    const innings = Math.max(9, g.line.away.length, g.line.home.length);
    const colW = (c.width - 170) / (innings + 3);
    x.fillStyle = "#f2c94c";
    for (let i = 0; i < innings; i += 1) x.fillText(String(i + 1), 90 + i * colW, 40);
    x.fillText("R", 90 + innings * colW + 10, 40);
    const rows: Array<["away" | "home", number]> = [
      ["away", 90],
      ["home", 140],
    ];
    for (const [side, y] of rows) {
      const team = side === "away" ? g.away.team.teamId : g.home.team.teamId;
      x.fillStyle = getTeamColor(team);
      x.fillRect(12, y - 28, 64, 36);
      x.fillStyle = "#fff";
      x.fillText(abbrevFor(team), 18, y - 3);
      const arr = g.line[side];
      for (let i = 0; i < arr.length; i += 1) x.fillText(String(arr[i]), 90 + i * colW, y);
      x.fillStyle = "#f2c94c";
      x.fillText(String(g.score[side]), 90 + innings * colW + 10, y);
    }
    tex.needsUpdate = true;
  }
}

/** Team abbreviation lookup is injected by the view (keeps this module data-free). */
let abbrevFor = (teamId: number) => String(teamId);
export function setAbbrevLookup(fn: (teamId: number) => string) {
  abbrevFor = fn;
}

export { idealContactTime };
