import { describe, expect, it } from "vitest";

import {
  buildPitchPath,
  buildHitPath,
  buildActorTargets,
  getMapper,
} from "@/lib/mlb/liveFieldAnimation";
import type { FieldDefender } from "@/lib/mlb/fieldDefense";
import type { HitData, PlayPitch } from "@/types/mlb-live";

const pitch = (overrides: Partial<PlayPitch> = {}): PlayPitch => ({
  pitchNumber: 1,
  typeCode: "FF",
  typeDescription: "Four-Seam Fastball",
  callDescription: "Strike",
  callCode: "S",
  balls: 0,
  strikes: 1,
  startSpeed: 95,
  plateX: 0.2,
  plateZ: 2.5,
  isStrike: true,
  isBall: false,
  isInPlay: false,
  isOut: false,
  isPitch: true,
  hasPlateLocation: true,
  strikeZoneTop: 3.5,
  strikeZoneBottom: 1.5,
  plateTime: 0.4,
  ...overrides,
});

const hit = (overrides: Partial<HitData> = {}): HitData => ({
  launchSpeed: 100,
  launchAngle: 25,
  totalDistance: 380,
  trajectory: "fly_ball",
  hardness: "hard",
  location: "8",
  coordX: 125,
  coordY: 50,
  ...overrides,
});

describe("liveFieldAnimation", () => {
  it("builds a pitch path from mound toward plate", () => {
    const mapper = getMapper(null);
    const { points, durationMs } = buildPitchPath(mapper, pitch());
    expect(points.length).toBeGreaterThan(10);
    expect(durationMs).toBe(400);
    expect(points[0][1]).toBeGreaterThan(points[points.length - 1][1]);
  });

  it("builds a hit path landing near spray coords", () => {
    const mapper = getMapper(null);
    const { points, durationMs } = buildHitPath(mapper, hit());
    expect(points.length).toBeGreaterThan(5);
    expect(durationMs).toBeGreaterThan(1000);
  });

  it("places defense and runners as actors", () => {
    const mapper = getMapper(null);
    const defense: FieldDefender[] = [
      { position: "P", playerId: 1, name: "Pitcher", x: 50, y: 72 },
      { position: "CF", playerId: 2, name: "Center", x: 50, y: 18 },
    ];
    const actors = buildActorTargets(mapper, {
      defense,
      batterName: "Batter Name",
      showBatter: true,
      runnerFirst: { id: 9, name: "Runner One" },
      runnerSecond: null,
      runnerThird: null,
    });
    expect(actors.some((a) => a.kind === "batter")).toBe(true);
    expect(actors.some((a) => a.kind === "runner")).toBe(true);
    expect(actors.filter((a) => a.kind === "fielder")).toHaveLength(2);
  });
});
