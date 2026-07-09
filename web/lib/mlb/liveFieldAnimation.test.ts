import { describe, expect, it } from "vitest";

import {
  buildPitchPath,
  buildHitPath,
  buildActorTargets,
  pursuitTargets,
  runnerPathBetween,
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
    const { points, durationMs, source } = buildPitchPath(mapper, pitch());
    expect(points.length).toBeGreaterThan(10);
    expect(durationMs).toBe(400);
    expect(source).toBe("heuristic");
    expect(points[0][1]).toBeGreaterThan(points[points.length - 1][1]);
  });

  it("builds a physics pitch path when kinematics exist", () => {
    const mapper = getMapper(null);
    const { source, points } = buildPitchPath(
      mapper,
      pitch({
        kinematics: {
          x0: 1.2,
          y0: 53,
          z0: 5.7,
          vX0: -1.5,
          vY0: -118,
          vZ0: -2,
          aX: -12,
          aY: 26,
          aZ: -28,
        },
      }),
    );
    expect(source).toBe("physics");
    expect(points.length).toBeGreaterThan(10);
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

  it("pursues nearest fielders harder on fly balls", () => {
    const mapper = getMapper(null);
    const defense: FieldDefender[] = [
      { position: "P", playerId: 1, name: "P", x: 50, y: 72 },
      { position: "CF", playerId: 2, name: "CF", x: 50, y: 18 },
      { position: "LF", playerId: 3, name: "LF", x: 22, y: 28 },
      { position: "SS", playerId: 4, name: "SS", x: 38, y: 52 },
    ];
    const targets = pursuitTargets(mapper, defense, hit());
    expect(targets.has("fielder-CF")).toBe(true);
    expect(targets.size).toBeGreaterThan(0);
  });

  it("builds a basepath polyline around the diamond", () => {
    const mapper = getMapper(null);
    const path = runnerPathBetween(mapper, "home", "second");
    expect(path.length).toBe(3);
  });
});
