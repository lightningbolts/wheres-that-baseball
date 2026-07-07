import { describe, expect, it } from "vitest";

import { createEmptySeasonCounters, createEmptyTeamCounters } from "@/lib/mlb/nerdStats/counters";
import { getNerdStatDefinition } from "@/lib/mlb/nerdStats/definitions";
import type { PerGameNerdCacheEntry } from "@/lib/mlb/nerdStats/gameCache";
import {
  buildNerdStatHistoryForStat,
  multiSeriesHasPlottedValues,
  selectHistorySeries,
  selectMultiHistorySeries,
} from "@/lib/mlb/nerdStats/history";
import type { SeasonNerdCounters } from "@/lib/mlb/nerdStats/types";

function seasonWithTeam(teamId: number, patch: Partial<ReturnType<typeof createEmptyTeamCounters>>): SeasonNerdCounters {
  const season = createEmptySeasonCounters();
  season[String(teamId)] = { ...createEmptyTeamCounters(), ...patch };
  return season;
}

function cacheEntry(
  gamePk: number,
  gameDate: string,
  combined: SeasonNerdCounters,
): PerGameNerdCacheEntry {
  return {
    gamePk,
    gameDate,
    combined,
    home: combined,
    away: combined,
    extractedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("buildNerdStatHistoryForStat", () => {
  it("builds cumulative, daily, and rolling7 walk-off win totals", () => {
    const statId = "walk-off-wins";
    const definition = getNerdStatDefinition(statId);
    expect(definition).toBeDefined();

    const caches: PerGameNerdCacheEntry[] = [
      cacheEntry(1, "2026-04-01", seasonWithTeam(147, { walkoffWins: 1, finalGamesWithFeed: 1 })),
      cacheEntry(2, "2026-04-02", seasonWithTeam(147, { walkoffWins: 0, finalGamesWithFeed: 1 })),
      cacheEntry(3, "2026-04-03", seasonWithTeam(147, { walkoffWins: 1, finalGamesWithFeed: 1 })),
      cacheEntry(4, "2026-04-03", seasonWithTeam(111, { walkoffWins: 1, finalGamesWithFeed: 1 })),
      cacheEntry(5, "2026-04-04", seasonWithTeam(147, { walkoffWins: 1, finalGamesWithFeed: 1 })),
    ];

    const history = buildNerdStatHistoryForStat(2026, statId, caches);
    expect(history).not.toBeNull();
    expect(history!.dates).toEqual(["2026-04-01", "2026-04-02", "2026-04-03", "2026-04-04"]);

    const nyy = history!.splits.all.teams["147"]!;
    expect(nyy.cumulative).toEqual([1, 1, 2, 3]);
    expect(nyy.daily).toEqual([1, 0, 1, 1]);
    expect(nyy.rolling7[2]).toBe(2);
    expect(nyy.rolling7[3]).toBe(3);
  });

  it("builds cumulative runs scored totals", () => {
    const statId = "runs-scored";
    const definition = getNerdStatDefinition(statId);
    expect(definition).toBeDefined();

    const caches: PerGameNerdCacheEntry[] = [
      cacheEntry(1, "2026-04-01", seasonWithTeam(147, { runsScored: 5, finalGamesWithFeed: 1 })),
      cacheEntry(2, "2026-04-02", seasonWithTeam(147, { runsScored: 2, finalGamesWithFeed: 1 })),
      cacheEntry(3, "2026-04-03", seasonWithTeam(147, { runsScored: 7, finalGamesWithFeed: 1 })),
    ];

    const history = buildNerdStatHistoryForStat(2026, statId, caches)!;
    const nyy = history.splits.all.teams["147"]!;
    expect(nyy.cumulative).toEqual([5, 7, 14]);
    expect(nyy.daily).toEqual([5, 2, 7]);
  });

  it("includes rate stats before standings minGames threshold", () => {
    const statId = "one-run-win-pct";
    const caches: PerGameNerdCacheEntry[] = [
      cacheEntry(1, "2026-04-01", seasonWithTeam(147, { oneRunWins: 1, oneRunGames: 2, finalGamesWithFeed: 1 })),
    ];

    const history = buildNerdStatHistoryForStat(2026, statId, caches)!;
    const nyy = history.splits.all.teams["147"]!;
    expect(nyy.cumulative[0]).toBe(50);
  });
});

describe("selectHistorySeries", () => {
  it("averages group values and computes rank within the group", () => {
    const history = buildNerdStatHistoryForStat(2026, "walk-off-wins", [
      cacheEntry(1, "2026-04-01", seasonWithTeam(147, { walkoffWins: 2, finalGamesWithFeed: 5 })),
      cacheEntry(2, "2026-04-02", seasonWithTeam(111, { walkoffWins: 1, finalGamesWithFeed: 5 })),
      cacheEntry(3, "2026-04-02", seasonWithTeam(147, { walkoffWins: 1, finalGamesWithFeed: 5 })),
    ])!;

    const selected = selectHistorySeries(history, {
      basis: "cumulative",
      split: "all",
      group: "AL-East",
      teamId: 147,
      sort: "desc",
    });

    expect(selected.points).toHaveLength(2);
    expect(selected.points[0]!.teamValue).toBe(2);
    expect(selected.points[0]!.groupAverage).toBe(2);
    expect(selected.points[0]!.teamRank).toBe(1);
    expect(selected.points[1]!.teamValue).toBe(3);
    expect(selected.points[1]!.groupAverage).toBe(2);
    expect(selected.points[1]!.teamRank).toBe(1);
  });
});

describe("selectMultiHistorySeries", () => {
  it("returns one series per team in the group with brand colors", () => {
    const history = buildNerdStatHistoryForStat(2026, "walk-off-wins", [
      cacheEntry(1, "2026-04-01", seasonWithTeam(147, { walkoffWins: 2, finalGamesWithFeed: 5 })),
      cacheEntry(2, "2026-04-02", seasonWithTeam(111, { walkoffWins: 1, finalGamesWithFeed: 5 })),
      cacheEntry(3, "2026-04-02", seasonWithTeam(147, { walkoffWins: 1, finalGamesWithFeed: 5 })),
    ])!;

    const selected = selectMultiHistorySeries(history, {
      basis: "cumulative",
      split: "all",
      group: "AL-East",
    });

    expect(selected.teams).toHaveLength(5);
    expect(selected.groupLabel).toBe("AL East");
    const nyy = selected.teams.find((team) => team.teamId === 147);
    expect(nyy?.values).toEqual([2, 3]);
    expect(nyy?.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(multiSeriesHasPlottedValues(selected)).toBe(true);
  });
});
