/**
 * One pitch, physically: select → throw (Magnus flight) → take or swing →
 * bat–ball collision → batted-ball path. Decisions come from Controllers so a
 * human (UI input) and the CPU (AI) drive the exact same physics.
 */
import { throwPitch, crossesZone, pitchStateAt, zoneContact, PLATE_FRONT_Z, PLATE_HALF_WIDTH, type PitchFlight } from "@/lib/game/physics/pitch";
import { BALL_RADIUS_FT } from "@/lib/game/physics/ballFlight";
import { battedBallFromLaunch } from "@/lib/game/physics/batBall";
import { resolveContact, type ContactResult } from "@/lib/game/physics/batBall";
import { simulateBattedBall, type BattedBallPath } from "@/lib/game/physics/battedBall";
import type { Park } from "@/lib/game/physics/park";
import type { BatterModel, PitcherModel } from "@/lib/game/ratings";
import { clamp, len, type Rng } from "@/lib/game/math";
import type { UmpTendency } from "@/lib/game/umpires/data";

export interface Count {
  balls: number;
  strikes: number;
}

export interface PitchContext {
  pitcher: PitcherModel;
  batter: BatterModel;
  side: "L" | "R";
  count: Count;
  outs: number;
  pitchCount: number;
  runnersOn: number;
  /** Occupied bases [1st, 2nd, 3rd]. */
  bases?: [boolean, boolean, boolean];
  /** Final three innings of regulation (or extras) in a one-run game. */
  lateClose?: boolean;
  park: Park;
  /** The plate umpire's zone (absent = league-average umpire). */
  ump?: UmpTendency;
}

export interface PitchDecision {
  /** Index into pitcher.arsenal. */
  pitchIdx: number;
  /** Intended plate location (Statcast frame: px + toward 1B side). */
  targetPx: number;
  targetPz: number;
  /** Execution multiplier on the pitcher's real command (human meter; CPU = 1). */
  commandMult: number;
}

export interface SwingDecision {
  swing: boolean;
  /** Timing error, ms (negative = early). */
  timingErrMs: number;
  /** Bat-line height error vs. the ball at contact, ft (+ = bat under the ball → lift). */
  verticalErrFt: number;
  /** Barrel placement error along the bat, ft (+ toward the end of the bat). */
  alongErrFt: number;
  /** Bat speed multiplier for this swing (effort / protect-mode / fatigue). */
  batSpeedMult?: number;
  /** Squared to bunt: the bat is held out over the plate instead of swung. */
  bunt?: boolean;
  /** Where the bunt is pushed, spray degrees (+ toward 1B, − toward 3B). */
  buntAimDeg?: number;
}

export interface Controller {
  choosePitch(ctx: PitchContext, rng: Rng): PitchDecision;
  decideSwing(ctx: PitchContext, flight: PitchFlight, rng: Rng): SwingDecision;
}

export type PitchResultKind =
  | "ball"
  | "called_strike"
  | "swinging_strike"
  | "foul"
  | "foul_tip"
  | "hbp"
  | "in_play";

export interface PitchResult {
  kind: PitchResultKind;
  flight: PitchFlight;
  decision: PitchDecision;
  swing: SwingDecision;
  contact?: ContactResult;
  path?: BattedBallPath;
  inZone: boolean;
  /** When the bat met the ball (s after the flight's start), for swings. */
  contactT?: number;
  /** A taken ball the catcher couldn't handle (in the dirt / way wide): runners move up. */
  wildPitch?: boolean;
  /** The batter bunted (foul with two strikes is a strikeout; fielders charge). */
  bunt?: boolean;
  /** An ABS challenge reversed the umpire's call (kind is the corrected call). */
  absOverturned?: boolean;
}

/** Where a batter stands: inner edge of the body ~1.9 ft from plate center on his side. */
const BODY_INNER_PX = 1.95;

export function playPitch(ctx: PitchContext, pitching: Controller, batting: Controller, rng: Rng): PitchResult {
  const decision = pitching.choosePitch(ctx, rng);
  const flight = throwPitchPhase(ctx, decision, rng);
  const swing = batting.decideSwing(ctx, flight, rng);
  return resolveSwingPhase(ctx, decision, flight, swing, rng);
}

/** Release the pitch: Magnus flight to the plate with fatigue applied. */
export function throwPitchPhase(ctx: PitchContext, decision: PitchDecision, rng: Rng): PitchFlight {
  const pitch = ctx.pitcher.arsenal[decision.pitchIdx] ?? ctx.pitcher.arsenal[0];
  // Fatigue: past stamina, velocity fades and command loosens.
  const over = Math.max(0, ctx.pitchCount - ctx.pitcher.stamina);
  const flight = throwPitch(
    pitch,
    {
      targetPx: decision.targetPx,
      targetPz: decision.targetPz,
      commandMult: decision.commandMult * (1 + over * 0.012),
      speedDeltaMph: -over * 0.05,
      air: ctx.park.air,
    },
    rng,
  );
  return flight;
}

