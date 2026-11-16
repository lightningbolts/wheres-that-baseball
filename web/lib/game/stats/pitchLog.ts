/**
 * Statcast-style pitch tracking for Play Ball games: one record per pitch (velocity,
 * spin, induced break, extension, location, swing / whiff / chase, contact quality),
 * and per-pitcher arsenal summaries built from them, like Baseball Savant's game feed.
 *
 * Movement is measured like Savant's pitch-movement numbers: where the pitch crosses the
 * plate versus a spinless ball (same air, same gravity) thrown from the same release.
 */
import { integrateFlight, type Air } from "@/lib/game/physics/ballFlight";
import { PLATE_FRONT_Z, type PitchFlight } from "@/lib/game/physics/pitch";
import { len, MPH_TO_FPS, v3 } from "@/lib/game/math";
import type { PitchContext, PitchResult } from "@/lib/game/engine/atBat";
import type { PlayResult } from "@/lib/game/play/resolvePlay";
import type { GameEvent } from "@/lib/game/rules/game";

export interface PitchRecord {
  /** Pitch number in the game (1-based). */
  n: number;
  inning: number;
  top: boolean;
  /** Plate appearance number in the game (1-based) and pitch number within it. */
  pa: number;
  paPitch: number;
  balls: number;
  strikes: number;
  outs: number;
  pitcherId: number;
  pitcherName: string;
  pThrows: "L" | "R";
  batterId: number;
  batterName: string;
  stand: "L" | "R";
  type: string;
  /** Release speed, mph. */
  mph: number;
  /** Speed crossing the plate, mph. */
  plateMph: number;
  spinRpm: number;
  /** Induced vertical break, in (+ = rides above a spinless ball). */
  ivb: number;
  /** Horizontal break, in, catcher's view (+ = toward the first-base side), like Statcast pfx_x. */
  hb: number;
  /** Release extension, ft (pitcher's Statcast average for the pitch). */
  ext: number | null;
  /** Statcast plate location, ft. */
  px: number;
  pz: number;
  inZone: boolean;
  result: PitchResult["kind"];
  swing: boolean;
  /** Swinging strike or foul tip (Savant counts both as whiffs). */
  whiff: boolean;
  called: boolean;
  foul: boolean;
  inPlay: boolean;
  bunt: boolean;
  ev: number | null;
  la: number | null;
  dist: number | null;
  /** Bases on a hit (0 = none), for batted balls. */
  hit: 0 | 1 | 2 | 3 | 4;
  hardHit: boolean;
  barrel: boolean;
  /** Final pitch of the plate appearance: its result ("Strikeout", "Single", …), else null. */
  paResult: string | null;
}

const RAD_TO_RPM = 60 / (2 * Math.PI);
/** Pitching rubber to the point of home plate, ft. */
const RUBBER_Z = 60.5;
const DEFAULT_EXT_FT = 6.3;

/**
 * Induced vertical and horizontal break (in) of a pitch versus a spinless ball. The
 * flight starts at y = 50 ft; the break builds with the square of flight time, so the
 * stretch from release (60.5 ft − extension) is added by scaling with (t_release / t_50)².
 */
export function pitchMovement(flight: PitchFlight, air: Air, extFt: number | null = null): { ivb: number; hb: number } {
  const s0 = flight.samples[0];
  // A ball in the dirt ends its flight where it hits the ground, short of the plate: compare
  // the spinless ball at that same distance, not at the plate (it would be under the ground).
  const endZ = Math.max(PLATE_FRONT_Z, flight.cross.p.z);
  const { final } = integrateFlight({ p: s0.p, v: s0.v, w: v3(0, 0, 0) }, air, (b) => b.p.z <= endZ, { dt: 1 / 960, maxT: 1.5, sampleEvery: 1000 });
  // Both balls end within one step of that plane; project the spinless one onto it.
  const back = (final.p.z - endZ) / (final.v.z || -1);
  const nx = final.p.x - final.v.x * back;
  const ny = final.p.y - final.v.y * back;
  const t50 = flight.cross.t - s0.t;
  const lead = Math.max(0, RUBBER_Z - (extFt ?? DEFAULT_EXT_FT) - s0.p.z) / Math.max(1, Math.abs(s0.v.z));
  const k = ((t50 + lead) / Math.max(1e-3, t50)) ** 2;
  // World x is −px (catcher's view: +px toward first base).
  return { ivb: (flight.cross.p.y - ny) * 12 * k, hb: (-flight.cross.p.x + nx) * 12 * k };
}

