/**
 * Per-game box score and play-by-play for franchise games (Baseball-Reference style).
 *
 * A season is ~2,430 games, so the log is compact: batting and pitching lines as number
 * tuples, and each play packed into one integer (half-inning, batter, pitcher, result,
 * runs, outs and runners after). Descriptions are written at display time. Games played
 * by hand in the ballpark keep the engine's own play text instead.
 */

/** [id, pos, ab, r, h, rbi, bb, k, hr, 2b, 3b, sb, cs, hbp, sf] in batting order. */
export type BoxBat = [number, string, number, number, number, number, number, number, number, number, number, number, number, number, number];
/** [id, outs, h, r, er, bb, k, hr, pitches, bf] in order of appearance. */
export type BoxPit = [number, number, number, number, number, number, number, number, number, number];

export interface GameBox {
  /** Batters per side [away, home], batting order (subs follow the starter they replaced). */
  bat: [BoxBat[], BoxBat[]];
  pit: [BoxPit[], BoxPit[]];
  /** Plays, packed (see packPlay). Batter = index into the batting side's bat list, pitcher into the fielding side's pit list. */
  pbp: number[];
  /** Hand-played games: the engine's play text, by play index. */
  txt?: string[];
  /** Hand-played games don't track runners on base per play. */
  manual?: true;
  /** Hand-played games: runs by inning from the engine (some runs score between logged plays). */
  line?: [number[], number[]];
}

export const PLAY = {
  K: 0,
  BB: 1,
  HBP: 2,
  S: 3,
  D: 4,
  T: 5,
  HR: 6,
  E: 7,
  GDP: 8,
  FC: 9,
  GO: 10,
  FO: 11,
  SF: 12,
  SB: 13,
  CS: 14,
  WP: 15,
  PO: 16,
  OUT: 17,
  /** Runners move up (balk, pickoff error). */
  ADV: 18,
} as const;
export type PlayCode = (typeof PLAY)[keyof typeof PLAY];

export interface Play {
  inning: number;
  bottom: boolean;
  batter: number;
  pitcher: number;
  code: PlayCode;
  runs: number;
  outs: number;
  /** Runners after the play: bit 0 = first, 1 = second, 2 = third. */
  bases: number;
}

export function packPlay(p: Play): number {
  const half = (p.inning - 1) * 2 + (p.bottom ? 1 : 0);
  return (
    Math.min(127, half) +
    Math.min(31, p.batter) * 2 ** 7 +
    Math.min(15, p.pitcher) * 2 ** 12 +
    p.code * 2 ** 16 +
    Math.min(7, p.runs) * 2 ** 21 +
    Math.min(3, p.outs) * 2 ** 24 +
    (p.bases & 7) * 2 ** 26
  );
}

export function unpackPlay(v: number): Play {
  const bits = (shift: number, n: number) => Math.floor(v / 2 ** shift) % 2 ** n;
  const half = bits(0, 7);
  return {
    inning: Math.floor(half / 2) + 1,
    bottom: half % 2 === 1,
    batter: bits(7, 5),
    pitcher: bits(12, 4),
    code: bits(16, 5) as PlayCode,
    runs: bits(21, 3),
    outs: bits(24, 2),
    bases: bits(26, 3),
  };
}

/** Runs by inning [away, home] from the plays; the home half not played (home ahead) is null. */
export function lineScore(box: GameBox): [Array<number | null>, Array<number | null>] {
  if (box.line) {
    const n = Math.max(box.line[0].length, box.line[1].length);
    return [Array.from({ length: n }, (_, i) => box.line![0][i] ?? 0), Array.from({ length: n }, (_, i) => box.line![1][i] ?? null)];
  }
  const away: Array<number | null> = [];
  const home: Array<number | null> = [];
  let last = 0;
  for (const v of box.pbp) {
    const p = unpackPlay(v);
    const side = p.bottom ? home : away;
    while (side.length < p.inning) side.push(0);
    side[p.inning - 1] = (side[p.inning - 1] ?? 0) + p.runs;
    last = Math.max(last, p.inning);
  }
  while (away.length < last) away.push(0);
  while (home.length < last) home.push(null);
  return [away, home];
}

