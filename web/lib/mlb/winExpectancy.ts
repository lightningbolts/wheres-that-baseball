/**
 * Win expectancy model based on Tom Tango's run-expectancy tables (2010–2015 era).
 * Ported from the reference implementation at:
 * https://gist.github.com/ericcolon/540e836c809bfac473b8edc55efa7122
 */

export interface WinExpectancyInput {
  inning: number;
  /** "top" (away batting) or "bottom" (home batting) */
  halfInning: string;
  outs: number;
  onFirst: boolean;
  onSecond: boolean;
  onThird: boolean;
  awayScore: number;
  homeScore: number;
}

type RunDistribution = Record<number, number> & { m?: number; b?: number };
type InningWinTable = Record<number, number>;
type RunExpectancyTable = Record<string, Record<number, number>>;

const TANGO_RUN_EXP: Record<string, RunDistribution> = {
  "60": { 1: 0.514, 2: 0.194, 3: 0.15, 4: 0.077, 5: 0.037, 6: 0.017, 7: 0.006, 8: 0.003, 9: 0.001, 10: 0.001, m: -0.216, b: 0.247 },
  "61": { 1: 0.596, 2: 0.176, 3: 0.132, 4: 0.057, 5: 0.024, 6: 0.009, 7: 0.004, 8: 0.001, 9: 0, 10: 0, m: -0.116, b: 0.406 },
  "62": { 1: 0.559, 2: 0.206, 3: 0.158, 4: 0.052, 5: 0.017, 6: 0.005, 7: 0.002, 8: 0.001, 9: 0, 10: 0, m: -0.199, b: 0.828 },
  "82": { 1: 0.273, 2: 0.355, 3: 0.17, 4: 0.138, 5: 0.041, 6: 0.015, 7: 0.005, 8: 0.001, 9: 0, 10: 0, m: -0.209, b: 0.789 },
  "80": { 1: 0.311, 2: 0.247, 3: 0.17, 4: 0.144, 5: 0.071, 6: 0.031, 7: 0.013, 8: 0.008, 9: 0.003, 10: 0.002, m: -0.127, b: 0.193 },
  "81": { 1: 0.397, 2: 0.244, 3: 0.151, 4: 0.123, 5: 0.051, 6: 0.021, 7: 0.008, 8: 0.003, 9: 0.001, 10: 0, m: -0.142, b: 0.402 },
  "20": { 1: 0.424, 2: 0.299, 3: 0.15, 4: 0.072, 5: 0.032, 6: 0.013, 7: 0.005, 8: 0.002, 9: 0.001, 10: 0, m: -0.278, b: 0.716 },
  "21": { 1: 0.444, 2: 0.326, 3: 0.137, 4: 0.056, 5: 0.022, 6: 0.009, 7: 0.003, 8: 0.001, 9: 0, 10: 0, m: -0.268, b: 0.863 },
  "22": { 1: 0.453, 2: 0.374, 3: 0.116, 4: 0.039, 5: 0.012, 6: 0.005, 7: 0.001, 8: 0, 9: 0, 10: 0, m: -0.194, b: 0.974 },
  "42": { 1: 0.494, 2: 0.237, 3: 0.181, 4: 0.06, 5: 0.018, 6: 0.007, 7: 0.002, 8: 0.001, 9: 0, 10: 0, m: -0.144, b: 0.841 },
  "40": { 1: 0.362, 2: 0.256, 3: 0.194, 4: 0.104, 5: 0.048, 6: 0.02, 7: 0.009, 8: 0.004, 9: 0.002, 10: 0.001, m: -0.167, b: 0.45 },
  "41": { 1: 0.401, 2: 0.258, 3: 0.203, 4: 0.083, 5: 0.034, 6: 0.013, 7: 0.005, 8: 0.002, 9: 0.001, 10: 0, m: -0.174, b: 0.669 },
  "72": { 1: 0.185, 2: 0.548, 3: 0.169, 4: 0.067, 5: 0.023, 6: 0.006, 7: 0.002, 8: 0, 9: 0, 10: 0, m: -0.095, b: 0.785 },
  "71": { 1: 0.413, 2: 0.328, 3: 0.138, 4: 0.073, 5: 0.029, 6: 0.011, 7: 0.005, 8: 0.002, 9: 0.001, 10: 0, m: -0.311, b: 0.478 },
  "70": { 1: 0.315, 2: 0.356, 3: 0.168, 4: 0.086, 5: 0.044, 6: 0.018, 7: 0.007, 8: 0.004, 9: 0.002, 10: 0, m: -0.229, b: 0.261 },
  "11": { 1: 0.6, 2: 0.243, 3: 0.097, 4: 0.037, 5: 0.014, 6: 0.006, 7: 0.002, 8: 0.001, 9: 0, 10: 0, m: -0.296, b: 0.988 },
  "12": { 1: 0.673, 2: 0.222, 3: 0.071, 4: 0.023, 5: 0.007, 6: 0.002, 7: 0.001, 8: 0, 9: 0, 10: 0, m: -0.163, b: 1.014 },
  "32": { 1: 0.686, 2: 0.204, 3: 0.073, 4: 0.025, 5: 0.008, 6: 0.002, 7: 0.001, 8: 0, 9: 0, 10: 0, m: -0.107, b: 0.832 },
  "31": { 1: 0.594, 2: 0.234, 3: 0.104, 4: 0.042, 5: 0.017, 6: 0.006, 7: 0.003, 8: 0.001, 9: 0, 10: 0, m: -0.191, b: 0.693 },
  "30": { 1: 0.566, 2: 0.226, 3: 0.114, 4: 0.053, 5: 0.023, 6: 0.01, 7: 0.004, 8: 0.002, 9: 0.001, 10: 0, m: -0.358, b: 0.559 },
  "51": { 1: 0.737, 2: 0.152, 3: 0.067, 4: 0.027, 5: 0.011, 6: 0.004, 7: 0.001, 8: 0.001, 9: 0, 10: 0, m: -0.27, b: 0.477 },
  "50": { 1: 0.654, 2: 0.185, 3: 0.089, 4: 0.041, 5: 0.018, 6: 0.008, 7: 0.003, 8: 0.001, 9: 0.001, 10: 0, m: -0.37, b: 0.355 },
  "52": { 1: 0.732, 2: 0.177, 3: 0.06, 4: 0.021, 5: 0.007, 6: 0.002, 7: 0.001, 8: 0, 9: 0, 10: 0, m: -0.047, b: 0.763 },
};

