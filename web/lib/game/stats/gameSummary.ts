/**
 * A one-glance Statcast recap of a Play Ball game, built from the pitch log: the
 * standout moments (hardest-hit ball, longest homer, fastest pitch, hard-luck out…),
 * team-vs-team quality of contact and pitching, and each starter's pitch mix.
 *
 * Sides follow the half-inning: in the top the away team bats and the home team pitches.
 */
import type { PitchRecord } from "@/lib/game/stats/pitchLog";

export type Side = "away" | "home";

/** Savant's sweet spot: launch angle 8–32°. */
export const isSweetSpot = (la: number) => la >= 8 && la <= 32;

export const battingSide = (p: PitchRecord): Side => (p.top ? "away" : "home");
export const pitchingSide = (p: PitchRecord): Side => (p.top ? "home" : "away");

export interface TeamBatting {
  /** Batted-ball events with a tracked exit velocity. */
  bbe: number;
  evAvg: number | null;
  evMax: number | null;
  laAvg: number | null;
  /** Rates 0..1 over batted balls (null with none). */
  hardHitPct: number | null;
  sweetSpotPct: number | null;
  barrels: number;
  hardHit: number;
  hits: number;
  hr: number;
}

export interface TeamPitching {
  pitches: number;
  /** Called strikes + whiffs per pitch, 0..1. */
  cswPct: number | null;
  /** Whiffs per swing. */
  whiffPct: number | null;
  /** Swings at pitches outside the zone. */
  chasePct: number | null;
  zonePct: number | null;
  whiffs: number;
  ks: number;
  veloMax: number | null;
  /** Average four-seam / sinker velocity. */
  fbVelo: number | null;
}

export interface PitcherLine {
  id: number;
  name: string;
  side: Side;
  throws: "L" | "R";
  pitches: number;
  ks: number;
  whiffs: number;
  csw: number;
}

export interface MixLine {
  type: string;
  n: number;
  usage: number;
  mph: number;
}

export interface StarterMix {
  side: Side;
  id: number;
  name: string;
  throws: "L" | "R";
  pitches: number;
  ks: number;
  cswPct: number;
  mix: MixLine[];
}

export interface GameSummary {
  pitches: number;
  bat: Record<Side, TeamBatting>;
  pit: Record<Side, TeamPitching>;
  hardestHit: PitchRecord | null;
  longestHr: PitchRecord | null;
  /** Longest batted ball of any kind (the fallback when nobody homered). */
  longestBall: PitchRecord | null;
  fastestPitch: PitchRecord | null;
  /** Most strikeouts by one pitcher (ties: fewer pitches). */
  topK: PitcherLine | null;
  /** Most swinging strikes by one pitcher (ties: fewer pitches). */
  topWhiffs: PitcherLine | null;
  /** Hardest-hit ball that was caught for an out: the hard-luck play. */
  hardLuckOut: PitchRecord | null;
  /** Softest-hit ball that fell for a hit: the bloop. */
  bloopHit: PitchRecord | null;
  starters: StarterMix[];
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : null);
const rate = (num: number, den: number) => (den > 0 ? num / den : null);
const FASTBALLS = new Set(["FF", "FA", "SI"]);

function maxBy<T>(xs: T[], f: (x: T) => number): T | null {
  let best: T | null = null;
  let bv = -Infinity;
  for (const x of xs) {
    const v = f(x);
    if (Number.isFinite(v) && v > bv) {
      bv = v;
      best = x;
    }
  }
  return best;
}

const isBbe = (p: PitchRecord): p is PitchRecord & { ev: number; la: number } => p.inPlay && p.ev != null && p.la != null;
const isOut = (p: PitchRecord) => p.inPlay && p.hit === 0 && p.paResult !== "Reached on error";

function teamBatting(ps: PitchRecord[]): TeamBatting {
  const bbe = ps.filter(isBbe);
  const hard = bbe.filter((p) => p.hardHit).length;
  return {
    bbe: bbe.length,
    evAvg: mean(bbe.map((p) => p.ev)),
    evMax: bbe.length ? Math.max(...bbe.map((p) => p.ev)) : null,
    laAvg: mean(bbe.map((p) => p.la)),
    hardHitPct: rate(hard, bbe.length),
    sweetSpotPct: rate(bbe.filter((p) => isSweetSpot(p.la)).length, bbe.length),
    barrels: bbe.filter((p) => p.barrel).length,
    hardHit: hard,
    hits: ps.filter((p) => p.inPlay && p.hit > 0).length,
    hr: ps.filter((p) => p.inPlay && p.hit === 4).length,
  };
}

