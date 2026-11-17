/**
 * Baseball Savant-style percentile profiles for franchise players and clubs:
 *   - "MLB Statcast": the player's real latest-season Savant metrics (rosters.json),
 *   - "Track record": the multi-year projection (2015–2026, aged to the franchise start),
 *   - "Franchise talent": his current in-game skills (moves with development and aging).
 * Percentiles rank against MLB regulars (100+ PA / BF) from the same source.
 */
import type { RosterFile, RosterPlayer } from "@/lib/game/types";
import { LG } from "./data";
import type { ProjectionFile, ScExtra } from "./projections";
import { wobaOf } from "./ratings";
import type { League, Player } from "./types";

export interface Metric {
  key: string;
  label: string;
  value: number | null;
  /** 0–100, higher = better for the player. */
  pct: number | null;
  fmt: (v: number) => string;
}

interface Def<T> {
  key: string;
  label: string;
  get: (x: T) => number | null | undefined;
  low?: boolean;
  fmt: (v: number) => string;
}

const d1 = (v: number) => v.toFixed(1);
const d3 = (v: number) => v.toFixed(3).replace(/^0/, "");
const pc = (v: number) => `${(v * 100).toFixed(1)}%`;
const pcRaw = (v: number) => `${v.toFixed(1)}%`;
const mph = (v: number) => `${v.toFixed(1)}`;
const int = (v: number) => `${Math.round(v)}`;

function rank(pool: number[], v: number, low?: boolean): number {
  if (!pool.length) return 50;
  let below = 0;
  let eq = 0;
  for (const x of pool) {
    if (x < v) below += 1;
    else if (x === v) eq += 1;
  }
  const p = ((below + eq / 2) / pool.length) * 100;
  return Math.round(Math.max(1, Math.min(100, low ? 100 - p : p)));
}

function profile<T>(defs: Array<Def<T>>, me: T, pool: T[]): Metric[] {
  return defs.map((d) => {
    const v = d.get(me);
    if (v == null || !Number.isFinite(v)) return { key: d.key, label: d.label, value: null, pct: null, fmt: d.fmt };
    const vals = pool.map(d.get).filter((x): x is number => x != null && Number.isFinite(x));
    return {
      key: d.key,
      label: d.label,
      value: v,
      pct: rank(vals, v, d.low),
      fmt: d.fmt,
    };
  });
}

// ------------------------------------------------------------- real Statcast

const fastball = (p: RosterPlayer) => {
  const fb = (p.pitch?.arsenal ?? []).filter((a) => a.type === "FF" || a.type === "SI" || a.type === "FC").sort((a, b) => b.usage - a.usage)[0];
  return fb?.speed ?? null;
};
const extension = (p: RosterPlayer) => {
  const ars = p.pitch?.arsenal ?? [];
  const tot = ars.reduce((s, a) => s + a.usage, 0);
  return tot ? ars.reduce((s, a) => s + (a.ext ?? 0) * a.usage, 0) / tot : null;
};

const REAL_BAT: Array<Def<RosterPlayer>> = [
  { key: "xwoba", label: "xwOBA", get: (p) => p.sav?.xwoba, fmt: d3 },
  { key: "xba", label: "xBA", get: (p) => p.sav?.xba, fmt: d3 },
  { key: "xslg", label: "xSLG", get: (p) => p.sav?.xslg, fmt: d3 },
  { key: "barrel", label: "Barrel %", get: (p) => p.sav?.barrel, fmt: pcRaw },
  {
    key: "hardHit",
    label: "Hard-Hit %",
    get: (p) => p.sav?.hardHit,
    fmt: pcRaw,
  },
  { key: "maxEv", label: "Max EV", get: (p) => p.sav?.maxEv, fmt: mph },
  { key: "ev90", label: "EV90", get: (p) => p.bat?.evP90, fmt: mph },
  {
    key: "batSpeed",
    label: "Bat Speed",
    get: (p) => p.sav?.batSpeed,
    fmt: mph,
  },
  {
    key: "squaredUp",
    label: "Squared-Up %",
    get: (p) => (p.sav?.squaredUp != null ? p.sav.squaredUp * 100 : null),
    fmt: pcRaw,
  },
  {
    key: "chase",
    label: "Chase %",
    get: (p) => (p.bat?.oSwing != null ? p.bat.oSwing * 100 : null),
    low: true,
    fmt: pcRaw,
  },
  {
    key: "whiff",
    label: "Whiff %",
    get: (p) => p.sav?.whiff,
    low: true,
    fmt: pcRaw,
  },
  { key: "k", label: "K %", get: (p) => p.bat?.k, low: true, fmt: pc },
  { key: "bb", label: "BB %", get: (p) => p.bat?.bb, fmt: pc },
  { key: "sprint", label: "Sprint Speed", get: (p) => p.sprint, fmt: d1 },
];

