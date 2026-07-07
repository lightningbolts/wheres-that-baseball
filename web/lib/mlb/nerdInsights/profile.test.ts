import { describe, expect, it } from "vitest";

import {
  isCursedInsightRank,
  isEliteRank,
  isNotableInsightRank,
} from "@/lib/mlb/nerdInsights/profile";
import type { TeamNerdStatEntry } from "@/lib/mlb/nerdInsights/types";

function entry(rank: number): TeamNerdStatEntry {
  return {
    rank,
    displayValue: "1",
    value: 1,
    title: "Test Stat",
    sort: "desc",
  };
}

describe("isCursedInsightRank", () => {
  it("treats ranks 23-30 as bottom 8 for insights", () => {
    expect(isCursedInsightRank(entry(22))).toBe(false);
    expect(isCursedInsightRank(entry(23))).toBe(true);
    expect(isCursedInsightRank(entry(30))).toBe(true);
  });

  it("supports a tighter bottom-5 window", () => {
    expect(isCursedInsightRank(entry(25), 5)).toBe(false);
    expect(isCursedInsightRank(entry(26), 5)).toBe(true);
  });
});

describe("isNotableInsightRank", () => {
  it("accepts elite or cursed ranks", () => {
    expect(isNotableInsightRank(entry(3))).toBe(true);
    expect(isNotableInsightRank(entry(15))).toBe(false);
    expect(isNotableInsightRank(entry(28))).toBe(true);
  });

  it("still gates blank values", () => {
    expect(
      isEliteRank({
        rank: 1,
        displayValue: "—",
        value: 0,
        title: "Empty",
        sort: "desc",
      }),
    ).toBe(false);
  });
});
