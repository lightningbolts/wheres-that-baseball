/**
 * Season Statcast leaderboards for a franchise, built from every game's pitch log (played
 * games' tracked pitches, simmed games' replays): Baseball Savant-style quality of contact
 * and plate discipline for hitters, stuff and results for pitchers, a pitch-arsenal board,
 * and the season's standout batted balls and pitches.
 */
import type { PitchRecord } from "@/lib/game/stats/pitchLog";
import { isSweetSpot } from "@/lib/game/stats/gameSummary";
import { getSeasonGameLogs, type GameLog } from "./gamelog";
import { simPitchLog, type PitchLogPlayer } from "./pitchReplay";
import { profile, type Def, type Metric } from "./statcast";
import type { League } from "./types";

const FASTBALL = new Set(["FF", "FA", "SI"]);

export interface ScBat {
  id: number;
  pitches: number;
  pa: number;
  swings: number;
  whiffs: number;
  outZone: number;
  chases: number;
  bbe: number;
  evSum: number;
  evMax: number;
  laSum: number;
  hardHit: number;
  barrels: number;
  sweetSpot: number;
  hrs: number;
  hrDistMax: number;
}

export interface ScPit {
  id: number;
  pitches: number;
  swings: number;
  whiffs: number;
  called: number;
  inZone: number;
  outZone: number;
  chases: number;
  ks: number;
  bbe: number;
  evSum: number;
  hardHit: number;
  barrels: number;
  fbN: number;
  fbVeloSum: number;
  veloMax: number;
  ffN: number;
  ffSpinSum: number;
}

/** One pitcher's pitch type over the season. */
export interface ScArsenal {
  key: string;
  id: number;
  type: string;
  n: number;
  /** Share of the pitcher's pitches, 0..1 (set by finish()). */
  usage: number;
  veloSum: number;
  veloMax: number;
  spinSum: number;
  ivbSum: number;
  hbSum: number;
  swings: number;
  whiffs: number;
  called: number;
  ks: number;
  bbe: number;
  evSum: number;
  hardHit: number;
}

/** A single notable pitch (hardest hit, longest homer, fastest pitch). */
export interface ScMoment {
  p: PitchRecord;
  gameId: number;
  day: number;
  away: number;
  home: number;
}

export interface ScTops {
  hardestHit: ScMoment[];
  longestHr: ScMoment[];
  fastest: ScMoment[];
}

export interface SeasonStatcast extends ScTops {
  games: number;
  pitches: number;
  bat: Map<number, ScBat>;
  pit: Map<number, ScPit>;
  arsenal: Map<string, ScArsenal>;
  /** Each club's own top plays (its hitters' batted balls, its pitchers' pitches). */
  team: Map<number, ScTops>;
}

const TOP = 25;

export function emptySeasonStatcast(): SeasonStatcast {
  return { games: 0, pitches: 0, bat: new Map(), pit: new Map(), arsenal: new Map(), hardestHit: [], longestHr: [], fastest: [], team: new Map() };
}

/** Keep the top `TOP` by score; cheap while lists are short and inserts rare. */
function keepTop(list: ScMoment[], m: ScMoment, score: (p: PitchRecord) => number): void {
  const s = score(m.p);
  if (list.length >= TOP && s <= score(list[list.length - 1].p)) return;
  let i = list.length;
  while (i > 0 && score(list[i - 1].p) < s) i -= 1;
  list.splice(i, 0, m);
  if (list.length > TOP) list.pop();
}

function topsOf(sc: SeasonStatcast, team: number): ScTops {
  let t = sc.team.get(team);
  if (!t) {
    t = { hardestHit: [], longestHr: [], fastest: [] };
    sc.team.set(team, t);
  }
  return t;
}

const evOf = (x: PitchRecord) => x.ev ?? 0;
const distOf = (x: PitchRecord) => x.dist ?? 0;
const mphOf = (x: PitchRecord) => x.mph;

function batOf(sc: SeasonStatcast, id: number): ScBat {
  let b = sc.bat.get(id);
  if (!b) {
    b = { id, pitches: 0, pa: 0, swings: 0, whiffs: 0, outZone: 0, chases: 0, bbe: 0, evSum: 0, evMax: 0, laSum: 0, hardHit: 0, barrels: 0, sweetSpot: 0, hrs: 0, hrDistMax: 0 };
    sc.bat.set(id, b);
  }
  return b;
}

