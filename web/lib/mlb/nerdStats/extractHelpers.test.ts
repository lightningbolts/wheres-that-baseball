import { describe, expect, it } from "vitest";

import {
  batterReachedOnError,
  countThrowingErrors,
  isFieldingError,
} from "@/lib/mlb/nerdStats/extractHelpers";
import type { PlayByPlayEntry } from "@/types/mlb-live";

function makePlay(overrides: Partial<PlayByPlayEntry>): PlayByPlayEntry {
  return {
    atBatIndex: 0,
    inning: 1,
    halfInning: "top",
    batterId: 1,
    batterName: "Batter",
    batterHits: 0,
    batterAtBats: 0,
    event: "Single",
    description: "",
    awayScore: 0,
    homeScore: 0,
    outs: 0,
    bases: {},
    onFirst: false,
    onSecond: false,
    onThird: false,
    situationBefore: {
      awayScore: 0,
      homeScore: 0,
      outs: 0,
      bases: {},
      onFirst: false,
      onSecond: false,
      onThird: false,
    },
    isScoringPlay: false,
    isAtBat: true,
    detail: {
      atBatIndex: 0,
      batterId: 1,
      batterName: "Batter",
      batterHits: 0,
      batterAtBats: 0,
      pitcherName: "Pitcher",
      pitcherId: 2,
      event: "Single",
      description: "",
      inning: 1,
      halfInning: "top",
      awayScore: 0,
      homeScore: 0,
      isScoringPlay: false,
      pitches: [],
      hit: null,
    },
    ...overrides,
  };
}

describe("error helpers", () => {
  it("detects field errors and reached-on-error", () => {
    const play = makePlay({
      event: "Field Error",
      description: "TJ Rumfield reaches on a fielding error by right fielder Jo Adell.",
    });

    expect(isFieldingError(play)).toBe(true);
    expect(batterReachedOnError(play)).toBe(true);
    expect(countThrowingErrors(play)).toBe(0);
  });

  it("counts throwing errors without crediting reached on error for FC plays", () => {
    const play = makePlay({
      event: "Fielders Choice",
      description:
        "Dansby Swanson reaches on a fielder's choice, fielded by shortstop Xander Bogaerts. Miguel Amaya advances to 3rd, on a fielding error by second baseman Jake Cronenworth.",
    });

    expect(isFieldingError(play)).toBe(true);
    expect(batterReachedOnError(play)).toBe(false);
    expect(countThrowingErrors(play)).toBe(0);
  });

  it("counts multiple throwing errors on one play", () => {
    const play = makePlay({
      event: "Single",
      description:
        "Jake McCarthy singles on a line drive to left fielder Wade Meckler. Jake McCarthy advances to 2nd, on a throwing error by left fielder Wade Meckler.",
    });

    expect(countThrowingErrors(play)).toBe(1);
  });
});
