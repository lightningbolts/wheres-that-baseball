/**
 * Franchise talent model: per-PA skills from the Statcast roster data, linear-weights
 * value (wOBA → runs → WAR) and a 20–80 overall grade derived from it.
 */
import type { RosterPlayer } from "@/lib/game/types";
import { LG } from "./data";
import type { BatSkill, LineupPos, PitSkill, Player, Pos } from "./types";

export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

const shrink = (rate: number | null | undefined, lg: number, n: number, prior: number): number =>
  rate == null || !Number.isFinite(rate) ? lg : (rate * n + lg * prior) / (n + prior);

/** Share of extra-base hits that are triples, from speed. */
export const tripleShare = (spd: number): number => clamp(0.06 + (spd - 27) * 0.03, 0.01, 0.2);

export const W = { bb: 0.69, hbp: 0.72, s: 0.89, d: 1.27, t: 1.62, hr: 2.1 };

export interface Rates {
  k: number;
  bb: number;
  hr: number;
  babip: number;
  xbh: number;
  spd: number;
}

export function wobaOf(r: Rates): number {
  const bip = Math.max(0, 1 - r.k - r.bb - LG.hbp - r.hr);
  const hits = bip * r.babip;
  const xb = hits * r.xbh;
  const t = xb * tripleShare(r.spd);
  return W.bb * r.bb + W.hbp * LG.hbp + W.s * (hits - xb) + W.d * (xb - t) + W.t * t + W.hr * r.hr;
}

export const LG_RATES: Rates = { k: LG.k, bb: LG.bb, hr: LG.hr, babip: LG.babip, xbh: LG.xbh, spd: 27 };
export const LG_WOBA = wobaOf(LG_RATES);

/** Positional adjustment, runs per ~600 PA. */
export const POS_ADJ: Record<string, number> = { C: 11.5, SS: 7, "2B": 2.5, "3B": 2.5, CF: 2.5, LF: -7, RF: -7, "1B": -11.5, DH: -16.5 };

export function batSkillFrom(p: RosterPlayer): BatSkill {
  const b = p.bat;
  const sv = p.sav ?? {};
  const pa = b?.pa ?? 0;
  const k = shrink(b?.k, LG.k, pa, 120);
  const bb = shrink(b?.bb, LG.bb, pa, 120);
  const hr = shrink(b?.hr, LG.hr, pa, 200);
  const abShare = Math.max(0.6, 1 - bb - 0.02);
  const xba = sv.xba ?? sv.avg ?? 0.245;
  const xslg = sv.xslg ?? sv.slg ?? 0.41;
  const nonHrHits = Math.max(0.05, xba * abShare - hr);
  const bip = Math.max(0.3, abShare - k - hr);
  const rawBabip = nonHrHits / bip;
  const babip = clamp(shrink(rawBabip, LG.babip, pa, 350) + (p.sprint - 27) * 0.003, 0.24, 0.34);
  const extra = Math.max(0, (xslg - xba) * abShare - 3 * hr);
  const rawXbh = clamp(extra / nonHrHits, 0.08, 0.5) * 0.9;
  const xbh = clamp(shrink(rawXbh, LG.xbh, pa, 250), 0.14, 0.42);
  const att = (sv.sb ?? 0) + (sv.cs ?? 0);
  const opp = sv.sbOpp ?? 0;
  const sbA = clamp(opp > 0 ? (att + 1) / (opp + 80) : 0.012 + (p.sprint - 27) * 0.006, 0.002, 0.12);
  const sbS = clamp(((sv.sb ?? 0) + 0.76 * 8) / (att + 8) + (p.sprint - 27) * 0.01, 0.5, 0.94);
  const def = clamp(sv.frp ?? (sv.oaa ?? 0) * 0.9, -18, 20);
  return { k, bb, hr, babip, xbh, spd: p.sprint, sbA, sbS, def };
}

export function pitSkillFrom(p: RosterPlayer): PitSkill {
  const pr = p.pitch;
  const sv = p.sav ?? {};
  const bf = pr?.bf ?? 0;
  const k = shrink(pr?.k, LG.k, bf, 200);
  const bb = shrink(pr?.bb, LG.bb, bf, 300);
  // Barrels allowed per batted ball track home runs (league ≈ 7.5% barrels ≈ 3.0% HR/PA).
  // Priors from the 2026 backtest: walks regress a little more, home runs and contact less.
  const hrRaw = sv.barrel != null ? LG.hr * (sv.barrel / 7.5) : LG.hr;
  const hr = clamp(shrink(hrRaw, LG.hr, bf, 150), 0.012, 0.055);
  // Contact quality beyond K/BB/HR: compare xwOBA allowed with what those rates imply.
  const implied = wobaOf({ k, bb, hr, babip: LG.babip, xbh: LG.xbh, spd: 27 });
  const resid = sv.xwoba != null ? sv.xwoba - implied : 0;
  const babip = clamp(LG.babip + shrink(resid, 0, bf, 200), 0.265, 0.315);
  const stam = clamp(pr?.stamina ?? 25, 15, 110);
  return { k, bb, hr, babip, stam };
}

export function batRates(b: BatSkill): Rates {
  return { k: b.k, bb: b.bb, hr: b.hr, babip: b.babip, xbh: b.xbh, spd: b.spd };
}

export function pitRates(p: PitSkill): Rates {
  return { k: p.k, bb: p.bb, hr: p.hr, babip: p.babip, xbh: LG.xbh, spd: 27 };
}

