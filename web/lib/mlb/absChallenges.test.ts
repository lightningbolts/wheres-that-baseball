import { describe, expect, it } from "vitest";

import {
  computeAbsChallengesRemaining,
  countAbsChallengesUsedFromPlays,
  resolveAbsChallengesRemaining,
  resolveAbsChallengesUsed,
  resolveAbsChallengesUsedFromFeed,
} from "@/lib/mlb/absChallenges";

const TOR_SEA_OPTIONS = {
  awayTeamId: 141,
  homeTeamId: 136,
  awayTeamName: "Toronto Blue Jays",
  homeTeamName: "Seattle Mariners",
  awayAbbrev: "TOR",
  homeAbbrev: "SEA",
};

const METS_BRAVES_OPTIONS = {
  awayTeamId: 121,
  homeTeamId: 144,
  awayTeamName: "New York Mets",
  homeTeamName: "Atlanta Braves",
  awayAbbrev: "NYM",
  homeAbbrev: "ATL",
};

const GAME_824902_PLAYS = [
  {
    about: { halfInning: "top", inning: 2 },
    matchup: {
      batter: { fullName: "Juan Soto" },
      pitcher: { fullName: "Drake Baldwin" },
    },
    result: {
      description:
        "Juan Soto singles on a line drive to right fielder Mike Yastrzemski. Brett Baty scores. Francisco Lindor scores.",
    },
    playEvents: [
      {
        isPitch: true,
        details: { description: "Called Strike" },
        reviewDetails: {
          isOverturned: true,
          inProgress: false,
          reviewType: "MJ",
          challengeTeamId: 144,
        },
      },
    ],
  },
  {
    about: { halfInning: "top", inning: 2 },
    matchup: {
      batter: { fullName: "Mark Vientos" },
      pitcher: { fullName: "Drake Baldwin" },
    },
    result: {
      description:
        "Mark Vientos grounds into a double play, shortstop Jim Jarvis to second baseman Ozzie Albies to first baseman Matt Olson.",
    },
    playEvents: [
      {
        isPitch: true,
        details: { description: "Called Strike" },
        reviewDetails: {
          isOverturned: false,
          inProgress: false,
          reviewType: "MJ",
          challengeTeamId: 121,
        },
      },
    ],
  },
];

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

  it("prefers absChallenges.usedFailed over stale review.used", () => {
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
        absChallenges: {
          hasChallenges: true,
          away: { usedFailed: 0 },
          home: { usedFailed: 2 },
        },
      }),
    ).toEqual({ away: 0, home: 2 });
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

  it("counts silent pitch-level ABS reviews (game 824902)", () => {
    expect(countAbsChallengesUsedFromPlays(GAME_824902_PLAYS, METS_BRAVES_OPTIONS)).toEqual({
      away: 1,
      home: 0,
    });
  });

  it("does not count overturned silent pitch reviews", () => {
    const allPlays = [
      {
        about: { halfInning: "top", inning: 2 },
        result: {
          description: "Juan Soto singles on a line drive to right fielder Mike Yastrzemski.",
        },
        playEvents: [
          {
            isPitch: true,
            details: { description: "Called Strike" },
            reviewDetails: {
              isOverturned: true,
              inProgress: false,
              reviewType: "MJ",
              challengeTeamId: 144,
            },
          },
        ],
      },
    ];

    expect(countAbsChallengesUsedFromPlays(allPlays, METS_BRAVES_OPTIONS)).toEqual({
      away: 0,
      home: 0,
    });
  });
});

describe("resolveAbsChallengesRemaining", () => {
  const gameData = {
    absChallenges: {
      hasChallenges: true,
      away: { usedSuccessful: 0, usedFailed: 1, remaining: 1 },
      home: { usedSuccessful: 1, usedFailed: 0, remaining: 2 },
    },
    teams: {
      away: { id: 121, name: "New York Mets", abbreviation: "NYM" },
      home: { id: 144, name: "Atlanta Braves", abbreviation: "ATL" },
    },
  };

  it("uses absChallenges.remaining when available", () => {
    expect(resolveAbsChallengesRemaining(gameData, GAME_824902_PLAYS, 2)).toEqual({
      away: 1,
      home: 2,
    });
  });

  it("falls back to play parsing when absChallenges is absent", () => {
    expect(
      resolveAbsChallengesRemaining(
        {
          teams: gameData.teams,
        },
        GAME_824902_PLAYS,
        2,
      ),
    ).toEqual({
      away: 1,
      home: 2,
    });
  });
});

describe("resolveAbsChallengesUsedFromFeed", () => {
  it("prefers absChallenges.usedFailed from feed metadata", () => {
    expect(
      resolveAbsChallengesUsedFromFeed(
        {
          absChallenges: {
            hasChallenges: true,
            away: { usedFailed: 1 },
            home: { usedFailed: 0 },
          },
          review: { away: { used: 0 }, home: { used: 0 } },
          teams: {
            away: { id: 121, name: "New York Mets", abbreviation: "NYM" },
            home: { id: 144, name: "Atlanta Braves", abbreviation: "ATL" },
          },
        },
        GAME_824902_PLAYS,
      ),
    ).toEqual({ away: 1, home: 0 });
  });
});
