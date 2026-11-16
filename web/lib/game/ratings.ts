/**
 * Convert roster stats into physical player models. Every number here is either
 * measured (Statcast via rosters.json) or a league-average default when a player
 * has too little data.
 */
import { calibratePitch, type CalibratedPitch } from "@/lib/game/physics/pitch";
import type { Air } from "@/lib/game/physics/ballFlight";
import { clamp } from "@/lib/game/math";
import type { FieldPos, RosterPlayer, RosterTeam } from "@/lib/game/types";

export const LEAGUE = {
  k: 0.222,
  bb: 0.084,
  zSwing: 0.67,
  oSwing: 0.29,
  zContact: 0.83,
  oContact: 0.57,
  evMean: 88.5,
  evP90: 104,
  laMean: 12.5,
  laSd: 27,
  spraySd: 26,
  zoneRate: 0.49,
};

export interface StealSkill {
  /** Extra primary lead vs. league on attempts, ft. */
  leadFt: number;
  /** Jump / read of the pitcher, s (− = earlier break). From SB% beyond what speed explains. */
  jumpS: number;
  /** Attempt frequency vs. league (1 = average). */
  aggr: number;
}

const LG_SB_RATE = 0.8;
const LG_ATTEMPT = 0.013;
const LG_SB_LEAD = 12.1;

/**
 * Stealing isn't only speed: a slow runner who picks his spots (Josh Naylor: 25-for-28
 * with a below-average lead) times pitchers. Success shrunk toward league and compared
 * with what his sprint speed alone predicts becomes a jump bonus.
 */
export function stealSkill(p: RosterPlayer): StealSkill {
  const sv = p.sav ?? {};
  const att = (sv.sb ?? 0) + (sv.cs ?? 0);
  const opp = sv.sbOpp ?? 0;
  // Faster runners are expected to succeed more; credit only the excess (shrunk toward it).
  const expected = clamp(LG_SB_RATE + (p.sprint - 28.5) * 0.025, 0.6, 0.9);
  const success = ((sv.sb ?? 0) + expected * 10) / (att + 10);
  const jumpS = clamp(-(success - expected) * 1.8, -0.28, 0.1);
  const leadFt = sv.sbLead != null && att >= 3 ? clamp(sv.sbLead - LG_SB_LEAD, -3, 4) : 0;
  const aggr = opp > 0 ? clamp((att + LG_ATTEMPT * 150) / (opp + 150) / LG_ATTEMPT, 0.15, 5) : 1;
  return { leadFt, jumpS, aggr };
}

export interface BatterModel {
  id: number;
  name: string;
  num: string | null;
  pos: FieldPos | "DH";
  /** "S" resolves per pitcher. */
  bats: "L" | "R" | "S";
  batSpeedMph: number;
  attackAngleDeg: number;
  /** Mean vertical offset (ball center − bat line), ft; + = undercut / lift. */
  liftOffsetFt: number;
  verticalSdFt: number;
  timingSdMs: number;
  sprayMeanDeg: number;
  zSwing: number;
  oSwing: number;
  zContact: number;
  oContact: number;
  zoneBottom: number;
  zoneTop: number;
  sprint: number;
  arm: number;
  glove: number;
  /** First-step adjustment vs. the position default, s (− = quicker jump; from OAA). */
  reactionAdj: number;
  /** Catcher pop time to 2B on steal attempts, s (Savant; league ≈ 1.95). */
  popTime: number;
  /** Bunting skill 0–1 (bat control + speed). */
  bunt: number;
  /** Base-stealing craft beyond raw speed (Savant basestealing): lead, jump, aggressiveness. */
  steal: StealSkill;
  raw: RosterPlayer;
}

export interface PitcherModel {
  id: number;
  name: string;
  num: string | null;
  throws: "L" | "R";
  arsenal: CalibratedPitch[];
  stamina: number;
  zoneRate: number;
  /** Pitcher strikeout-stuff factor vs league (1 = average); scales whiff odds. */
  stuff: number;
  sprint: number;
  arm: number;
  glove: number;
  /** Also a batter (pitchers never bat with the universal DH, but keep the slot sane). */
  asBatter: BatterModel;
  raw: RosterPlayer;
}

const n = (x: number | null | undefined, d: number) => (x == null || !Number.isFinite(x) ? d : x);

/** Shrink small-sample rates toward league average (simple empirical-Bayes). */
function shrink(rate: number | null | undefined, lg: number, sample: number, prior = 150): number {
  if (rate == null) return lg;
  return (rate * sample + lg * prior) / (sample + prior);
}