/** Batting runs above average per 600 PA (offense only, incl. baserunning). */
export function batRuns600(b: BatSkill): number {
  return ((wobaOf(batRates(b)) - LG_WOBA) / LG.wobaScale) * 600 + (b.spd - 27) * 1.2 + (b.sbA * b.sbS - 0.01) * 60;
}

export function batWar600(b: BatSkill, pos: string): number {
  return (batRuns600(b) + (POS_ADJ[pos] ?? -16.5) + (pos === "DH" ? 0 : b.def) + 20) / 10;
}

export const isStarterSkill = (p: PitSkill): boolean => p.stam >= 60;

/** Pitching WAR over a full season in his role (SP ≈ 750 BF, RP ≈ 260 BF at higher leverage). */
export function pitWarSeason(p: PitSkill, role?: "SP" | "RP"): number {
  const sp = role ? role === "SP" : isStarterSkill(p);
  const woba = wobaOf(pitRates(p));
  const perBf = (LG_WOBA - woba) / LG.wobaScale;
  if (sp) return (perBf * 750 + 0.026 * 750) / 10;
  return (perBf * 260 * 1.6 + 0.012 * 260) / 10;
}

/** Expected full-season WAR in his natural role. */
export function playerWar(p: Player): number {
  if (p.pitcher && p.pit) return pitWarSeason(p.pit, p.pos === "SP" ? "SP" : "RP");
  if (p.bat) return batWar600(p.bat, p.pos === "SP" || p.pos === "RP" ? "DH" : p.pos);
  return 0;
}

/**
 * The 20–80 grade for a season's WAR in a player's role. Pitchers' WAR runs on a smaller
 * scale than hitters' (the best starters project ~5, the best hitters ~8, elite closers ~2),
 * so each role gets its own slope: an ace and an MVP-level bat both grade in the high 70s,
 * and an average regular at any spot grades about 50.
 */
export const GRADE = {
  bat: { base: 40, per: 5 },
  SP: { base: 40, per: 7.5 },
  RP: { base: 42, per: 12 },
} as const;

export const gradeRole = (p: Pick<Player, "pitcher" | "pos">): keyof typeof GRADE => (p.pitcher ? (p.pos === "SP" ? "SP" : "RP") : "bat");

/** Grades per WAR relative to hitters': development and aging steps are scaled by this. */
export const gradeScale = (p: Pick<Player, "pitcher" | "pos">): number => GRADE[gradeRole(p)].per / GRADE.bat.per;

export const gradeFromWar = (p: Pick<Player, "pitcher" | "pos">, war: number): number => {
  const g = GRADE[gradeRole(p)];
  return g.base + g.per * war;
};

export const warFromGrade = (p: Pick<Player, "pitcher" | "pos">, ovr: number): number => {
  const g = GRADE[gradeRole(p)];
  return (ovr - g.base) / g.per;
};

export function overall(p: Player): number {
  return Math.round(clamp(gradeFromWar(p, playerWar(p)), 20, 80));
}

/** Positions a player can field, best first, with a defensive penalty (runs/150) off his primary. */
export function eligible(p: Player): Array<[LineupPos, number]> {
  const out: Array<[LineupPos, number]> = [];
  const add = (pos: LineupPos, pen: number) => out.push([pos, pen]);
  switch (p.pos) {
    case "C":
      add("C", 0);
      add("1B", -6);
      break;
    case "SS":
      add("SS", 0);
      add("2B", 2);
      add("3B", 0);
      add("CF", -8);
      break;
    case "2B":
      add("2B", 0);
      add("SS", -7);
      add("3B", -3);
      add("LF", -4);
      break;
    case "3B":
      add("3B", 0);
      add("1B", 2);
      add("2B", -5);
      add("SS", -10);
      break;
    case "CF":
      add("CF", 0);
      add("LF", 4);
      add("RF", 3);
      break;
    case "LF":
    case "RF":
      add(p.pos, 0);
      add(p.pos === "LF" ? "RF" : "LF", -1);
      add("1B", -3);
      add("CF", -9);
      break;
    case "1B":
      add("1B", 0);
      add("LF", -8);
      break;
    case "DH":
      add("1B", -9);
      break;
    default:
      break;
  }
  if (!p.pitcher || p.bat) add("DH", 0);
  return out;
}

export function defAt(p: Player, pos: LineupPos): number | null {
  const e = eligible(p).find(([q]) => q === pos);
  if (!e) return null;
  if (pos === "DH") return 0;
  return (p.bat?.def ?? 0) * (e[1] === 0 ? 1 : 0.5) + e[1];
}

/** Value of a hitter starting at a position (runs per 600 PA, incl. positional adjustment). */
export function slotValue(p: Player, pos: LineupPos): number {
  const d = defAt(p, pos);
  if (d == null || !p.bat) return -999;
  return batRuns600(p.bat) + (POS_ADJ[pos] ?? 0) + d;
}

export const isPosPlayer = (p: Player): boolean => (!p.pitcher || !!p.twoWay) && !!p.bat;
/** Can take the mound: a pitcher, or a two-way player. */
export const canPitch = (p: Player): boolean => (p.pitcher || !!p.twoWay) && !!p.pit;

export const fieldPos = (pos: string): Pos => {
  if (pos === "TWP") return "DH";
  if (["C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "DH"].includes(pos)) return pos as Pos;
  return "DH";
};