const REAL_PIT: Array<Def<RosterPlayer>> = [
  {
    key: "xera",
    label: "xERA",
    get: (p) => p.sav?.xera,
    low: true,
    fmt: (v) => v.toFixed(2),
  },
  {
    key: "xwoba",
    label: "xwOBA",
    get: (p) => p.sav?.xwoba,
    low: true,
    fmt: d3,
  },
  { key: "fb", label: "Fastball Velo", get: fastball, fmt: mph },
  { key: "ext", label: "Extension", get: extension, fmt: d1 },
  { key: "k", label: "K %", get: (p) => p.pitch?.k, fmt: pc },
  { key: "bb", label: "BB %", get: (p) => p.pitch?.bb, low: true, fmt: pc },
  { key: "whiff", label: "Whiff %", get: (p) => p.sav?.whiff, fmt: pcRaw },
  { key: "chase", label: "Chase %", get: (p) => p.sav?.chase, fmt: pcRaw },
  {
    key: "barrel",
    label: "Barrel %",
    get: (p) => p.sav?.barrel,
    low: true,
    fmt: pcRaw,
  },
  { key: "gb", label: "GB %", get: (p) => p.sav?.gb, fmt: pcRaw },
];

const realPools = new WeakMap<RosterFile, { idx: Map<number, RosterPlayer>; bat: RosterPlayer[]; pit: RosterPlayer[] }>();

export function realIndex(rosters: RosterFile) {
  let r = realPools.get(rosters);
  if (!r) {
    const idx = new Map<number, RosterPlayer>();
    const bat: RosterPlayer[] = [];
    const pit: RosterPlayer[] = [];
    for (const t of Object.values(rosters.teams)) {
      for (const p of [...t.lineup, ...t.bench]) if (!idx.has(p.id)) (idx.set(p.id, p), (p.bat?.pa ?? 0) >= 100 && bat.push(p));
      for (const p of [...t.rotation, ...t.bullpen]) {
        if (!idx.has(p.id)) idx.set(p.id, p);
        if ((p.pitch?.bf ?? 0) >= 100 && p.pitch?.arsenal?.length) pit.push(p);
      }
    }
    r = { idx, bat, pit };
    realPools.set(rosters, r);
  }
  return r;
}

/** The player's real Statcast profile, as a pitcher or a hitter. */
export function realProfile(rosters: RosterFile, id: number, pitcher: boolean): { metrics: Metric[]; raw: RosterPlayer } | null {
  const r = realIndex(rosters);
  // A two-way player is listed twice; take the right listing.
  let raw: RosterPlayer | undefined;
  for (const t of Object.values(rosters.teams)) {
    raw = (pitcher ? [...t.rotation, ...t.bullpen] : [...t.lineup, ...t.bench]).find((p) => p.id === id) ?? raw;
  }
  raw ??= r.idx.get(id);
  if (!raw) return null;
  const isP = pitcher && !!raw.pitch;
  const metrics = isP ? profile(REAL_PIT, raw, r.pit) : profile(REAL_BAT, raw, r.bat);
  if (metrics.every((m) => m.value == null)) return null;
  return { metrics, raw };
}

// ----------------------------------------------------------- track record

type ProjEntry = ProjectionFile["players"][string];

