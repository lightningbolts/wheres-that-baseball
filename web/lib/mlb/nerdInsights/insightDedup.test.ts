import { describe, expect, it } from "vitest";

import {
  baseInsightId,
  dedupeFeedInsights,
  restoreDedupState,
} from "@/lib/mlb/nerdInsights/insightDedup";
import type { NerdInsight } from "@/lib/mlb/nerdInsights/types";

function miniInsight(baseId: string, occurrence: number): NerdInsight {
  return {
    id: `${baseId}-mini-${occurrence}`,
    variant: "mini",
    eyebrow: "Pitcher nerd",
    title: "Pitcher nerd",
    message: `GIDP Inducers — LAD (${occurrence}× this game, 28th, 55).`,
    teamId: 119,
    playerId: 608566,
    statId: "gidp-induced",
    anchor: { type: "at-bat", atBatIndex: 17 },
  };
}

describe("baseInsightId", () => {
  it("strips the mini occurrence suffix", () => {
    expect(baseInsightId("42-player-pitcher-gidp-induced-608566-17-mini-12")).toBe(
      "42-player-pitcher-gidp-induced-608566-17",
    );
  });

  it("leaves full insight ids unchanged", () => {
    expect(baseInsightId("42-player-batter-steal-success-rate-666971-17")).toBe(
      "42-player-batter-steal-success-rate-666971-17",
    );
  });
});

describe("dedupeFeedInsights", () => {
  it("keeps a single row per base id, preferring the highest mini count", () => {
    const baseId = "42-player-pitcher-gidp-induced-608566-17";
    const spam = [12, 13, 14, 24].map((n) => miniInsight(baseId, n));
    const other: NerdInsight = {
      id: "42-player-batter-steal-success-rate-666971-17-mini-2",
      variant: "mini",
      eyebrow: "Batter nerd",
      title: "Batter nerd",
      message: "Swipe Success Rate — SEA (2× this game, 18th, 78.6%).",
      teamId: 136,
      playerId: 666971,
      statId: "steal-success-rate",
      anchor: { type: "at-bat", atBatIndex: 17 },
    };

    const deduped = dedupeFeedInsights([other, ...spam]);

    expect(deduped).toHaveLength(2);
    expect(deduped[0]?.id).toBe(other.id);
    expect(deduped[1]?.id).toBe(`${baseId}-mini-24`);
  });
});

describe("restoreDedupState", () => {
  it("marks the base id as seen for stored mini insights", () => {
    const baseId = "42-player-pitcher-gidp-induced-608566-17";
    const insights = [miniInsight(baseId, 12)];

    const restored = restoreDedupState(insights);

    expect(restored.shownIds.has(baseId)).toBe(true);
    expect(restored.shownIds.has(`${baseId}-mini-12`)).toBe(true);
    expect(restored.shownStatIds.has("gidp-induced:player:608566")).toBe(true);
    expect(restored.statOccurrence.get("gidp-induced:player:608566")).toBe(12);
  });
});
