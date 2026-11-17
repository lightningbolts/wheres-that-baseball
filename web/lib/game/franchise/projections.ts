/**
 * Multi-year talent projections (web/data/game/franchise-proj.json, built by
 * ml-engine/scripts/build_franchise_projections.py): every MLB season 2015–2026,
 * aged to the first franchise season and weighted toward recent years. A 2026 slump or
 * an injury-shortened season no longer defines a player; his track record does.
 */
import type { RosterPlayer } from "@/lib/game/types";
import { LG } from "./data";

export interface BatProj {
  /** Effective (recency-weighted) sample, PA: drives regression to the mean. */
  pa: number;
  career: number;
  k: number;
  bb: number;
  hr: number;
  xba?: number;
  xslg?: number;
  xwoba?: number;
  sprint?: number;
}

export interface PitProj {
  bf: number;
  career: number;
  k: number;
  bb: number;
  hr: number;
  xwoba?: number;
  barrel?: number;
  gsShare?: number;
  ipPerGs?: number;
  sv?: number;
}

export type ExtraRole = "lineup" | "bench" | "rotation" | "bullpen";

export interface ProjectionFile {
  projSeason: number;
  years: [number, number];
  players: Record<string, { born?: string; bat?: BatProj; pit?: PitProj }>;
  /** Current 40-man players missing from the 2026 roster snapshot (mostly injured stars). */
  extras: Record<string, Array<RosterPlayer & { role: ExtraRole }>>;
  /** Latest-season Savant fielding / baserunning / ABS challenge value, by player id. */
  sc?: Record<string, ScExtra>;
}

export interface AbsLine {
  /** Challenges, overturns, runs above average, overturnable calls available, share of them taken, expected overturn rate. */
  n: number;
  ot: number;
  raa: number | null;
  avail: number;
  taken: number | null;
  exp: number | null;
}

export interface ScExtra {
  /** Fielding Run Value: total, range, arm, double plays; catchers framing, blocking, throwing, ABS. */
  fld?: { tot?: number; rng?: number; arm?: number; dp?: number; frm?: number; blk?: number; thr?: number; abs?: number; outs: number };
  /** Baserunning Run Value: total, extra bases taken, stolen-base attempts; n = runner opportunities. */
  run?: { tot: number | null; xb: number | null; sb: number | null; n: number };
  /** ABS challenges as batter / catcher / pitcher. */
  abs?: { b?: AbsLine; c?: AbsLine; p?: AbsLine };
}

/** The roster entry with its rate inputs replaced by the multi-year projection. */
export function projectRosterPlayer(rp: RosterPlayer, proj: ProjectionFile | undefined, pitcher: boolean): RosterPlayer {
  const pr = proj?.players[String(rp.id)];
  if (!pr) return rp;
  const out: RosterPlayer = { ...rp, sav: { ...(rp.sav ?? {}) } };
  const sav = out.sav!;
  if (!pitcher && pr.bat) {
    const b = pr.bat;
    out.bat = { ...(rp.bat ?? ({} as NonNullable<RosterPlayer["bat"]>)), pa: b.pa, k: b.k, bb: b.bb, hr: b.hr };
    if (b.xba != null) sav.xba = b.xba;
    if (b.xslg != null) sav.xslg = b.xslg;
    if (b.xwoba != null) sav.xwoba = b.xwoba;
    if (b.sprint != null) out.sprint = b.sprint;
  }
  if (pitcher && pr.pit) {
    const p = pr.pit;
    out.pitch = { ...(rp.pitch ?? { stamina: 25, arsenal: [] }), bf: p.bf, k: p.k, bb: p.bb };
    // The rating reads HR risk from barrels; blend the actual HR rate in (≈3.0% HR/PA ↔ 7.5% barrels).
    const fromHr = (p.hr / LG.hr) * 7.5;
    sav.barrel = p.barrel != null ? (p.barrel + fromHr) / 2 : fromHr;
    if (p.xwoba != null) sav.xwoba = p.xwoba;
  }
  return out;
}
