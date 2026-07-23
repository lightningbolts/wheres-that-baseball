import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { VenueHit } from "@/lib/mlb/ballparkHits";
import {
  appendHitsToPlayerPitchBipStore,
  loadPlayerPitchBipDetail,
  loadPlayerPitchBipIndex,
  mergePlayerSearchIndexes,
} from "@/lib/mlb/playerPitchBipStore";
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
  overrides: Partial<VenueHit> &
    Pick<VenueHit, "hitKey" | "batterId" | "batterName" | "pitcherId" | "pitcherName">,
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
    pitcherId: overrides.pitcherId,
    pitcherName: overrides.pitcherName,
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
    detail,
    ...overrides,
  };
}

describe("appendHitsToPlayerPitchBipStore", () => {
  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "player-pitch-bip-"));
    process.chdir(tempRoot);
  });

  afterEach(() => {
    process.chdir(ORIGINAL_CWD);
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("indexes BIP by pitcherId and uses pitching team", () => {
    const venueId = 3; // Fenway
    const hit = makeHit({
      hitKey: "900001-7",
      batterId: 545361,
      batterName: "Test Batter",
      pitcherId: 543037,
      pitcherName: "Test Pitcher",
      atBatIndex: 7,
      halfInning: "top",
      homeAbbrev: "BOS",
      awayAbbrev: "NYY",
    });

    const result = appendHitsToPlayerPitchBipStore(2026, venueId, [hit]);
    expect(result.playersUpdated).toBe(1);
    expect(result.hitsAdded).toBe(1);

    const detail = loadPlayerPitchBipDetail(2026, 543037);
    expect(detail).not.toBeNull();
    expect(detail!.name).toBe("Test Pitcher");
    expect(detail!.bipCount).toBe(1);
    expect(detail!.teamAbbrev).toBe("BOS");
    expect(detail!.parks[0]!.hits[0]!.pitcherId).toBe(543037);
    expect(detail!.parks[0]!.hits[0]!.detail).toBeUndefined();

    const index = loadPlayerPitchBipIndex(2026);
    expect(index?.players.some((p) => p.playerId === 543037 && p.bipCount === 1)).toBe(true);
  });

  it("skips hits without pitcherId", () => {
    const venueId = 3;
    const hit = makeHit({
      hitKey: "900001-8",
      batterId: 545361,
      batterName: "Test Batter",
      pitcherId: null,
      pitcherName: "",
    });

    const result = appendHitsToPlayerPitchBipStore(2026, venueId, [hit]);
    expect(result.playersUpdated).toBe(0);
    expect(loadPlayerPitchBipIndex(2026)).toBeNull();
  });
});

describe("mergePlayerSearchIndexes", () => {
  it("dedupes two-way players and tags roles", () => {
    const merged = mergePlayerSearchIndexes(
      [
        {
          playerId: 1,
          name: "Two Way",
          teamAbbrev: "LAD",
          teamId: 119,
          bipCount: 40,
          hitCount: 12,
          venueCount: 5,
        },
      ],
      [
        {
          playerId: 1,
          name: "Two Way",
          teamAbbrev: "LAD",
          teamId: 119,
          bipCount: 80,
          hitCount: 20,
          venueCount: 8,
        },
        {
          playerId: 2,
          name: "Only Pitcher",
          teamAbbrev: "NYY",
          teamId: 147,
          bipCount: 50,
          hitCount: 10,
          venueCount: 4,
        },
      ],
      10,
    );

    expect(merged).toHaveLength(2);
    const twoWay = merged.find((p) => p.playerId === 1)!;
    expect(twoWay.roles).toEqual(expect.arrayContaining(["batter", "pitcher"]));
    expect(twoWay.bipCount).toBe(80);
    expect(merged.find((p) => p.playerId === 2)?.roles).toEqual(["pitcher"]);
  });
});
