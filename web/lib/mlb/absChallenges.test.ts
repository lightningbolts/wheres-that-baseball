import { describe, expect, it } from "vitest";

import {
  computeAbsChallengesRemaining,
  countAbsChallengesUsedFromPlays,
  resolveAbsChallengesUsed,
} from "@/lib/mlb/absChallenges";

const TOR_SEA_OPTIONS = {
  awayTeamId: 141,
  homeTeamId: 136,
  awayTeamName: "Toronto Blue Jays",
  homeTeamName: "Seattle Mariners",
  awayAbbrev: "TOR",
  homeAbbrev: "SEA",
};

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
  const teamOptions = {
    awayTeamId: 138,
    homeTeamId: 112,
    awayTeamName: "St. Louis Cardinals",
    homeTeamName: "Chicago Cubs",
    awayAbbrev: "STL",
    homeAbbrev: "CHC",
  };

  it("ignores non-ABS manager reviews on pitch events", () => {
    const allPlays = [
      {
        about: { halfInning: "bottom" },
        result: { description: "J.P. Crawford walks." },
        playEvents: [
          {
            isPitch: true,
            reviewDetails: { inProgress: false, reviewType: "MJ" },
          },
        ],
      },
      {
        about: { halfInning: "top" },
        result: { description: "Andrés Giménez flies out to left fielder Randy Arozarena." },
        playEvents: [
          {
            isPitch: true,
            reviewDetails: { inProgress: false, reviewType: "MJ", isOverturned: true },
          },
        ],
      },
    ];

    expect(countAbsChallengesUsedFromPlays(allPlays)).toEqual({ away: 0, home: 0 });
  });

  it("credits the challenging team via challengeTeamId, including multiple in one at-bat", () => {
    const allPlays = [
      {
        about: { halfInning: "bottom", inning: 1 },
        matchup: {
          batter: { fullName: "Randy Arozarena" },
          pitcher: { fullName: "Dylan Cease" },
        },
        result: {
          description:
            "Randy Arozarena challenged (pitch result), call on the field was confirmed: Randy Arozarena called out on strikes.",
        },
        playEvents: [
          {
            isPitch: true,
            details: { description: "Called Strike" },
          },
          {
            isPitch: true,
            details: { description: "Called Strike" },
            reviewDetails: {
              inProgress: false,
              isOverturned: false,
              reviewType: "MJ",
              challengeTeamId: 136,
            },
          },
        ],
      },
    ];

    const used = countAbsChallengesUsedFromPlays(allPlays, TOR_SEA_OPTIONS);
    expect(used).toEqual({ away: 0, home: 2 });
    expect(computeAbsChallengesRemaining(used.home, 9)).toBe(0);
    expect(computeAbsChallengesRemaining(used.away, 9)).toBe(2);
  });

  it("does not count successful overturned challenges against the limit", () => {
    const allPlays = [
      {
        about: { halfInning: "top" },
        matchup: { batter: { fullName: "Alejandro Kirk" }, pitcher: { fullName: "George Kirby" } },
        result: { description: "Alejandro Kirk grounds out." },
      },
      {
        about: { halfInning: "bottom" },
        matchup: {
          batter: { fullName: "Dominic Canzone" },
          pitcher: { fullName: "Dylan Cease" },
        },
        result: {
          description:
            "Alejandro Kirk challenged (pitch result), call on the field was overturned: Dominic Canzone called out on strikes.",
        },
        reviewDetails: {
          inProgress: false,
          isOverturned: true,
          reviewType: "MJ",
          challengeTeamId: 141,
        },
      },
    ];

    expect(countAbsChallengesUsedFromPlays(allPlays, TOR_SEA_OPTIONS)).toEqual({
      away: 0,
      home: 0,
    });
  });

  it("attributes description-only challenges to the challenger player team", () => {
    const allPlays = [
      {
        about: { halfInning: "bottom" },
        matchup: {
          batter: { fullName: "Alex Bregman" },
          pitcher: { fullName: "Pedro Pagés" },
        },
        result: {
          description:
            "Pedro Pagés challenged (pitch result), call on the field was confirmed: Alex Bregman walks.",
        },
      },
    ];

    expect(countAbsChallengesUsedFromPlays(allPlays, teamOptions)).toEqual({
      away: 1,
      home: 0,
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
    ];

    expect(countAbsChallengesUsedFromPlays(allPlays)).toEqual({
      away: 0,
      home: 0,
    });
  });

  it("ignores stale review.used when play-by-play is available", () => {
    const allPlays = [
      {
        about: { halfInning: "bottom" },
        matchup: {
          batter: { fullName: "Alex Bregman" },
          pitcher: { fullName: "Pedro Pagés" },
        },
        result: {
          description:
            "Pedro Pagés challenged (pitch result), call on the field was confirmed: Alex Bregman walks.",
        },
      },
    ];

    expect(resolveAbsChallengesUsed(allPlays, 138, 112, 0, 2, teamOptions)).toEqual({
      away: 1,
      home: 0,
    });
  });

  it("prefers MLB review totals when hasChallenges and play parsing disagrees", () => {
    const allPlays = [
      {
        about: { halfInning: "top" },
        matchup: {
          batter: { fullName: "Moisés Ballesteros" },
          pitcher: { fullName: "Hunter Feduccia" },
        },
        result: {
          description:
            "Hunter Feduccia challenged (pitch result), call on the field was confirmed: Moisés Ballesteros walks.",
        },
      },
      {
        about: { halfInning: "bottom" },
        matchup: {
          batter: { fullName: "Jake Fraley" },
          pitcher: { fullName: "Carson Kelly" },
        },
        result: {
          description:
            "Carson Kelly challenged (pitch result), call on the field was overturned: Jake Fraley called out on strikes.",
        },
      },
      {
        about: { halfInning: "top" },
        matchup: {
          batter: { fullName: "Alex Bregman" },
          pitcher: { fullName: "Hunter Feduccia" },
        },
        result: {
          description:
            "Alex Bregman challenged (pitch result), call on the field was overturned: Alex Bregman walks.",
        },
      },
    ];

    expect(
      resolveAbsChallengesUsed(allPlays, 112, 139, 0, 2, {
        hasChallenges: true,
        awayTeamId: 112,
        homeTeamId: 139,
        awayTeamName: "Chicago Cubs",
        homeTeamName: "Tampa Bay Rays",
        awayAbbrev: "CHC",
        homeAbbrev: "TB",
      }),
    ).toEqual({ away: 0, home: 2 });
  });
});
