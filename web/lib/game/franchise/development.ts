/** Player development and aging between seasons (ratings move toward potential, then decline). */
import { agingDelta } from "./contracts";
import { clamp, overall } from "./ratings";
import type { FRng } from "./rng";
import type { BatSkill, League, PitSkill, Player, RateLine } from "./types";

export function shiftBat(b: BatSkill, dz: number): BatSkill {
  return {
    ...b,
    k: clamp(b.k - 0.03 * dz, 0.08, 0.4),
    bb: clamp(b.bb + 0.011 * dz, 0.03, 0.2),
    hr: clamp(b.hr + 0.008 * dz, 0.003, 0.08),
    babip: clamp(b.babip + 0.008 * dz, 0.23, 0.35),
    xbh: clamp(b.xbh + 0.02 * dz, 0.12, 0.45),
  };
}

export function shiftPit(p: PitSkill, dz: number): PitSkill {
  return {
    ...p,
    k: clamp(p.k + 0.035 * dz, 0.1, 0.42),
    bb: clamp(p.bb - 0.01 * dz, 0.03, 0.16),
    hr: clamp(p.hr - 0.005 * dz, 0.01, 0.06),
    babip: clamp(p.babip - 0.004 * dz, 0.26, 0.32),
  };
}

/** Move a player's skills so his overall changes by about `delta` grades. */
export function applyOvrDelta(p: Player, delta: number): void {
  const target = p.ovr + delta;
  const base = { bat: p.bat, pit: p.pit };
  let lo = -4;
  let hi = 4;
  for (let i = 0; i < 20; i += 1) {
    const z = (lo + hi) / 2;
    if (base.bat) p.bat = shiftBat(base.bat, z);
    if (base.pit) p.pit = shiftPit(base.pit, z);
    if (overall(p) < target) lo = z;
    else hi = z;
  }
  const z = (lo + hi) / 2;
  if (base.bat) p.bat = shiftBat(base.bat, z);
  if (base.pit) p.pit = shiftPit(base.pit, z);
  p.ovr = overall(p);
}

/** One offseason of development for a player; returns the overall change. */
export function developPlayer(p: Player, rng: FRng): number {
  const before = p.ovr;
  const base = agingDelta(p.age);
  const gap = Math.max(0, p.pot - p.ovr);
  let delta = base > 0 ? base * 0.5 + gap * 0.2 : base;
  delta += rng.gauss(0, p.age <= 25 ? 3 : 2.2);
  if (base >= 0 && p.ovr + delta > p.pot) delta = p.pot - p.ovr + (delta - (p.pot - p.ovr)) * 0.3;
  applyOvrDelta(p, delta);
  if (p.bat) {
    const spdLoss = p.age >= 28 ? 0.15 + Math.max(0, p.age - 32) * 0.05 : -0.05;
    p.bat.spd = clamp(p.bat.spd - spdLoss, 22, 31);
    if (p.age >= 30) p.bat.def = clamp(p.bat.def - 1, -20, 20);
  }
  if (p.pit && p.age >= 34 && p.pos === "SP") p.pit.stam = clamp(p.pit.stam - 2, 60, 110);
  p.ovr = overall(p);
  p.pot = p.age >= 27 ? Math.max(p.ovr, Math.min(p.pot, p.ovr + 2)) : Math.max(p.ovr, Math.round(p.pot + rng.gauss(0, 2)));
  return p.ovr - before;
}

export interface TalentEnv {
  bat: { k: number; bb: number; hr: number };
  pit: { k: number; bb: number; hr: number };
}

