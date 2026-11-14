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
  const pa = b?.pa ?? 0;
  const evP90 = shrink(b?.evP90, LEAGUE.evP90, pa, 120);
  const laMean = shrink(b?.laMean, LEAGUE.laMean, pa, 120);
  const laSd = shrink(b?.laSd, LEAGUE.laSd, pa, 120);
  // Square contact EV ≈ 0.2·v_pitch(plate) + 1.2·v_bat  (q = 0.2) — invert at p90.
  const batSpeedMph = clamp((evP90 - 0.2 * 84) / 1.22, 60, 80);
  return {
    id: p.id,
    name: p.name,
    num: p.num,
    pos: pos ?? ((p.pos as FieldPos) || "DH"),
    bats: (p.bats ?? "R") as "L" | "R" | "S",
    batSpeedMph,
    attackAngleDeg: clamp(9 + (laMean - LEAGUE.laMean) * 0.35, 2, 18),
    liftOffsetFt: (laMean - LEAGUE.laMean) / 400 + 0.012,
    verticalSdFt: clamp((laSd / 380) * 0.95, 0.04, 0.1),
    timingSdMs: 24,
    sprayMeanDeg: n(b?.sprayMean, 0),
    zSwing: shrink(b?.zSwing, LEAGUE.zSwing, pa),
    oSwing: shrink(b?.oSwing, LEAGUE.oSwing, pa),
    zContact: shrink(b?.zContact, LEAGUE.zContact, pa),
    oContact: shrink(b?.oContact, LEAGUE.oContact, pa),
    zoneBottom: n(p.zone?.[0], 1.6),
    zoneTop: n(p.zone?.[1], 3.4),
    sprint: p.sprint,
    arm: p.arm,
    glove: 0.5,
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
    glove: 0.5,
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
