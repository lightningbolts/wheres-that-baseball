import { describe, expect, it } from "vitest";

import {
  PREVIEW_HITS_PER_PARK,
  selectPreviewHits,
} from "@/lib/mlb/ballparkHitsAggregate";
import type { VenueHit } from "@/lib/mlb/ballparkHits";
import { bipFamilyCount, officialHitCount } from "@/lib/mlb/gameHits";
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
  pitchSpeed: 92,
  spinRate: 2200,
  pfxX: 1,
  pfxZ: 2,
};

function makeHit(
  overrides: Partial<VenueHit> & Pick<VenueHit, "hitKey" | "gameDate" | "atBatIndex">,
): VenueHit {
  return {
    batterId: 1,
    batterName: "Test",
    pitcherId: 2,
    pitcherName: "Pitcher",
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
  it("includes all official hits when under the cap and strips pitch telemetry", () => {
    const hits = [
      ...Array.from({ length: 40 }, (_, i) =>
        makeHit({
          hitKey: `100-out-${i}`,
          gameDate: "2026-07-20",
          atBatIndex: i,
          gamePk: 100,
          event: "Groundout",
          bipKind: "out",
        }),
      ),
      ...Array.from({ length: 120 }, (_, i) =>
        makeHit({
          hitKey: `100-hit-${i}`,
          gameDate: i < 40 ? "2026-04-01" : "2026-07-01",
          atBatIndex: 100 + i,
          gamePk: 100,
        }),
      ),
    ];

    const preview = selectPreviewHits(hits);
    expect(preview).toHaveLength(120);
    expect(preview.every((hit) => hit.bipKind === "hit")).toBe(true);
    expect(preview.some((hit) => hit.hitKey.startsWith("100-hit-") && Number(hit.hitKey.split("-")[2]) < 40)).toBe(
      true,
    );
    expect(preview[0]?.hit.spinRate).toBeUndefined();
    expect(preview[0]?.hit.pfxX).toBeUndefined();
    expect(preview[0]?.hit.coordX).toBe(100);
    expect(preview[0]?.batterName).toBeUndefined();
  });

  it("stratifies when over the cap", () => {
    const hits = Array.from({ length: PREVIEW_HITS_PER_PARK + 200 }, (_, i) =>
      makeHit({
        hitKey: `100-${i}`,
        gameDate: i < 200 ? "2026-04-01" : "2026-07-01",
        atBatIndex: i,
        gamePk: 100,
      }),
    );

    const preview = selectPreviewHits(hits, 100);
    expect(preview).toHaveLength(100);
    const indexes = preview.map((hit) => hit.atBatIndex);
    expect(Math.min(...indexes)).toBeLessThan(200);
    expect(Math.max(...indexes)).toBeGreaterThan(PREVIEW_HITS_PER_PARK);
  });

  it("returns empty for empty input", () => {
    expect(selectPreviewHits([])).toEqual([]);
  });
});

describe("bipFamilyCount", () => {
  const stats = {
    total: 100,
    singles: 10,
    doubles: 5,
    triples: 1,
    homeRuns: 4,
    outs: 70,
    sac: 6,
    errors: 3,
    other: 1,
    avgExitVelo: null,
    avgLaunchAngle: null,
    maxExitVelo: null,
    maxDistance: null,
  };

  it("uses the matching family total", () => {
    expect(officialHitCount(stats)).toBe(20);
    expect(bipFamilyCount(stats, "hit")).toBe(20);
    expect(bipFamilyCount(stats, "out")).toBe(70);
    expect(bipFamilyCount(stats, "sac")).toBe(6);
    expect(bipFamilyCount(stats, "error")).toBe(3);
    expect(bipFamilyCount(stats, "other")).toBe(1);
    expect(bipFamilyCount(stats, "all")).toBe(100);
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
