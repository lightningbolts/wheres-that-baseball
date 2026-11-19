/**
 * Umpire scorecards, Umpire-Scorecards style: every taken pitch the plate umpire
 * calls is checked against the rulebook zone (the same zone ABS uses).
 *
 *  - accuracy      correct calls / called pitches
 *  - expected acc. what a league-average umpire would get on these same pitches
 *                  (a game full of borderline takes is harder to call)
 *  - consistency   share of calls that fit the umpire's own zone for the day: the best
 *                  single edge-distance threshold of his calls, wherever he put it
 *  - favor         runs the missed calls were worth, + toward the home club
 *  - biggest miss  the wrong call farthest from the edge
 *
 * Played games keep a pitch list while live and fold it into a small card at the end;
 * simmed games (no pitches) draw a card from the umpire's profile.
 */
import {
  umpireGeometry,
  UMP_SD_HEIGHT_FT,
  UMP_SD_SIDE_FT,
} from "@/lib/game/engine/atBat";
import type { PitchFlight } from "@/lib/game/physics/pitch";
import type { UmpTendency } from "./data";

export interface UmpMiss {
  /** Inches from the edge of the zone. */
  in: number;
  /** 1 = called a strike (should have been a ball), 0 = called a ball. */
  k: 0 | 1;
  /** Count before the pitch, "b-s". */
  c: string;
  inn: number;
  top: 0 | 1;
  /** Run value of the miss. */
  rv: number;
}

/** One game's plate-umpire scorecard (counts, so cards add up into season lines). */
export interface UmpCard {
  /** Called pitches. */
  n: number;
  /** Correct calls. */
  ok: number;
  /** Expected correct calls for a league-average umpire. */
  xa: number;
  /** Calls consistent with the umpire's own zone that day. */
  con: number;
  /** Runs the missed calls favored the home club by (− = the away club). */
  fav: number;
  big?: UmpMiss;
  /** Drawn from the profile (simmed game), not called pitch by pitch. */
  sim?: 1;
}

/**
 * Run value of a called strike vs a ball, by count [balls][strikes] (a strike at 3-2 is
 * a strikeout instead of a walk). Rough linear weights, bases and outs ignored.
 */
const RV: number[][] = [
  [0.07, 0.09, 0.19],
  [0.09, 0.11, 0.22],
  [0.12, 0.15, 0.3],
  [0.18, 0.31, 0.55],
];

export const callRunValue = (balls: number, strikes: number): number =>
  RV[Math.min(3, balls)]?.[Math.min(2, strikes)] ?? 0.1;

/** Standard normal CDF (Abramowitz–Stegun 7.1.26 erf). */
export function normCdf(x: number): number {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-z * z);
  return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

interface Call {
  /** Signed distance to the deciding edge, ft (+ inside the zone). */
  m: number;
  strike: boolean;
}

/** Best single-threshold fit of a set of calls: how many a self-consistent zone explains. */
export function consistentCalls(calls: ReadonlyArray<Call>): number {
  const sorted = [...calls].sort((a, b) => a.m - b.m);
  // Threshold below everything: all called strikes are "right".
  let cur = sorted.reduce((n, c) => n + (c.strike ? 1 : 0), 0);
  let best = cur;
  for (const c of sorted) {
    cur += c.strike ? -1 : 1;
    if (cur > best) best = cur;
  }
  return best;
}

export interface CalledPitch {
  flight: PitchFlight;
  zoneBottom: number;
  zoneTop: number;
  /** Rulebook (ABS) zone. */
  inZone: boolean;
  /** The umpire's call. */
  strike: boolean;
  balls: number;
  strikes: number;
  inning: number;
  top: boolean;
}

/** Live tracker for one game. */
export class UmpTracker {
  private calls: Call[] = [];
  private ok = 0;
  private xa = 0;
  private fav = 0;
  private big: UmpMiss | undefined;

  record(p: CalledPitch): void {
    const { margin, nearSide } = umpireGeometry(
      p.flight,
      p.zoneBottom,
      p.zoneTop,
      p.inZone,
    );
    const correct = p.strike === p.inZone;
    this.calls.push({ m: margin, strike: p.strike });
    this.xa += normCdf(
      Math.abs(margin) / (nearSide ? UMP_SD_SIDE_FT : UMP_SD_HEIGHT_FT),
    );
    if (correct) {
      this.ok += 1;
      return;
    }
    const rv = callRunValue(p.balls, p.strikes);
    // A wrong strike helps the defense, a wrong ball the offense; the home club fields in the top.
    const helpsHome = p.strike === p.top;
    this.fav += helpsHome ? rv : -rv;
    const inches = Math.round(Math.abs(margin) * 120) / 10;
    if (!this.big || inches > this.big.in) {
      this.big = {
        in: inches,
        k: p.strike ? 1 : 0,
        c: `${p.balls}-${p.strikes}`,
        inn: p.inning,
        top: p.top ? 1 : 0,
        rv,
      };
    }
  }

  get called(): number {
    return this.calls.length;
  }

