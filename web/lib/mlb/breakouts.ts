/** Shape of `data/breakouts/<season>.json`, written by `ml-engine/breakouts/build_breakouts.py`. */

export interface BreakoutMetricSet {
  auc: number;
  /** `p<N>`: share of the model's top N who actually hit the outcome the next season. */
  [topN: `p${number}`]: number;
}

export interface BreakoutBacktestSeason {
  season: number;
  outcomeSeason: number;
  cohort: number;
  breakouts: number;
  baseRate: number;
  model: BreakoutMetricSet;
  baselines: Record<string, BreakoutMetricSet>;
}

export interface BreakoutBacktest {
  /** Top-N cutoffs reported (breakout backtests use 10/25/50 and omit this). */
  topN?: number[];
  seasons: BreakoutBacktestSeason[];
  summary: {
    model: BreakoutMetricSet;
    baselines: Record<string, BreakoutMetricSet>;
    baseRate: number;
  };
}

export interface BreakoutComp {
  playerId: number;
  name: string;
  season: number;
  /** Comp's profile in `season`. */
  before: string;
  /** What the comp did in `season + 1`. */
  after: string;
}

/** Player-specific explanation shared by hitters and pitchers. */
export interface BreakoutExplanation {
  /** Strongest model drivers, each with a percentile vs. regulars. */
  drivers: string[];
  /** Extra Statcast/split detail not in the model (bat speed, new pitch, second half). */
  signals: string[];
  risk: string | null;
  /** What the player needs to do to clear the breakout bar. */
  bar: string;
  comp: BreakoutComp | null;
}

export interface BreakoutHitter extends BreakoutExplanation {
  rank: number;
  playerId: number;
  name: string;
  teamId: number | null;
  position: string | null;
  bats: string | null;
  age: number;
  probability: number;
  stats: {
    pa: number;
    woba: number | null;
    xwoba: number | null;
    barrelPct: number | null;
    ev50: number | null;
    kPct: number | null;
    bbPct: number | null;
    chasePct: number | null;
    hr: number | null;
  };
}

export interface BreakoutPitcher extends BreakoutExplanation {
  rank: number;
  playerId: number;
  name: string;
  teamId: number | null;
  role: "SP" | "RP" | "SP/RP";
  throws: string | null;
  age: number;
  probability: number;
  stats: {
    ip: string;
    era: number | null;
    xera: number | null;
    kPct: number | null;
    bbPct: number | null;
    kbbPct: number | null;
    whiffPct: number | null;
    xwoba: number | null;
    fbVelo: number | null;
    fbIvb: number | null;
    k: number | null;
  };
}

/** Ranked prospect with little or no MLB time, scored by the separate prospect model. */
export interface BreakoutProspect extends BreakoutExplanation {
  rank: number;
  playerId: number;
  name: string;
  teamId: number | null;
  position: string;
  age: number | null;
  probability: number;
  pipeline: { overall: number | null; org: number | null; eta: number | null; fv: number | null };
  /** Most recent minor-league line (Double-A and up when there is enough of it). */
  milb: {
    season: number;
    levels: string | null;
    pa?: number;
    ops?: number | null;
    iso?: number | null;
    hr?: number;
    sb?: number;
    ip?: string;
    era?: number;
    kbbPct?: number | null;
    k?: number;
    kPct?: number | null;
    bbPct?: number | null;
  };
}

export interface BreakoutAlreadyBrokeOut {
  playerId: number;
  name: string;
  why: string[];
}

export interface BreakoutReport {
  season: number;
  basedOnSeason: number;
  generatedAt: string;
  source: string;
  definitions: { hitter: string; pitcher: string; eligibility: string; prospects: string };
  backtest: {
    hitters: BreakoutBacktest;
    pitchers: BreakoutBacktest;
    prospectHitters: BreakoutBacktest;
    prospectPitchers: BreakoutBacktest;
  };
  prospects: { hitters: BreakoutProspect[]; pitchers: BreakoutProspect[] };
  alreadyBrokeOut: { hitters: BreakoutAlreadyBrokeOut[]; pitchers: BreakoutAlreadyBrokeOut[] };
  hitters: BreakoutHitter[];
  pitchers: BreakoutPitcher[];
}

/** Shape of `data/breakouts/<season>-turnarounds.json`, written by `ml-engine/breakouts/build_turnarounds.py`. */
export type TurnaroundKind = "regression" | "bounceback";

export interface TurnaroundHitter extends BreakoutExplanation {
  rank: number;
  playerId: number;
  name: string;
  teamId: number | null;
  position: string | null;
  bats: string | null;
  age: number;
  probability: number;
  stats: {
    pa: number;
    woba: number | null;
    xwoba: number | null;
    babip: number | null;
    slg: number | null;
    xslg: number | null;
    barrelPct: number | null;
    ev50: number | null;
    kPct: number | null;
    bbPct: number | null;
    hr: number | null;
    /** PA-weighted wOBA over the two prior seasons (null without enough history). */
    baseWoba: number | null;
    basePa: number;
  };
}

export interface TurnaroundPitcher extends BreakoutExplanation {
  rank: number;
  playerId: number;
  name: string;
  teamId: number | null;
  role: "SP" | "RP";
  throws: string | null;
  age: number;
  probability: number;
  stats: {
    ip: string;
    era: number | null;
    xera: number | null;
    babip: number | null;
    hr9: number | null;
    kbbPct: number | null;
    whiffPct: number | null;
    fbVelo: number | null;
    k: number | null;
    baseEra: number | null;
    baseIp: string | null;
  };
}

interface TurnaroundDefinition {
  hitter: string;
  pitcher: string;
  eligibility: string;
}

export interface TurnaroundReport {
  season: number;
  basedOnSeason: number;
  generatedAt: string;
  source: string;
  definitions: Record<TurnaroundKind, TurnaroundDefinition>;
  backtest: Record<TurnaroundKind, { hitters: BreakoutBacktest; pitchers: BreakoutBacktest }>;
  regression: { hitters: TurnaroundHitter[]; pitchers: TurnaroundPitcher[] };
  bounceback: { hitters: TurnaroundHitter[]; pitchers: TurnaroundPitcher[] };
}

export const BREAKOUT_BASELINE_LABELS: Record<string, string> = {
  wobaOverX: "“Lucky” (wOBA − xwOBA)",
  rawWoba: "Raw wOBA",
  eraUnderX: "“Lucky” (xERA − ERA)",
  rawEra: "Raw ERA",
  xOverWoba: "“Unlucky” (xwOBA − wOBA)",
  eraOverX: "“Unlucky” (ERA − xERA)",
  trackRecord: "Best track record",
  xwobaGap: "“Unlucky” (xwOBA − wOBA)",
  xwoba: "Raw xwOBA",
  eraMinusXera: "“Unlucky” (ERA − xERA)",
  kbb: "Raw K-BB%",
  pipelineRank: "Pipeline rank",
  orgRank: "Org rank",
};

/** `.343` style rate (no leading zero). */
export function formatRate3(value: number | null | undefined): string {
  if (value == null) return "—";
  return value.toFixed(3).replace(/^0/, "");
}

export function formatPct(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`;
}
