import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { VenueHit } from "@/lib/mlb/ballparkHits";
import {
  appendHitsToPlayerBipStore,
  loadPlayerBipDetail,
  loadPlayerBipIndex,
} from "@/lib/mlb/playerBipStore";
import type { HitData, PlayDetail } from "@/types/mlb-live";

const ORIGINAL_CWD = process.cwd();
let tempRoot: string;

const stubHitData: HitData = {
  launchSpeed: 101,
  launchAngle: 18,
  totalDistance: 320,
  trajectory: "line_drive",
  hardness: "hard",
  location: "9",
  coordX: 120,
  coordY: 180,
};

function makeHit(
  overrides: Partial<VenueHit> & Pick<VenueHit, "hitKey" | "batterId" | "batterName">,
): VenueHit {
  const detail: PlayDetail = {
    atBatIndex: overrides.atBatIndex ?? 1,
    awayScore: 1,
    batterAtBats: 1,
    batterHits: 1,
    batterId: overrides.batterId,
    batterName: overrides.batterName,
    description: "Line drive single",
    event: "Single",
    halfInning: "top",
    hit: stubHitData,
    homeScore: 0,
    homeWinProbAfter: 0.45,
    homeWinProbBefore: 0.48,
    inning: 3,
    isScoringPlay: false,
    pitcherId: 2,
    pitcherName: "Pitcher",
    pitches: [],
    wpa: -0.03,
  };

  return {
    atBatIndex: 1,
    event: "Single",
    bipKind: "hit",
    inning: 3,
    halfInning: "top",
    awayScore: 1,
    homeScore: 0,
    hit: stubHitData,
    color: "#38bdf8",
    gamePk: 900001,
    gameDate: "2026-07-01",
    awayAbbrev: "NYY",
    homeAbbrev: "BOS",
    pitcherId: 2,
    pitcherName: "Pitcher",
    detail,
    ...overrides,
  };
}

describe("appendHitsToPlayerBipStore", () => {
  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "player-bip-"));
    process.chdir(tempRoot);
  });

  afterEach(() => {
    process.chdir(ORIGINAL_CWD);
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("writes slim player files and updates the index", () => {
    // Fenway Park — present in ballparkIndex
    const venueId = 3;
    const hit = makeHit({
      hitKey: "900001-7",
      batterId: 545361,
      batterName: "Test Batter",
      atBatIndex: 7,
      homeAbbrev: "BOS",
      awayAbbrev: "NYY",
    });

    const result = appendHitsToPlayerBipStore(2026, venueId, [hit]);
    expect(result.playersUpdated).toBe(1);
    expect(result.hitsAdded).toBe(1);

    const detail = loadPlayerBipDetail(2026, 545361);
    expect(detail).not.toBeNull();
    expect(detail!.bipCount).toBe(1);
    expect(detail!.parks).toHaveLength(1);
    expect(detail!.parks[0]!.hits[0]!.hitKey).toBe("900001-7");
    expect(detail!.parks[0]!.hits[0]!.detail).toBeUndefined();

    const index = loadPlayerBipIndex(2026);
    expect(index?.players.some((p) => p.playerId === 545361 && p.bipCount === 1)).toBe(true);
  });

  it("merges by hitKey without duplicating", () => {
    const venueId = 3;
    const hit = makeHit({
      hitKey: "900001-7",
      batterId: 545361,
      batterName: "Test Batter",
      atBatIndex: 7,
    });

    appendHitsToPlayerBipStore(2026, venueId, [hit]);
    const second = appendHitsToPlayerBipStore(2026, venueId, [hit]);
    expect(second.hitsAdded).toBe(0);
    expect(loadPlayerBipDetail(2026, 545361)?.bipCount).toBe(1);
  });
});
