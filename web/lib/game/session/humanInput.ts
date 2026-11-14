/**
 * Map human controls onto the same SwingDecision / PitchDecision the CPU produces,
 * so human and CPU at-bats run through identical physics.
 */
import type { PitchDecision, SwingDecision } from "@/lib/game/engine/atBat";
import { idealContactTime } from "@/lib/game/engine/atBat";
import type { PitchFlight } from "@/lib/game/physics/pitch";
import type { BatterModel } from "@/lib/game/ratings";
import type { Difficulty } from "@/lib/game/session/session";
import type { Rng } from "@/lib/game/math";

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
}

export const DIFFICULTY: Record<Difficulty, DifficultyParams> = {
  rookie: { label: "Rookie", timeScale: 0.42, timing: 0.55, aim: 0.6, pci: 1.3, meter: 0.7 },
  pro: { label: "Pro", timeScale: 0.62, timing: 0.75, aim: 0.8, pci: 1.0, meter: 1.0 },
  allstar: { label: "All-Star", timeScale: 0.85, timing: 1.0, aim: 1.0, pci: 0.82, meter: 1.25 },
};

/** Plate-coverage indicator half-size (ft) in Statcast plate coordinates. */
export function pciHalfSize(power: boolean, difficulty: Difficulty): { w: number; h: number } {
  const k = DIFFICULTY[difficulty].pci * (power ? 0.72 : 1);
  return { w: 0.5 * k, h: 0.36 * k };
}

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
  const { w, h } = pciHalfSize(input.power, difficulty);
  const timingErrMs = (input.pressT - idealContactTime(flight)) * 1000 * d.timing + rng.gauss(0, batter.timingSdMs * 0.25);
  const dx = flight.px - input.pciPx;
  const dz = flight.pz - input.pciPz;
  // Ball outside the barrel's coverage: a clean miss over or under it.
  if (Math.abs(dx) > w + 0.1 || Math.abs(dz) > h + 0.08) {
    return { swing: true, timingErrMs, verticalErrFt: Math.sign(dz || 1) * -0.6, alongErrFt: 0 };
  }
  // + vertical = bat under the ball (ball above the PCI center) → lift.
  const verticalErrFt = (dz / h) * 0.13 * d.aim + batter.liftOffsetFt + rng.gauss(0, batter.verticalSdFt * 0.45);
  const bodySide = side === "R" ? -1 : 1;
  const insideAmt = dx * bodySide; // ball more inside than the PCI → toward the handle
  const alongErrFt = (-insideAmt / w) * 0.75 * d.aim + rng.gauss(0, 0.12);
  return { swing: true, timingErrMs, verticalErrFt, alongErrFt, batSpeedMult: input.power ? 1.035 : 0.985 };
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