const PROJ_BAT: Array<Def<ProjEntry>> = [
  { key: "xwoba", label: "xwOBA", get: (p) => p.bat?.xwoba, fmt: d3 },
  { key: "xba", label: "xBA", get: (p) => p.bat?.xba, fmt: d3 },
  { key: "xslg", label: "xSLG", get: (p) => p.bat?.xslg, fmt: d3 },
  {
    key: "hr",
    label: "HR / 600 PA",
    get: (p) => (p.bat ? p.bat.hr * 600 : null),
    fmt: int,
  },
  { key: "k", label: "K %", get: (p) => p.bat?.k, low: true, fmt: pc },
  { key: "bb", label: "BB %", get: (p) => p.bat?.bb, fmt: pc },
  { key: "sprint", label: "Sprint Speed", get: (p) => p.bat?.sprint, fmt: d1 },
];
const PROJ_PIT: Array<Def<ProjEntry>> = [
  {
    key: "xwoba",
    label: "xwOBA",
    get: (p) => p.pit?.xwoba,
    low: true,
    fmt: d3,
  },
  { key: "k", label: "K %", get: (p) => p.pit?.k, fmt: pc },
  { key: "bb", label: "BB %", get: (p) => p.pit?.bb, low: true, fmt: pc },
  { key: "hr", label: "HR %", get: (p) => p.pit?.hr, low: true, fmt: pc },
  {
    key: "barrel",
    label: "Barrel %",
    get: (p) => p.pit?.barrel,
    low: true,
    fmt: pcRaw,
  },
];

const projPools = new WeakMap<ProjectionFile, { bat: ProjEntry[]; pit: ProjEntry[] }>();

export function projProfile(proj: ProjectionFile, id: number, pitcher: boolean): { metrics: Metric[]; sample: number; career: number } | null {
  const me = proj.players[String(id)];
  const part = pitcher ? me?.pit : me?.bat;
  if (!me || !part) return null;
  let pools = projPools.get(proj);
  if (!pools) {
    const all = Object.values(proj.players);
    pools = {
      bat: all.filter((p) => (p.bat?.pa ?? 0) >= 300),
      pit: all.filter((p) => (p.pit?.bf ?? 0) >= 250),
    };
    projPools.set(proj, pools);
  }
  return {
    metrics: pitcher ? profile(PROJ_PIT, me, pools.pit) : profile(PROJ_BAT, me, pools.bat),
    sample: pitcher ? (me.pit?.bf ?? 0) : (me.bat?.pa ?? 0),
    career: part.career,
  };
}

// ------------------------------------------- fielding, baserunning, ABS

const sgn1 = (v: number) => (v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1));
const sgn2 = (v: number) => (v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2));
const otPct = (l?: { n: number; ot: number }) => (l && l.n ? (l.ot / l.n) * 100 : null);

const FLD: Array<Def<ScExtra>> = [
  {
    key: "frv",
    label: "Fielding Run Value",
    get: (x) => x.fld?.tot,
    fmt: sgn1,
  },
  { key: "range", label: "Range Runs", get: (x) => x.fld?.rng, fmt: sgn1 },
  { key: "armRuns", label: "Arm Runs", get: (x) => x.fld?.arm, fmt: sgn1 },
  { key: "dp", label: "Double-Play Runs", get: (x) => x.fld?.dp, fmt: sgn1 },
];
const CATCH: Array<Def<ScExtra>> = [
  { key: "frm", label: "Framing Runs", get: (x) => x.fld?.frm, fmt: sgn1 },
  { key: "blk", label: "Blocking Runs", get: (x) => x.fld?.blk, fmt: sgn1 },
  { key: "thr", label: "Throwing Runs", get: (x) => x.fld?.thr, fmt: sgn1 },
  {
    key: "absRuns",
    label: "ABS Runs (as catcher)",
    get: (x) => x.fld?.abs,
    fmt: sgn1,
  },
];
const RUN: Array<Def<ScExtra>> = [
  {
    key: "bsr",
    label: "Baserunning Run Value",
    get: (x) => x.run?.tot,
    fmt: sgn1,
  },
  {
    key: "xb",
    label: "Extra Bases Taken (runs)",
    get: (x) => x.run?.xb,
    fmt: sgn1,
  },
  {
    key: "sbRuns",
    label: "Stolen-Base Runs",
    get: (x) => x.run?.sb,
    fmt: sgn1,
  },
];
const absDefs = (role: "b" | "c" | "p"): Array<Def<ScExtra>> => [
  {
    key: `abs-${role}-ot`,
    label: "Overturn %",
    get: (x) => otPct(x.abs?.[role]),
    fmt: pcRaw,
  },
  {
    key: `abs-${role}-raa`,
    label: "Challenge Runs Above Avg",
    get: (x) => x.abs?.[role]?.raa,
    fmt: sgn2,
  },
  {
    key: `abs-${role}-taken`,
    label: "Missed Calls Challenged",
    get: (x) => (x.abs?.[role]?.taken != null ? x.abs[role]!.taken! * 100 : null),
    fmt: pcRaw,
  },
];

