/**
 * Player and team stat rows for the sortable leaderboards (FanGraphs / Baseball-Reference
 * style): standard, rate and value columns with league-relative (+/−) stats.
 */
import type { MLBLeague } from "@/lib/mlb/teams";
import { awardTags } from "./awards";
import { LG } from "./data";
import { seasonSegments } from "./splits";
import { avg, batWar, era, fip, ip, obp, pitWar, slg, woba } from "./stats";
import type { BatLine, League, PitLine, Player, Pos } from "./types";

export type StatSeason = number;
export type StatSplit = "reg" | "post";

export interface BatRow {
  id: number;
  name: string;
  team: number;
  lg: MLBLeague | null;
  pos: Pos;
  age: number;
  rookie: boolean;
  tags: string;
  qual: boolean;
  g: number;
  pa: number;
  ab: number;
  r: number;
  h: number;
  d: number;
  t: number;
  hr: number;
  rbi: number;
  sb: number;
  cs: number;
  bb: number;
  so: number;
  hbp: number;
  bbPct: number;
  kPct: number;
  iso: number;
  babip: number;
  avg: number;
  obp: number;
  slg: number;
  ops: number;
  woba: number;
  wrcPlus: number;
  opsPlus: number;
  war: number;
}

export interface PitRow {
  id: number;
  name: string;
  team: number;
  lg: MLBLeague | null;
  role: "SP" | "RP";
  age: number;
  rookie: boolean;
  tags: string;
  qual: boolean;
  w: number;
  l: number;
  era: number;
  g: number;
  gs: number;
  sv: number;
  hld: number;
  bs: number;
  ip: number;
  outs: number;
  h: number;
  r: number;
  er: number;
  hr: number;
  bb: number;
  so: number;
  bf: number;
  k9: number;
  bb9: number;
  hr9: number;
  kPct: number;
  bbPct: number;
  kbb: number;
  whip: number;
  babip: number;
  fip: number;
  eraMinus: number;
  eraPlus: number;
  war: number;
}

interface Env {
  woba: number;
  rpa: number;
  obp: number;
  slg: number;
  era: number;
}

/** Players' lines for a season (current season reads live stats, past ones the history). */
function lines(league: League, season: StatSeason, split: StatSplit): Array<{ p: Player; team: number; bat?: BatLine; pit?: PitLine }> {
  const out: Array<{ p: Player; team: number; bat?: BatLine; pit?: PitLine }> = [];
  for (const p of Object.values(league.players)) {
    if (season === league.season) {
      const s = split === "post" ? p.post : p.stats;
      if (s?.bat?.pa || s?.pit?.outs || s?.pit?.bf) out.push({ p, team: p.team, bat: s?.bat, pit: s?.pit });
    } else if (split === "reg") {
      const h = p.history?.find((x) => x.season === season);
      if (h && (h.bat?.pa || h.pit?.bf)) out.push({ p, team: h.team, bat: h.bat, pit: h.pit });
    }
  }
  return out;
}

function env(ls: Array<{ bat?: BatLine; pit?: PitLine }>): Env {
  let pa = 0;
  let w = 0;
  let r = 0;
  let ob = 0;
  let obd = 0;
  let tb = 0;
  let ab = 0;
  let er = 0;
  let outs = 0;
  for (const x of ls) {
    const b = x.bat;
    if (b?.pa) {
      pa += b.pa;
      w += woba(b) * (b.ab + b.bb + b.sf + b.hbp);
      r += b.r;
      ob += b.h + b.bb + b.hbp;
      obd += b.ab + b.bb + b.hbp + b.sf;
      tb += b.h + b.d + 2 * b.t + 3 * b.hr;
      ab += b.ab;
    }
    if (x.pit) {
      er += x.pit.er;
      outs += x.pit.outs;
    }
  }
  return {
    woba: obd ? w / obd : LG.woba,
    rpa: pa ? r / pa : LG.runsPerPa,
    obp: obd ? ob / obd : 0.315,
    slg: ab ? tb / ab : 0.4,
    era: outs ? (er * 27) / outs : 4.2,
  };
}

