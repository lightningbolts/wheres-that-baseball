import { describe, expect, it } from "vitest";

import {
  computeAbsChallengesRemaining,
  countAbsChallengesUsedFromPlays,
  resolveAbsChallengesUsed,
} from "@/lib/mlb/absChallenges";

describe("computeAbsChallengesRemaining", () => {
  it("starts with 2 in regulation", () => {
    expect(computeAbsChallengesRemaining(0, 1)).toBe(2);
    expect(computeAbsChallengesRemaining(0, 9)).toBe(2);
  });

  it("subtracts used challenges in regulation", () => {
    expect(computeAbsChallengesRemaining(1, 5)).toBe(1);
    expect(computeAbsChallengesRemaining(2, 8)).toBe(0);
  });

  it("adds one back for each extra inning, capped at 2", () => {
    expect(computeAbsChallengesRemaining(2, 10)).toBe(1);
    expect(computeAbsChallengesRemaining(2, 11)).toBe(2);
    expect(computeAbsChallengesRemaining(0, 10)).toBe(2);
  });

  it("never exceeds 2", () => {
    expect(computeAbsChallengesRemaining(0, 15)).toBe(2);
  });
});

describe("countAbsChallengesUsedFromPlays", () => {
  const awayTeamId = 138; // STL
  const homeTeamId = 112; // CHC

  it("attributes ABS pitch challenges via challengeTeamId and excludes HBP reviews", () => {
    const allPlays = [
      {
        about: { halfInning: "bottom" },
        result: { description: "Pete Crow-Armstrong walks." },
        playEvents: [
          {
            isPitch: true,
            reviewDetails: {
              inProgress: false,
              reviewType: "MJ",
              challengeTeamId: homeTeamId,
              isOverturned: false,
            },
          },
        ],
      },
      {
        about: { halfInning: "bottom" },
        result: { description: "Michael Conforto strikes out swinging." },
        playEvents: [
          {
            isPitch: true,
            reviewDetails: {
              inProgress: false,
              reviewType: "MJ",
              challengeTeamId: awayTeamId,
              isOverturned: true,
            },
          },
        ],
      },
      {
        about: { halfInning: "bottom" },
        result: {
          description:
            "Pedro Pagés challenged (pitch result), call on the field was confirmed: Alex Bregman walks.",
        },
        playEvents: [{ isPitch: true, details: { description: "Ball" } }],
      },
      {
        about: { halfInning: "top" },
        result: { description: "Single." },
        playEvents: [
          {
            isPitch: true,
            reviewDetails: {
              inProgress: false,
              reviewType: "MJ",
              challengeTeamId: awayTeamId,
              isOverturned: false,
            },
          },
        ],
      },
    ];

    expect(countAbsChallengesUsedFromPlays(allPlays, awayTeamId, homeTeamId)).toEqual({
      away: 3,
      home: 1,
    });
  });

  it("excludes hit-by-pitch manager reviews from ABS counts", () => {
    const allPlays = [
      {
        about: { halfInning: "bottom" },
        result: {
          description:
            "Marlins challenged (hit by pitch), call on the field was upheld: Joshua Kuroda-Grauer hit by pitch.",
        },
        playEvents: [
          {
            isPitch: true,
            reviewDetails: {
              inProgress: false,
              reviewType: "MJ",
              challengeTeamId: 146,
            },
          },
        ],
      },
      {
        about: { halfInning: "top" },
        result: { description: "Javier Sanoja lines out to right fielder Lawrence Butler." },
        playEvents: [
          {
            isPitch: true,
            reviewDetails: {
              inProgress: false,
              reviewType: "MJ",
              challengeTeamId: 146,
            },
          },
        ],
      },
      {
        about: { halfInning: "bottom" },
        result: { description: "Lawrence Butler strikes out swinging." },
        playEvents: [
          {
            isPitch: true,
            reviewDetails: {
              inProgress: false,
              reviewType: "MJ",
              challengeTeamId: 133,
            },
          },
        ],
      },
      {
        about: { halfInning: "top" },
        result: { description: "Griffin Conine walks." },
        playEvents: [
          {
            isPitch: true,
            reviewDetails: {
              inProgress: false,
              reviewType: "MJ",
              challengeTeamId: 133,
            },
          },
        ],
      },
    ];

    expect(countAbsChallengesUsedFromPlays(allPlays, 146, 133)).toEqual({
      away: 1,
      home: 2,
    });
    expect(computeAbsChallengesRemaining(1, 9)).toBe(1);
    expect(computeAbsChallengesRemaining(2, 9)).toBe(0);
  });

  it("ignores stale review.used when play-by-play is available", () => {
    const allPlays = [
      {
        about: { halfInning: "bottom" },
        result: {
          description:
            "Pedro Pagés challenged (pitch result), call on the field was confirmed: Alex Bregman walks.",
        },
      },
    ];

    expect(
      resolveAbsChallengesUsed(allPlays, awayTeamId, homeTeamId, 0, 2),
    ).toEqual({ away: 1, home: 0 });
    expect(computeAbsChallengesRemaining(1, 9)).toBe(1);
  });
});
