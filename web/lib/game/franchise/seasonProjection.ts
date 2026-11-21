/**
 * Monte Carlo season projections on the franchise engine (the same game sim, injuries, depth
 * charts, call-ups, AI trades and postseason as a franchise season).
 *
 * Each simulation clones the Opening Day league, draws every player's true talent around his
 * projection (projection error is real: vets ±~2.5 grades, prospects and thin samples more),
 * plays the 162-game schedule and the postseason, and records every line, the standings, the
 * bracket and the awards. `ProjectionAccumulator` folds thousands of those runs into
 * distributions: means, percentiles, histograms and probabilities.
 */
import type { RosterFile } from "@/lib/game/types";
import type { ContractFile } from "./contracts";
import { shiftBat, shiftPit } from "./development";
import { createLeague } from "./league";
import { startNextSeason } from "./offseason";
import type { ProjectionFile } from "./projections";
import { FRng } from "./rng";
import { simUntil } from "./season";
import { avg, era, fip, obp, seasonWar, slg, whip, woba } from "./stats";
import type { MLBLeague } from "@/lib/mlb/teams";
import type { BatLine, League, PitLine, Player } from "./types";

// ─── One simulation ──────────────────────────────────────────────────────────

/** Opening Day of the real season: rosters, contracts, prospects, the winter market closed by the AI. */
export function openingDayLeague(rosters: RosterFile, opts: { proj?: ProjectionFile; contracts?: ContractFile; seed?: number }): League {
  const league = createLeague(rosters, { userTeam: 147, seed: opts.seed ?? 2027, proj: opts.proj, contracts: opts.contracts });
  league.settings.neutral = true;
  league.settings.autoRoster = true;
  if (league.opening) startNextSeason(league);
  return league;
}

/**
 * True-talent uncertainty in skill z (one z ≈ 10 grades ≈ .042 wOBA ≈ 1.6 WAR a full season).
 * Established regulars ≈ ±.016 wOBA; youth, thin MLB samples and prospects run wider.
 */
export function talentSd(p: Player): number {
  let sd = 0.36;
  if (p.age <= 24) sd += 0.12;
  else if (p.age >= 34) sd += 0.06;
  if (!p.real) sd += 0.15;
  if (p.rookie) sd += 0.1;
  if (p.prospect) sd += 0.08;
  return sd;
}

/**
 * Re-draws every player's true talent around his projection (directly in skill space, so the
 * 20–80 grade cap never distorts the tails). Managers still see and play the projected grade.
 */
export function drawTalent(league: League, rng: FRng): void {
  for (const p of Object.values(league.players)) {
    if (p.status === "retired") continue;
    const sd = talentSd(p);
    if (p.bat) p.bat = shiftBat(p.bat, rng.gauss(0, sd));
    if (p.pit) p.pit = shiftPit(p.pit, rng.gauss(0, sd));
  }
}

export interface SimTeam {
  id: number;
  w: number;
  l: number;
  rs: number;
  ra: number;
  /** Playoff seed (1–6) or 0. */
  seed: number;
  /** Furthest round: 0 missed, 1 lost WC, 2 lost DS, 3 lost LCS, 4 lost WS, 5 champion. */
  reach: number;
}

export interface SimPlayer {
  id: number;
  team: number;
  bat?: BatLine;
  pit?: PitLine;
  war: number;
}

export type AwardKey = "mvp" | "cy" | "roy" | "relief" | "aaron";

export interface SimResult {
  teams: SimTeam[];
  players: SimPlayer[];
  awards: Record<AwardKey, Partial<Record<MLBLeague, number>>>;
  league: { rpg: number; hrPa: number; avg: number; era: number };
}

const ROUND_REACH: Record<string, number> = { wc: 1, ds: 2, lcs: 3, ws: 4 };