const teamGames = (league: League, team: number, season: number) => {
  if (season !== league.season) return 162;
  const t = league.teams[team];
  return t ? Math.max(1, t.w + t.l) : 162;
};

export function battingRows(league: League, season: StatSeason, split: StatSplit = "reg"): BatRow[] {
  const ls = lines(league, season, split);
  const e = env(ls);
  const rows: BatRow[] = [];
  for (const { p, team, bat: b, pit } of ls) {
    if (!b?.pa) continue;
    const bip = b.ab - b.k - b.hr + b.sf;
    const w = woba(b);
    const wrc = e.rpa ? (((w - e.woba) / LG.wobaScale + e.rpa) / e.rpa) * 100 : 100;
    rows.push({
      id: p.id,
      name: p.name,
      team,
      lg: league.teams[team]?.league ?? null,
      pos: p.pos,
      age: p.age - (league.season - season),
      rookie: !!p.rookie && season === league.season,
      tags: awardTags(league, season, p.id).join(", "),
      qual: split === "post" ? b.pa >= 10 : b.pa >= 3.1 * teamGames(league, team, season),
      g: b.g,
      pa: b.pa,
      ab: b.ab,
      r: b.r,
      h: b.h,
      d: b.d,
      t: b.t,
      hr: b.hr,
      rbi: b.rbi,
      sb: b.sb,
      cs: b.cs,
      bb: b.bb,
      so: b.k,
      hbp: b.hbp,
      bbPct: b.bb / b.pa,
      kPct: b.k / b.pa,
      iso: slg(b) - avg(b),
      babip: bip > 0 ? (b.h - b.hr) / bip : 0,
      avg: avg(b),
      obp: obp(b),
      slg: slg(b),
      ops: obp(b) + slg(b),
      woba: w,
      wrcPlus: Math.round(wrc),
      opsPlus: Math.round(100 * (obp(b) / e.obp + slg(b) / e.slg - 1)),
      war: batWar(p, b) + (pit && p.twoWay ? pitWar(pit) : 0),
    });
  }
  return rows;
}

export function pitchingRows(league: League, season: StatSeason, split: StatSplit = "reg"): PitRow[] {
  const ls = lines(league, season, split);
  const e = env(ls);
  const rows: PitRow[] = [];
  for (const { p, team, pit: s } of ls) {
    if (!s?.bf) continue;
    const inn = ip(s);
    const bip = s.bf - s.k - s.bb - s.hr;
    const er = era(s);
    rows.push({
      id: p.id,
      name: p.name,
      team,
      lg: league.teams[team]?.league ?? null,
      role: s.gs >= s.g / 2 ? "SP" : "RP",
      age: p.age - (league.season - season),
      rookie: !!p.rookie && season === league.season,
      tags: awardTags(league, season, p.id).join(", "),
      qual: split === "post" ? s.outs >= 9 : s.outs >= 3 * teamGames(league, team, season),
      w: s.w,
      l: s.l,
      era: er,
      g: s.g,
      gs: s.gs,
      sv: s.sv,
      hld: s.hld,
      bs: s.bs,
      ip: inn,
      outs: s.outs,
      h: s.h,
      r: s.r,
      er: s.er,
      hr: s.hr,
      bb: s.bb,
      so: s.k,
      bf: s.bf,
      k9: inn ? (s.k * 9) / inn : 0,
      bb9: inn ? (s.bb * 9) / inn : 0,
      hr9: inn ? (s.hr * 9) / inn : 0,
      kPct: s.k / s.bf,
      bbPct: s.bb / s.bf,
      kbb: (s.k - s.bb) / s.bf,
      whip: inn ? (s.h + s.bb) / inn : 0,
      babip: bip > 0 ? (s.h - s.hr) / bip : 0,
      fip: fip(s),
      eraMinus: e.era ? Math.round((er / e.era) * 100) : 100,
      eraPlus: er > 0 ? Math.round((e.era / er) * 100) : 999,
      war: pitWar(s),
    });
  }
  return rows;
}

