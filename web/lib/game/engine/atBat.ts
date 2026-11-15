/**
 * One pitch, physically: select → throw (Magnus flight) → take or swing →
 * bat–ball collision → batted-ball path. Decisions come from Controllers so a
 * human (UI input) and the CPU (AI) drive the exact same physics.
 */
import { throwPitch, isStrike, pitchStateAt, PLATE_FRONT_Z, type PitchFlight } from "@/lib/game/physics/pitch";
import { resolveContact, type ContactResult } from "@/lib/game/physics/batBall";
import { simulateBattedBall, type BattedBallPath } from "@/lib/game/physics/battedBall";
import type { Park } from "@/lib/game/physics/park";
import type { BatterModel, PitcherModel } from "@/lib/game/ratings";
import { clamp, len, type Rng } from "@/lib/game/math";

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
  park: Park;
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
export function resolveSwingPhase(
  ctx: PitchContext,
  decision: PitchDecision,
  flight: PitchFlight,
  swing: SwingDecision,
  rng: Rng,
): PitchResult {
  const inZone = isStrike(flight.px, flight.pz, ctx.batter.zoneBottom, ctx.batter.zoneTop);

  // Hit by pitch: the ball crosses where the batter's body is.
  const bodySide = ctx.side === "R" ? -1 : 1; // RHB stands on the catcher's left (−px)
  const inside = flight.px * bodySide;
  if (!swing.swing && inside > BODY_INNER_PX && flight.pz > 0.6 && flight.pz < 5.2 && rng.chance(0.55)) {
    return { kind: "hbp", flight, decision, swing, inZone };
  }

  if (!swing.swing) {
    // Umpire: Statcast zone with a little edge noise (~1 in).
    const called = isStrike(flight.px + rng.gauss(0, 0.07), flight.pz + rng.gauss(0, 0.07), ctx.batter.zoneBottom, ctx.batter.zoneTop);
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

/** Zone-relative location helpers for AI and UI. */
export function zoneCenter(b: BatterModel): number {
  return (b.zoneBottom + b.zoneTop) / 2;
}

export function distanceOutsideZone(px: number, pz: number, b: BatterModel): number {
  const dx = Math.max(0, Math.abs(px) - 0.83);
  const dz = Math.max(0, b.zoneBottom - pz, pz - b.zoneTop);
  return Math.hypot(dx, dz);
}