/** Plays one full season (and postseason) from a clone of `base`. */
export function simulateOnce(base: League, seed: number): SimResult {
  const league = structuredClone(base);
  const rng = new FRng(seed);
  league.rng = rng.s;
  drawTalent(league, rng);
  // The game sim draws from league.rng: start it from this run's seed.
  league.rng = new FRng(seed ^ 0x5bd1e995).s;
  simUntil(league, "season");

  const players: SimPlayer[] = [];
  for (const p of Object.values(league.players)) {
    const bat = p.stats.bat && p.stats.bat.pa > 0 ? { ...p.stats.bat } : undefined;
    const pit = p.stats.pit && p.stats.pit.bf > 0 ? { ...p.stats.pit } : undefined;
    if (!bat && !pit) continue;
    players.push({ id: p.id, team: p.team, bat, pit, war: seasonWar(p) });
  }
  const aw = league.awards[league.awards.length - 1];
  const awards: SimResult["awards"] = { mvp: {}, cy: {}, roy: {}, relief: {}, aaron: {} };
  if (aw) {
    for (const lg of ["AL", "NL"] as const) {
      awards.mvp[lg] = aw.mvp[lg];
      awards.cy[lg] = aw.cy[lg];
      awards.roy[lg] = aw.roy[lg];
      if (aw.relief?.[lg]) awards.relief[lg] = aw.relief[lg]!.id;
      if (aw.aaron?.[lg]) awards.aaron[lg] = aw.aaron[lg]!.id;
    }
  }
  const seedOf = new Map<number, number>();
  for (const lg of ["AL", "NL"] as const) league.bracket?.seeds[lg].forEach((id, i) => seedOf.set(id, i + 1));

  // League environment from the regular season.
  let runs = 0;
  let games = 0;
  for (const t of Object.values(league.teams)) {
    runs += t.rs;
    games += t.w + t.l;
  }
  const tot = { pa: 0, hr: 0, h: 0, ab: 0, er: 0, outs: 0 };
  for (const s of players) {
    if (s.bat) {
      tot.pa += s.bat.pa;
      tot.hr += s.bat.hr;
      tot.h += s.bat.h;
      tot.ab += s.bat.ab;
    }
    if (s.pit) {
      tot.er += s.pit.er;
      tot.outs += s.pit.outs;
    }
  }
  const standings = Object.values(league.teams).map((t) => ({ id: t.id, w: t.w, l: t.l, rs: t.rs, ra: t.ra }));

  simUntil(league, "postseason");
  const reach = new Map<number, number>();
  for (const s of league.bracket?.series ?? []) {
    const r = ROUND_REACH[s.round];
    for (const id of [s.hi, s.lo]) if (id) reach.set(id, Math.max(reach.get(id) ?? 0, r));
  }
  const champ = league.bracket?.champion;
  if (champ) reach.set(champ, 5);

  return {
    teams: standings.map((t) => ({ ...t, seed: seedOf.get(t.id) ?? 0, reach: reach.get(t.id) ?? 0 })),
    players,
    awards,
    league: {
      rpg: games ? runs / games : 0,
      hrPa: tot.pa ? tot.hr / tot.pa : 0,
      avg: tot.ab ? tot.h / tot.ab : 0,
      era: tot.outs ? (tot.er * 27) / tot.outs : 0,
    },
  };
}

// ─── Aggregation ─────────────────────────────────────────────────────────────

const BAT_KEYS = ["g", "pa", "ab", "h", "d", "t", "hr", "r", "rbi", "bb", "k", "sb", "cs", "hbp", "sf"] as const;
const PIT_KEYS = ["g", "gs", "w", "l", "sv", "hld", "bs", "outs", "h", "r", "er", "bb", "k", "hr", "bf", "pit"] as const;

/** Compact per-sim record: raw counting stats, so runs from parallel workers merge exactly. */
export interface RawPlayerRuns {
  id: number;
  /** Final team each run. */
  team: number[];
  war: number[];
  bat?: number[][];
  pit?: number[][];
}

