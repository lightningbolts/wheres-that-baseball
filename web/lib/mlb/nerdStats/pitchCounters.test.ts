import { describe, expect, it } from "vitest";

import { classifyPitch } from "@/lib/mlb/pitchClassification";
import { recordPitchCounters } from "@/lib/mlb/nerdStats/pitchCounters";
import { createEmptyTeamCounters } from "@/lib/mlb/nerdStats/counters";
import type { PlayPitch } from "@/types/mlb-live";

function basePitch(overrides: Partial<PlayPitch> = {}): PlayPitch {
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
    strikeZoneTop: 3.5,
    strikeZoneBottom: 1.5,
    ...overrides,
  };
}

describe("classifyPitch", () => {
  it("returns null for non-pitch events", () => {
    expect(classifyPitch(basePitch({ isPitch: false }))).toBeNull();
  });

  it("classifies fouls even when MLB marks isStrike true", () => {
    const foul = classifyPitch(
      basePitch({
        isStrike: true,
        isBall: false,
        isInPlay: false,
        callDescription: "Foul",
        callCode: "F",
      }),
    );
    expect(foul?.isFoul).toBe(true);
    expect(foul?.isStrike).toBe(false);
  });

  it("classifies foul bunts by call code", () => {
    const foulBunt = classifyPitch(
      basePitch({
        isStrike: true,
        isBall: false,
        isInPlay: false,
        callDescription: "Foul Bunt",
        callCode: "L",
      }),
    );
    expect(foulBunt?.isFoul).toBe(true);
    expect(foulBunt?.isStrike).toBe(false);
  });

  it("detects swinging and called strikes", () => {
    const swinging = classifyPitch(
      basePitch({ callDescription: "Swinging Strike", isStrike: true }),
    );
    const called = classifyPitch(
      basePitch({ callDescription: "Called Strike", isStrike: true }),
    );
    expect(swinging?.isSwingingStrike).toBe(true);
    expect(called?.isCalledStrike).toBe(true);
  });
});

describe("recordPitchCounters", () => {
  it("credits offense and defense pitch totals", () => {
    const offense = createEmptyTeamCounters();
    const defense = createEmptyTeamCounters();

    recordPitchCounters(offense, defense, basePitch({ isInPlay: true, isStrike: false }));
    recordPitchCounters(
      offense,
      defense,
      basePitch({
        isStrike: true,
        isBall: false,
        isInPlay: false,
        callDescription: "Foul",
        callCode: "F",
      }),
    );
    recordPitchCounters(
      offense,
      defense,
      basePitch({ isBall: true, isStrike: false, callDescription: "Ball" }),
    );

    expect(offense.pitchesSeen).toBe(3);
    expect(defense.pitchesThrown).toBe(3);
    expect(offense.ballsInPlay).toBe(1);
    expect(offense.foulBalls).toBe(1);
    expect(offense.pitchBalls).toBe(1);
    expect(defense.foulsInduced).toBe(1);
    expect(defense.ballsInPlayAllowed).toBe(1);
  });
});
