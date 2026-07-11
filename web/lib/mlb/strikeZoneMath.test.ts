import { describe, expect, it } from "vitest";

import {
  ABS_PLANE_Y_FT,
  BALL_RADIUS_FT,
  PLATE_FRONT_Y_FT,
  PLATE_HALF_WIDTH_FT,
  absPlateLocation,
  isAbsStrike,
  isAbsStrikeForPitch,
  pitchCoordsAtY,
  sceneZoneToSvgPercent,
  strikeZoneCellRect,
  zoneRectPercent,
} from "@/lib/mlb/strikeZoneMath";
import type { SvgRectPercent } from "@/lib/mlb/strikeZoneMath";
import type { PitchKinematics, PlayPitch } from "@/types/mlb-live";

describe("strikeZoneCellRect", () => {
  const zone = zoneRectPercent(3.5, 1.5);

  it("maps MLB zones 01–09 into a 3×3 grid", () => {
    const topLeft = strikeZoneCellRect(zone, "01");
    const middle = strikeZoneCellRect(zone, "05");
    const bottomRight = strikeZoneCellRect(zone, "09");

    expect(topLeft?.x).toBeCloseTo(zone.x, 5);
    expect(topLeft?.y).toBeCloseTo(zone.y, 5);
    expect(middle?.x).toBeCloseTo(zone.x + zone.width / 3, 5);
    expect(middle?.y).toBeCloseTo(zone.y + zone.height / 3, 5);
    expect(bottomRight?.x).toBeCloseTo(zone.x + (zone.width * 2) / 3, 5);
    expect(bottomRight?.y).toBeCloseTo(zone.y + (zone.height * 2) / 3, 5);
  });

  it("returns null for out-of-zone ids", () => {
    expect(strikeZoneCellRect(zone, "11")).toBeNull();
  });
});

describe("sceneZoneToSvgPercent", () => {
  const sceneZone: SvgRectPercent = { x: 42, y: 48, width: 16, height: 22 };
  const szTop = 3.5;
  const szBottom = 1.5;

  it("maps ABS corners onto the scene zone edges", () => {
    const topLeft = sceneZoneToSvgPercent(-PLATE_HALF_WIDTH_FT, szTop, szTop, szBottom, sceneZone);
    const bottomRight = sceneZoneToSvgPercent(PLATE_HALF_WIDTH_FT, szBottom, szTop, szBottom, sceneZone);

    expect(topLeft.x).toBeCloseTo(sceneZone.x, 5);
    expect(topLeft.y).toBeCloseTo(sceneZone.y, 5);
    expect(bottomRight.x).toBeCloseTo(sceneZone.x + sceneZone.width, 5);
    expect(bottomRight.y).toBeCloseTo(sceneZone.y + sceneZone.height, 5);
  });

  it("plots clear balls outside the drawn zone", () => {
    const outside = sceneZoneToSvgPercent(1.0, 2.0, szTop, szBottom, sceneZone);

    expect(outside.x).toBeGreaterThan(sceneZone.x + sceneZone.width);
    expect(outside.y).toBeGreaterThan(sceneZone.y);
    expect(outside.y).toBeLessThan(sceneZone.y + sceneZone.height);
  });
});

/** Kyle Tucker pitch 6 — ABS overturned called strike (ARI @ LAD, 2026-07-10). */
const TUCKER_P6_KINEMATICS: PitchKinematics = {
  x0: 1.0809590647766838,
  y0: 50.00381833363634,
  z0: 5.9184644173068675,
  vX0: -5.195368514496487,
  vY0: -135.92898881538133,
  vZ0: -3.357379282018673,
  aX: 8.05183293435968,
  aY: 25.74363895486361,
  aZ: -16.993021510174643,
};

const TUCKER_P6 = {
  plateX: -0.291237538811999,
  plateZ: 3.5089928530402457,
  strikeZoneTop: 3.351,
  strikeZoneBottom: 1.691,
  kinematics: TUCKER_P6_KINEMATICS,
} satisfies Pick<
  PlayPitch,
  "plateX" | "plateZ" | "strikeZoneTop" | "strikeZoneBottom" | "kinematics"
>;

describe("ABS midpoint plate location", () => {
  it("places the ABS plane 8.5 inches behind the front of the plate", () => {
    expect(PLATE_FRONT_Y_FT).toBeCloseTo(17 / 12, 10);
    expect(ABS_PLANE_Y_FT).toBeCloseTo(PLATE_FRONT_Y_FT - 8.5 / 12, 10);
  });

  it("reproduces Statcast front-of-plate pX/pZ from kinematics", () => {
    const front = pitchCoordsAtY(TUCKER_P6_KINEMATICS, PLATE_FRONT_Y_FT);
    expect(front).not.toBeNull();
    expect(front!.x).toBeCloseTo(TUCKER_P6.plateX, 3);
    expect(front!.z).toBeCloseTo(TUCKER_P6.plateZ, 3);
  });

  it("projects Tucker ABS strike to the midpoint so ball overlap matches the call", () => {
    // Front-of-plate center is above the zone and does not touch.
    expect(
      isAbsStrike(
        TUCKER_P6.plateX,
        TUCKER_P6.plateZ,
        TUCKER_P6.strikeZoneTop,
        TUCKER_P6.strikeZoneBottom,
      ),
    ).toBe(false);

    const mid = absPlateLocation(TUCKER_P6);
    expect(mid.z).toBeLessThan(TUCKER_P6.plateZ);
    expect(mid.z - BALL_RADIUS_FT).toBeLessThanOrEqual(TUCKER_P6.strikeZoneTop);
    expect(isAbsStrikeForPitch(TUCKER_P6)).toBe(true);
  });

  it("falls back to front-of-plate coords without kinematics", () => {
    const loc = absPlateLocation({
      plateX: 0.5,
      plateZ: 2.5,
      kinematics: null,
    });
    expect(loc).toEqual({ x: 0.5, z: 2.5 });
  });
});
