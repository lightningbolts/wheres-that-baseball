import { describe, expect, it } from "vitest";
import { simulateBattedBall } from "@/lib/game/physics/battedBall";
import { buildPark } from "@/lib/game/physics/park";
import { horizDist, v3 } from "@/lib/game/math";

const launch = (mph: number, la: number, spray = 0) => {
  const s = (mph * 5280) / 3600;
  const r = (la * Math.PI) / 180;
  const a = (spray * Math.PI) / 180;
  const h = s * Math.cos(r);
  // Backspin (about -x) like a real fly ball.
  return { p: v3(0, 3, 1.5), v: v3(-h * Math.sin(a), s * Math.sin(r), h * Math.cos(a)), w: v3(-220, 0, 0) };
};

describe("batted ball leaving the park", () => {
  const park = buildPark(null);

  it("carries a homer on into the seats and brings it to rest there", () => {
    const path = simulateBattedBall(launch(108, 28), park);
    expect(path.homeRun).toBe(true);
    expect(path.tail.length).toBeGreaterThan(5);
    const end = path.samples[path.samples.length - 1];
    const rest = path.tail[path.tail.length - 1];
    expect(rest.phase).toBe("dead");
    expect(rest.t).toBeGreaterThan(end.t);
    expect(horizDist(rest.p)).toBeGreaterThan(horizDist(end.p));
    // Comes down on the raked seats: above the field, below where it crossed the wall + a deck.
    expect(rest.p.y).toBeGreaterThan(park.wallHeight(0));
    // Statcast-style projected distance: past the fence, not stopped at it.
    expect(path.distance).toBeGreaterThan(horizDist(end.p) + 5);
  });

  it("has no tail for a ball that stays in play", () => {
    const path = simulateBattedBall(launch(85, 12), park);
    expect(path.homeRun).toBe(false);
    expect(path.tail).toEqual([]);
  });
});