/** Statcast barrel: 98+ mph with a launch-angle window that widens with exit velocity. */
export function isBarrel(ev: number, la: number): boolean {
  if (ev < 98) return false;
  const over = Math.min(ev, 116) - 98;
  return la >= 26 - over && la <= 30 + over * (20 / 18);
}

const PA_END: Record<string, (e: GameEvent, play?: PlayResult) => string> = {
  strikeout: () => "Strikeout",
  walk: () => "Walk",
  hbp: () => "Hit by pitch",
  in_play: (_e, play) => {
    if (!play) return "In play";
    if (play.hit) return ["", "Single", "Double", "Triple", "Home run"][play.hit];
    if (play.error) return "Reached on error";
    if (play.doublePlay) return "Double play";
    if (play.fieldersChoice) return "Fielder's choice";
    if (play.sacFly) return "Sac fly";
    return "Out";
  },
};

export interface PitchRecordInput {
  ctx: PitchContext;
  result: PitchResult;
  play?: PlayResult;
  battingSide: "L" | "R";
  events: GameEvent[];
  inning: number;
  top: boolean;
}

export function pitchRecord(input: PitchRecordInput, prev: PitchRecord | undefined): PitchRecord {
  const { ctx, result, play, events } = input;
  const flight = result.flight;
  const p = ctx.pitcher;
  const b = ctx.batter;
  const type = flight.type;
  const samePa = !!prev && prev.batterId === b.id && prev.paResult == null && prev.inning === input.inning && prev.top === input.top;
  const raw = p.raw.pitch?.arsenal.find((a) => a.type === type);
  const { ivb, hb } = pitchMovement(flight, ctx.park.air, raw?.ext ?? null);
  const contact = result.contact?.contact ? result.contact : undefined;
  const k = result.kind;
  const inPlay = k === "in_play" && !!play && !play.foul;
  const ev = contact?.exitSpeedMph ?? null;
  const la = contact?.launchAngleDeg ?? null;
  const end = events.find((e) => e.kind in PA_END);
  const swing = result.swing.swing && k !== "hbp";
  return {
    n: (prev?.n ?? 0) + 1,
    inning: input.inning,
    top: input.top,
    pa: samePa ? prev!.pa : (prev?.pa ?? 0) + 1,
    paPitch: samePa ? prev!.paPitch + 1 : 1,
    balls: ctx.count.balls,
    strikes: ctx.count.strikes,
    outs: ctx.outs,
    pitcherId: p.id,
    pitcherName: p.name,
    pThrows: p.throws,
    batterId: b.id,
    batterName: b.name,
    stand: input.battingSide,
    type,
    mph: flight.releaseSpeedMph,
    plateMph: len(flight.cross.v) / MPH_TO_FPS,
    spinRpm: len(flight.start.w) * RAD_TO_RPM,
    ivb,
    hb,
    ext: raw?.ext ?? null,
    px: flight.px,
    pz: flight.pz,
    inZone: result.inZone,
    result: k,
    swing,
    whiff: k === "swinging_strike" || k === "foul_tip",
    called: k === "called_strike",
    foul: k === "foul" || (k === "in_play" && !!play?.foul),
    inPlay,
    bunt: !!result.bunt,
    ev,
    la,
    dist: inPlay && result.path ? result.path.distance : null,
    hit: inPlay ? (play?.hit ?? 0) : 0,
    hardHit: ev != null && ev >= 95,
    barrel: ev != null && la != null && isBarrel(ev, la),
    paResult: end ? PA_END[end.kind](end, play) : null,
  };
}

