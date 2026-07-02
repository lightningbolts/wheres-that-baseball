import { describe, expect, it } from "vitest";

import { isScoreablePitch, pitchActual, pitchKey } from "@/lib/mlb/callItGame";
import type { PlayPitch } from "@/types/mlb-live";

function pitch(overrides: Partial<PlayPitch> = {}): PlayPitch {
  return {
    pitchNumber: 1,
    typeCode: "FF",
    typeDescription: "Four-Seam Fastball",
    callDescription: "Called Strike",
    callCode: "C",
    balls: 0,
    strikes: 1,
    startSpeed: 95,
    plateX: 0,
    plateZ: 2.5,
    isStrike: true,
    isBall: false,
    isInPlay: false,
    isOut: false,
    isPitch: true,
    hasPlateLocation: true,
    strikeZoneTop: 3.5,
    strikeZoneBottom: 1.5,
    ...overrides,
  };
}

describe("isScoreablePitch", () => {
  it("accepts called strikes and balls", () => {
    expect(isScoreablePitch(pitch({ isStrike: true, isBall: false }))).toBe(true);
    expect(isScoreablePitch(pitch({ isStrike: false, isBall: true }))).toBe(true);
  });

  it("rejects fouls and in-play events", () => {
    expect(isScoreablePitch(pitch({ isStrike: false, isBall: false, isInPlay: true }))).toBe(false);
    expect(isScoreablePitch(pitch({ isStrike: true, isBall: false, isInPlay: true }))).toBe(false);
  });

  it("rejects non-pitch rows", () => {
    expect(isScoreablePitch(pitch({ isPitch: false }))).toBe(false);
  });
});

describe("pitchActual", () => {
  it("maps MLB flags to strike or ball", () => {
    expect(pitchActual(pitch({ isStrike: true, isBall: false }))).toBe("strike");
    expect(pitchActual(pitch({ isStrike: false, isBall: true }))).toBe("ball");
  });
});

describe("pitchKey", () => {
  it("dedupes by batter and pitch number", () => {
    expect(pitchKey(123, 2)).toBe("123:2");
    expect(pitchKey(null, 1)).toBe("0:1");
  });
});