const DEFAULT_RUNS_PER_GAME = 4.5;

let cachedTables: {
  runsPerGame: number;
  inningWin: Record<string, InningWinTable>;
  runExp: RunExpectancyTable;
} | null = null;

/** Encode runners-on-base as 1–8 (empty through loaded). */
export function encodeBaseState(onFirst: boolean, onSecond: boolean, onThird: boolean): number {
  if (onFirst && onSecond && onThird) return 8;
  if (!onFirst && onSecond && onThird) return 7;
  if (onFirst && !onSecond && onThird) return 6;
  if (!onFirst && !onSecond && onThird) return 5;
  if (onFirst && onSecond && !onThird) return 4;
  if (!onFirst && onSecond && !onThird) return 3;
  if (onFirst && !onSecond && !onThird) return 2;
  return 1;
}

function halfInningCode(halfInning: string): 1 | 2 {
  return halfInning.toLowerCase().startsWith("bot") ? 2 : 1;
}

function runsInInning(runsPerInning: number): Record<number, number> {
  const denom = runsPerInning * 0.761 + 1;
  const dist: Record<number, number> = {
    0: 1 / denom,
    1: (runsPerInning * 0.761 ** 2) / denom ** 2,
  };
  for (let runs = 2; runs <= 10; runs += 1) {
    dist[runs] =
      (runsPerInning * 0.761 ** 2 * (runsPerInning * 0.761 - 0.761 + 1) ** (runs - 1)) /
      denom ** (runs + 1);
  }
  return dist;
}

function buildRunExpectancy(runsPerGame: number): RunExpectancyTable {
  const runsPerInning = runsPerGame / 9;
  const inningRuns = runsInInning(runsPerInning);
  const runExp: RunExpectancyTable = { "10": { ...inningRuns } };

  for (let outs = 0; outs <= 2; outs += 1) {
    for (let base = 1; base <= 8; base += 1) {
      const key = `${base}${outs}`;
      if (key === "10") continue;
      const coeffs = TANGO_RUN_EXP[key];
      if (!coeffs?.m || coeffs.b == null) continue;

      const zeroRuns = coeffs.m * runsPerInning + coeffs.b;
      runExp[key] = { 0: zeroRuns };
      for (let runs = 1; runs <= 10; runs += 1) {
        runExp[key][runs] = (1 - zeroRuns) * (coeffs[runs] ?? 0);
      }
    }
  }

  return runExp;
}

function buildInningWinExpectancy(runExp: RunExpectancyTable): Record<string, InningWinTable> {
  const innWin: Record<string, InningWinTable> = {
    "101": { 0: 0.5 },
  };

  for (let diff = -25; diff < 0; diff += 1) innWin["101"][diff] = 0;
  for (let diff = 1; diff <= 25; diff += 1) innWin["101"][diff] = 1;

  for (let inning = 9; inning >= 1; inning -= 1) {
    for (let half = 2; half >= 1; half -= 1) {
      const thisKey = `${inning}${half}`;
      const nextKey = half === 2 ? `${inning + 1}1` : `${inning}2`;
      innWin[thisKey] = {};

      if (half === 2) {
        for (let diff = -25; diff <= 25; diff += 1) {
          if (inning === 9 && diff > 0) {
            innWin[thisKey][diff] = 1;
            continue;
          }
          let probability = 0;
          for (let runs = 0; runs <= 10; runs += 1) {
            const nextDiff = diff + runs;
            const nextWin =
              nextDiff > 25 ? 1 : nextDiff < -25 ? 0 : (innWin[nextKey]?.[nextDiff] ?? 0);
            probability += (runExp["10"]?.[runs] ?? 0) * nextWin;
          }
          innWin[thisKey][diff] = probability;
        }
      } else {
        for (let diff = -25; diff <= 25; diff += 1) {
          let probability = 0;
          for (let runs = 0; runs <= 10; runs += 1) {
            const nextDiff = diff - runs;
            const nextWin =
              nextDiff < -25 ? 0 : nextDiff > 25 ? 1 : (innWin[nextKey]?.[nextDiff] ?? 0);
            probability += (runExp["10"]?.[runs] ?? 0) * nextWin;
          }
          innWin[thisKey][diff] = probability;
        }
      }
    }
  }

  return innWin;
}