  card(): UmpCard {
    return {
      n: this.calls.length,
      ok: this.ok,
      xa: Math.round(this.xa * 10) / 10,
      con: consistentCalls(this.calls),
      fav: Math.round(this.fav * 100) / 100,
      big: this.big,
    };
  }
}

export interface Draws {
  next(): number;
  gauss(mean?: number, sd?: number): number;
}

/**
 * Calibration of simmed cards against played games (physics engine, CPU vs CPU):
 * share of pitches that are taken and called, the average umpire's miss rate, and how
 * much of an umpire's error is noise (inconsistent) versus a shifted zone.
 */
// Measured over 40 played games per profile: 153 calls a game (53% of pitches), average
// umpire 94.5% accurate vs 94.7% expected, 95.8% consistent (~75% of misses are noise);
// sd 0.85 → 95.1%, sd 1.25 → 93.6%; a shifted zone adds only a few misses.
export const SIM_CAL = {
  calledShare: 0.53,
  xMiss: 0.053,
  xMissSd: 0.009,
  consNoise: 0.76,
};

/** How many more misses than average an umpire's tendency produces (1 = average). */
export function missFactor(t: UmpTendency): number {
  return 1 + (t.sd - 1) * 0.65 + Math.abs(t.zone) * 2.5 + Math.abs(t.hi) * 3.5;
}

/** Strikeout / walk multipliers for a PA-level sim: a bigger zone means more Ks, fewer walks. */
export function zoneRateEffect(t: UmpTendency): { k: number; bb: number } {
  return { k: 1 + t.zone * 2, bb: 1 - t.zone * 4 };
}

/** A plausible scorecard for a simmed game: no pitches, so drawn from the umpire's profile. */
export function simUmpCard(
  t: UmpTendency,
  pitches: number,
  innings: number,
  rng: Draws,
): UmpCard {
  const n = Math.max(
    40,
    Math.round(pitches * SIM_CAL.calledShare + rng.gauss(0, 5)),
  );
  // Expected miss rate for these pitches (how borderline the game was).
  const xMiss = Math.min(
    0.1,
    Math.max(0.025, SIM_CAL.xMiss + rng.gauss(0, SIM_CAL.xMissSd)),
  );
  const pMiss = Math.min(0.2, xMiss * missFactor(t));
  let miss = 0;
  for (let i = 0; i < n; i += 1) if (rng.next() < pMiss) miss += 1;
  // Noise misses are inconsistent; misses from a shifted zone are consistent with it.
  const noiseShare = (1 + (t.sd - 1) * 0.65) / missFactor(t);
  const incons = Math.min(
    miss,
    Math.round(miss * noiseShare * SIM_CAL.consNoise + rng.gauss(0, 0.8)),
  );
  let fav = 0;
  let big: UmpMiss | undefined;
  for (let i = 0; i < miss; i += 1) {
    const balls = Math.floor(rng.next() * 4);
    const strikes = Math.floor(rng.next() * 3);
    const rv = callRunValue(balls, strikes);
    const k = rng.next() < 0.5 + Math.max(-0.3, Math.min(0.3, t.zone * 15));
    const top = rng.next() < 0.5;
    fav += k === top ? rv : -rv;
    // Misses are mostly within an inch or two of the edge, with a tail.
    const inches =
      Math.round(
        (0.3 - Math.log(Math.max(1e-6, rng.next())) * 0.6 * t.sd) * 10,
      ) / 10;
    if (!big || inches > big.in)
      big = {
        in: inches,
        k: k ? 1 : 0,
        c: `${balls}-${strikes}`,
        inn: 1 + Math.floor(rng.next() * Math.max(9, innings)),
        top: top ? 1 : 0,
        rv,
      };
  }
  return {
    n,
    ok: n - miss,
    xa: Math.round(n * (1 - xMiss) * 10) / 10,
    con: n - Math.max(0, incons),
    fav: Math.round(fav * 100) / 100,
    big,
    sim: 1,
  };
}

/** Season (or any) totals for one umpire. */
export interface UmpTotals {
  g: number;
  n: number;
  ok: number;
  xa: number;
  con: number;
  fav: number;
  /** Absolute favor (how much the misses mattered, whichever way). */
  absFav: number;
}

export const emptyTotals = (): UmpTotals => ({
  g: 0,
  n: 0,
  ok: 0,
  xa: 0,
  con: 0,
  fav: 0,
  absFav: 0,
});

export function addCard(t: UmpTotals, c: UmpCard): void {
  t.g += 1;
  t.n += c.n;
  t.ok += c.ok;
  t.xa += c.xa;
  t.con += c.con;
  t.fav += c.fav;
  t.absFav += Math.abs(c.fav);
}

export const pct = (num: number, den: number): number =>
  den > 0 ? num / den : 0;

export function describeMiss(m: UmpMiss): string {
  const call = m.k ? "Strike called" : "Ball called";
  const half = `${m.top ? "T" : "B"}${m.inn}`;
  return `${call} ${m.in.toFixed(1)}″ ${m.k ? "outside" : "inside"} the zone, ${m.c}, ${half}`;
}
