import { describe, expect, it } from "vitest";

import {
  PREVIEW_HITS_PER_PARK,
  selectPreviewHits,
} from "@/lib/mlb/ballparkHitsAggregate";
import type { VenueHit } from "@/lib/mlb/ballparkHits";
import { parseHitKey } from "@/lib/mlb/hitDetailFromArchive";
import type { HitData } from "@/types/mlb-live";

const stubHitData: HitData = {
  launchSpeed: 95,
  launchAngle: 12,
  totalDistance: 250,
  trajectory: "line_drive",
  hardness: "medium",
  location: "8",
  coordX: 100,
  coordY: 150,
};

function makeHit(
  overrides: Partial<VenueHit> & Pick<VenueHit, "hitKey" | "gameDate" | "atBatIndex">,
): VenueHit {
  return {
    batterId: 1,
    batterName: "Test",
    event: "Single",
    bipKind: "hit",
    inning: 1,
    halfInning: "top",
    awayScore: 0,
    homeScore: 0,
    hit: stubHitData,
    color: "#38bdf8",
    gamePk: 1,
    awayAbbrev: "NYY",
    homeAbbrev: "BOS",
    ...overrides,
  };
}

describe("selectPreviewHits", () => {
  it("returns empty when PREVIEW_HITS_PER_PARK is 0 (count-only index)", () => {
    const hits = Array.from({ length: 40 }, (_, i) =>
      makeHit({
        hitKey: `100-${i}`,
        gameDate: "2026-07-01",
        atBatIndex: i,
        gamePk: 100,
      }),
    );

    expect(PREVIEW_HITS_PER_PARK).toBe(0);
    expect(selectPreviewHits(hits)).toEqual([]);
  });

  it("caps and prefers recent dates when a positive limit is passed", () => {
    const hits = Array.from({ length: 50 }, (_, i) =>
      makeHit({
        hitKey: `100-${i}`,
        gameDate: i < 20 ? "2026-04-01" : "2026-07-01",
        atBatIndex: i,
        gamePk: 100,
      }),
    );

    const preview = selectPreviewHits(hits, 12);
    expect(preview).toHaveLength(12);
    expect(preview.every((hit) => hit.gameDate === "2026-07-01")).toBe(true);
  });

  it("returns empty for empty input", () => {
    expect(selectPreviewHits([])).toEqual([]);
  });
});

describe("parseHitKey", () => {
  it("parses gamePk-atBatIndex keys", () => {
    expect(parseHitKey("776123-42")).toEqual({ gamePk: 776123, atBatIndex: 42 });
  });

  it("rejects malformed keys", () => {
    expect(parseHitKey("abc")).toBeNull();
    expect(parseHitKey("1-")).toBeNull();
  });
});