/** Ideal bat–ball meeting time (s after the flight's start): ~1.6 ft in front of the plate. */
export function idealContactTime(flight: PitchFlight): number {
  return flight.cross.t - 1.6 / len(flight.cross.v);
}

/** Take or swing: umpire, HBP, bat–ball collision, batted-ball path. */
/** Umpire's spread at the zone edge, ft (1 SD): tighter on the sides than at the top and bottom. */
export const UMP_SD_SIDE_FT = 0.075;
export const UMP_SD_HEIGHT_FT = 0.12;

/**
 * The umpire's call on a taken pitch. Well inside or well outside the zone he is never
 * wrong; within a couple of inches of the edge he is a person — each call has its own
 * scatter (wider at the knees and letters than on the corners), and the count leans on
 * him a little (a wider zone at 3-0, a tighter one at 0-2), as Statcast shows real umps do.
 * `g1`, `g2` are standard normal draws.
 */
export function umpireCall(
  flight: PitchFlight,
  zoneBottom: number,
  zoneTop: number,
  inZone: boolean,
  count: Count,
  g1: number,
  g2: number,
  ump?: UmpTendency,
): boolean {
  const { margin, nearSide } = umpireGeometry(flight, zoneBottom, zoneTop, inZone, ump);
  const sd = (nearSide ? UMP_SD_SIDE_FT : UMP_SD_HEIGHT_FT) * (ump?.sd ?? 1);
  const lean = count.balls === 3 && count.strikes === 0 ? 0.035 : count.strikes === 2 && count.balls < 2 ? -0.035 : 0;
  // A different draw per edge, so corners aren't called by one coin.
  return margin + (ump?.zone ?? 0) + lean + (nearSide ? g1 : g2) * sd > 0;
}

/**
 * Where the pitch sits relative to the umpire's zone: signed distance to the deciding
 * edge (+ inside: the nearest one; − outside: the one missed by most), and whether that
 * edge is a side (else the top or bottom). An umpire's `hi` lifts the top and bottom.
 */
export function umpireGeometry(
  flight: Pick<PitchFlight, "px" | "pz"> & Partial<PitchFlight>,
  zoneBottom: number,
  zoneTop: number,
  inZone: boolean,
  ump?: Pick<UmpTendency, "hi">,
): { margin: number; nearSide: boolean } {
  const at = inZone && flight.cross ? (zoneContact(flight as PitchFlight, zoneBottom, zoneTop) ?? { px: flight.px, pz: flight.pz }) : { px: flight.px, pz: flight.pz };
  const r = BALL_RADIUS_FT;
  const lift = ump?.hi ?? 0;
  const side = PLATE_HALF_WIDTH + r - Math.abs(at.px);
  const height = Math.min(at.pz - (zoneBottom + lift - r), zoneTop + lift + r - at.pz);
  const nearSide = side <= height;
  return { margin: Math.min(side, height), nearSide };
}

export function resolveSwingPhase(
  ctx: PitchContext,
  decision: PitchDecision,
  flight: PitchFlight,
  swing: SwingDecision,
  rng: Rng,
): PitchResult {
  const inZone = crossesZone(flight, ctx.batter.zoneBottom, ctx.batter.zoneTop);

  // Hit by pitch: the ball crosses where the batter's body is.
  const bodySide = ctx.side === "R" ? -1 : 1; // RHB stands on the catcher's left (−px)
  const inside = flight.px * bodySide;
  if (!swing.swing && inside > BODY_INNER_PX && flight.pz > 0.6 && flight.pz < 5.2 && rng.chance(0.55)) {
    return { kind: "hbp", flight, decision, swing, inZone };
  }

  if (swing.swing && swing.bunt) return resolveBunt(ctx, decision, flight, swing, rng, inZone);

  if (!swing.swing) {
    const called = umpireCall(flight, ctx.batter.zoneBottom, ctx.batter.zoneTop, inZone, ctx.count, rng.gauss(0, 1), rng.gauss(0, 1), ctx.ump);
    let wildPitch = false;
    if (!called && ctx.runnersOn > 0) {
      const pWild = flight.pz < -0.2 ? 0.4 : flight.pz < 0.4 ? 0.12 : Math.abs(flight.px) > 2.0 ? 0.12 : 0.006;
      wildPitch = rng.chance(pWild);
    }
    return { kind: called ? "called_strike" : "ball", flight, decision, swing, inZone, wildPitch };
  }

  // Contact point: on time ≈ 1.6 ft in front of the plate; early meets it farther out.
  // Way early/late swings still reach the ball's path at the edge of the hitting zone —
  // they produce dribblers and fouls, not whiffs (whiffs come from missing the plane).
  const contactT = idealContactTime(flight) + clamp(swing.timingErrMs, -60, 45) / 1000;
  const at = pitchStateAt(flight, contactT);
  const b = ctx.batter;
  const pullDir = ctx.side === "R" ? -1 : 1;
  const pathSprayDeg =
    b.sprayMeanDeg * 0.6 + -swing.timingErrMs * 0.85 * pullDir + flight.px * 9;
  const contact = resolveContact(at.v, at.p, {
    batSpeedMph: b.batSpeedMph * (swing.batSpeedMult ?? 1),
    attackAngleDeg: b.attackAngleDeg,
    pathSprayDeg,
    verticalOffsetFt: swing.verticalErrFt,
    alongBarrelFt: clamp(swing.alongErrFt, -1.75, 0.42),
  });
  if (!contact.contact || !contact.ball) {
    return { kind: "swinging_strike", flight, decision, swing, inZone, contact, contactT };
  }
  // Ball deflected backward: foul tip into the mitt (strike, catchable) or foul back.
  if (contact.ball.v.z < 0) {
    const nearPitchLine = (contact.exitSpeedMph ?? 0) > 50 && Math.abs(contact.launchAngleDeg ?? 0) < 20;
    if (nearPitchLine && rng.chance(0.55)) return { kind: "foul_tip", flight, decision, swing, inZone, contact, contactT };
    // Simulated anyway so the foul can be drawn flying back into the screen / stands.
    return { kind: "foul", flight, decision, swing, inZone, contact, contactT, path: simulateBattedBall(contact.ball, ctx.park) };
  }
  const path = simulateBattedBall(contact.ball, ctx.park);
  return { kind: "in_play", flight, decision, swing, inZone, contact, contactT, path };
}

