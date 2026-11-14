/**
 * Pitch-by-pitch game flow for the 3D view: drives a GameSession from human input,
 * hands timelines to the scene's Playback, and exposes a HUD snapshot. Lives
 * outside React so per-frame scene code and input handlers share one source of truth.
 */
import * as THREE from "three";
import { buildTimeline, type Timeline } from "@/lib/game/anim/timeline";
import { GameSession, type CommittedPitch, type GameSetup, type PitchInput, type PitchOutcome, type ThrowPrompt } from "@/lib/game/session/session";
import { DIFFICULTY, humanPitch, humanSwing, meterAt, pciHalfSize } from "@/lib/game/session/humanInput";
import { idealContactTime } from "@/lib/game/engine/atBat";
import type { PitchFlight } from "@/lib/game/physics/pitch";
import type { Base } from "@/lib/game/play/resolvePlay";
import type { GameEvent } from "@/lib/game/rules/game";
import type { TeamModel } from "@/lib/game/ratings";
import { Rng, clamp } from "@/lib/game/math";
import { homeWinProbability } from "@/lib/mlb/winExpectancy";
import { getTeamColor } from "@/lib/mlb/teamColors";
import type { Playback } from "@/components/game/scene/playback";
import { crowdState, scoreboardCanvas } from "@/components/game/scene/Ballpark";
import { sfx } from "@/components/game/audio";
import { saveGame, clearSave } from "@/components/game/save";

