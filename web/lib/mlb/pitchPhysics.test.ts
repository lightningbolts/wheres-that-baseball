import { describe, expect, it } from "vitest";

import {
  buildPhysicsPitchPath,
  integratePitchPhysics,
  mlbFeetToScene,
} from "@/lib/mlb/pitchPhysics";
import { getParkSceneMapper } from "@/lib/mlb/ballparkScene";
import type { PlayPitch } from "@/types/mlb-live";

function pitch(overrides: Partial<PlayPitch> = {}): PlayPitch {
  return {
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
  };
}

describe("pitchPhysics", () => {
  it("maps Statcast feet into scene space", () => {
    const [x, y, z] = mlbFeetToScene(1, 50, 6);
    expect(x).toBeLessThan(0); // +x (1B) → scene -X
    expect(y).toBeGreaterThan(0);
    expect(z).toBeGreaterThan(0); // toward mound / CF
  });

  it("integrates quadratic kinematics toward the plate", () => {
    const points = integratePitchPhysics(
      {
        x0: 1.5,
        y0: 54,
        z0: 5.8,
        vX0: -2,
        vY0: -120,
        vZ0: -3,
        aX: -10,
        aY: 25,
        aZ: -25,
      },
      0.42,
      20,
    );
    expect(points.length).toBe(21);
    // y (toward mound) should decrease toward plate (scene Z shrinks).
    expect(points[0][2]).toBeGreaterThan(points[points.length - 1][2]);
  });

  it("uses physics source when kinematics are present", () => {
    const mapper = getParkSceneMapper(null);
    const result = buildPhysicsPitchPath(
      mapper,
      pitch({
        kinematics: {
          x0: 1.5,
          y0: 54,
          z0: 5.8,
          vX0: -2,
          vY0: -120,
          vZ0: -3,
          aX: -10,
          aY: 25,
          aZ: -25,
        },
      }),
    );
    expect(result.source).toBe("physics");
    expect(result.durationMs).toBe(400);
    expect(result.points.length).toBeGreaterThan(10);
  });

  it("falls back to heuristic without kinematics", () => {
    const mapper = getParkSceneMapper(null);
    const result = buildPhysicsPitchPath(mapper, pitch({ kinematics: null, pfxX: -6, pfxZ: 8 }));
    expect(result.source).toBe("heuristic");
    expect(result.points.length).toBeGreaterThan(10);
  });
});