export interface AbsSummary {
  role: "Batter" | "Catcher" | "Pitcher";
  n: number;
  ot: number;
  avail: number;
  metrics: Metric[];
}

export interface ScProfile {
  fielding: Metric[];
  catching: Metric[];
  baserunning: Metric[];
  abs: AbsSummary[];
  outs?: number;
  runnerOpps?: number;
}

const scPools = new WeakMap<
  ProjectionFile,
  {
    fld: ScExtra[];
    c: ScExtra[];
    run: ScExtra[];
    b: ScExtra[];
    cc: ScExtra[];
    p: ScExtra[];
  }
>();

/**
 * Real latest-season Savant fielding, baserunning and ABS challenge value, ranked against MLB.
 * Real tools from the roster snapshot (OAA, arm strength, pop time, home-to-first, bolts) join in.
 */
export function scProfile(proj: ProjectionFile | undefined, rosters: RosterFile | undefined, id: number): ScProfile | null {
  const me = proj?.sc?.[String(id)];
  const raw = rosters ? realIndex(rosters).idx.get(id) : undefined;
  if (!me && !raw) return null;
  const x: ScExtra = me ?? {};
  let pools = proj ? scPools.get(proj) : undefined;
  if (proj && !pools) {
    const all = Object.values(proj.sc ?? {});
    pools = {
      fld: all.filter((a) => a.fld),
      c: all.filter((a) => a.fld?.frm != null),
      run: all.filter((a) => a.run && a.run.n >= 30),
      b: all.filter((a) => (a.abs?.b?.n ?? 0) >= 5),
      cc: all.filter((a) => (a.abs?.c?.n ?? 0) >= 15),
      p: all.filter((a) => (a.abs?.p?.n ?? 0) >= 2),
    };
    scPools.set(proj, pools);
  }
  const P = pools ?? { fld: [], c: [], run: [], b: [], cc: [], p: [] };
  const fielding = x.fld ? profile(FLD, x, P.fld) : [];
  const catching = x.fld?.frm != null ? profile(CATCH, x, P.c) : [];
  const baserunning = x.run ? profile(RUN, x, P.run) : [];
  if (raw && rosters) {
    const bat = realIndex(rosters).bat;
    const tools: Array<Def<RosterPlayer>> = [
      {
        key: "oaa",
        label: "Outs Above Average",
        get: (p) => p.sav?.oaa,
        fmt: (v) => (v > 0 ? `+${v}` : String(v)),
      },
      {
        key: "armMax",
        label: "Arm Strength",
        get: (p) => p.sav?.armMax,
        fmt: mph,
      },
    ];
    if (!raw.pitch) fielding.push(...profile(tools, raw, bat).filter((m) => m.value != null));
    if (raw.sav?.pop2b != null)
      catching.push(
        ...profile(
          [
            {
              key: "pop",
              label: "Pop Time to 2B",
              get: (p) => p.sav?.pop2b,
              low: true,
              fmt: (v) => `${v.toFixed(2)}s`,
            },
          ],
          raw,
          bat.filter((p) => p.sav?.pop2b != null),
        ),
      );
    if (!raw.pitch) {
      const run: Array<Def<RosterPlayer>> = [
        { key: "sprint", label: "Sprint Speed", get: (p) => p.sprint, fmt: d1 },
        {
          key: "hp1b",
          label: "Home to 1st",
          get: (p) => p.sav?.hpTo1b,
          low: true,
          fmt: (v) => `${v.toFixed(2)}s`,
        },
        {
          key: "bolts",
          label: "Bolts (30+ ft/s)",
          get: (p) => p.sav?.bolts ?? 0,
          fmt: int,
        },
      ];
      baserunning.push(...profile(run, raw, bat).filter((m) => m.value != null));
    }
  }
  const abs: AbsSummary[] = [];
  const roles = [
    ["b", "Batter", P.b],
    ["c", "Catcher", P.cc],
    ["p", "Pitcher", P.p],
  ] as const;
  for (const [k, role, pool] of roles) {
    const l = x.abs?.[k];
    if (!l) continue;
    abs.push({
      role,
      n: l.n,
      ot: l.ot,
      avail: l.avail,
      metrics: profile(absDefs(k), x, pool),
    });
  }
  if (!fielding.length && !catching.length && !baserunning.length && !abs.length) return null;
  return {
    fielding,
    catching,
    baserunning,
    abs,
    outs: x.fld?.outs,
    runnerOpps: x.run?.n,
  };
}