export interface RawRuns {
  sims: number;
  teams: Record<number, { w: number[]; rs: number[]; ra: number[]; seed: number[]; reach: number[] }>;
  players: Record<number, RawPlayerRuns>;
  awards: Record<string, Record<number, number>>;
  league: { rpg: number[]; hrPa: number[]; avg: number[]; era: number[] };
}

export function emptyRuns(): RawRuns {
  return { sims: 0, teams: {}, players: {}, awards: {}, league: { rpg: [], hrPa: [], avg: [], era: [] } };
}

/** Adds one simulation. Players who didn't play that run get zero lines (padded at summary time). */
export function addRun(runs: RawRuns, r: SimResult): void {
  const i = runs.sims;
  runs.sims += 1;
  for (const t of r.teams) {
    const e = (runs.teams[t.id] ??= { w: [], rs: [], ra: [], seed: [], reach: [] });
    e.w.push(t.w);
    e.rs.push(t.rs);
    e.ra.push(t.ra);
    e.seed.push(t.seed);
    e.reach.push(t.reach);
  }
  for (const s of r.players) {
    const e = (runs.players[s.id] ??= { id: s.id, team: [], war: [] });
    // Pad runs he didn't appear in.
    while (e.team.length < i) {
      e.team.push(0);
      e.war.push(0);
      e.bat?.push([]);
      e.pit?.push([]);
    }
    e.team.push(s.team);
    e.war.push(Math.round(s.war * 100) / 100);
    if (s.bat) {
      e.bat ??= Array.from({ length: i }, () => []);
      e.bat.push(BAT_KEYS.map((k) => s.bat![k]));
    } else e.bat?.push([]);
    if (s.pit) {
      e.pit ??= Array.from({ length: i }, () => []);
      e.pit.push(PIT_KEYS.map((k) => s.pit![k]));
    } else e.pit?.push([]);
  }
  for (const [award, byLg] of Object.entries(r.awards)) {
    for (const [lg, id] of Object.entries(byLg)) {
      if (!id) continue;
      const key = `${award}:${lg}`;
      const m = (runs.awards[key] ??= {});
      m[id] = (m[id] ?? 0) + 1;
    }
  }
  runs.league.rpg.push(r.league.rpg);
  runs.league.hrPa.push(r.league.hrPa);
  runs.league.avg.push(r.league.avg);
  runs.league.era.push(r.league.era);
}

/** Pads every player's arrays to `runs.sims`. */
function padAll(runs: RawRuns): void {
  for (const e of Object.values(runs.players)) {
    while (e.team.length < runs.sims) {
      e.team.push(0);
      e.war.push(0);
      e.bat?.push([]);
      e.pit?.push([]);
    }
  }
}

/** Concatenates runs from parallel workers. */
export function mergeRuns(parts: RawRuns[]): RawRuns {
  const out = emptyRuns();
  for (const part of parts) {
    padAll(part);
    const off = out.sims;
    for (const [id, t] of Object.entries(part.teams)) {
      const e = (out.teams[+id] ??= { w: [], rs: [], ra: [], seed: [], reach: [] });
      e.w.push(...t.w);
      e.rs.push(...t.rs);
      e.ra.push(...t.ra);
      e.seed.push(...t.seed);
      e.reach.push(...t.reach);
    }
    for (const [id, p] of Object.entries(part.players)) {
      let e = out.players[+id];
      if (!e) {
        e = out.players[+id] = { id: p.id, team: new Array(off).fill(0), war: new Array(off).fill(0) };
      }
      while (e.team.length < off) {
        e.team.push(0);
        e.war.push(0);
        e.bat?.push([]);
        e.pit?.push([]);
      }
      if (p.bat) e.bat ??= Array.from({ length: off }, () => []);
      if (p.pit) e.pit ??= Array.from({ length: off }, () => []);
      e.team.push(...p.team);
      e.war.push(...p.war);
      if (e.bat) e.bat.push(...(p.bat ?? p.team.map(() => [])));
      if (e.pit) e.pit.push(...(p.pit ?? p.team.map(() => [])));
    }
    for (const [k, m] of Object.entries(part.awards)) {
      const o = (out.awards[k] ??= {});
      for (const [id, n] of Object.entries(m)) o[+id] = (o[+id] ?? 0) + n;
    }
    out.league.rpg.push(...part.league.rpg);
    out.league.hrPa.push(...part.league.hrPa);
    out.league.avg.push(...part.league.avg);
    out.league.era.push(...part.league.era);
    out.sims += part.sims;
  }
  padAll(out);
  return out;
}

