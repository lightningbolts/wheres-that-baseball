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
});
