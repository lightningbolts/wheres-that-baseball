/** Rate stats, season WAR, league leaders and end-of-season awards. */
import { LG } from "./data";
import { POS_ADJ, W } from "./ratings";
import type { BatLine, League, PitLine, Player } from "./types";
import type { MLBLeague } from "@/lib/mlb/teams";

export const avg = (b: BatLine): number => (b.ab ? b.h / b.ab : 0);
export const obp = (b: BatLine): number => {
  const d = b.ab + b.bb + b.hbp + b.sf;
  return d ? (b.h + b.bb + b.hbp) / d : 0;
};
export const slg = (b: BatLine): number => (b.ab ? (b.h + b.d + 2 * b.t + 3 * b.hr) / b.ab : 0);
export const ops = (b: BatLine): number => obp(b) + slg(b);
export const woba = (b: BatLine): number => {
  const d = b.ab + b.bb + b.sf + b.hbp;
  if (!d) return 0;
  const s = b.h - b.d - b.t - b.hr;
  return (W.bb * b.bb + W.hbp * b.hbp + W.s * s + W.d * b.d + W.t * b.t + W.hr * b.hr) / d;
};
export const ip = (p: PitLine): number => p.outs / 3;
export const ipStr = (p: PitLine): string => `${Math.floor(p.outs / 3)}.${p.outs % 3}`;
export const era = (p: PitLine): number => (p.outs ? (p.er * 27) / p.outs : 0);
export const whip = (p: PitLine): number => (p.outs ? ((p.h + p.bb) * 3) / p.outs : 0);
export const k9 = (p: PitLine): number => (p.outs ? (p.k * 27) / p.outs : 0);
export const fip = (p: PitLine): number => (p.outs ? ((13 * p.hr + 3 * p.bb - 2 * p.k) * 3) / p.outs + 3.15 : 0);
export const fmt3 = (x: number): string => (x >= 1 ? x.toFixed(3) : x.toFixed(3).replace(/^0/, ""));

export function batWar(p: Player, b: BatLine): number {
  const runs = ((woba(b) - LG.woba) / LG.wobaScale) * b.pa;
  const pos = POS_ADJ[p.pos] ?? -16.5;
  const share = b.pa / 650;
  const def = p.pos === "DH" ? 0 : (p.bat?.def ?? 0) * (b.g / 150);
  const bsr = (b.sb * 0.2 - b.cs * 0.42) + ((p.bat?.spd ?? 27) - 27) * 1.2 * share;
  return (runs + pos * share + def + bsr + 20 * (b.pa / 600)) / 10;
}

export function pitWar(p: PitLine): number {
  if (!p.outs) return 0;
  const inn = p.outs / 3;
  const ra9 = (0.5 * fip(p) + 0.5 * era(p));
  const starter = p.gs >= p.g / 2;
  const repl = starter ? 5.4 : 4.9;
  return ((repl - ra9) * inn) / 9 / 9.5 * (starter ? 1 : 1.25);
}

export function seasonWar(p: Player, post = false): number {
  const s = post ? p.post : p.stats;
  return (s?.bat ? batWar(p, s.bat) : 0) + (s?.pit ? pitWar(s.pit) : 0);
}

export interface LeaderRow {
  id: number;
  value: number;
}

export type BatStatKey = "avg" | "hr" | "rbi" | "sb" | "ops" | "war" | "h" | "r";
export type PitStatKey = "era" | "w" | "sv" | "k" | "whip" | "war" | "ip";

/** Qualifier: 3.1 PA per team game for rate stats; 1 IP per team game. */
export function battingLeaders(league: League, key: BatStatKey, lg?: MLBLeague, n = 10): LeaderRow[] {
  const rows: LeaderRow[] = [];
  for (const p of Object.values(league.players)) {
    const b = p.stats.bat;
    if (!b || !b.pa) continue;
    const t = league.teams[p.team];
    if (lg && t?.league !== lg) continue;
    const gp = t ? t.w + t.l : 162;
    const rate = key === "avg" || key === "ops";
    if (rate && b.pa < 3.1 * gp) continue;
    const v = key === "avg" ? avg(b) : key === "ops" ? ops(b) : key === "war" ? batWar(p, b) + (p.stats.pit ? pitWar(p.stats.pit) : 0) : b[key];
    rows.push({ id: p.id, value: v });
  }
  return rows.sort((a, b) => b.value - a.value).slice(0, n);
}

export function pitchingLeaders(league: League, key: PitStatKey, lg?: MLBLeague, n = 10): LeaderRow[] {
  const rows: LeaderRow[] = [];
  for (const p of Object.values(league.players)) {
    const s = p.stats.pit;
    if (!s || !s.outs) continue;
    const t = league.teams[p.team];
    if (lg && t?.league !== lg) continue;
    const gp = t ? t.w + t.l : 162;
    const rate = key === "era" || key === "whip";
    if (rate && s.outs < 3 * gp) continue;
    const v = key === "era" ? era(s) : key === "whip" ? whip(s) : key === "war" ? pitWar(s) : key === "ip" ? ip(s) : s[key];
    rows.push({ id: p.id, value: v });
  }
  const asc = key === "era" || key === "whip";
  return rows.sort((a, b) => (asc ? a.value - b.value : b.value - a.value)).slice(0, n);
}

/** League batting totals: runs per team-game, HR per PA, K% etc. (calibration / UI). */
export function leagueTotals(league: League): { games: number; rpg: number; hrPerPa: number; k: number; bb: number; avg: number; obp: number; slg: number; era: number; sbPerG: number } {
  const tot: BatLine = { g: 0, pa: 0, ab: 0, h: 0, d: 0, t: 0, hr: 0, r: 0, rbi: 0, bb: 0, k: 0, sb: 0, cs: 0, hbp: 0, sf: 0 };
  let er = 0;
  let outs = 0;
  for (const p of Object.values(league.players)) {
    const b = p.stats.bat;
    if (b) for (const k of Object.keys(tot) as Array<keyof BatLine>) tot[k] += b[k];
    if (p.stats.pit) {
      er += p.stats.pit.er;
      outs += p.stats.pit.outs;
    }
  }
  const games = league.schedule.filter((g) => g.result && !g.ps).length;
  return {
    games,
    rpg: games ? tot.r / (games * 2) : 0,
    hrPerPa: tot.pa ? tot.hr / tot.pa : 0,
    k: tot.pa ? tot.k / tot.pa : 0,
    bb: tot.pa ? tot.bb / tot.pa : 0,
    avg: avg(tot),
    obp: obp(tot),
    slg: slg(tot),
    era: outs ? (er * 27) / outs : 0,
    sbPerG: games ? tot.sb / (games * 2) : 0,
  };
}
