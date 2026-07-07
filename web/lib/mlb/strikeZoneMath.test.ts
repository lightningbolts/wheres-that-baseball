import { describe, expect, it } from "vitest";

import {
  PLATE_HALF_WIDTH_FT,
  sceneZoneToSvgPercent,
  strikeZoneCellRect,
  zoneRectPercent,
} from "@/lib/mlb/strikeZoneMath";
import type { SvgRectPercent } from "@/lib/mlb/strikeZoneMath";

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