function getTables(runsPerGame = DEFAULT_RUNS_PER_GAME) {
  if (cachedTables && cachedTables.runsPerGame === runsPerGame) {
    return cachedTables;
  }

  const runExp = buildRunExpectancy(runsPerGame);
  const inningWin = buildInningWinExpectancy(runExp);
  cachedTables = { runsPerGame, inningWin, runExp };
  return cachedTables;
}

function lookupWinExpectancy(
  inningWin: Record<string, InningWinTable>,
  runExp: RunExpectancyTable,
  inning: number,
  half: 1 | 2,
  base: number,
  outs: number,
  runDiff: number,
): number {
  const cappedInning = Math.min(Math.max(inning, 1), 9);
  const cappedOuts = Math.min(Math.max(outs, 0), 2);
  const cappedDiff = Math.max(-25, Math.min(25, runDiff));
  const innKey = `${cappedInning}${half}`;
  const sitKey = `${base}${cappedOuts}`;
  const nextKey = half === 2 ? `${cappedInning + 1}1` : `${cappedInning}2`;

  if (sitKey === "10") {
    return inningWin[innKey]?.[cappedDiff] ?? 0.5;
  }

  const distribution = runExp[sitKey];
  if (!distribution) {
    return inningWin[innKey]?.[cappedDiff] ?? 0.5;
  }

  if (half === 1) {
    let probability = 0;
    for (let runs = 10; runs >= 0; runs -= 1) {
      const nextDiff = cappedDiff - runs;
      const nextWin =
        nextDiff < -25 ? 0 : nextDiff > 25 ? 1 : (inningWin[nextKey]?.[nextDiff] ?? 0);
      probability += (distribution[runs] ?? 0) * nextWin;
    }
    return probability;
  }

  let probability = 0;
  for (let runs = 0; runs <= 10; runs += 1) {
    const nextDiff = cappedDiff + runs;
    const nextWin =
      nextDiff < -25 ? 0 : nextDiff > 25 ? 1 : (inningWin[nextKey]?.[nextDiff] ?? 0);
    probability += (distribution[runs] ?? 0) * nextWin;
  }
  return probability;
}

/** Home-team win probability (0–1) for a game situation. */
export function homeWinProbability(
  input: WinExpectancyInput,
  runsPerGame = DEFAULT_RUNS_PER_GAME,
): number {
  const { inningWin, runExp } = getTables(runsPerGame);
  const half = halfInningCode(input.halfInning);
  const base = encodeBaseState(input.onFirst, input.onSecond, input.onThird);
  const runDiff = input.homeScore - input.awayScore;

  return lookupWinExpectancy(
    inningWin,
    runExp,
    input.inning,
    half,
    base,
    input.outs,
    runDiff,
  );
}

/**
 * Expected runs remaining in the half-inning from a base-out state (RE24 mean).
 * Uses the Tango run-expectancy distribution for the encoded base/outs key.
 */
export function expectedRunsRemaining(
  onFirst: boolean,
  onSecond: boolean,
  onThird: boolean,
  outs: number,
  runsPerGame = DEFAULT_RUNS_PER_GAME,
): number {
  const { runExp } = getTables(runsPerGame);
  const base = encodeBaseState(onFirst, onSecond, onThird);
  const cappedOuts = Math.min(Math.max(outs, 0), 2);
  const distribution = runExp[`${base}${cappedOuts}`];
  if (!distribution) return 0;

  let expected = 0;
  for (let runs = 0; runs <= 10; runs += 1) {
    expected += runs * (distribution[runs] ?? 0);
  }
  return expected;
}

/** Decode encodeBaseState (1–8) back to first/second/third occupancy. */
export function decodeBaseState(base: number): {
  onFirst: boolean;
  onSecond: boolean;
  onThird: boolean;
} {
  switch (base) {
    case 8:
      return { onFirst: true, onSecond: true, onThird: true };
    case 7:
      return { onFirst: false, onSecond: true, onThird: true };
    case 6:
      return { onFirst: true, onSecond: false, onThird: true };
    case 5:
      return { onFirst: false, onSecond: false, onThird: true };
    case 4:
      return { onFirst: true, onSecond: true, onThird: false };
    case 3:
      return { onFirst: false, onSecond: true, onThird: false };
    case 2:
      return { onFirst: true, onSecond: false, onThird: false };
    default:
      return { onFirst: false, onSecond: false, onThird: false };
  }
}
