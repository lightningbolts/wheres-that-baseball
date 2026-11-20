/**
 * Franchise ("2027 Season") state. Everything is plain JSON so a league can be
 * saved to IndexedDB and restored exactly (the RNG state is a single number).
 */
import type { MLBDivision, MLBLeague } from "@/lib/mlb/teams";
import type { RosterTeam } from "@/lib/game/types";
import type { UmpCard, UmpTotals } from "@/lib/game/umpires/scorecard";

export type Pos = "C" | "1B" | "2B" | "3B" | "SS" | "LF" | "CF" | "RF" | "DH" | "SP" | "RP";
export const FIELD_SPOTS = ["C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "DH"] as const;
export type LineupPos = (typeof FIELD_SPOTS)[number];

/** Per-PA batting talent vs a league-average pitcher. */
export interface BatSkill {
  k: number;
  bb: number;
  hr: number;
  /** Hits per non-HR ball in play. */
  babip: number;
  /** Share of non-HR hits that go for extra bases. */
  xbh: number;
  /** Sprint speed, ft/s (league ≈ 27). */
  spd: number;
  /** Steal attempts per opportunity and success rate. */
  sbA: number;
  sbS: number;
  /** Fielding runs per 150 games at his primary position. */
  def: number;
}

/** Per-PA pitching talent vs a league-average batter. */
export interface PitSkill {
  k: number;
  bb: number;
  hr: number;
  babip: number;
  /** Typical pitch limit (≈ Statcast stamina: ~90 starters, ~25 relievers). */
  stam: number;
}

export type ContractKind = "pre" | "arb" | "fa" | "ext" | "minor";

export interface Contract {
  /** Salary per year, $M. */
  aav: number;
  /** Seasons remaining including the current one. */
  years: number;
  kind: ContractKind;
  /** Season the deal was signed (history only). */
  signed: number;
  /** Salary for each remaining guaranteed season, current season first (real deals; else flat `aav`). */
  salaries?: number[];
  /** Option on the season after the guaranteed years. */
  option?: ContractOption;
  /** Whole deal (real contracts): total value $M and length in seasons, for display. */
  total?: number;
  length?: number;
  /** From the real-contracts snapshot. */
  real?: boolean;
  /** Estimated at league creation for a real player missing from the snapshot. */
  est?: boolean;
}

export interface ContractOption {
  type: "team" | "player" | "mutual" | "vesting";
  /** Option-year salary and the buyout owed if it's declined, $M. */
  salary: number;
  buyout: number;
}

export interface Injury {
  days: number;
  desc: string;
  /** 10/15-day IL keep the player on the 40-man; 60-day frees the spot. */
  il: 10 | 15 | 60;
}

export interface BatLine {
  g: number;
  pa: number;
  ab: number;
  h: number;
  d: number;
  t: number;
  hr: number;
  r: number;
  rbi: number;
  bb: number;
  k: number;
  sb: number;
  cs: number;
  hbp: number;
  sf: number;
}

export interface PitLine {
  g: number;
  gs: number;
  w: number;
  l: number;
  sv: number;
  hld: number;
  bs: number;
  outs: number;
  h: number;
  r: number;
  er: number;
  bb: number;
  k: number;
  hr: number;
  bf: number;
  pit: number;
}

export type PlayerStatus = "active" | "minors" | "il" | "fa" | "retired";

export interface Player {
  id: number;
  name: string;
  /** Age during the current season. */
  age: number;
  bats: "L" | "R" | "S";
  throws: "L" | "R";
  pos: Pos;
  pitcher: boolean;
  /** Hits and pitches (both `bat` and `pit`): in the lineup and on the staff. */
  twoWay?: boolean;
  bat?: BatSkill;
  pit?: PitSkill;
  /** Talent at the start of the franchise (real players: physics data is scaled by cur/initial). */
  bat0?: BatSkill;
  pit0?: PitSkill;
  /** 20–80 scale. */
  ovr: number;
  pot: number;
  /** MLB service years (fractional). */
  service: number;
  options: number;
  optionedThisYear?: boolean;
  contract: Contract;
  /** 0 = free agent. */
  team: number;
  status: PlayerStatus;
  on40: boolean;
  injury?: Injury;
  /** Real MLBAM id from rosters.json (physics data); generated players borrow a template. */
  real: boolean;
  template?: number;
  /** Recent pitching: [day, pitches] newest last (relief fatigue). */
  pd?: Array<[number, number]>;
  lastStart?: number;
  /** Consecutive games caught (catchers rest). */
  streak?: number;
  /** Days on the active roster this season (service time). */
  mlbDays: number;
  stats: { bat?: BatLine; pit?: PitLine };
  /** This season's lines for clubs he left mid-season (stats above stay his full season). */
  splits?: Array<{ team: number; bat?: BatLine; pit?: PitLine }>;
  /** Postseason lines (not counted in regular-season leaders/awards). */
  post?: { bat?: BatLine; pit?: PitLine };
  history?: SeasonRecord[];
  /** Team before free agency (FA bookkeeping). */
  prevTeam?: number;
  rookie?: boolean;
  draft?: { season: number; round: number };
}

export interface SeasonRecord {
  season: number;
  team: number;
  bat?: BatLine;
  pit?: PitLine;
  ovr: number;
}

/** League batting rates per PA (babip per ball in play). */
export interface RateLine {
  k: number;
  bb: number;
  hr: number;
  babip: number;
}

export interface LineupSlot {
  id: number;
  pos: LineupPos;
}

export interface Finances {
  /** Running season ledger, $M. */
  gate: number;
  concessions: number;
  media: number;
  sponsorship: number;
  sharing: number;
  playoff: number;
  payroll: number;
  tax: number;
  operations: number;
  deadMoney: number;
  /** Home dates and total attendance this season. */
  homeGames: number;
  attendance: number;
  cash: number;
  /** Owner's payroll budget for the season, $M. */
  budget: number;
  /** 0–100. */
  ownerMood: number;
  /** Consecutive seasons over the CBT threshold (sets the tax rate). */
  cbtYears: number;
  history: Array<{ season: number; revenue: number; expenses: number; profit: number; payroll: number; tax: number; wins: number; attendance: number }>;
}

export type Strategy = "contend" | "neutral" | "rebuild";

export interface TeamState {
  id: number;
  abbrev: string;
  name: string;
  league: MLBLeague;
  division: MLBDivision;
  lineup: LineupSlot[];
  rotation: number[];
  rotIdx: number;
  closer: number | null;
  setup: number[];
  w: number;
  l: number;
  rs: number;
  ra: number;
  hw: number;
  hl: number;
  /** Last results, newest last ("W"/"L"). */
  last: string[];
  ticketPrice: number;
  strategy: Strategy;
  fin: Finances;
  dead: Array<{ aav: number; years: number; name: string }>;
}

export interface GameDecisions {
  wp?: number;
  lp?: number;
  sv?: number;
}

export interface ScheduledGame {
  id: number;
  day: number;
  away: number;
  home: number;
  /** Neutral or alternate venue (e.g. Field of Dreams), from the real schedule. */
  site?: string;
  /** Postseason series id. */
  ps?: string;
  /** Home-plate umpire (id in UMPIRES) and his crew's index for the season. */
  ump?: number;
  crew?: number;
  /** Plate umpire's scorecard (games played before umpires were tracked have none). */
  uc?: UmpCard;
  result?: {
    as: number;
    hs: number;
    inn: number;
    manual?: boolean;
    att?: number;
  } & GameDecisions;
}

export interface Series {
  id: string;
  round: "wc" | "ds" | "lcs" | "ws";
  league: MLBLeague | "MLB";
  hi: number;
  lo: number;
  hiSeed: number;
  loSeed: number;
  bestOf: number;
  wins: [number, number];
  winner?: number;
  games: number[];
}

export interface Bracket {
  seeds: Record<MLBLeague, number[]>;
  series: Series[];
  champion?: number;
  /** First day the next round may be played. */
  nextDay?: number;
}

export interface NewsItem {
  day: number;
  text: string;
  team?: number;
  kind?: "trade" | "injury" | "signing" | "roster" | "award" | "milestone" | "info";
}

export interface AwardPick {
  id: number;
  /** Club at the time of the award. */
  team: number;
  /** Selection score (WAR-like). */
  v: number;
  /** Stat line at the time of the award. */
  line: string;
  /** Ballot points (voted awards). */
  pts?: number;
}

export interface AllStarRoster {
  starters: Array<{ pos: string; id: number }>;
  reserves: number[];
  pitchers: number[];
}

export interface Awards {
  season: number;
  /** Winners (ids). */
  mvp: Record<MLBLeague, number>;
  cy: Record<MLBLeague, number>;
  roy: Record<MLBLeague, number>;
  /** Full voting results (seasons before ballots were tracked lack these). */
  ballots?: { mvp: Record<MLBLeague, AwardPick[]>; cy: Record<MLBLeague, AwardPick[]>; roy: Record<MLBLeague, AwardPick[]> };
  /** Mariano Rivera AL / Trevor Hoffman NL Reliever of the Year. */
  relief?: Partial<Record<MLBLeague, AwardPick>>;
  aaron?: Partial<Record<MLBLeague, AwardPick>>;
  silver?: Record<MLBLeague, Partial<Record<string, AwardPick>>>;
  gold?: Record<MLBLeague, Partial<Record<string, AwardPick>>>;
  allStar?: Record<MLBLeague, AllStarRoster>;
}

export interface FaOffer {
  team: number;
  aav: number;
  years: number;
  round: number;
}

export interface FaState {
  round: number;
  rounds: number;
  offers: Record<number, FaOffer[]>;
  /** Asking terms per free agent. */
  ask: Record<number, { aav: number; years: number }>;
}

export type Phase = "regular" | "postseason" | "offseason" | "freeagency" | "preseason";

export interface Calendar {
  /** UTC ms of day 0 (Opening Day). */
  start: number;
  /** Last regular-season day index. */
  endDay: number;
  asb: [number, number];
  deadlineDay: number;
}

export interface Settings {
  difficulty: "rookie" | "pro" | "allstar";
  /** Fill injuries / IL returns for the user automatically. */
  autoRoster: boolean;
}

export interface League {
  version: number;
  seed: number;
  rng: number;
  season: number;
  userTeam: number;
  day: number;
  phase: Phase;
  calendar: Calendar;
  players: Record<number, Player>;
  teams: Record<number, TeamState>;
  schedule: ScheduledGame[];
  bracket?: Bracket;
  news: NewsItem[];
  awards: Awards[];
  /** All-Star selections by season (made at the break). */
  allStars?: Record<number, Record<MLBLeague, AllStarRoster>>;
  champions: Array<{ season: number; team: number; runnerUp: number }>;
  fa?: FaState;
  nextId: number;
  nextGameId: number;
  settings: Settings;
  /** A manual game launched but not finished (resume / forfeit). */
  /**
   * A manual game in progress: its seed and the exact rosters it started with, so a
   * resumed game replays its saved inputs against the same teams even after roster moves.
   */
  pending?: { gameId: number; seed: number; away?: RosterTeam; home?: RosterTeam };
  /** Opening usage-weighted talent averages (keeps the run environment stable across seasons). */
  env?: { bat: { k: number; bb: number; hr: number }; pit: { k: number; bb: number; hr: number } };
  /** Realized league rates: the first season (target) and the latest, plus the running correction. */
  envRealized?: { base: RateLine; last: RateLine; adj: RateLine };
  /**
   * The winter before the first franchise season: the real free-agent market is open and
   * finishing it starts the first season (same year, schedule already built).
   */
  opening?: boolean;
  /** Preseason projected wins (owner expectations). */
  expected?: Record<number, number>;
  /** Umpire season totals for finished seasons (by umpire id). */
  umpHist?: Array<{ season: number; totals: Record<number, UmpTotals> }>;
  tradeLog: Array<{ day: number; season: number; a: number; b: number; aGets: number[]; bGets: number[] }>;
  /** Rating scale revision (2: pitchers graded on their own WAR spread). */
  gradeV?: number;
}

export const emptyBat = (): BatLine => ({ g: 0, pa: 0, ab: 0, h: 0, d: 0, t: 0, hr: 0, r: 0, rbi: 0, bb: 0, k: 0, sb: 0, cs: 0, hbp: 0, sf: 0 });
export const emptyPit = (): PitLine => ({ g: 0, gs: 0, w: 0, l: 0, sv: 0, hld: 0, bs: 0, outs: 0, h: 0, r: 0, er: 0, bb: 0, k: 0, hr: 0, bf: 0, pit: 0 });