function pitOf(sc: SeasonStatcast, id: number): ScPit {
  let p = sc.pit.get(id);
  if (!p) {
    p = { id, pitches: 0, swings: 0, whiffs: 0, called: 0, inZone: 0, outZone: 0, chases: 0, ks: 0, bbe: 0, evSum: 0, hardHit: 0, barrels: 0, fbN: 0, fbVeloSum: 0, veloMax: 0, ffN: 0, ffSpinSum: 0 };
    sc.pit.set(id, p);
  }
  return p;
}

function arsOf(sc: SeasonStatcast, id: number, type: string): ScArsenal {
  const key = `${id}:${type}`;
  let a = sc.arsenal.get(key);
  if (!a) {
    a = { key, id, type, n: 0, usage: 0, veloSum: 0, veloMax: 0, spinSum: 0, ivbSum: 0, hbSum: 0, swings: 0, whiffs: 0, called: 0, ks: 0, bbe: 0, evSum: 0, hardHit: 0 };
    sc.arsenal.set(key, a);
  }
  return a;
}

/** Fold one game's pitches into the season. */
export function addGamePitches(sc: SeasonStatcast, pitches: PitchRecord[], game: { id: number; day: number; away: number; home: number }): void {
  sc.games += 1;
  for (const p of pitches) {
    sc.pitches += 1;
    const b = batOf(sc, p.batterId);
    const t = pitOf(sc, p.pitcherId);
    const a = arsOf(sc, p.pitcherId, p.type);
    const m: ScMoment = { p, gameId: game.id, day: game.day, away: game.away, home: game.home };
    const batTops = topsOf(sc, p.top ? game.away : game.home);
    b.pitches += 1;
    t.pitches += 1;
    a.n += 1;
    a.veloSum += p.mph;
    a.veloMax = Math.max(a.veloMax, p.mph);
    a.spinSum += p.spinRpm;
    a.ivbSum += p.ivb;
    a.hbSum += p.hb;
    t.veloMax = Math.max(t.veloMax, p.mph);
    if (FASTBALL.has(p.type)) {
      t.fbN += 1;
      t.fbVeloSum += p.mph;
    }
    if (p.type === "FF") {
      t.ffN += 1;
      t.ffSpinSum += p.spinRpm;
    }
    if (p.paResult != null) b.pa += 1;
    if (p.paResult === "Strikeout") {
      t.ks += 1;
      a.ks += 1;
    }
    if (p.inZone) t.inZone += 1;
    else {
      t.outZone += 1;
      b.outZone += 1;
      if (p.swing) {
        t.chases += 1;
        b.chases += 1;
      }
    }
    if (p.swing) {
      b.swings += 1;
      t.swings += 1;
      a.swings += 1;
    }
    if (p.whiff) {
      b.whiffs += 1;
      t.whiffs += 1;
      a.whiffs += 1;
    }
    if (p.called) {
      t.called += 1;
      a.called += 1;
    }
    if (p.inPlay && p.ev != null) {
      const ev = p.ev;
      b.bbe += 1;
      b.evSum += ev;
      b.evMax = Math.max(b.evMax, ev);
      b.laSum += p.la ?? 0;
      t.bbe += 1;
      t.evSum += ev;
      a.bbe += 1;
      a.evSum += ev;
      if (p.hardHit) {
        b.hardHit += 1;
        t.hardHit += 1;
        a.hardHit += 1;
      }
      if (p.barrel) {
        b.barrels += 1;
        t.barrels += 1;
      }
      if (p.la != null && isSweetSpot(p.la)) b.sweetSpot += 1;
      if (p.hit === 4) b.hrs += 1;
      if (p.hit === 4 && p.dist != null) {
        b.hrDistMax = Math.max(b.hrDistMax, p.dist);
        keepTop(sc.longestHr, m, distOf);
        keepTop(batTops.longestHr, m, distOf);
      }
      keepTop(sc.hardestHit, m, evOf);
      keepTop(batTops.hardestHit, m, evOf);
    }
    keepTop(sc.fastest, m, mphOf);
    keepTop(topsOf(sc, p.top ? game.home : game.away).fastest, m, mphOf);
  }
}

/** Usage shares once every game is in. */
export function finishSeasonStatcast(sc: SeasonStatcast): SeasonStatcast {
  for (const a of sc.arsenal.values()) a.usage = a.n / Math.max(1, sc.pit.get(a.id)?.pitches ?? a.n);
  return sc;
}

const div = (a: number, b: number): number | null => (b > 0 ? a / b : null);

