import { playsThroughAtBat } from "@/lib/games/replay";
import type { LiveGameState, PlayPitch } from "@/types/mlb-live";

export interface ZoneDisplayPitch extends PlayPitch {
  /** Stable React key, e.g. "ab-12-p-3". */
  chartKey: string;
  /** True when pitch belongs to the focal (current/replayed) at-bat. */
  isCurrentAtBat: boolean;
}

function isCurrentAbAlreadyLogged(gameState: LiveGameState): boolean {
  const lastPlay = gameState.plays.at(-1);
  return lastPlay?.isAtBat === true && lastPlay.batterId === gameState.batterId;
}

function toZoneDisplayPitch(
  pitch: PlayPitch,
  atBatIndex: number,
  pitchIndex: number,
  isCurrentAtBat: boolean,
): ZoneDisplayPitch {
  return {
    ...pitch,
    chartKey: `ab-${atBatIndex}-p-${pitchIndex}`,
    isCurrentAtBat,
  };
}

function pitchesFromPlays(
  plays: LiveGameState["plays"],
  focalAtBatIndex?: number,
): ZoneDisplayPitch[] {
  const result: ZoneDisplayPitch[] = [];

  for (const play of plays) {
    if (play.isAtBat === false) continue;

    const isCurrentAtBat =
      focalAtBatIndex != null && play.atBatIndex === focalAtBatIndex;

    play.detail.pitches.forEach((pitch, pitchIndex) => {
      result.push(toZoneDisplayPitch(pitch, play.atBatIndex, pitchIndex, isCurrentAtBat));
    });
  }

  return result;
}

/** All pitches thrown in the game up to the current replay point. */
export function allPitchesThroughPoint(
  gameState: LiveGameState,
  options?: { throughAtBatIndex?: number; currentAtBatPitches?: PlayPitch[] },
): ZoneDisplayPitch[] {
  const { throughAtBatIndex, currentAtBatPitches } = options ?? {};

  if (throughAtBatIndex != null) {
    const slice = playsThroughAtBat(gameState.plays, throughAtBatIndex);
    return pitchesFromPlays(slice, throughAtBatIndex);
  }

  const livePitches = currentAtBatPitches ?? gameState.atBatPitches;

  if (livePitches.length > 0 && !isCurrentAbAlreadyLogged(gameState)) {
    const focalAtBatIndex = gameState.plays.at(-1)?.atBatIndex ?? -1;
    const currentAbPitches = livePitches.map((pitch, pitchIndex) =>
      toZoneDisplayPitch(pitch, focalAtBatIndex + 1, pitchIndex, true),
    );
    return [...pitchesFromPlays(gameState.plays), ...currentAbPitches];
  }

  const lastAtBatPlay = [...gameState.plays].reverse().find((play) => play.isAtBat !== false);
  const focalAtBatIndex = lastAtBatPlay?.atBatIndex;
  return pitchesFromPlays(gameState.plays, focalAtBatIndex);
}