export interface TeamRow {
  id: number;
  name: string;
  abbrev: string;
  lg: MLBLeague;
  w: number;
  l: number;
  pct: number;
  rs: number;
  ra: number;
  rd: number;
  rpg: number;
  avg: number;
  obp: number;
  slg: number;
  ops: number;
  woba: number;
  wrcPlus: number;
  hr: number;
  sb: number;
  kPct: number;
  bbPct: number;
  era: number;
  fip: number;
  whip: number;
  k9: number;
  pitKPct: number;
  pitBbPct: number;
  hrAllowed: number;
  sv: number;
  batWar: number;
  pitWar: number;
  war: number;
}

const zeroBat = (): BatLine => ({ g: 0, pa: 0, ab: 0, h: 0, d: 0, t: 0, hr: 0, r: 0, rbi: 0, bb: 0, k: 0, sb: 0, cs: 0, hbp: 0, sf: 0 });
const zeroPit = (): PitLine => ({ g: 0, gs: 0, w: 0, l: 0, sv: 0, hld: 0, bs: 0, outs: 0, h: 0, r: 0, er: 0, bb: 0, k: 0, hr: 0, bf: 0, pit: 0 });

/** Club totals for the current season (players' lines summed by their club). */
export function teamRows(league: League): TeamRow[] {
  const bat = new Map<number, BatLine>();
  const pit = new Map<number, PitLine>();
  const bw = new Map<number, number>();
  const pw = new Map<number, number>();
  // Each club gets only what was played for it (a traded player's line is split).
  for (const p of Object.values(league.players)) {
    for (const s of seasonSegments(p)) {
      if (!league.teams[s.team]) continue;
      if (s.bat) {
        const t = bat.get(s.team) ?? zeroBat();
        for (const k of Object.keys(t) as Array<keyof BatLine>) t[k] += s.bat[k];
        bat.set(s.team, t);
        bw.set(s.team, (bw.get(s.team) ?? 0) + batWar(p, s.bat));
      }
      if (s.pit) {
        const t = pit.get(s.team) ?? zeroPit();
        for (const k of Object.keys(t) as Array<keyof PitLine>) t[k] += s.pit[k];
        pit.set(s.team, t);
        pw.set(s.team, (pw.get(s.team) ?? 0) + pitWar(s.pit));
      }
    }
  }
  const all = [...bat.values()].map((b) => ({ bat: b }));
  const e = env([...all, ...[...pit.values()].map((x) => ({ pit: x }))]);
  return Object.values(league.teams).map((t) => {
    const b = bat.get(t.id) ?? zeroBat();
    const s = pit.get(t.id) ?? zeroPit();
    const g = Math.max(1, t.w + t.l);
    const w = woba(b);
    const inn = ip(s);
    return {
      id: t.id,
      name: t.name,
      abbrev: t.abbrev,
      lg: t.league,
      w: t.w,
      l: t.l,
      pct: t.w / g,
      rs: t.rs,
      ra: t.ra,
      rd: t.rs - t.ra,
      rpg: t.rs / g,
      avg: avg(b),
      obp: obp(b),
      slg: slg(b),
      ops: obp(b) + slg(b),
      woba: w,
      wrcPlus: b.pa ? Math.round(e.rpa ? (((w - e.woba) / LG.wobaScale + e.rpa) / e.rpa) * 100 : 100) : 0,
      hr: b.hr,
      sb: b.sb,
      kPct: b.pa ? b.k / b.pa : 0,
      bbPct: b.pa ? b.bb / b.pa : 0,
      era: era(s),
      fip: fip(s),
      whip: inn ? (s.h + s.bb) / inn : 0,
      k9: inn ? (s.k * 9) / inn : 0,
      pitKPct: s.bf ? s.k / s.bf : 0,
      pitBbPct: s.bf ? s.bb / s.bf : 0,
      hrAllowed: s.hr,
      sv: s.sv,
      batWar: bw.get(t.id) ?? 0,
      pitWar: pw.get(t.id) ?? 0,
      war: (bw.get(t.id) ?? 0) + (pw.get(t.id) ?? 0),
    };
  });
}

/** Seasons with stats on record, newest first. */
export function statSeasons(league: League): number[] {
  const s = new Set<number>([league.season]);
  for (const a of league.awards) s.add(a.season);
  for (const c of league.champions) s.add(c.season);
  return [...s].sort((a, b) => b - a);
}