export type Phase = "aim" | "meter" | "ready" | "pitch" | "play" | "throw" | "between" | "final";

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
  prompt: ThrowPrompt | null;
  winProbHome: number;
  final: boolean;
  turbo: boolean;
  lastPitch: { type: string; mph: number; result: string } | null;
}

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
  private prompt: ThrowPrompt | null = null;
  private banner: HudSnapshot["banner"] = null;
  private log: Array<{ id: number; text: string }> = [];
  private logId = 0;
  private lastPitch: HudSnapshot["lastPitch"] = null;
  private disposed = false;

  constructor(
    readonly setup: GameSetup,
    private teams: Map<number, TeamModel>,
    pb: Playback,
    inputs: PitchInput[] = [],
  ) {
    this.pb = pb;
    this.session = inputs.length ? GameSession.replay(setup, inputs, teams) : new GameSession(setup, teams);
    this.refreshCast();
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
      this.pb.cam = "overview";
      clearSave();
      this.emit();
      return;
    }
    s.prepare();
    this.refreshCast();
    this.pb.timeline = null;
    this.pb.paused = false;
    this.pb.slow = null;
    this.pb.cues = [];
    this.swung = false;
    this.flight = null;
    this.outcome = null;
    this.prompt = null;
    this.stealOn = false;
    const ctx = s.currentContext!;
    const a = this.pb.aim;
    a.zoneBottom = ctx.batter.zoneBottom;
    a.zoneTop = ctx.batter.zoneTop;
    if (s.humanPitching) {
      this.pb.cam = "pitcher";
      this.phase = "aim";
      this.pitchIdx = Math.min(this.pitchIdx, ctx.pitcher.arsenal.length - 1);
      a.kind = "target";
      a.visible = true;
      a.showZone = true;
      a.w = 0;
      a.h = 0;
      if (Math.abs(a.px) > 2 || a.pz < 0.5 || a.pz > 4.5) {
        a.px = 0;
        a.pz = (ctx.batter.zoneBottom + ctx.batter.zoneTop) / 2;
      }
    } else if (s.humanBatting) {
      this.pb.cam = "batter";
      this.phase = "ready";
      a.kind = "pci";
      a.visible = true;
      a.showZone = true;
      this.applyPci();
      this.later(this.pb.turbo ? 500 : 1500, () => {
        if (this.phase === "ready") this.throwPitch({ steal: this.stealOn });
      });
    } else {
      this.pb.cam = "broadcast";
      this.phase = "ready";
      a.visible = false;
      a.showZone = false;
      this.later(this.pb.turbo ? 150 : 700, () => this.throwPitch({}));
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
    this.pb.aim.showZone = s.humanBatting || s.humanPitching;
    if (s.humanPitching) this.pb.aim.visible = false;
    if (s.humanBatting) {
      const tl = this.pitchOnlyTimeline(flight);
      this.pb.timeline = tl;
      this.pb.T = tl.releaseT - 1.25;
      this.pb.slow = { from: tl.releaseT, to: flight.cross.t + 0.2, rate: DIFFICULTY[this.setup.difficulty].timeScale };
      this.pb.cues = [{ T: flight.cross.t + 0.1, fn: () => this.swing(null) }];
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

  /** Human swing (pressT = flight time) or take (null). */
  swing(pressT: number | null) {
    if (this.phase !== "pitch" || this.swung || !this.flight || !this.session.humanBatting) return;
    if (pressT != null && pressT < this.flight.samples[0].t - 0.15) return; // way before the ball is out of the hand
    this.swung = true;
    const s = this.session;
    const ctx = s.currentContext!;
    const sw = humanSwing(
      { pressT, pciPx: this.pb.aim.px, pciPz: this.pb.aim.pz, power: this.power },
      this.flight,
      ctx.batter,
      ctx.side,
      this.setup.difficulty,
      this.inputRng,
    );
    const outcome = s.swing({ swing: sw });
    this.afterSwing(outcome, false);
  }

  private afterSwing(outcome: PitchOutcome, fresh: boolean) {
    this.outcome = outcome;
    const s = this.session;
    if (outcome.throwPrompt && s.humanPitching) {
      const tl = buildTimeline({ ...outcome, events: [] });
      this.mountTimeline(tl, fresh, outcome);
      const tPrompt = (tl.contactT ?? 0) + outcome.throwPrompt.fielded.t;
      this.pb.cues.push({
        T: tPrompt,
        fn: () => {
          this.pb.paused = true;
          this.prompt = outcome.throwPrompt!;
          this.phase = "throw";
          this.emit();
        },
      });
      this.pb.onEnd = null;
      this.phase = "play";
      this.emit();
      return;
    }
    const committed = s.commit();
    const tl = buildTimeline(committed);
    this.mountTimeline(tl, fresh, committed);
    this.pb.onEnd = () => this.finish(committed);
    this.emit();
  }

  /** Human throw choice (null = hold the ball, undefined = let the AI choose). */
  chooseThrow(base: Base | null | undefined) {
    if (this.phase !== "throw" || !this.outcome) return;
    const committed = this.session.commit(base);
    const T = this.pb.T;
    const tl = buildTimeline(committed);
    this.pb.timeline = tl;
    this.pb.T = T;
    this.pb.cues = this.pb.cues.filter((c) => c.done);
    this.pb.onEnd = () => this.finish(committed);
    this.prompt = null;
    this.phase = "play";
    this.pb.paused = false;
    this.emit();
  }

  private mountTimeline(tl: Timeline, fresh: boolean, o: PitchOutcome) {
    const T = fresh ? tl.releaseT - 1.25 : this.pb.T;
    this.pb.timeline = tl;
    this.pb.T = T;
    const cues = this.pb.cues.filter((c) => c.done);
    const r = o.result;
    const cross = r.flight.cross.t;
    if (tl.contactT != null) {
      const ev = r.contact?.exitSpeedMph ?? 70;
      cues.push({
        T: tl.contactT,
        fn: () => {
          if (r.kind === "foul_tip") sfx.foulTip();
          else sfx.crack(ev);
          if (tl.inPlay) {
            this.pb.cam = "follow";
            this.pb.aim.visible = false;
            this.pb.aim.showZone = false;
            this.phase = "play";
            sfx.swell(ev > 100 ? 0.6 : 0.25, 2.5);
            this.emit();
          }
        },
      });
    }
    if (tl.contactT == null || r.kind === "foul_tip") {
      cues.push({
        T: cross + 0.04,
        fn: () => {
          if (r.kind !== "hbp") sfx.mitt();
          if (r.kind === "called_strike") sfx.call(true);
          this.pb.lastPitch = { px: r.flight.px, pz: r.flight.pz, strike: r.inZone };
          this.pb.aim.showZone = this.session.humanBatting || this.session.humanPitching || this.pb.aim.showZone;
          this.banner = { text: RESULT_TEXT[r.kind] ?? r.kind, tone: "neutral" };
          this.emit();
        },
      });
    }
    this.pb.cues = cues;
    // After the ball is past the plate, real-time playback.
    if (this.pb.slow) this.pb.slow.to = Math.min(this.pb.slow.to, tl.contactT ?? this.pb.slow.to);
  }

  private finish(c: CommittedPitch) {
    const s = this.session;
    const r = c.result;
    this.lastPitch = {
      type: r.flight.type,
      mph: Math.round(r.flight.releaseSpeedMph),
      result: RESULT_TEXT[r.kind] ?? r.kind,
    };
    this.pb.lastPitch = { px: r.flight.px, pz: r.flight.pz, strike: r.inZone };
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
    saveGame(this.setup, s.inputs);
    this.drawScoreboard();
    const inningOver = c.events.some((e) => e.kind === "inning_end");
    this.phase = "between";
    this.pb.timeline = null;
    this.pb.slow = null;
    this.refreshCast();
    if (s.game.final) {
      this.emit();
      this.later(1800, () => this.next());
      return;
    }
    if (inningOver) this.pb.cam = "overview";
    this.emit();
    const wait = this.pb.turbo ? 350 : inningOver ? 2600 : important.length ? 1500 : 650;
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
    if (c.result.kind === "foul") return { text: "Foul ball", tone: "neutral" };
    return this.banner;
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
    this.pb.turbo = !this.pb.turbo;
    this.emit();
  }

  /** Quick-sim the rest of the half-inning with the CPU on both sides. */
  simHalf() {
    if (this.phase === "final" || this.phase === "throw" || this.phase === "pitch" || this.phase === "play") return;
    this.timers.forEach(clearTimeout);
    this.timers = [];
    const pitches = this.session.simHalfInning();
    for (const c of pitches) for (const e of c.events) if (e.kind !== "pitch") this.pushLog(e);
    saveGame(this.setup, this.session.inputs);
    this.drawScoreboard();
    this.banner = { text: "Half-inning simulated", tone: "neutral" };
    this.pb.cam = "overview";
    this.refreshCast();
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
    this.pb.cast = {
      field: uni(fieldTeam),
      bat: uni(batTeam),
      pitcherHand: g.fielding.pitcher.throws,
      batterHand: ctx.side,
      fielders: g.fielders().map((f) => ({ pos: f.pos, p: f.p, id: f.playerId })),
      runners: g.bases.map((r, i) => (r ? { id: r.playerId, base: (i + 1) as 1 | 2 | 3 } : null)),
      batterId: ctx.batter.id,
    };
  }

  private buildSnap(): HudSnapshot {
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
      phase: this.phase,
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
      pitchIdx: this.pitchIdx,
      humanBatting: s.humanBatting,
      humanPitching: s.humanPitching,
      canSteal: this.canSteal(),
      stealOn: this.stealOn,
      power: this.power,
      meterStart: this.meterStart,
      banner: this.banner,
      log: this.log,
      prompt: this.prompt,
      winProbHome: wp,
      final: g.final,
      turbo: this.pb.turbo,
      lastPitch: this.lastPitch,
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