/** Rates for the tables (null = nothing to divide by). */
export const batRates = (b: ScBat) => ({
  ev: div(b.evSum, b.bbe),
  la: div(b.laSum, b.bbe),
  hardHitPct: div(b.hardHit, b.bbe),
  barrelPct: div(b.barrels, b.bbe),
  barrelPa: div(b.barrels, b.pa),
  sweetSpotPct: div(b.sweetSpot, b.bbe),
  swingPct: div(b.swings, b.pitches),
  whiffPct: div(b.whiffs, b.swings),
  chasePct: div(b.chases, b.outZone),
});

export const pitRates = (p: ScPit) => ({
  fbVelo: div(p.fbVeloSum, p.fbN),
  ffSpin: div(p.ffSpinSum, p.ffN),
  whiffPct: div(p.whiffs, p.swings),
  cswPct: div(p.called + p.whiffs, p.pitches),
  chasePct: div(p.chases, p.outZone),
  zonePct: div(p.inZone, p.pitches),
  evAgainst: div(p.evSum, p.bbe),
  hardHitPct: div(p.hardHit, p.bbe),
  barrelPct: div(p.barrels, p.bbe),
});

export const arsenalRates = (a: ScArsenal) => ({
  velo: a.veloSum / a.n,
  spin: a.spinSum / a.n,
  ivb: a.ivbSum / a.n,
  hb: a.hbSum / a.n,
  whiffPct: div(a.whiffs, a.swings),
  cswPct: (a.called + a.whiffs) / a.n,
  evAgainst: div(a.evSum, a.bbe),
  hardHitPct: div(a.hardHit, a.bbe),
});

// ------------------------------------------------------------------ building a season

export type ScSplit = "reg" | "post";

/** Every regular season has 2,430 games, numbered from 1; postseason games are numbered after them. */
export const REGULAR_SEASON_GAMES = 2430;

/**
 * Postseason game? Logs from before the flag don't say, but game numbers do: postseason
 * games come after the regular schedule's (the current schedule's own count, else 2,430).
 */
export function psLookup(league: League, season: number): (log: GameLog) => boolean {
  const regular = season === league.season ? league.schedule.filter((g) => !g.ps).length || REGULAR_SEASON_GAMES : REGULAR_SEASON_GAMES;
  return (log) => log.ps ?? log.id > regular;
}

/** One game's pitches: its own tracked ones, else the replay. */
export function gamePitches(log: GameLog, who: (id: number) => PitchLogPlayer): PitchRecord[] {
  return log.pitches ?? simPitchLog(log, who)?.pitches ?? [];
}

/** The whole season at once (tests; the app builds it in slices with buildSeasonStatcast). */
export function seasonStatcastFromLogs(logs: GameLog[], who: (id: number) => PitchLogPlayer, keep: (log: GameLog) => boolean = () => true): SeasonStatcast {
  const sc = emptySeasonStatcast();
  for (const log of logs) if (keep(log)) addGamePitches(sc, gamePitches(log, who), log);
  return finishSeasonStatcast(sc);
}

const cache = new Map<string, SeasonStatcast>();

/** Forget every built season (a save slot was replaced or deleted). */
export function clearSeasonStatcastCache(): void {
  cache.clear();
}

/**
 * Fingerprint of a set of logs' contents, so two franchises that played the same
 * scheduled games (same ids) never share a cached season.
 */
export function logsSignature(logs: GameLog[]): string {
  let h = 2166136261;
  const mix = (v: number) => {
    h = Math.imul(h ^ (v | 0), 16777619);
  };
  for (const l of logs) {
    mix(l.id);
    mix(l.as);
    mix(l.hs);
    mix(l.inn);
    mix(l.plays?.length ?? 0);
    for (const side of l.box) for (const x of side.pit) mix(x[0] * 31 + x[8]);
  }
  return `${logs.length}:${(h >>> 0).toString(36)}`;
}

/**
 * Read a season's stored games and fold their pitch logs together, yielding to the page
 * between slices (a full season is ~2,400 games and ~700,000 pitches). Cached until more
 * games are stored.
 */
