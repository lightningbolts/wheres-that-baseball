import { describe, expect, it } from "vitest";

import { extractGameHits } from "@/lib/mlb/gameHits";
import type { PlayByPlayEntry, PlayDetail } from "@/types/mlb-live";

const hitData = {
  launchSpeed: 98,
  launchAngle: 12,
  totalDistance: 280,
  trajectory: "line_drive",
  hardness: "hard",
  location: "8",
  coordX: 125,
  coordY: 160,
};

function makePlay(overrides: Partial<PlayByPlayEntry> = {}): PlayByPlayEntry {
  const detail: PlayDetail = {
    atBatIndex: 3,
    batterId: 100,
    batterName: "Batter",
    batterHits: 1,
    batterAtBats: 2,
    pitcherName: "Pitcher Ace",
    pitcherId: 200,
    event: "Single",
    description: "Line drive single",
    inning: 2,
    halfInning: "top",
    awayScore: 0,
    homeScore: 0,
    isScoringPlay: false,
    pitches: [],
    hit: hitData,
    ...(overrides.detail ?? {}),
  };

  return {
    atBatIndex: 3,
    inning: 2,
    halfInning: "top",
    batterId: 100,
    batterName: "Batter",
    batterHits: 1,
    batterAtBats: 2,
    event: "Single",
    description: "Line drive single",
    awayScore: 0,
    homeScore: 0,
    outs: 0,
    bases: {},
    onFirst: false,
    onSecond: false,
    onThird: false,
    situationBefore: {
      outs: 0,
      bases: {},
      onFirst: false,
      onSecond: false,
      onThird: false,
      awayScore: 0,
      homeScore: 0,
    },
    isScoringPlay: false,
    isAtBat: true,
    detail,
    ...overrides,
  };
}

describe("extractGameHits pitcher fields", () => {
  it("captures pitcherId and pitcherName from play detail", () => {
    const hits = extractGameHits([makePlay()]);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.pitcherId).toBe(200);
    expect(hits[0]!.pitcherName).toBe("Pitcher Ace");
    expect(hits[0]!.batterId).toBe(100);
  });

  it("allows null pitcherId", () => {
    const hits = extractGameHits([
      makePlay({
        detail: {
          ...makePlay().detail,
          pitcherId: null,
          pitcherName: "",
        },
      }),
    ]);
    expect(hits[0]!.pitcherId).toBeNull();
  });
});