function teamPitching(ps: PitchRecord[]): TeamPitching {
  const swings = ps.filter((p) => p.swing);
  const out = ps.filter((p) => !p.inZone);
  const whiffs = ps.filter((p) => p.whiff).length;
  const fb = ps.filter((p) => FASTBALLS.has(p.type)).map((p) => p.mph);
  return {
    pitches: ps.length,
    cswPct: rate(ps.filter((p) => p.called).length + whiffs, ps.length),
    whiffPct: rate(whiffs, swings.length),
    chasePct: rate(out.filter((p) => p.swing).length, out.length),
    zonePct: rate(ps.filter((p) => p.inZone).length, ps.length),
    whiffs,
    ks: ps.filter((p) => p.paResult === "Strikeout").length,
    veloMax: ps.length ? Math.max(...ps.map((p) => p.mph)) : null,
    fbVelo: mean(fb),
  };
}

function pitcherLines(log: PitchRecord[]): PitcherLine[] {
  const m = new Map<number, PitcherLine>();
  for (const p of log) {
    let l = m.get(p.pitcherId);
    if (!l) {
      l = { id: p.pitcherId, name: p.pitcherName, side: pitchingSide(p), throws: p.pThrows, pitches: 0, ks: 0, whiffs: 0, csw: 0 };
      m.set(p.pitcherId, l);
    }
    l.pitches += 1;
    if (p.paResult === "Strikeout") l.ks += 1;
    if (p.whiff) l.whiffs += 1;
    if (p.whiff || p.called) l.csw += 1;
  }
  return [...m.values()];
}

function leader(lines: PitcherLine[], f: (l: PitcherLine) => number): PitcherLine | null {
  let best: PitcherLine | null = null;
  for (const l of lines) {
    if (f(l) <= 0) continue;
    if (!best || f(l) > f(best) || (f(l) === f(best) && l.pitches < best.pitches)) best = l;
  }
  return best;
}

export function starterMix(log: PitchRecord[], side: Side): StarterMix | null {
  const first = log.find((p) => pitchingSide(p) === side);
  if (!first) return null;
  const mine = log.filter((p) => p.pitcherId === first.pitcherId);
  const byType = new Map<string, number[]>();
  for (const p of mine) byType.set(p.type, [...(byType.get(p.type) ?? []), p.mph]);
  const mix = [...byType]
    .map(([type, mphs]) => ({ type, n: mphs.length, usage: mphs.length / mine.length, mph: mean(mphs) ?? 0 }))
    .sort((a, b) => b.n - a.n || a.type.localeCompare(b.type));
  return {
    side,
    id: first.pitcherId,
    name: first.pitcherName,
    throws: first.pThrows,
    pitches: mine.length,
    ks: mine.filter((p) => p.paResult === "Strikeout").length,
    cswPct: mine.filter((p) => p.whiff || p.called).length / mine.length,
    mix,
  };
}

export function gameSummary(log: PitchRecord[]): GameSummary {
  const bbe = log.filter(isBbe);
  const inPlayDist = log.filter((p) => p.inPlay && p.dist != null);
  const hits = bbe.filter((p) => p.hit > 0);
  const pitchers = pitcherLines(log);
  const sides: Side[] = ["away", "home"];
  return {
    pitches: log.length,
    bat: { away: teamBatting(log.filter((p) => battingSide(p) === "away")), home: teamBatting(log.filter((p) => battingSide(p) === "home")) },
    pit: { away: teamPitching(log.filter((p) => pitchingSide(p) === "away")), home: teamPitching(log.filter((p) => pitchingSide(p) === "home")) },
    hardestHit: maxBy(bbe, (p) => p.ev),
    longestHr: maxBy(
      inPlayDist.filter((p) => p.hit === 4),
      (p) => p.dist!,
    ),
    longestBall: maxBy(inPlayDist, (p) => p.dist!),
    fastestPitch: maxBy(log, (p) => p.mph),
    topK: leader(pitchers, (l) => l.ks),
    topWhiffs: leader(pitchers, (l) => l.whiffs),
    hardLuckOut: maxBy(bbe.filter(isOut), (p) => p.ev),
    bloopHit: maxBy(hits, (p) => -p.ev),
    starters: sides.map((s) => starterMix(log, s)).filter((s): s is StarterMix => s != null),
  };
}
