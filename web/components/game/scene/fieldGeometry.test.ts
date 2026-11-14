import { describe, expect, it } from "vitest";
import ballparkIndex from "@/data/ballparks/index.json";
import { buildPark } from "@/lib/game/physics/park";
import { layoutFor, PARK_LAYOUTS } from "@/lib/game/data/parkLayouts";
import { buildWallLoop, fieldGrass, fieldMarks, wallGeometry } from "@/components/game/scene/fieldGeometry";
import { GeoBuilder } from "@/components/game/scene/parks/geo";
import { buildStands } from "@/components/game/scene/parks/stands";
import { battersEye, bullpens, dugouts, features, foulPoles, lightBanks, netGeometry, roof, scoreboard, type PropCtx } from "@/components/game/scene/parks/props";
import type { BallparkIndex } from "@/types/ballpark";

const venues = Object.values((ballparkIndex as unknown as BallparkIndex).parks);

function finite(g: { getAttribute(name: string): { array: ArrayLike<number> } }): boolean {
  const a = g.getAttribute("position").array;
  for (let i = 0; i < a.length; i += 1) if (!Number.isFinite(a[i])) return false;
  return true;
}

describe("ballpark scene geometry", () => {
  it("has a layout for every park", () => {
    for (const v of venues) expect(PARK_LAYOUTS[v.venueId], v.venueName).toBeDefined();
  });

  for (const v of venues) {
    const park = buildPark(v.venueId);
    const loop = buildWallLoop(park);

    it(`${v.venueName}: wall loop is closed, ordered and matches the physics fence`, () => {
      const pts = loop.pts;
      expect(pts.length).toBeGreaterThan(150);
      // Bearings never run backwards and the loop spans the whole circle.
      for (let i = 1; i < pts.length; i += 1) expect(pts[i].beta).toBeGreaterThanOrEqual(pts[i - 1].beta - 1e-6);
      expect(pts[0].beta).toBeCloseTo(-180, 3);
      expect(pts[pts.length - 1].beta).toBeCloseTo(180, 3);
      expect(Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].z - pts[pts.length - 1].z)).toBeLessThan(0.5);
      // The rendered wall is exactly where the physics says the fence is.
      for (let a = -44; a <= 44; a += 4) {
        const w = loop.atBeta(a);
        expect(Math.abs(Math.hypot(w.x, w.z) - park.fence(a))).toBeLessThan(1.5);
        // Outward normals point away from home plate.
        expect(w.nx * w.x + w.nz * w.z).toBeGreaterThan(0);
      }
      expect(loop.length).toBeGreaterThan(1200);
      expect(loop.length).toBeLessThan(2400);
    });

    it(`${v.venueName}: stadium builds with finite geometry and a crowd`, () => {
      const layout = layoutFor(v.venueId);
      const st = new GeoBuilder();
      const glow = new GeoBuilder();
      const seats = new GeoBuilder(true);
      const stands = buildStands(layout, loop, st, seats, { homeColor: "#123456", skip: () => false });
      const ctx: PropCtx = { park, layout, loop, st, glow, reach: stands.reach, homeColor: "#123456", lit: true };
      foulPoles(ctx);
      dugouts(ctx);
      battersEye(ctx);
      bullpens(ctx);
      lightBanks(ctx);
      const board = scoreboard(ctx);
      roof(ctx);
      features(ctx);
      const net = netGeometry(ctx);
      expect(board.w).toBeGreaterThan(20);
      expect(board.position.every(Number.isFinite)).toBe(true);
      expect(stands.slots.length / 3).toBeGreaterThan(5000);
      expect(stands.yaws.length).toBe(stands.slots.length / 3);
      for (const g of [st.build(), glow.build(), seats.build(), net, wallGeometry(loop, layout), fieldGrass(loop), fieldMarks(park, loop)]) {
        expect(g.getAttribute("position").array.length).toBeGreaterThan(0);
        expect(finite(g)).toBe(true);
      }
    });
  }
});
