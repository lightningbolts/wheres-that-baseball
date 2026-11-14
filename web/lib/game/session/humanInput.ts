/**
 * Map human controls onto the same SwingDecision / PitchDecision the CPU produces,
 * so human and CPU at-bats run through identical physics.
 */
import type { PitchDecision, SwingDecision } from "@/lib/game/engine/atBat";
import { idealContactTime } from "@/lib/game/engine/atBat";
import type { PitchFlight } from "@/lib/game/physics/pitch";
import { LEAGUE, type BatterModel } from "@/lib/game/ratings";
import type { Difficulty } from "@/lib/game/session/session";
import { clamp, type Rng } from "@/lib/game/math";

export interface DifficultyParams {
  label: string;
  /** Playback speed of the pitch (physics is unchanged). */
  timeScale: number;
  /** Fraction of the human's timing / aim error that reaches the bat. */
  timing: number;
  aim: number;
  /** Plate-coverage indicator size multiplier. */
  pci: number;
  /** Pitch-meter penalty multiplier. */
  meter: number;
  /** Flight-time timing error (ms) that is forgiven entirely: the "on time" window. */
  window: number;
}

export const DIFFICULTY: Record<Difficulty, DifficultyParams> = {
  rookie: { label: "Rookie", timeScale: 0.42, timing: 0.5, aim: 0.6, pci: 1.3, meter: 0.7, window: 24 },
  pro: { label: "Pro", timeScale: 0.62, timing: 0.65, aim: 0.75, pci: 1.05, meter: 1.0, window: 14 },
  allstar: { label: "All-Star", timeScale: 0.85, timing: 0.9, aim: 0.95, pci: 0.85, meter: 1.25, window: 6 },
};

/** Who is batting, for sizing the PCI and the power swing (all optional: defaults are league average). */
export type PciBatter = Pick<BatterModel, "zContact" | "oContact" | "batSpeedMph">;

/**
 * Contact skill → PCI size: an elite bat-to-ball hitter (zContact ~.93) gets a box
 * ~25% bigger than average, a free swinger (~.72) ~20% smaller.
 */
export function contactScale(b?: PciBatter): number {
  if (!b) return 1;
  const c = b.zContact * 0.8 + b.oContact * 0.2;
  const lg = LEAGUE.zContact * 0.8 + LEAGUE.oContact * 0.2;
  return clamp(1 + (c - lg) * 2.3, 0.78, 1.28);
}

/**
 * Raw power (bat speed, from his 90th-pct exit velocity) → how much a power swing
 * pays: big boppers lose less box and gain more bat speed than slap hitters.
 */
export function powerScale(b?: PciBatter): number {
  if (!b) return 0.5;
  return clamp((b.batSpeedMph - 66) / 10, 0, 1);
}

/** Plate-coverage indicator half-size (ft) in Statcast plate coordinates. */
export function pciHalfSize(power: boolean, difficulty: Difficulty, batter?: PciBatter): { w: number; h: number } {
  const shrink = power ? 0.66 + 0.12 * powerScale(batter) : 1;
  const k = DIFFICULTY[difficulty].pci * contactScale(batter) * shrink;
  return { w: 0.5 * k, h: 0.36 * k };
}

/** Errors inside the on-time window are forgiven; beyond it they grow from zero. */
function forgive(errMs: number, windowMs: number): number {
  const a = Math.abs(errMs);
  if (a <= windowMs) return 0;
  return Math.sign(errMs) * (a - windowMs);
}

/**
 * A swing is not instant: the bat needs this long (flight time) from the button
 * press to reach the hitting zone, so the on-time press comes this far ahead of
 * the ideal contact time and the swing animation can start on the press itself.
 */
export const SWING_LEAD_S = 0.085;
/** Pressing with less than this much time before the latest possible contact is a late whiff. */
const MIN_SWING_S = 0.035;

export interface HumanSwingInput {
  /** Flight time (s) when the swing button was pressed; null = took the pitch. */
  pressT: number | null;
  /** PCI center at the plate, Statcast px / pz (ft). */
  pciPx: number;
  pciPz: number;
  power: boolean;
}

export function humanSwing(
  input: HumanSwingInput,
  flight: PitchFlight,
  batter: BatterModel,
  side: "L" | "R",
  difficulty: Difficulty,
  rng: Rng,
): SwingDecision {
  if (input.pressT == null) return { swing: false, timingErrMs: 0, verticalErrFt: 0, alongErrFt: 0 };
  const d = DIFFICULTY[difficulty];
  const { w, h } = pciHalfSize(input.power, difficulty, batter);
  const ideal = idealContactTime(flight);
  const timingErrMs = forgive((input.pressT + SWING_LEAD_S - ideal) * 1000, d.window) * d.timing + rng.gauss(0, batter.timingSdMs * 0.2);
  // The ball is already by him: the bat can't get there, whatever the aim.
  if (input.pressT > ideal + 0.045 - MIN_SWING_S) {
    return { swing: true, timingErrMs: Math.max(timingErrMs, 45), verticalErrFt: -0.6, alongErrFt: 0 };
  }
  const dx = flight.px - input.pciPx;
  const dz = flight.pz - input.pciPz;
  // Ball outside the barrel's coverage: a clean miss over or under it.
  if (Math.abs(dx) > w + 0.1 || Math.abs(dz) > h + 0.08) {
    return { swing: true, timingErrMs, verticalErrFt: Math.sign(dz || 1) * -0.6, alongErrFt: 0 };
  }
  // + vertical = bat under the ball (ball above the PCI center) → lift.
  const verticalErrFt = (dz / h) * 0.11 * d.aim + batter.liftOffsetFt + rng.gauss(0, batter.verticalSdFt * 0.4);
  const bodySide = side === "R" ? -1 : 1;
  const insideAmt = dx * bodySide; // ball more inside than the PCI → toward the handle
  const alongErrFt = (-insideAmt / w) * 0.6 * d.aim + rng.gauss(0, 0.1);
  const batSpeedMult = input.power ? 1.02 + 0.035 * powerScale(batter) : 0.985;
  return { swing: true, timingErrMs, verticalErrFt, alongErrFt, batSpeedMult };
}

/**
 * Pitch meter: a needle sweeping 0→1→0; 0.5 is the sweet spot. Returns the
 * execution multiplier on the pitcher's real command (0.6 = paint, 2.2 = yanked).
 */
export function meterToCommand(meter: number, difficulty: Difficulty): number {
  const err = Math.min(1, Math.abs(meter - 0.5) * 2);
  return 0.6 + 1.6 * Math.pow(err, 1.4) * DIFFICULTY[difficulty].meter;
}

/** Meter needle position for elapsed seconds (triangle wave, ~1.15 sweeps/s). */
export function meterAt(seconds: number, speed = 1.15): number {
  const x = (seconds * speed) % 2;
  return x < 1 ? x : 2 - x;
}

export function humanPitch(pitchIdx: number, targetPx: number, targetPz: number, meter: number, difficulty: Difficulty): PitchDecision {
  return { pitchIdx, targetPx, targetPz, commandMult: meterToCommand(meter, difficulty) };
}
