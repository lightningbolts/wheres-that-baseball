import { describe, expect, it } from "vitest";

import {
  BATTER_BOX_GAP_FT,
  BATTER_BOX_WIDTH_FT,
  GAME_VIEW_WIDTH_FT,
  PLATE_HALF_WIDTH_FT,
  PLATE_BAND_PCT,
  ZONE_BAND_PCT,
  batterBoxRectsPercent,
  gameToSvgPercent,
  gameZoneRectPercent,
  isAbsStrike,
  plateBandBatterBoxes,
} from "@/lib/mlb/strikeZoneMath";

describe("gameToSvgPercent", () => {
  it("maps center of plate to horizontal center", () => {
    const pt = gameToSvgPercent(0, 2.5, 3.5, 1.5);
    expect(pt.x).toBeCloseTo(50, 0);
  });

  it("maps positive plateX toward the right of the view", () => {
    const left = gameToSvgPercent(-1, 2.5, 3.5, 1.5);
    const right = gameToSvgPercent(1, 2.5, 3.5, 1.5);
    expect(right.x).toBeGreaterThan(left.x);
  });
});

describe("gameZoneRectPercent", () => {
  it("centers the strike zone in the widened view", () => {
    const zone = gameZoneRectPercent(3.5, 1.5);
    const center = zone.x + zone.width / 2;
    expect(center).toBeCloseTo(50, 0);
    expect(zone.width).toBeGreaterThan(0);
    expect(zone.height).toBeGreaterThan(0);
  });
});

describe("batterBoxRectsPercent", () => {
  const szTop = 3.5;
  const szBottom = 1.5;

  it("places boxes on opposite sides of the plate", () => {
    const boxes = batterBoxRectsPercent("R", szTop, szBottom);
    const rhCenter = boxes.rightHanded.x + boxes.rightHanded.width / 2;
    const lhCenter = boxes.leftHanded.x + boxes.leftHanded.width / 2;
    expect(rhCenter).toBeLessThan(50);
    expect(lhCenter).toBeGreaterThan(50);
  });

  it("marks left-handed batters in the first-base box", () => {
    expect(batterBoxRectsPercent("L", szTop, szBottom).activeSide).toBe("leftHanded");
  });

  it("marks right-handed batters in the third-base box", () => {
    expect(batterBoxRectsPercent("R", szTop, szBottom).activeSide).toBe("rightHanded");
  });

  it("uses regulation box width in feet", () => {
    const inner = PLATE_HALF_WIDTH_FT + BATTER_BOX_GAP_FT;
    const span = inner + BATTER_BOX_WIDTH_FT;
    const viewHalf = GAME_VIEW_WIDTH_FT / 2;
    const expectedWidthPct = (BATTER_BOX_WIDTH_FT / GAME_VIEW_WIDTH_FT) * 100;
    const boxes = batterBoxRectsPercent("R", szTop, szBottom);
    expect(boxes.rightHanded.width).toBeCloseTo(expectedWidthPct, 0);
    expect(boxes.leftHanded.width).toBeCloseTo(expectedWidthPct, 0);
    expect(span).toBeLessThan(viewHalf);
  });
});

describe("plateBandBatterBoxes", () => {
  it("places boxes in the plate band on opposite sides", () => {
    const boxes = plateBandBatterBoxes("R");
    expect(boxes.rightHanded.y).toBeGreaterThanOrEqual(ZONE_BAND_PCT);
    expect(boxes.leftHanded.y).toBeGreaterThanOrEqual(ZONE_BAND_PCT);
    expect(boxes.rightHanded.x + boxes.rightHanded.width).toBeLessThan(50);
    expect(boxes.leftHanded.x).toBeGreaterThan(50);
  });

  it("selects active box from bat side", () => {
    expect(plateBandBatterBoxes("L").activeSide).toBe("leftHanded");
    expect(plateBandBatterBoxes("R").activeSide).toBe("rightHanded");
  });
});

describe("isAbsStrike", () => {
  it("matches a pitch on the corner of the zone", () => {
    expect(isAbsStrike(0, 2.5, 3.5, 1.5)).toBe(true);
    expect(isAbsStrike(2, 0.5, 3.5, 1.5)).toBe(false);
  });
});
