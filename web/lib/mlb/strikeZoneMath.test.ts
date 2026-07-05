import { describe, expect, it } from "vitest";

import { strikeZoneCellRect, zoneRectPercent } from "@/lib/mlb/strikeZoneMath";

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
