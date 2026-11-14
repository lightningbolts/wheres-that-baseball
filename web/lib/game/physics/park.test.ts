import { describe, expect, it } from "vitest";
import ballparkIndex from "@/data/ballparks/index.json";
import { buildPark } from "@/lib/game/physics/park";
import { FIELD_INFO_ANGLES } from "@/lib/game/physics/parkOutline";
import type { BallparkIndex } from "@/types/ballpark";

const index = ballparkIndex as unknown as BallparkIndex;
const venues = Object.values(index.parks);

/** Closest the fence comes to `ft` within `window` degrees of `deg`. */
function nearestMiss(fence: (deg: number) => number, deg: number, ft: number, window: number): number {
  let best = Infinity;
  for (let a = Math.max(-45, deg - window); a <= Math.min(45, deg + window); a += 0.5) best = Math.min(best, Math.abs(fence(a) - ft));
  return best;
}

describe("park fences follow the real outline", () => {
  it("covers all 30 parks", () => {
    expect(venues.length).toBe(30);
  });

  for (const v of venues) {
    const park = buildPark(v.venueId);
    const fi = v.fieldInfo as unknown as Record<string, number | undefined>;

    it(`${v.venueName}: fence matches the published distances`, () => {
      // The outline is scaled so the foul poles sit at the published line distances.
      expect(Math.abs(park.fence(-45) - fi.leftLine!)).toBeLessThan(1.5);
      expect(Math.abs(park.fence(45) - fi.rightLine!)).toBeLessThan(1.5);
      // Parks paint their interior numbers wherever the wall happens to turn, not at fixed
      // angles (Fenway's "left" 379 is its deep left-center), and a few outlines predate a
      // moved fence, so each published number only has to be attained somewhere on its side.
      for (const [key, deg] of FIELD_INFO_ANGLES) {
        const ft = fi[key];
        if (ft == null) continue;
        expect(nearestMiss(park.fence, deg, ft, 30), `${key} ${ft}`).toBeLessThan(9);
      }
      // Dead center is within a few percent of the published figure (Fenway quotes 390 beside its 420 triangle).
      if (fi.center != null) expect(Math.abs(park.fence(0) - fi.center) / fi.center).toBeLessThan(0.08);
    });

    it(`${v.venueName}: fence table is sane`, () => {
      let prev = park.fence(-45);
      for (let a = -45; a <= 45; a += 0.5) {
        const d = park.fence(a);
        expect(Number.isFinite(d)).toBe(true);
        expect(d).toBeGreaterThan(290);
        expect(d).toBeLessThan(440);
        // No teleporting walls: half a degree never moves the fence more than a notch.
        expect(Math.abs(d - prev)).toBeLessThan(14);
        prev = d;
      }
      // Outside the foul poles the lookup clamps instead of extrapolating.
      expect(park.fence(-60)).toBeCloseTo(park.fence(-45), 5);
      expect(park.fence(60)).toBeCloseTo(park.fence(45), 5);
    });

    it(`${v.venueName}: wall heights, markers and foul ground are sane`, () => {
      for (let a = -45; a <= 45; a += 1) {
        const h = park.wallHeight(a);
        expect(h).toBeGreaterThanOrEqual(3);
        expect(h).toBeLessThanOrEqual(38);
      }
      for (const b of park.wallBreaks) expect(Math.abs(b)).toBeLessThan(45);
      expect(park.fenceMarkers.length).toBeGreaterThanOrEqual(3);
      for (const m of park.fenceMarkers) {
        expect(Math.abs(m.deg)).toBeLessThanOrEqual(45);
        expect(Math.abs(park.fence(m.deg) - m.ft)).toBeLessThan(8);
      }
      expect(park.foulSpace).toBeGreaterThan(15);
      expect(park.foulSpace).toBeLessThan(90);
      expect(park.backstop).toBeGreaterThan(35);
      expect(park.backstop).toBeLessThan(90);
      // Two clubs play in minor-league parks for now.
      expect(park.capacity).toBeGreaterThan(9000);
    });
  }

  it("keeps the signature walls", () => {
    const fenway = buildPark(3);
    expect(fenway.wallHeight(-35)).toBeGreaterThan(30);
    expect(fenway.fence(-45)).toBeLessThan(320);
    const generic = buildPark(null);
    expect(generic.fence(0)).toBeGreaterThan(380);
    expect(generic.wallHeight(0)).toBe(8);
  });
});
