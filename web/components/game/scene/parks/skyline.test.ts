import { describe, expect, it } from "vitest";
import ballparkIndex from "@/data/ballparks/index.json";
import { buildPark } from "@/lib/game/physics/park";
import { layoutFor } from "@/lib/game/data/parkLayouts";
import { buildWallLoop } from "@/components/game/scene/fieldGeometry";
import { GeoBuilder } from "@/components/game/scene/parks/geo";
import { features, roof, type PropCtx } from "@/components/game/scene/parks/props";
import { buildStands } from "@/components/game/scene/parks/stands";
import type { BallparkIndex } from "@/types/ballpark";

const venues = Object.values((ballparkIndex as unknown as BallparkIndex).parks);

function stats(b: GeoBuilder): { tris: number; finite: boolean; uvOk: boolean } {
  const g = b.build();
  const pos = g.getAttribute("position").array;
  let finite = true;
  for (let i = 0; i < pos.length; i += 1) if (!Number.isFinite(pos[i])) finite = false;
  const uv = g.getAttribute("uv")?.array;
  let uvOk = true;
  if (uv) for (let i = 0; i < uv.length; i += 1) if (!Number.isFinite(uv[i])) uvOk = false;
  return { tris: pos.length / 9, finite, uvOk };
}

/** Scenery (skylines, landmarks, roofs) for one park, day or night. */
function scenery(venueId: number, lit: boolean) {
  const park = buildPark(venueId);
  const loop = buildWallLoop(park);
  const layout = layoutFor(venueId);
  const st = new GeoBuilder();
  const glow = new GeoBuilder();
  const led = new GeoBuilder(true);
  const city = new GeoBuilder(true);
  const stands = buildStands(layout, loop, new GeoBuilder(), new GeoBuilder(true), { homeColor: "#123456", led: new GeoBuilder(true), glow: new GeoBuilder(), lit, skip: () => false });
  const ctx: PropCtx = {
    park,
    layout,
    loop,
    st,
    glow,
    led,
    city,
    flares: [],
    reach: stands.reach,
    homeColor: "#123456",
    lit,
  };
  roof(ctx);
  features(ctx);
  return { layout, st: stats(st), glow: stats(glow), city: stats(city) };
}

describe("city skylines and park landmarks", () => {
  for (const v of venues) {
    for (const lit of [false, true]) {
      it(`${v.venueName} (${lit ? "night" : "day"}): finite scenery within budget`, () => {
        const s = scenery(v.venueId, lit);
        expect(s.st.finite).toBe(true);
        expect(s.glow.finite).toBe(true);
        expect(s.city.finite).toBe(true);
        expect(s.city.uvOk).toBe(true);
        if (s.layout.features.some((f) => f.k === "skyline")) expect(s.city.tris).toBeGreaterThan(200);
        // Merged geometry: keep each park's backdrop to a modest triangle count.
        expect(s.city.tris).toBeLessThan(60000);
        expect(s.st.tris + s.glow.tris).toBeLessThan(120000);
      });
    }
  }

  it("lights skyline windows and beacons only at night", () => {
    const day = scenery(680, false);
    const night = scenery(680, true);
    expect(night.glow.tris).toBeGreaterThan(day.glow.tris);
  });
});