/** Usage-weighted talent averages: lineup regulars and rotations count most. */
export function talentEnv(league: League): TalentEnv | null {
  const wb = new Map<number, number>();
  const wp = new Map<number, number>();
  for (const t of Object.values(league.teams)) {
    for (const s of t.lineup) wb.set(s.id, 1);
    for (const id of t.rotation) wp.set(id, 1.2);
  }
  for (const p of Object.values(league.players)) {
    if (p.status !== "active") continue;
    if (!p.pitcher && p.bat && !wb.has(p.id)) wb.set(p.id, 0.25);
    if (p.pitcher && p.pit && !wp.has(p.id)) wp.set(p.id, p.id === league.teams[p.team]?.closer ? 0.5 : 0.35);
  }
  const avg = (w: Map<number, number>, get: (p: Player) => { k: number; bb: number; hr: number } | undefined) => {
    let n = 0;
    const o = { k: 0, bb: 0, hr: 0 };
    for (const [id, x] of w) {
      const r = get(league.players[id]);
      if (!r) continue;
      n += x;
      o.k += r.k * x;
      o.bb += r.bb * x;
      o.hr += r.hr * x;
    }
    return n ? { k: o.k / n, bb: o.bb / n, hr: o.hr / n } : null;
  };
  const bat = avg(wb, (p) => p?.bat);
  const pit = avg(wp, (p) => p?.pit);
  return bat && pit ? { bat, pit } : null;
}

/**
 * Keep the run environment stable across seasons: shift every player's rates so
 * usage-weighted averages match the league's opening baseline (development and the
 * influx of generated players otherwise drift the league toward hitters or pitchers).
 */
export function normalizeEnvironment(league: League): void {
  const target = league.env;
  const now = talentEnv(league);
  if (!target || !now) return;
  // Residual correction from realized results (usage patterns the talent weights miss), split between hitters and pitchers.
  const adj = league.envRealized?.adj ?? { k: 0, bb: 0, hr: 0, babip: 0 };
  const db = { k: target.bat.k - now.bat.k + adj.k / 2, bb: target.bat.bb - now.bat.bb + adj.bb / 2, hr: target.bat.hr - now.bat.hr + adj.hr / 2 };
  const dp = { k: target.pit.k - now.pit.k + adj.k / 2, bb: target.pit.bb - now.pit.bb + adj.bb / 2, hr: target.pit.hr - now.pit.hr + adj.hr / 2 };
  for (const p of Object.values(league.players)) {
    if (p.status === "retired") continue;
    const before = p.ovr;
    if (p.bat) p.bat = { ...p.bat, k: clamp(p.bat.k + db.k, 0.08, 0.4), bb: clamp(p.bat.bb + db.bb, 0.03, 0.2), hr: clamp(p.bat.hr + db.hr, 0.003, 0.08), babip: clamp(p.bat.babip + adj.babip / 2, 0.22, 0.36) };
    if (p.pit) p.pit = { ...p.pit, k: clamp(p.pit.k + dp.k, 0.1, 0.42), bb: clamp(p.pit.bb + dp.bb, 0.03, 0.16), hr: clamp(p.pit.hr + dp.hr, 0.01, 0.06), babip: clamp(p.pit.babip + adj.babip / 2, 0.25, 0.33) };
    p.ovr = overall(p);
    p.pot = Math.max(p.ovr, p.pot + (p.ovr - before));
  }
  // The babip correction is applied directly (not re-centred), so it is consumed.
  if (league.envRealized) league.envRealized.adj.babip = 0;
}

/** Realized league rates from this season's batting lines. */
export function realizedRates(league: League): RateLine | null {
  let pa = 0;
  let k = 0;
  let bb = 0;
  let hr = 0;
  let h = 0;
  let ab = 0;
  let sf = 0;
  for (const p of Object.values(league.players)) {
    const b = p.stats.bat;
    if (!b) continue;
    pa += b.pa;
    k += b.k;
    bb += b.bb;
    hr += b.hr;
    h += b.h;
    ab += b.ab;
    sf += b.sf;
  }
  if (pa < 50_000) return null;
  return { k: k / pa, bb: bb / pa, hr: hr / pa, babip: (h - hr) / Math.max(1, ab - k - hr + sf) };
}

/** End of season: remember realized rates and update the running correction toward the first season's. */
export function trackEnvironment(league: League): void {
  const r = realizedRates(league);
  if (!r) return;
  const e = (league.envRealized ??= { base: r, last: r, adj: { k: 0, bb: 0, hr: 0, babip: 0 } });
  e.last = r;
  e.adj = {
    k: e.adj.k + (e.base.k - r.k) * 0.9,
    bb: e.adj.bb + (e.base.bb - r.bb) * 0.9,
    hr: e.adj.hr + (e.base.hr - r.hr) * 0.9,
    babip: (e.base.babip - r.babip) * 0.9,
  };
}
