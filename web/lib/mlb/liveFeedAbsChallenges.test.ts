import { describe, expect, it } from "vitest";

import { gameStateForAtBat } from "@/lib/games/replay";
import {
  buildLiveFeedSnapshot,
  parseLiveFeed,
  reconstructFeedFromParts,
} from "@/lib/mlb/liveFeed";
import type { MLBLiveFeedResponse } from "@/types/mlb-live";

const GAME_824902_FEED: MLBLiveFeedResponse = {
  gameData: {
    status: { abstractGameState: "Live" },
    absChallenges: {
      hasChallenges: true,
      away: { usedSuccessful: 0, usedFailed: 1, remaining: 1 },
      home: { usedSuccessful: 1, usedFailed: 0, remaining: 2 },
    },
    review: {
      hasChallenges: false,
      away: { used: 0, remaining: 1 },
      home: { used: 0, remaining: 1 },
    },
    teams: {
      away: { id: 121, name: "New York Mets", abbreviation: "NYM" },
      home: { id: 144, name: "Atlanta Braves", abbreviation: "ATL" },
    },
  },
  liveData: {
    linescore: {
      currentInning: 2,
      inningState: "Bottom",
      teams: { away: { runs: 2 }, home: { runs: 0 } },
    },
    plays: {
      allPlays: [
        {
          about: { halfInning: "top", inning: 2, atBatIndex: 0, isComplete: true },
          matchup: {
            batter: { id: 665487, fullName: "Juan Soto" },
            pitcher: { id: 686948, fullName: "Drake Baldwin" },
          },
          result: {
            event: "Single",
            description:
              "Juan Soto singles on a line drive to right fielder Mike Yastrzemski. Brett Baty scores. Francisco Lindor scores.",
            awayScore: 2,
            homeScore: 0,
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
          about: { halfInning: "top", inning: 2, atBatIndex: 1, isComplete: true },
          matchup: {
            batter: { id: 668901, fullName: "Mark Vientos" },
            pitcher: { id: 686948, fullName: "Drake Baldwin" },
          },
          result: {
            event: "Grounded Into DP",
            description:
              "Mark Vientos grounds into a double play, shortstop Jim Jarvis to second baseman Ozzie Albies to first baseman Matt Olson.",
            awayScore: 2,
            homeScore: 0,
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
      ],
      currentPlay: {
        about: { halfInning: "bottom", inning: 2 },
        count: { balls: 0, strikes: 0, outs: 0 },
        matchup: {
          batter: { fullName: "Batter" },
          pitcher: { fullName: "Pitcher" },
        },
      },
    },
  },
};

describe("live feed ABS snapshot round-trip", () => {
  it("preserves absChallenges through snapshot build and reconstruct", () => {
    const snapshot = buildLiveFeedSnapshot(824902, GAME_824902_FEED);

    expect(snapshot.absChallenges).toEqual(GAME_824902_FEED.gameData.absChallenges);
    expect(snapshot.awayAbsChallengesUsed).toBe(1);
    expect(snapshot.homeAbsChallengesUsed).toBe(0);

    const reconstructed = reconstructFeedFromParts(
      snapshot,
      GAME_824902_FEED.liveData.plays.allPlays ?? [],
    );

    expect(reconstructed.gameData.absChallenges).toEqual(
      GAME_824902_FEED.gameData.absChallenges,
    );

    const state = parseLiveFeed(824902, reconstructed);
    expect(state.awayAbsChallengesRemaining).toBe(1);
    expect(state.homeAbsChallengesRemaining).toBe(2);
  });

  it("stamps replay ABS counts on each at-bat for season history scrubbing", () => {
    const state = parseLiveFeed(824902, GAME_824902_FEED);
    const atBats = state.plays.filter((play) => play.isAtBat !== false);
    expect(atBats).toHaveLength(2);

    expect(atBats[0]?.awayAbsChallengesRemaining).toBe(2);
    expect(atBats[0]?.homeAbsChallengesRemaining).toBe(2);
    expect(atBats[1]?.awayAbsChallengesRemaining).toBe(1);
    expect(atBats[1]?.homeAbsChallengesRemaining).toBe(2);

    const earlyReplay = gameStateForAtBat(state, atBats[0]!, {
      awayTeamId: 121,
      homeTeamId: 144,
    });
    const afterChallenge = gameStateForAtBat(state, atBats[1]!, {
      awayTeamId: 121,
      homeTeamId: 144,
    });

    expect(earlyReplay.awayAbsChallengesRemaining).toBe(2);
    expect(earlyReplay.homeAbsChallengesRemaining).toBe(2);
    expect(afterChallenge.awayAbsChallengesRemaining).toBe(1);
    expect(afterChallenge.homeAbsChallengesRemaining).toBe(2);
  });
});
