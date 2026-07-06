import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  isPlateAppearanceEvent,
  mergeCurrentPlayTail,
  playByPlaySyncFromIndex,
  rebuildPlayByPlayFromFeed,
  syncPlayByPlayFromFeed,
  createPlayByPlayParseState,
} from "@/lib/mlb/liveFeed";
import { incrementalPlaysFromIndex, mergeAllPlaysForTest } from "@/lib/mlb/liveFeedCoordinator";
import type { AllPlayRaw } from "@/types/mlb-live";

function loadFixture(name: string): AllPlayRaw {
  const file = path.join(__dirname, "__fixtures__", name);
  return JSON.parse(readFileSync(file, "utf8")) as AllPlayRaw;
}

function loadScenario(name: string): Record<string, AllPlayRaw> {
  const file = path.join(__dirname, "__fixtures__", name);
  return JSON.parse(readFileSync(file, "utf8")) as Record<string, AllPlayRaw>;
}

describe("liveFeed parser golden fixtures", () => {
  it("parses active at-bat pitch events from fixture", () => {
    const currentPlay = loadFixture("current-play-active.json");
    const merged = mergeCurrentPlayTail([currentPlay], currentPlay, 0);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.playEvents).toHaveLength(2);
  });

  it("logs walk plate appearance when result is present", () => {
    const play = loadFixture("current-play-active.json");
    play.result = { event: "Walk", description: "Walk" };
    play.about = { ...play.about!, isComplete: true };

    const state = createPlayByPlayParseState();
    const next = syncPlayByPlayFromFeed(state, [play], play);
    expect(next.entries.some((e) => e.event === "Walk")).toBe(true);
    expect(isPlateAppearanceEvent("Walk")).toBe(true);

    const rebuilt = rebuildPlayByPlayFromFeed([play], play);
    expect(rebuilt.entries).toHaveLength(next.entries.length);
  });

  it("merges fresher currentPlay over allPlays tail", () => {
    const stale = loadFixture("current-play-active.json");
    const fresh = loadFixture("current-play-active.json");
    const extraEvent = {
      isPitch: true,
      index: 3,
      count: { balls: 2, strikes: 1, outs: 1 },
      details: { call: { code: "B", description: "Ball" }, isBall: true },
      pitchData: {
        startSpeed: 88,
        coordinates: { pX: 0, pZ: 2 },
        strikeZoneTop: 3.5,
        strikeZoneBottom: 1.5,
      },
    } as NonNullable<AllPlayRaw["playEvents"]>[number];
    fresh.playEvents = [...(fresh.playEvents ?? []), extraEvent];

    const merged = mergeCurrentPlayTail([stale], fresh, 0);
    expect(merged[0]?.playEvents).toHaveLength(3);
  });

  it("does not replace a completed allPlays row with the next currentPlay", () => {
    const { completedAb, nextCurrentPlay } = loadScenario("completed-ab-with-next-current.json");
    const allPlays = [completedAb, completedAb];

    const merged = mergeCurrentPlayTail(allPlays, nextCurrentPlay, 1);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.about?.atBatIndex).toBe(4);
    expect(merged[0]?.result?.event).toBe("Single");
  });

  it("logs a completed at-bat when currentPlay has moved to the next batter", () => {
    const { completedAb, nextCurrentPlay } = loadScenario("completed-ab-with-next-current.json");
    const allPlays = [completedAb];

    const state = createPlayByPlayParseState();
    const next = syncPlayByPlayFromFeed(state, allPlays, nextCurrentPlay);

    expect(next.entries.some((entry) => entry.event === "Single")).toBe(true);
    expect(next.entries.some((entry) => entry.batterName === "Completed Batter")).toBe(true);
  });

  it("annotates WPA and win probability on incrementally synced plays", () => {
    const { completedAb, nextCurrentPlay } = loadScenario("completed-ab-with-next-current.json");
    const allPlays = [completedAb];

    const state = createPlayByPlayParseState();
    const next = syncPlayByPlayFromFeed(state, allPlays, nextCurrentPlay);
    const single = next.entries.find((entry) => entry.event === "Single");

    expect(single?.wpa).toBeDefined();
    expect(single?.homeWinProbBefore).toBeDefined();
    expect(single?.homeWinProbAfter).toBeDefined();
    expect(single?.detail.wpa).toBe(single?.wpa);
  });

  it("updates bases on steal game events during an at-bat", () => {
    const play = loadFixture("steal-mid-at-bat.json");
    const priorSingle = loadScenario("completed-ab-with-next-current.json").completedAb;
    priorSingle.matchup!.batter!.fullName = "Cedric Mullins";
    priorSingle.runners = [
      {
        movement: { originBase: null, start: null, end: "1B", isOut: false },
        details: { runner: { fullName: "Cedric Mullins" }, playIndex: 0 },
      },
    ];

    const rebuilt = rebuildPlayByPlayFromFeed([priorSingle, play], play);
    const steal = rebuilt.entries.find(
      (entry) => entry.isAtBat === false && /steals/i.test(entry.description),
    );

    expect(steal).toBeDefined();
    expect(steal?.affectsSituation).toBe(true);
    expect(steal?.situationBefore.onFirst).toBe(true);
    expect(steal?.situationBefore.bases.first).toBe("Cedric Mullins");
    expect(steal?.onThird).toBe(true);
    expect(steal?.bases.third).toBe("Cedric Mullins");
    expect(steal?.onFirst).toBe(false);
  });

  it("updates bases after a successful pickoff", () => {
    const priorSingle = loadScenario("completed-ab-with-next-current.json").completedAb;
    priorSingle.matchup!.batter!.fullName = "Tommy Pham";
    priorSingle.runners = [
      {
        movement: { originBase: null, start: null, end: "1B", isOut: false },
        details: { runner: { fullName: "Tommy Pham" }, playIndex: 0 },
      },
    ];
    const pickoffPlay = loadFixture("pickoff-1b.json");

    const rebuilt = rebuildPlayByPlayFromFeed([priorSingle, pickoffPlay], pickoffPlay);
    const pickoff = rebuilt.entries.find(
      (entry) =>
        entry.isAtBat === false &&
        /picks off Tommy Pham/i.test(entry.description),
    );

    expect(pickoff).toBeDefined();
    expect(pickoff?.affectsSituation).toBe(true);
    expect(pickoff?.situationBefore.onFirst).toBe(true);
    expect(pickoff?.onFirst).toBe(false);
    expect(pickoff?.outs).toBe(2);
  });

  it("logs at-bat when result arrives in-place on the same allPlays index", () => {
    const { completedAb } = loadScenario("completed-ab-with-next-current.json");
    const incomplete = structuredClone(completedAb) as AllPlayRaw;
    incomplete.result = undefined;
    incomplete.about = { ...incomplete.about!, isComplete: false };

    let state = createPlayByPlayParseState();
    state = syncPlayByPlayFromFeed(state, [incomplete], incomplete);
    expect(state.entries.filter((entry) => entry.isAtBat !== false)).toHaveLength(0);

    state = {
      ...state,
      rawPlayCount: 1,
    };
    const next = syncPlayByPlayFromFeed(state, [completedAb], completedAb);
    expect(next.entries.some((entry) => entry.event === "Single")).toBe(true);
    expect(playByPlaySyncFromIndex(state, 1)).toBe(0);
  });

  it("refreshes local allPlays tail when fetching incremental plays", () => {
    const { completedAb } = loadScenario("completed-ab-with-next-current.json");
    const incomplete = structuredClone(completedAb) as AllPlayRaw;
    incomplete.result = undefined;
    incomplete.about = { ...incomplete.about!, isComplete: false };

    const local = [incomplete];
    const merged = mergeAllPlaysForTest(
      local,
      incrementalPlaysFromIndex(local.length),
      [completedAb],
      1,
    );
    expect(merged[0]?.result?.event).toBe("Single");
  });

  it("refreshes game event bases when runner data arrives on a later poll", () => {
    const play = loadFixture("steal-mid-at-bat.json");
    const stalePlay = structuredClone(play) as AllPlayRaw;
    stalePlay.runners = [];
    stalePlay.result = undefined;
    stalePlay.about = { ...stalePlay.about!, inning: 2, halfInning: "top", isComplete: false };

    let state = createPlayByPlayParseState();
    state.situation = {
      ...state.situation,
      bases: { first: "Cedric Mullins" },
      onFirst: true,
    };
    state.currentHalf = "2-top";

    state = syncPlayByPlayFromFeed(state, [stalePlay], stalePlay);
    const stealEarly = state.entries.find(
      (entry) => entry.isAtBat === false && /steals/i.test(entry.description),
    );
    expect(stealEarly).toBeDefined();
    expect(stealEarly?.onThird).toBe(false);

    state = syncPlayByPlayFromFeed(state, [play], play);
    const stealLate = state.entries.find(
      (entry) => entry.isAtBat === false && /steals/i.test(entry.description),
    );
    expect(stealLate?.onThird).toBe(true);
    expect(stealLate?.bases.third).toBe("Cedric Mullins");
  });

  it("tracks bases through walks, GDP, and a scoring single", () => {
    const walk1 = loadFixture("leadoff-walk.json");
    const walk2 = loadFixture("walk-with-runner-on-first.json");
    const gdp = loadFixture("gdp-runners-on-first-second.json");
    const single = loadFixture("scoring-single-from-second.json");

    walk1.about = { ...walk1.about!, inning: 3, halfInning: "top" };
    walk2.about = { ...walk2.about!, inning: 3, halfInning: "top" };
    gdp.about = { ...gdp.about!, inning: 3, halfInning: "top" };
    single.about = { ...single.about!, inning: 3, halfInning: "top" };

    const rebuilt = rebuildPlayByPlayFromFeed([walk1, walk2, gdp, single], single);
    const atBats = rebuilt.entries.filter((entry) => entry.isAtBat !== false);

    expect(atBats).toHaveLength(4);

    const afterWalk2 = atBats[1];
    expect(afterWalk2?.bases.first).toBe("Dominic Canzone");
    expect(afterWalk2?.bases.second).toBe("Cal Raleigh");
    expect(afterWalk2?.outs).toBe(0);

    const afterGdp = atBats[2];
    expect(afterGdp?.event).toBe("Grounded Into DP");
    expect(afterGdp?.outs).toBe(2);
    expect(afterGdp?.onFirst).toBe(false);
    expect(afterGdp?.bases.second).toBe("Cal Raleigh");
    expect(afterGdp?.bases.first).toBeUndefined();

    const afterSingle = atBats[3];
    expect(afterSingle?.event).toBe("Single");
    expect(afterSingle?.awayScore).toBe(2);
    expect(afterSingle?.homeScore).toBe(1);
    expect(afterSingle?.bases.first).toBe("J.P. Crawford");
    expect(afterSingle?.onSecond).toBe(false);
    expect(afterSingle?.bases.second).toBeUndefined();
  });

  it("clears a scoring runner when MLB start base does not match occupied base", () => {
    const priorSingle = loadScenario("completed-ab-with-next-current.json").completedAb;
    priorSingle.matchup!.batter!.fullName = "Jake Burger";
    priorSingle.runners = [
      {
        movement: { originBase: null, start: null, end: "2B", isOut: false },
        details: { runner: { fullName: "Jake Burger" } },
      },
    ];

    const scoringDouble: AllPlayRaw = {
      about: { atBatIndex: 5, inning: 4, halfInning: "top", isComplete: true, isScoringPlay: true },
      matchup: {
        batter: { id: 6, fullName: "Kyle Higashioka" },
        pitcher: { id: 401, fullName: "Pitcher" },
      },
      result: {
        event: "Double",
        description: "Kyle Higashioka doubles. Jake Burger scores.",
        awayScore: 2,
        homeScore: 0,
      },
      runners: [
        {
          movement: { originBase: "2B", start: "3B", end: "score", isOut: false },
          details: { runner: { fullName: "Jake Burger" } },
        },
        {
          movement: { originBase: null, start: null, end: "2B", isOut: false },
          details: { runner: { fullName: "Kyle Higashioka" } },
        },
      ],
      count: { balls: 0, strikes: 0, outs: 0 },
    };

    const rebuilt = rebuildPlayByPlayFromFeed([priorSingle, scoringDouble], scoringDouble);
    const scoringPlay = rebuilt.entries.find((entry) => entry.event === "Double");

    expect(scoringPlay?.bases.second).toBe("Kyle Higashioka");
    expect(scoringPlay?.onFirst).toBe(false);
    expect(scoringPlay?.bases.first).toBeUndefined();
  });
});
