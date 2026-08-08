import { describe, expect, it } from "vitest";

import { mergePerGamePlayerCaches, type PerGameNerdCacheEntry } from "@/lib/mlb/nerdStats/gameCache";
import {
  createEmptyPlayerCounters,
  ensurePlayerCounters,
  mergePlayerSeasonCounters,
} from "@/lib/mlb/nerdStats/playerMirror";
import { createEmptySeasonCounters } from "@/lib/mlb/nerdStats/counters";
import type { SeasonPlayerNerdCounters } from "@/lib/mlb/nerdStats/types";

describe("ensurePlayerCounters trade deadline", () => {
  it("updates team when the same player appears for a new club", () => {
    const players: SeasonPlayerNerdCounters = {};
    ensurePlayerCounters(players, 123, "Trade Bait", 136, "SEA");
    ensurePlayerCounters(players, 123, "Trade Bait", 147, "NYY");

    expect(players["123"]?.teamId).toBe(147);
    expect(players["123"]?.teamAbbrev).toBe("NYY");
  });
});

describe("mergePlayerSeasonCounters trade deadline", () => {
  it("adopts the later club even when the old club has more plate appearances", () => {
    const target: SeasonPlayerNerdCounters = {};
    const early = createEmptyPlayerCounters(123, "Trade Bait", 136, "SEA");
    early.plateAppearances = 400;
    target["123"] = early;

    const late: SeasonPlayerNerdCounters = {};
    const afterTrade = createEmptyPlayerCounters(123, "Trade Bait", 147, "NYY");
    afterTrade.plateAppearances = 12;
    late["123"] = afterTrade;

    mergePlayerSeasonCounters(target, late);

    expect(target["123"]?.teamId).toBe(147);
    expect(target["123"]?.teamAbbrev).toBe("NYY");
    expect(target["123"]?.plateAppearances).toBe(412);
  });
});

describe("mergePerGamePlayerCaches trade deadline", () => {
  it("uses chronological order so out-of-order caches still resolve to the latest club", () => {
    function entry(
      gamePk: number,
      gameDate: string,
      teamId: number,
      teamAbbrev: string,
      plateAppearances: number,
    ): PerGameNerdCacheEntry {
      const players: SeasonPlayerNerdCounters = {};
      const player = createEmptyPlayerCounters(123, "Trade Bait", teamId, teamAbbrev);
      player.plateAppearances = plateAppearances;
      players["123"] = player;
      return {
        gamePk,
        gameDate,
        combined: createEmptySeasonCounters(),
        home: createEmptySeasonCounters(),
        away: createEmptySeasonCounters(),
        players,
        extractedAt: `${gameDate}T00:00:00.000Z`,
      };
    }

    // Newest game listed first — merge must still end on NYY.
    const merged = mergePerGamePlayerCaches([
      entry(2, "2026-08-01", 147, "NYY", 4),
      entry(1, "2026-07-01", 136, "SEA", 4),
    ]);

    expect(merged["123"]?.teamId).toBe(147);
    expect(merged["123"]?.teamAbbrev).toBe("NYY");
    expect(merged["123"]?.plateAppearances).toBe(8);
  });
});