export function batterModel(p: RosterPlayer, pos?: FieldPos | "DH"): BatterModel {
  const b = p.bat;
  const sv = p.sav ?? {};
  const pa = b?.pa ?? 0;
  const evP90 = shrink(b?.evP90, LEAGUE.evP90, pa, 120);
  const laMean = shrink(b?.laMean, LEAGUE.laMean, pa, 120);
  const laSd = shrink(b?.laSd, LEAGUE.laSd, pa, 120);
  // Square contact EV ≈ 0.2·v_pitch(plate) + 1.2·v_bat  (q = 0.2) — invert at p90,
  // then lean on Savant's measured bat speed when bat tracking has the hitter.
  const derived = clamp((evP90 - 0.2 * 84) / 1.22, 60, 80);
  const batSpeedMph = sv.batSpeed ? clamp(0.65 * sv.batSpeed + 0.35 * derived, 60, 80) : derived;
  // Long swings are harder to time; squared-up hitters find the barrel line more often.
  const lengthF = sv.swingLength ? clamp(1 + (sv.swingLength - 7.3) * 0.12, 0.85, 1.2) : 1;
  const squareF = sv.squaredUp ? clamp(1 - (sv.squaredUp - 0.25) * 1.1, 0.85, 1.15) : 1;
  // Pull / spray tendency: Savant pull% (league ≈ 40%) sharpens the stored spray mean.
  const pullAdj = sv.pull != null ? (sv.pull - 40) * 0.35 : 0;
  const pullDir = (p.bats ?? "R") === "L" ? 1 : -1;
  // Fielding: outs above average → glove (0.5 = average) and a quicker/slower first step.
  const oaa = sv.oaa ?? 0;
  const glove = clamp(0.5 + oaa / 24, 0.15, 0.92);
  const reactionAdj = clamp(-oaa * 0.006, -0.08, 0.08);
  const sprint = p.sprint;
  const contactSkill = shrink(b?.zContact, LEAGUE.zContact, pa);
  const bunt = clamp(0.35 + (contactSkill - LEAGUE.zContact) * 2.2 + (sprint - 27) * 0.06 + (sv.squaredUp ? (sv.squaredUp - 0.25) * 0.8 : 0), 0.1, 0.95);
  return {
    id: p.id,
    name: p.name,
    num: p.num,
    pos: pos ?? ((p.pos as FieldPos) || "DH"),
    bats: (p.bats ?? "R") as "L" | "R" | "S",
    batSpeedMph,
    attackAngleDeg: clamp(9 + (laMean - LEAGUE.laMean) * 0.35, 2, 18),
    liftOffsetFt: (laMean - LEAGUE.laMean) / 400 + 0.012,
    verticalSdFt: clamp((laSd / 380) * 0.95 * squareF, 0.04, 0.1),
    timingSdMs: 24 * lengthF,
    sprayMeanDeg: b?.sprayMean != null ? b.sprayMean : pullAdj * pullDir,
    zSwing: shrink(b?.zSwing, LEAGUE.zSwing, pa),
    oSwing: shrink(b?.oSwing, LEAGUE.oSwing, pa),
    zContact: contactSkill,
    oContact: shrink(b?.oContact, LEAGUE.oContact, pa),
    zoneBottom: n(p.zone?.[0], 1.6),
    zoneTop: n(p.zone?.[1], 3.4),
    sprint,
    arm: p.arm,
    glove,
    reactionAdj,
    popTime: clamp(sv.pop2b ?? 1.96, 1.8, 2.15),
    bunt,
    steal: stealSkill(p),
    raw: p,
  };
}

export function pitcherModel(p: RosterPlayer, air?: Air): PitcherModel {
  const pr = p.pitch!;
  const bf = pr.bf ?? 0;
  const k = shrink(pr.k, LEAGUE.k, bf, 200);
  return {
    id: p.id,
    name: p.name,
    num: p.num,
    throws: (p.throws ?? "R") as "L" | "R",
    arsenal: pr.arsenal.map((a) => calibratePitch(a, air)),
    stamina: clamp(n(pr.stamina, 25), 15, 110),
    zoneRate: shrink(pr.zoneRate, LEAGUE.zoneRate, bf * 3.9, 400),
    stuff: k / LEAGUE.k,
    sprint: p.sprint,
    arm: p.arm,
    glove: clamp(0.5 + (p.sav?.oaa ?? 0) / 12, 0.2, 0.85),
    asBatter: batterModel({ ...p, bat: undefined }, "DH"),
    raw: p,
  };
}

export interface TeamModel {
  teamId: number;
  lineup: BatterModel[];
  bench: BatterModel[];
  rotation: PitcherModel[];
  bullpen: PitcherModel[];
}

export function teamModel(t: RosterTeam): TeamModel {
  return {
    teamId: t.teamId,
    lineup: t.lineup.map((p) => batterModel(p, p.pos as FieldPos | "DH")),
    bench: t.bench.map((p) => batterModel(p)),
    rotation: t.rotation.map((p) => pitcherModel(p)),
    bullpen: t.bullpen.map((p) => pitcherModel(p)),
  };
}

/** Switch hitters bat opposite the pitcher's hand. */
export function batSide(b: BatterModel, pitcherThrows: "L" | "R"): "L" | "R" {
  if (b.bats === "S") return pitcherThrows === "R" ? "L" : "R";
  return b.bats;
}
