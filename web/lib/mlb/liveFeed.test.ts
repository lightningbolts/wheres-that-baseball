import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  isPlateAppearanceEvent,
  mergeCurrentPlayTail,
  rebuildPlayByPlayFromFeed,
  syncPlayByPlayFromFeed,
  createPlayByPlayParseState,
} from "@/lib/mlb/liveFeed";
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

  it("updates bases on steal game events during an at-bat", () => {
    const play = loadFixture("steal-mid-at-bat.json");
    const rebuilt = rebuildPlayByPlayFromFeed([play], play);
    const steal = rebuilt.entries.find(
      (entry) => entry.isAtBat === false && /steals/i.test(entry.description),
    );

    expect(steal).toBeDefined();
    expect(steal?.affectsSituation).toBe(true);
    expect(steal?.onThird).toBe(true);
    expect(steal?.bases.third).toBe("Cedric Mullins");
    expect(steal?.onFirst).toBe(false);
  });
});