/**
 * A bunt: the bat is held still over the plate, so the ball comes off it slowly. The
 * batter pulls the bat back on a pitch well off the plate (a take); otherwise skill
 * (bat control), location and velocity decide contact, foul or fair, and pop-ups on
 * high pitches. Fair bunts die 30–70 ft out toward the aimed line.
 */
function resolveBunt(
  ctx: PitchContext,
  decision: PitchDecision,
  flight: PitchFlight,
  swing: SwingDecision,
  rng: Rng,
  inZone: boolean,
): PitchResult {
  const b = ctx.batter;
  const off = distanceOutsideZone(flight.px, flight.pz, b);
  if (off > 0.42) {
    const take = resolveSwingPhase(ctx, decision, flight, { ...swing, swing: false, bunt: false }, rng);
    return { ...take, swing: { ...swing, swing: false } };
  }
  const skill = b.bunt;
  const velo = flight.releaseSpeedMph;
  const breaking = !["FF", "SI", "FC"].includes(flight.type);
  const pContact = clamp(0.74 + 0.24 * skill - off * 0.7 - (breaking ? 0.06 : 0) - Math.max(0, velo - 95) * 0.012, 0.15, 0.97);
  const contactT = idealContactTime(flight) + 0.012;
  if (!rng.chance(pContact)) return { kind: "swinging_strike", flight, decision, swing, inZone, contactT, bunt: true };
  const at = pitchStateAt(flight, contactT);
  const high = flight.pz > b.zoneTop - 0.25;
  const pFoul = clamp(0.3 - 0.2 * skill + off * 0.35, 0.06, 0.6);
  const pPop = high ? clamp(0.34 - 0.26 * skill, 0.04, 0.4) : clamp(0.06 - 0.05 * skill, 0.01, 0.06);
  const aim = swing.buntAimDeg ?? (ctx.side === "R" ? -28 : 26);
  const roll = rng.next();
  let ev: number, la: number, spray: number, spin: number;
  if (roll < pFoul) {
    // Off the bat toward the stands or back into the screen.
    const back = rng.chance(0.45);
    ev = rng.range(28, 55);
    la = back ? rng.range(15, 50) : rng.range(-20, 25);
    spray = (rng.chance(0.5) ? 1 : -1) * rng.range(back ? 120 : 52, back ? 170 : 85);
    spin = 1200;
  } else if (roll < pFoul + pPop) {
    ev = rng.range(32, 52);
    la = rng.range(38, 62);
    spray = aim * 0.6 + rng.gauss(0, 14);
    spin = 2600;
  } else {
    ev = clamp(rng.gauss(21 + (1 - skill) * 10, 4.5), 12, 45);
    la = clamp(rng.gauss(-13, 8), -40, 6);
    spray = clamp(aim + rng.gauss(0, 13 - 7 * skill), -47, 47);
    spin = -700;
  }
  const ball = battedBallFromLaunch(ev, la, spray, spin, 0, at.p);
  const contact = { contact: true, ball, exitSpeedMph: ev, launchAngleDeg: la, sprayDeg: spray, backspinRpm: spin, q: 0.04 };
  const path = simulateBattedBall(ball, ctx.park);
  const kind: PitchResultKind = Math.abs(spray) > 45 || ball.v.z < 0 ? "foul" : "in_play";
  return { kind, flight, decision, swing, inZone, contact, contactT, path, bunt: true };
}

/** Zone-relative location helpers for AI and UI. */
export function zoneCenter(b: BatterModel): number {
  return (b.zoneBottom + b.zoneTop) / 2;
}

export function distanceOutsideZone(px: number, pz: number, b: BatterModel): number {
  const dx = Math.max(0, Math.abs(px) - 0.83);
  const dz = Math.max(0, b.zoneBottom - pz, pz - b.zoneTop);
  return Math.hypot(dx, dz);
}
