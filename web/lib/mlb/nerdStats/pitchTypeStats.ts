import type { PitchTypeAccumulator } from "@/lib/mlb/nerdStats/types";
import type { PlayPitch } from "@/types/mlb-live";

export const TRACKED_PITCH_TYPES = [
  { code: "FF", label: "Four-Seam" },
  { code: "SI", label: "Sinker" },
  { code: "SL", label: "Slider" },
  { code: "CH", label: "Changeup" },
  { code: "CU", label: "Curveball" },
  { code: "FC", label: "Cutter" },
  { code: "ST", label: "Sweeper" },
  { code: "SV", label: "Slurve" },
] as const;

export type TrackedPitchTypeCode = (typeof TRACKED_PITCH_TYPES)[number]["code"];

export function createEmptyPitchTypeAccumulator(): PitchTypeAccumulator {
  return {
    count: 0,
    velocitySum: 0,
    spinSum: 0,
    hBreakSum: 0,
    vBreakSum: 0,
  };
}

export function createEmptyPitchTypesThrown(): Record<string, PitchTypeAccumulator> {
  const record: Record<string, PitchTypeAccumulator> = {};
  for (const { code } of TRACKED_PITCH_TYPES) {
    record[code] = createEmptyPitchTypeAccumulator();
  }
  return record;
}

export function mergePitchTypesThrown(
  target: Record<string, PitchTypeAccumulator>,
  source: Record<string, PitchTypeAccumulator>,
): void {
  for (const [code, src] of Object.entries(source)) {
    const acc = target[code] ?? createEmptyPitchTypeAccumulator();
    acc.count += src.count;
    acc.velocitySum += src.velocitySum;
    acc.spinSum += src.spinSum;
    acc.hBreakSum += src.hBreakSum;
    acc.vBreakSum += src.vBreakSum;
    target[code] = acc;
  }
}

export function recordPitchTypeThrown(
  pitchingTeam: { pitchTypesThrown: Record<string, PitchTypeAccumulator> },
  pitch: PlayPitch,
): void {
  if (!pitch.isPitch || pitch.startSpeed <= 0) return;

  const code = pitch.typeCode;
  if (!code || code === "—") return;

  const acc = pitchingTeam.pitchTypesThrown[code] ?? createEmptyPitchTypeAccumulator();
  acc.count += 1;
  acc.velocitySum += pitch.startSpeed;
  if (pitch.spinRate != null && pitch.spinRate > 0) acc.spinSum += pitch.spinRate;
  if (pitch.breakHorizontal != null) acc.hBreakSum += pitch.breakHorizontal;
  if (pitch.breakVerticalInduced != null) acc.vBreakSum += pitch.breakVerticalInduced;
  pitchingTeam.pitchTypesThrown[code] = acc;
}