export interface ArsenalLine {
  type: string;
  n: number;
  /** Share of the pitcher's pitches, 0..1. */
  usage: number;
  mph: number;
  mphMax: number;
  mphMin: number;
  spinRpm: number;
  ivb: number;
  hb: number;
  ext: number | null;
  /** Spread (standard deviation) of plate location, in. */
  locSpreadIn: number;
  /** Rates, 0..1 (null when there is nothing to divide by). */
  zonePct: number;
  swingPct: number;
  whiffPct: number | null;
  cswPct: number;
  chasePct: number | null;
  /** Two-strike pitches that ended in a strikeout. */
  putAwayPct: number | null;
  called: number;
  whiffs: number;
  fouls: number;
  inPlay: number;
  hits: number;
  ks: number;
  evAvg: number | null;
  laAvg: number | null;
  hardHitPct: number | null;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : 0);
const rate = (num: number, den: number) => (den > 0 ? num / den : null);

function line(type: string, ps: PitchRecord[], total: number): ArsenalLine {
  const mphs = ps.map((p) => p.mph);
  const swings = ps.filter((p) => p.swing);
  const out = ps.filter((p) => !p.inZone);
  const bbe = ps.filter((p) => p.inPlay && p.ev != null);
  const twoK = ps.filter((p) => p.strikes === 2);
  const ks = ps.filter((p) => p.paResult === "Strikeout").length;
  const mx = mean(ps.map((p) => p.px));
  const mz = mean(ps.map((p) => p.pz));
  const spread = Math.sqrt(mean(ps.map((p) => (p.px - mx) ** 2 + (p.pz - mz) ** 2))) * 12;
  const exts = ps.map((p) => p.ext).filter((e): e is number => e != null);
  const whiffs = ps.filter((p) => p.whiff).length;
  const called = ps.filter((p) => p.called).length;
  return {
    type,
    n: ps.length,
    usage: ps.length / Math.max(1, total),
    mph: mean(mphs),
    mphMax: Math.max(...mphs),
    mphMin: Math.min(...mphs),
    spinRpm: mean(ps.map((p) => p.spinRpm)),
    ivb: mean(ps.map((p) => p.ivb)),
    hb: mean(ps.map((p) => p.hb)),
    ext: exts.length ? mean(exts) : null,
    locSpreadIn: spread,
    zonePct: ps.filter((p) => p.inZone).length / ps.length,
    swingPct: swings.length / ps.length,
    whiffPct: rate(whiffs, swings.length),
    cswPct: (called + whiffs) / ps.length,
    chasePct: rate(out.filter((p) => p.swing).length, out.length),
    putAwayPct: rate(twoK.filter((p) => p.paResult === "Strikeout").length, twoK.length),
    called,
    whiffs,
    fouls: ps.filter((p) => p.foul).length,
    inPlay: ps.filter((p) => p.inPlay).length,
    hits: ps.filter((p) => p.hit > 0).length,
    ks,
    evAvg: bbe.length ? mean(bbe.map((p) => p.ev!)) : null,
    laAvg: bbe.length ? mean(bbe.map((p) => p.la!)) : null,
    hardHitPct: rate(bbe.filter((p) => p.hardHit).length, bbe.length),
  };
}

/** One pitcher's arsenal in this game, most-used pitch first, plus an "All" line. */
export function arsenalSummary(log: PitchRecord[], pitcherId: number): { lines: ArsenalLine[]; all: ArsenalLine | null } {
  const mine = log.filter((p) => p.pitcherId === pitcherId);
  if (!mine.length) return { lines: [], all: null };
  const byType = new Map<string, PitchRecord[]>();
  for (const p of mine) byType.set(p.type, [...(byType.get(p.type) ?? []), p]);
  const lines = [...byType].map(([t, ps]) => line(t, ps, mine.length)).sort((a, b) => b.n - a.n);
  return { lines, all: line("All", mine, mine.length) };
}

/** Pitchers who have thrown in this game, in order of appearance, with their side. */
export function pitchersInLog(log: PitchRecord[]): Array<{ id: number; name: string; top: boolean; throws: "L" | "R"; n: number }> {
  const seen = new Map<number, { id: number; name: string; top: boolean; throws: "L" | "R"; n: number }>();
  for (const p of log) {
    const s = seen.get(p.pitcherId);
    if (s) s.n += 1;
    else seen.set(p.pitcherId, { id: p.pitcherId, name: p.pitcherName, top: p.top, throws: p.pThrows, n: 1 });
  }
  return [...seen.values()];
}