// ------------------------------------------------------- franchise talent

export const batXwoba = (p: Player): number | null => (p.bat ? wobaOf(p.bat) : null);
export const pitXwoba = (p: Player): number | null =>
  p.pit
    ? wobaOf({
        k: p.pit.k,
        bb: p.pit.bb,
        hr: p.pit.hr,
        babip: p.pit.babip,
        xbh: LG.xbh,
        spd: 27,
      })
    : null;

const TAL_BAT: Array<Def<Player>> = [
  { key: "xwoba", label: "Talent wOBA", get: batXwoba, fmt: d3 },
  {
    key: "contact",
    label: "Contact (K %)",
    get: (p) => p.bat?.k,
    low: true,
    fmt: pc,
  },
  { key: "eye", label: "Eye (BB %)", get: (p) => p.bat?.bb, fmt: pc },
  {
    key: "power",
    label: "Power (HR / 600)",
    get: (p) => (p.bat ? p.bat.hr * 600 : null),
    fmt: int,
  },
  {
    key: "babip",
    label: "Hit Tool (BABIP)",
    get: (p) => p.bat?.babip,
    fmt: d3,
  },
  {
    key: "gap",
    label: "Gap Power (XBH share)",
    get: (p) => p.bat?.xbh,
    fmt: pc,
  },
  { key: "spd", label: "Sprint Speed", get: (p) => p.bat?.spd, fmt: d1 },
  {
    key: "sb",
    label: "Base Stealing",
    get: (p) => (p.bat ? p.bat.sbA * p.bat.sbS : null),
    fmt: (v) => (v * 1000).toFixed(0),
  },
  {
    key: "def",
    label: "Defense (runs / 150 G)",
    get: (p) => p.bat?.def,
    fmt: int,
  },
];
const TAL_PIT: Array<Def<Player>> = [
  {
    key: "xwoba",
    label: "Talent wOBA allowed",
    get: pitXwoba,
    low: true,
    fmt: d3,
  },
  { key: "k", label: "Strikeouts (K %)", get: (p) => p.pit?.k, fmt: pc },
  {
    key: "bb",
    label: "Control (BB %)",
    get: (p) => p.pit?.bb,
    low: true,
    fmt: pc,
  },
  {
    key: "hr",
    label: "HR Suppression",
    get: (p) => p.pit?.hr,
    low: true,
    fmt: pc,
  },
  {
    key: "babip",
    label: "Contact Mgmt (BABIP)",
    get: (p) => p.pit?.babip,
    low: true,
    fmt: d3,
  },
  { key: "stam", label: "Stamina", get: (p) => p.pit?.stam, fmt: int },
];

/** Current franchise talent percentiles among active MLB players. */
export function talentProfile(league: League, p: Player, pitcher: boolean): Metric[] {
  const pool = Object.values(league.players).filter((x) => x.status === "active" && (pitcher ? !!x.pit && x.pitcher : !!x.bat && !x.pitcher));
  return pitcher ? profile(TAL_PIT, p, pool) : profile(TAL_BAT, p, pool);
}

// ------------------------------------------------------------------ teams

export interface TeamMetric {
  key: string;
  label: string;
  value: number;
  rank: number;
  pct: number;
  fmt: (v: number) => string;
}

function rankTeams(league: League, label: string, key: string, f: (tid: number) => number | null, fmt: (v: number) => string, low = false): Map<number, TeamMetric> {
  const vals = Object.keys(league.teams)
    .map(Number)
    .map((id) => [id, f(id)] as const)
    .filter((x): x is readonly [number, number] => x[1] != null && Number.isFinite(x[1]));
  const sorted = [...vals].sort((a, b) => (low ? a[1] - b[1] : b[1] - a[1]));
  const out = new Map<number, TeamMetric>();
  sorted.forEach(([id, v], i) =>
    out.set(id, {
      key,
      label,
      value: v,
      rank: i + 1,
      pct: Math.round(((sorted.length - 1 - i) / Math.max(1, sorted.length - 1)) * 99 + 1),
      fmt,
    }),
  );
  return out;
}

const activeOf = (league: League, tid: number) => Object.values(league.players).filter((p) => p.team === tid && p.status === "active");