// ─── Summary (what the projections page reads) ───────────────────────────────

/** Mean, SD, percentiles [5,10,25,50,75,90,95] and a histogram. */
export interface Dist {
  mean: number;
  sd: number;
  pct: number[];
  /** Histogram: first bin's lower edge, bin width, counts (share of sims, ‰). */
  hist?: { lo: number; w: number; n: number[] };
}

const PCTS = [0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95];

const round = (x: number, d: number): number => {
  const k = 10 ** d;
  return Math.round(x * k) / k;
};

export function dist(values: number[], opts: { digits?: number; bins?: number; width?: number; lo?: number } = {}): Dist {
  const d = opts.digits ?? 1;
  const n = values.length;
  if (!n) return { mean: 0, sd: 0, pct: PCTS.map(() => 0) };
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((s, x) => s + x, 0) / n;
  const sd = Math.sqrt(values.reduce((s, x) => s + (x - mean) ** 2, 0) / n);
  const q = (p: number) => {
    const i = (n - 1) * p;
    const a = Math.floor(i);
    return sorted[a] + (sorted[Math.min(n - 1, a + 1)] - sorted[a]) * (i - a);
  };
  const out: Dist = { mean: round(mean, d + 1), sd: round(sd, d + 1), pct: PCTS.map((p) => round(q(p), d)) };
  if (opts.bins || opts.width) {
    const lo0 = opts.lo ?? q(0.003);
    const hi0 = q(0.997);
    const w = opts.width ?? niceWidth((hi0 - lo0) / (opts.bins ?? 24));
    const lo = Math.floor(lo0 / w) * w;
    const count = Math.max(1, Math.min(80, Math.ceil((hi0 - lo) / w) + 1));
    const bins = new Array(count).fill(0);
    for (const x of values) {
      const b = Math.floor((x - lo) / w);
      if (b >= 0 && b < count) bins[b] += 1;
      else if (b >= count) bins[count - 1] += 1;
      else bins[0] += 1;
    }
    out.hist = { lo: round(lo, 4), w: round(w, 4), n: bins.map((c) => Math.round((c / n) * 1000)) };
  }
  return out;
}

function niceWidth(raw: number): number {
  if (raw <= 0) return 1;
  const e = 10 ** Math.floor(Math.log10(raw));
  const m = raw / e;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * e;
}

export interface TeamProjection {
  id: number;
  wins: Dist;
  rs: number;
  ra: number;
  /** Probabilities (0–1). */
  div: number;
  wc: number;
  playoffs: number;
  bye: number;
  ds: number;
  lcs: number;
  pennant: number;
  ws: number;
  /** Share of sims finishing as each seed 1–6. */
  seeds: number[];
  /** Exact wins histogram: index 0 = `winsLo` wins. */
  winsLo: number;
  winsHist: number[];
}

export interface HitterProjection {
  id: number;
  name: string;
  team: number;
  pos: string;
  age: number;
  bats: string;
  prospect?: Player["prospect"];
  /** Unsigned this winter: his club is where the simulated free-agent market placed him. */
  signing?: boolean;
  /** Share of sims he reached 100 PA. */
  regular: number;
  /** Means of counting stats over all sims. */
  line: Record<(typeof BAT_KEYS)[number], number>;
  pa: Dist;
  hr: Dist;
  rbi: Dist;
  r: Dist;
  sb: Dist;
  avg: Dist;
  obp: Dist;
  slg: Dist;
  ops: Dist;
  woba: Dist;
  war: Dist;
  /** Milestone probabilities. */
  odds: { hr30: number; hr40: number; hr50: number; avg300: number; sb30: number; war5: number; war8: number };
}