/** Errors charged to each side's defense [away, home] (reached on error). */
export function errors(box: GameBox): [number, number] {
  const e: [number, number] = [0, 0];
  for (const v of box.pbp) {
    const p = unpackPlay(v);
    if (p.code === PLAY.E) e[p.bottom ? 0 : 1] += 1;
  }
  return e;
}

// ---------------------------------------------------------------------------
// Descriptions

/** Deterministic pick from the play itself (no dice: the sim's random stream is untouched). */
function pick<T>(seed: number, xs: readonly T[]): T {
  const s = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return xs[Math.floor((s - Math.floor(s)) * xs.length)];
}

const GROUND = ["6-3", "4-3", "5-3", "3U", "1-3", "6-3", "4-3"] as const;
const AIR = ["Flyball: CF", "Flyball: LF", "Flyball: RF", "Lineout: SS", "Popfly: 2B", "Lineout: 3B", "Popfly: C", "Flyball: CF"] as const;
const SINGLE = ["Single to LF (Ground Ball)", "Single to CF (Line Drive)", "Single to RF (Ground Ball)", "Single to LF (Line Drive)", "Single to SS (Ground Ball)", "Single to CF (Ground Ball)"] as const;
const DOUBLE = ["Double to LF (Line Drive)", "Double to CF (Fly Ball)", "Double to RF (Line Drive)", "Ground-rule Double (Fly Ball to LF)"] as const;
const TRIPLE = ["Triple to RF (Line Drive)", "Triple to CF (Fly Ball)", "Triple to LF (Line Drive)"] as const;
const HOMER = ["Home Run (Fly Ball to LF)", "Home Run (Fly Ball to CF)", "Home Run (Fly Ball to RF)", "Home Run (Line Drive to LF)"] as const;

/** Baseball-Reference style play description (without runner movement). */
export function describePlay(p: Play, seed: number): string {
  switch (p.code) {
    case PLAY.K:
      return pick(seed, ["Strikeout Swinging", "Strikeout Looking", "Strikeout Swinging"]);
    case PLAY.BB:
      return "Walk";
    case PLAY.HBP:
      return "Hit By Pitch";
    case PLAY.S:
      return pick(seed, SINGLE);
    case PLAY.D:
      return pick(seed, DOUBLE);
    case PLAY.T:
      return pick(seed, TRIPLE);
    case PLAY.HR:
      return p.runs > 1 ? `${pick(seed, HOMER)}; ${p.runs} runs score` : pick(seed, HOMER);
    case PLAY.E:
      return `Reached on E${pick(seed, ["6", "5", "4", "3", "8"])} (Ground Ball)`;
    case PLAY.GDP:
      return `Ground Ball Double Play: ${pick(seed, ["6-4-3", "4-6-3", "5-4-3", "6-3"])}`;
    case PLAY.FC:
      return `Fielder's Choice ${pick(seed, ["6", "4", "5"])}; Runner forced out`;
    case PLAY.GO:
      return `Groundout: ${pick(seed, GROUND)}`;
    case PLAY.FO:
      return pick(seed, AIR);
    case PLAY.SF:
      return `Sacrifice Fly: ${pick(seed, ["CF", "LF", "RF"])}`;
    case PLAY.SB:
      return "Stolen Base";
    case PLAY.CS:
      return "Caught Stealing";
    case PLAY.WP:
      return "Wild Pitch";
    case PLAY.PO:
      return "Pickoff";
    case PLAY.ADV:
      return "Runners advance";
    default:
      return "Out";
  }
}

/** Plate appearances (steals, pickoffs and wild pitches happen between them). */
export const isPA = (c: PlayCode): boolean => c !== PLAY.SB && c !== PLAY.CS && c !== PLAY.WP && c !== PLAY.PO && c !== PLAY.ADV;