export async function buildSeasonStatcast(opts: {
  slot: number;
  season: number;
  split: ScSplit;
  league: League;
  who: (id: number) => PitchLogPlayer;
  onProgress?: (done: number, total: number) => void;
  cancelled?: () => boolean;
}): Promise<SeasonStatcast | null> {
  const logs = await getSeasonGameLogs(opts.slot, opts.season);
  const isPs = psLookup(opts.league, opts.season);
  const mine = logs.filter((l) => isPs(l) === (opts.split === "post"));
  const key = `${opts.league.seed}:${opts.slot}:${opts.season}:${opts.split}:${logsSignature(mine)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const sc = emptySeasonStatcast();
  for (let i = 0; i < mine.length; i += 1) {
    addGamePitches(sc, gamePitches(mine[i], opts.who), mine[i]);
    if (i % 60 === 59) {
      opts.onProgress?.(i + 1, mine.length);
      await new Promise((r) => setTimeout(r, 0));
      if (opts.cancelled?.()) return null;
    }
  }
  finishSeasonStatcast(sc);
  if (cache.size > 6) cache.clear();
  cache.set(key, sc);
  return sc;
}

// ------------------------------------------------------------------ percentile ranks

/** Pool minimums per team game (Savant ranks regulars): 2 PA, 5 pitches. */
export const POOL_PA_PER_G = 2;
export const POOL_PITCHES_PER_G = 5;

const p1 = (v: number) => `${(v * 100).toFixed(1)}%`;
const d1 = (v: number) => v.toFixed(1);
const d0 = (v: number) => v.toFixed(0);

type BatR = ScBat & ReturnType<typeof batRates>;
type PitR = ScPit & ReturnType<typeof pitRates>;

const BAT_DEFS: Array<Def<BatR>> = [
  { key: "ev", label: "Avg exit velocity", get: (b) => b.ev, fmt: d1 },
  { key: "evMax", label: "Max exit velocity", get: (b) => (b.bbe ? b.evMax : null), fmt: d1 },
  { key: "brl", label: "Barrel %", get: (b) => b.barrelPct, fmt: p1 },
  { key: "hard", label: "Hard-hit %", get: (b) => b.hardHitPct, fmt: p1 },
  { key: "sweet", label: "LA sweet-spot %", get: (b) => b.sweetSpotPct, fmt: p1 },
  { key: "hrDist", label: "Longest home run (ft)", get: (b) => (b.hrDistMax || null), fmt: d0 },
  { key: "chase", label: "Chase %", get: (b) => b.chasePct, low: true, fmt: p1 },
  { key: "whiff", label: "Whiff %", get: (b) => b.whiffPct, low: true, fmt: p1 },
];

const PIT_DEFS: Array<Def<PitR>> = [
  { key: "fb", label: "Fastball velo", get: (p) => p.fbVelo, fmt: d1 },
  { key: "spin", label: "Four-seam spin", get: (p) => p.ffSpin, fmt: d0 },
  { key: "whiff", label: "Whiff %", get: (p) => p.whiffPct, fmt: p1 },
  { key: "csw", label: "CSW %", get: (p) => p.cswPct, fmt: p1 },
  { key: "chase", label: "Chase %", get: (p) => p.chasePct, fmt: p1 },
  { key: "ev", label: "Avg exit velocity", get: (p) => p.evAgainst, low: true, fmt: d1 },
  { key: "hard", label: "Hard-hit %", get: (p) => p.hardHitPct, low: true, fmt: p1 },
  { key: "brl", label: "Barrel %", get: (p) => p.barrelPct, low: true, fmt: p1 },
];

export interface SeasonPercentiles {
  metrics: Metric[];
  /** His sample (PA or pitches) and the pool's minimum. */
  n: number;
  min: number;
  pool: number;
}

/**
 * A player's season Statcast percentile ranks among the franchise's regulars (the pool:
 * 2+ PA or 5+ pitches per team game). A player short of the minimum is still ranked
 * against it, flagged by n < min.
 */
export function seasonPercentiles(sc: SeasonStatcast, id: number, side: "bat" | "pit"): SeasonPercentiles | null {
  const teamGames = (sc.games * 2) / 30;
  if (side === "bat") {
    const me = sc.bat.get(id);
    if (!me || !me.pa) return null;
    const min = Math.max(10, Math.round(teamGames * POOL_PA_PER_G));
    const pool = [...sc.bat.values()].filter((b) => b.pa >= min).map((b) => ({ ...b, ...batRates(b) }));
    return { metrics: profile(BAT_DEFS, { ...me, ...batRates(me) }, pool), n: me.pa, min, pool: pool.length };
  }
  const me = sc.pit.get(id);
  if (!me || !me.pitches) return null;
  const min = Math.max(30, Math.round(teamGames * POOL_PITCHES_PER_G));
  const pool = [...sc.pit.values()].filter((p) => p.pitches >= min).map((p) => ({ ...p, ...pitRates(p) }));
  return { metrics: profile(PIT_DEFS, { ...me, ...pitRates(me) }, pool), n: me.pitches, min, pool: pool.length };
}