export interface PitcherProjection {
  id: number;
  name: string;
  team: number;
  role: "SP" | "RP";
  age: number;
  throws: string;
  prospect?: Player["prospect"];
  signing?: boolean;
  regular: number;
  line: Record<(typeof PIT_KEYS)[number], number>;
  ip: Dist;
  era: Dist;
  fip: Dist;
  whip: Dist;
  k: Dist;
  bb: Dist;
  w: Dist;
  sv: Dist;
  k9: Dist;
  war: Dist;
  odds: { k200: number; era3: number; w15: number; sv30: number; war5: number; cy: number };
}

export interface AwardOdds {
  id: number;
  p: number;
}

export interface SeasonProjection {
  season: number;
  sims: number;
  generated: string;
  engine: string;
  league: { rpg: Dist; hrPa: Dist; avg: Dist; era: Dist };
  teams: TeamProjection[];
  hitters: HitterProjection[];
  pitchers: PitcherProjection[];
  /** "mvp:AL" → top candidates. */
  awards: Record<string, AwardOdds[]>;
  /** "hr:AL" → who leads the league (qualified for rate stats). */
  leaders: Record<string, AwardOdds[]>;
}

const share = <T,>(xs: T[], f: (x: T) => boolean): number => (xs.length ? round(xs.filter(f).length / xs.length, 4) : 0);
const meanOf = (xs: number[]): number => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const mode = (xs: number[]): number => {
  const c = new Map<number, number>();
  for (const x of xs) if (x) c.set(x, (c.get(x) ?? 0) + 1);
  let best = 0;
  let n = -1;
  for (const [k, v] of c) if (v > n) [best, n] = [k, v];
  return best;
};

const batLine = (row: number[]): BatLine => {
  const o = {} as BatLine;
  BAT_KEYS.forEach((k, i) => (o[k] = row[i] ?? 0));
  return o;
};
const pitLine = (row: number[]): PitLine => {
  const o = {} as PitLine;
  PIT_KEYS.forEach((k, i) => (o[k] = row[i] ?? 0));
  return o;
};

/** Plate appearances / innings that qualify for a rate title (162 games). */
const QUAL_PA = 502;
const QUAL_OUTS = 486;

