import { describe, expect, it } from "vitest";

import { encodeBaseState, homeWinProbability } from "@/lib/mlb/winExpectancy";
import { annotatePlayByPlayWithWpa, formatPlayWinProbabilityLine, formatWpa } from "@/lib/mlb/wpa";
import type { PlayByPlayEntry } from "@/types/mlb-live";

describe("encodeBaseState", () => {
  it("maps runner combinations to Tango base codes", () => {
    expect(encodeBaseState(false, false, false)).toBe(1);
    expect(encodeBaseState(true, false, false)).toBe(2);
    expect(encodeBaseState(false, true, false)).toBe(3);
    expect(encodeBaseState(true, true, false)).toBe(4);
    expect(encodeBaseState(false, false, true)).toBe(5);
    expect(encodeBaseState(true, false, true)).toBe(6);
    expect(encodeBaseState(false, true, true)).toBe(7);
    expect(encodeBaseState(true, true, true)).toBe(8);
  });
});

describe("homeWinProbability", () => {
  it("is 50% at the start of a game", () => {
    const probability = homeWinProbability({
      inning: 1,
      halfInning: "top",
      outs: 0,
      onFirst: false,
      onSecond: false,
      onThird: false,
      awayScore: 0,
      homeScore: 0,
    });
    expect(probability).toBeCloseTo(0.5, 2);
  });

  it("favors the home team when they lead late", () => {
    const probability = homeWinProbability({
      inning: 9,
      halfInning: "bottom",
      outs: 0,
      onFirst: false,
      onSecond: false,
      onThird: false,
      awayScore: 2,
      homeScore: 3,
    });
    expect(probability).toBeGreaterThan(0.9);
  });
});

describe("annotatePlayByPlayWithWpa", () => {
  it("assigns positive WPA to a go-ahead home run", () => {
    const play: PlayByPlayEntry = {
      atBatIndex: 1,
      inning: 9,
      halfInning: "bottom",
      batterId: 1,
      batterName: "Test Batter",
      batterHits: 1,
      batterAtBats: 4,
      event: "Home Run",
      description: "Test Batter homers.",
      awayScore: 2,
      homeScore: 3,
      outs: 0,
      bases: {},
      onFirst: false,
      onSecond: false,
      onThird: false,
      situationBefore: {
        awayScore: 2,
        homeScore: 2,
        outs: 0,
        bases: {},
        onFirst: false,
        onSecond: false,
        onThird: false,
      },
      isScoringPlay: true,
      isAtBat: true,
      detail: {
        atBatIndex: 1,
        batterId: 1,
        batterName: "Test Batter",
        batterHits: 1,
        batterAtBats: 4,
        pitcherName: "Pitcher",
        pitcherId: 2,
        event: "Home Run",
        description: "Test Batter homers.",
        inning: 9,
        halfInning: "bottom",
        awayScore: 2,
        homeScore: 3,
        isScoringPlay: true,
        pitches: [],
        hit: null,
      },
    };

    const [annotated] = annotatePlayByPlayWithWpa([play]);
    expect(annotated.wpa).toBeGreaterThan(0.2);
    expect(annotated.homeWinProbAfter).toBe(1);
  });
});

describe("formatWpa", () => {
  it("formats signed percentages", () => {
    expect(formatWpa(0.123)).toBe("+12.3%");
    expect(formatWpa(-0.031)).toBe("-3.1%");
  });
});

describe("formatPlayWinProbabilityLine", () => {
  it("shows batting-team WP before and after with WPA", () => {
    expect(
      formatPlayWinProbabilityLine({
        halfInning: "bottom",
        homeWinProbBefore: 0.32,
        homeWinProbAfter: 0.45,
        wpa: 0.13,
      }),
    ).toBe("32% → 45% · +13.0% WPA");
  });

  it("uses away-team WP in the top half", () => {
    expect(
      formatPlayWinProbabilityLine({
        halfInning: "top",
        homeWinProbBefore: 0.6,
        homeWinProbAfter: 0.7,
        wpa: -0.1,
      }),
    ).toBe("40% → 30% · -10.0% WPA");
  });
});