/** Club percentile ranks (1st = best of 30): franchise talent, real Statcast of the roster, season results. */
export function teamProfile(
  league: League,
  tid: number,
  rosters?: RosterFile,
  proj?: ProjectionFile,
): {
  talent: TeamMetric[];
  statcast: TeamMetric[];
  glove: TeamMetric[];
  results: TeamMetric[];
} {
  const realIdx = rosters ? realIndex(rosters).idx : undefined;
  const hitters = (id: number) => activeOf(league, id).filter((p) => !p.pitcher && p.bat);
  const lineupIds = (id: number) => new Set(league.teams[id].lineup.map((s) => s.id));
  const wavg = (ps: Player[], f: (p: Player) => number | null | undefined, w: (p: Player) => number) => {
    let s = 0;
    let n = 0;
    for (const p of ps) {
      const v = f(p);
      if (v == null || !Number.isFinite(v)) continue;
      s += v * w(p);
      n += w(p);
    }
    return n ? s / n : null;
  };
  const batW = (id: number) => {
    const L = lineupIds(id);
    return (p: Player) => (L.has(p.id) ? 3 : 1);
  };
  const rot = (id: number) => league.teams[id].rotation.map((x) => league.players[x]).filter(Boolean);
  const pen = (id: number) => activeOf(league, id).filter((p) => p.pitcher && !league.teams[id].rotation.includes(p.id));

  const talent = [
    rankTeams(
      league,
      "Lineup wOBA (talent)",
      "bat",
      (id) => wavg(hitters(id), batXwoba, batW(id)),
      (v) => d3(v),
    ),
    rankTeams(league, "Contact (K %)", "k", (id) => wavg(hitters(id), (p) => p.bat?.k, batW(id)), pc, true),
    rankTeams(league, "Plate Discipline (BB %)", "bb", (id) => wavg(hitters(id), (p) => p.bat?.bb, batW(id)), pc),
    rankTeams(league, "Power (HR / 600)", "hr", (id) => wavg(hitters(id), (p) => (p.bat ? p.bat.hr * 600 : null), batW(id)), d1),
    rankTeams(league, "Team Speed", "spd", (id) => wavg(hitters(id), (p) => p.bat?.spd, batW(id)), d1),
    rankTeams(
      league,
      "Defense (runs)",
      "def",
      (id) => league.teams[id].lineup.reduce((s, x) => s + (x.pos === "DH" ? 0 : (league.players[x.id]?.bat?.def ?? 0)), 0),
      int,
    ),
    rankTeams(league, "Rotation wOBA allowed", "rot", (id) => wavg(rot(id), pitXwoba, () => 1), d3, true),
    rankTeams(league, "Bullpen wOBA allowed", "pen", (id) => wavg(pen(id), pitXwoba, () => 1), d3, true),
    rankTeams(
      league,
      "Staff K %",
      "pk",
      (id) =>
        wavg(
          [...rot(id), ...pen(id)],
          (p) => p.pit?.k,
          (p) => (p.pos === "SP" ? 2 : 1),
        ),
      pc,
    ),
    rankTeams(
      league,
      "Staff BB %",
      "pbb",
      (id) =>
        wavg(
          [...rot(id), ...pen(id)],
          (p) => p.pit?.bb,
          (p) => (p.pos === "SP" ? 2 : 1),
        ),
      pc,
      true,
    ),
  ].flatMap((m) => m.get(tid) ?? []);

  let statcast: TeamMetric[] = [];
  if (realIdx) {
    const real = (p: Player) => realIdx.get(p.id);
    const hs = (id: number) => hitters(id).filter((p) => p.real && real(p));
    const ps = (id: number) => [...rot(id), ...pen(id)].filter((p) => p.real && real(p)?.pitch);
    statcast = [
      rankTeams(league, "xwOBA", "xwoba", (id) => wavg(hs(id), (p) => real(p)?.sav?.xwoba, batW(id)), d3),
      rankTeams(league, "Barrel %", "barrel", (id) => wavg(hs(id), (p) => real(p)?.sav?.barrel, batW(id)), pcRaw),
      rankTeams(league, "Hard-Hit %", "hardHit", (id) => wavg(hs(id), (p) => real(p)?.sav?.hardHit, batW(id)), pcRaw),
      rankTeams(league, "Bat Speed", "batSpeed", (id) => wavg(hs(id), (p) => real(p)?.sav?.batSpeed, batW(id)), mph),
      rankTeams(league, "Chase %", "chase", (id) => wavg(hs(id), (p) => (real(p)?.bat?.oSwing ?? NaN) * 100, batW(id)), pcRaw, true),
      rankTeams(league, "Sprint Speed", "sprint", (id) => wavg(hs(id), (p) => real(p)?.sprint, batW(id)), d1),
      rankTeams(
        league,
        "Pitching xwOBA",
        "pxwoba",
        (id) =>
          wavg(
            ps(id),
            (p) => real(p)?.sav?.xwoba,
            (p) => (p.pos === "SP" ? 2 : 1),
          ),
        d3,
        true,
      ),
      rankTeams(
        league,
        "Fastball Velo",
        "fb",
        (id) =>
          wavg(
            ps(id),
            (p) => fastball(real(p)!),
            () => 1,
          ),
        mph,
      ),
      rankTeams(
        league,
        "Pitching Whiff %",
        "whiff",
        (id) =>
          wavg(
            ps(id),
            (p) => real(p)?.sav?.whiff,
            (p) => (p.pos === "SP" ? 2 : 1),
          ),
        pcRaw,
      ),
      rankTeams(
        league,
        "Barrel % Allowed",
        "pbarrel",
        (id) =>
          wavg(
            ps(id),
            (p) => real(p)?.sav?.barrel,
            (p) => (p.pos === "SP" ? 2 : 1),
          ),
        pcRaw,
        true,
      ),
    ].flatMap((m) => m.get(tid) ?? []);
  }

  // Real latest-season fielding / baserunning / ABS value of the players on each club now.
  let glove: TeamMetric[] = [];
  if (proj?.sc) {
    const sc = (p: Player) => proj.sc![String(p.id)];
    const sum = (id: number, f: (x: ScExtra) => number | null | undefined) =>
      activeOf(league, id).reduce((s, p) => {
        const x = sc(p);
        const v = x ? f(x) : null;
        return s + (v != null && Number.isFinite(v) ? v : 0);
      }, 0);
    const absTot = (id: number, k: "n" | "ot") =>
      activeOf(league, id).reduce((s, p) => {
        const a = sc(p)?.abs;
        return s + (a?.b?.[k] ?? 0) + (a?.c?.[k] ?? 0) + (a?.p?.[k] ?? 0);
      }, 0);
    glove = [
      rankTeams(league, "Fielding Run Value", "frv", (id) => sum(id, (x) => x.fld?.tot), sgn1),
      rankTeams(league, "Range Runs", "rng", (id) => sum(id, (x) => x.fld?.rng), sgn1),
      rankTeams(league, "Arm Runs", "arm", (id) => sum(id, (x) => x.fld?.arm), sgn1),
      rankTeams(league, "Catcher Framing Runs", "frm", (id) => sum(id, (x) => x.fld?.frm), sgn1),
      rankTeams(league, "Baserunning Run Value", "bsr", (id) => sum(id, (x) => x.run?.tot), sgn1),
      rankTeams(league, "ABS Challenge Runs", "absRaa", (id) => sum(id, (x) => (x.abs?.b?.raa ?? 0) + (x.abs?.c?.raa ?? 0) + (x.abs?.p?.raa ?? 0)), sgn2),
      rankTeams(
        league,
        "ABS Overturn %",
        "absOt",
        (id) => {
          const n = absTot(id, "n");
          return n ? (absTot(id, "ot") / n) * 100 : null;
        },
        pcRaw,
      ),
    ].flatMap((m) => m.get(tid) ?? []);
  }

  const g = (id: number) => Math.max(1, league.teams[id].w + league.teams[id].l);
  const played = league.teams[tid].w + league.teams[tid].l > 0;
  const results = played
    ? [
        rankTeams(
          league,
          "Win %",
          "wpct",
          (id) => league.teams[id].w / g(id),
          (v) => d3(v),
        ),
        rankTeams(
          league,
          "Runs / G",
          "rpg",
          (id) => league.teams[id].rs / g(id),
          (v) => v.toFixed(2),
        ),
        rankTeams(
          league,
          "Runs Allowed / G",
          "rapg",
          (id) => league.teams[id].ra / g(id),
          (v) => v.toFixed(2),
          true,
        ),
        rankTeams(
          league,
          "Run Differential",
          "rd",
          (id) => league.teams[id].rs - league.teams[id].ra,
          (v) => (v > 0 ? `+${v}` : String(v)),
        ),
      ].flatMap((m) => m.get(tid) ?? [])
    : [];
  return { talent, statcast, glove, results };
}