export function summarize(runs: RawRuns, league: League, opts: { minPa?: number; minOuts?: number } = {}): SeasonProjection {
  padAll(runs);
  const n = runs.sims;
  const lgOf = (team: number): MLBLeague | undefined => league.teams[team]?.league;

  const teams: TeamProjection[] = Object.entries(runs.teams).map(([id, t]) => {
    const lo = Math.min(...t.w);
    const hi = Math.max(...t.w);
    const hist = new Array(hi - lo + 1).fill(0);
    for (const w of t.w) hist[w - lo] += 1;
    return {
      id: +id,
      wins: dist(t.w, { digits: 1 }),
      rs: round(meanOf(t.rs), 0),
      ra: round(meanOf(t.ra), 0),
      div: share(t.seed, (s) => s >= 1 && s <= 3),
      wc: share(t.seed, (s) => s >= 4),
      playoffs: share(t.seed, (s) => s > 0),
      bye: share(t.seed, (s) => s === 1 || s === 2),
      ds: share(t.reach, (r) => r >= 2),
      lcs: share(t.reach, (r) => r >= 3),
      pennant: share(t.reach, (r) => r >= 4),
      ws: share(t.reach, (r) => r >= 5),
      seeds: [1, 2, 3, 4, 5, 6].map((s) => share(t.seed, (x) => x === s)),
      winsLo: lo,
      winsHist: hist.map((c) => round(c / n, 4)),
    };
  });

  // Rate-title leaders per sim, by league: [statKey, higher-is-better, qualifies, value].
  const leaderCounts: Record<string, Record<number, number>> = {};
  const best: Record<string, Array<{ id: number; v: number }>> = {};
  const offer = (key: string, sim: number, id: number, v: number, higher: boolean) => {
    const arr = (best[key] ??= []);
    const cur = arr[sim];
    if (!cur || (higher ? v > cur.v : v < cur.v)) arr[sim] = { id, v };
  };

  const hitters: HitterProjection[] = [];
  const pitchers: PitcherProjection[] = [];
  const minPa = opts.minPa ?? 60;
  const minOuts = opts.minOuts ?? 45;

  for (const e of Object.values(runs.players)) {
    const p = league.players[e.id];
    if (!p) continue;
    const team = mode(e.team) || p.team;
    const signing = p.real && p.contract.kind === "fa" && p.contract.signed === league.season ? true : undefined;
    if (e.bat) {
      const lines = e.bat.map(batLine);
      const pa = lines.map((l) => l.pa);
      lines.forEach((l, sim) => {
        const lg = lgOf(e.team[sim]);
        if (!lg || !l.pa) return;
        offer(`hr:${lg}`, sim, e.id, l.hr, true);
        offer(`rbi:${lg}`, sim, e.id, l.rbi, true);
        offer(`sb:${lg}`, sim, e.id, l.sb, true);
        offer(`war_b:${lg}`, sim, e.id, e.war[sim], true);
        if (l.pa >= QUAL_PA) {
          offer(`avg:${lg}`, sim, e.id, avg(l), true);
          offer(`ops:${lg}`, sim, e.id, obp(l) + slg(l), true);
        }
      });
      if (meanOf(pa) >= minPa) {
        const played = lines.filter((l) => l.pa >= 30);
        const rate = (f: (l: BatLine) => number, digits = 3, bins?: number) => dist(played.map(f), { digits, bins });
        const qual = lines.filter((l) => l.pa >= QUAL_PA);
        const line = Object.fromEntries(BAT_KEYS.map((k) => [k, round(meanOf(lines.map((l) => l[k])), 1)])) as HitterProjection["line"];
        hitters.push({
          id: e.id,
          name: p.name,
          team,
          pos: p.pos,
          age: p.age,
          bats: p.bats,
          prospect: p.prospect,
          signing,
          regular: share(pa, (x) => x >= 100),
          line,
          pa: dist(pa, { digits: 0, bins: 20 }),
          hr: dist(lines.map((l) => l.hr), { digits: 1, width: lines.some((l) => l.hr > 40) ? 2 : 1 }),
          rbi: dist(lines.map((l) => l.rbi), { digits: 1, bins: 20 }),
          r: dist(lines.map((l) => l.r), { digits: 1 }),
          sb: dist(lines.map((l) => l.sb), { digits: 1, width: lines.some((l) => l.sb > 40) ? 2 : 1 }),
          avg: rate(avg, 3, 26),
          obp: rate(obp),
          slg: rate(slg),
          ops: rate((l) => obp(l) + slg(l), 3, 26),
          woba: rate(woba),
          war: dist(e.war, { digits: 1, bins: 26 }),
          odds: {
            hr30: share(lines, (l) => l.hr >= 30),
            hr40: share(lines, (l) => l.hr >= 40),
            hr50: share(lines, (l) => l.hr >= 50),
            avg300: n ? round(qual.filter((l) => avg(l) >= 0.3).length / n, 4) : 0,
            sb30: share(lines, (l) => l.sb >= 30),
            war5: share(e.war, (w) => w >= 5),
            war8: share(e.war, (w) => w >= 8),
          },
        });
      }
    }
    if (e.pit) {
      const lines = e.pit.map(pitLine);
      const outs = lines.map((l) => l.outs);
      lines.forEach((l, sim) => {
        const lg = lgOf(e.team[sim]);
        if (!lg || !l.bf) return;
        offer(`w:${lg}`, sim, e.id, l.w, true);
        offer(`k:${lg}`, sim, e.id, l.k, true);
        offer(`sv:${lg}`, sim, e.id, l.sv, true);
        if (!e.bat) offer(`war_p:${lg}`, sim, e.id, e.war[sim], true);
        if (l.outs >= QUAL_OUTS) offer(`era:${lg}`, sim, e.id, era(l), false);
      });
      if (meanOf(outs) >= minOuts) {
        const played = lines.filter((l) => l.outs >= 30);
        const rate = (f: (l: PitLine) => number, digits = 2, bins?: number) => dist(played.map(f), { digits, bins });
        const line = Object.fromEntries(PIT_KEYS.map((k) => [k, round(meanOf(lines.map((l) => l[k])), 1)])) as PitcherProjection["line"];
        const gs = meanOf(lines.map((l) => l.gs));
        const g = meanOf(lines.map((l) => l.g));
        const cyKey = `cy:${lgOf(team) ?? "AL"}`;
        pitchers.push({
          id: e.id,
          name: p.name,
          team,
          role: gs >= g * 0.5 ? "SP" : "RP",
          age: p.age,
          throws: p.throws,
          prospect: p.prospect,
          signing,
          regular: share(outs, (x) => x >= 90),
          line,
          ip: dist(outs.map((o) => o / 3), { digits: 1, bins: 20 }),
          era: rate(era, 2, 26),
          fip: rate(fip),
          whip: rate(whip),
          k: dist(lines.map((l) => l.k), { digits: 1, bins: 24 }),
          bb: dist(lines.map((l) => l.bb), { digits: 1 }),
          w: dist(lines.map((l) => l.w), { digits: 1, width: 1 }),
          sv: dist(lines.map((l) => l.sv), { digits: 1, width: lines.some((l) => l.sv > 40) ? 2 : 1 }),
          k9: rate((l) => (l.outs ? (l.k * 27) / l.outs : 0)),
          war: dist(e.bat ? lines.map((l, i) => e.war[i]) : e.war, { digits: 1, bins: 26 }),
          odds: {
            k200: share(lines, (l) => l.k >= 200),
            era3: n ? round(lines.filter((l) => l.outs >= QUAL_OUTS && era(l) < 3).length / n, 4) : 0,
            w15: share(lines, (l) => l.w >= 15),
            sv30: share(lines, (l) => l.sv >= 30),
            war5: share(e.war, (w) => w >= 5),
            cy: round((runs.awards[cyKey]?.[e.id] ?? 0) / n, 4),
          },
        });
      }
    }
  }

  for (const [key, arr] of Object.entries(best)) {
    const m = (leaderCounts[key] ??= {});
    for (const x of arr) if (x) m[x.id] = (m[x.id] ?? 0) + 1;
  }
  const top = (m: Record<number, number> | undefined, k = 12): AwardOdds[] =>
    Object.entries(m ?? {})
      .map(([id, c]) => ({ id: +id, p: round(c / n, 4) }))
      .sort((a, b) => b.p - a.p)
      .slice(0, k);

  hitters.sort((a, b) => b.war.mean - a.war.mean);
  pitchers.sort((a, b) => b.war.mean - a.war.mean);
  return {
    season: league.season,
    sims: n,
    generated: new Date().toISOString().slice(0, 10),
    engine: "Play Ball franchise sim",
    league: {
      rpg: dist(runs.league.rpg, { digits: 2, bins: 24 }),
      hrPa: dist(runs.league.hrPa, { digits: 4 }),
      avg: dist(runs.league.avg, { digits: 3 }),
      era: dist(runs.league.era, { digits: 2 }),
    },
    teams,
    hitters,
    pitchers,
    awards: Object.fromEntries(Object.entries(runs.awards).map(([k, m]) => [k, top(m)])),
    leaders: Object.fromEntries(Object.entries(leaderCounts).map(([k, m]) => [k, top(m, 8)])),
  };
}
