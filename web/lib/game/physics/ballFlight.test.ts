import { describe, expect, it } from "vitest";
import { integrateFlight, makeAir, SEA_LEVEL_AIR } from "@/lib/game/physics/ballFlight";
import { battedBallFromLaunch, resolveContact } from "@/lib/game/physics/batBall";
import { horizDist, MPH_TO_FPS, v3 } from "@/lib/game/math";

function carry(ev: number, la: number, spin: number, air = SEA_LEVEL_AIR) {
  const start = battedBallFromLaunch(ev, la, 0, spin);
  const { final, t } = integrateFlight(start, air, (s) => s.p.y <= 0);
  return { dist: horizDist(final.p), hang: t };
}

describe("batted-ball flight", () => {
  it("100 mph / 28° / 2000 rpm carries ~390–410 ft at sea level", () => {
    const { dist, hang } = carry(100, 28, 2000);
    expect(dist).toBeGreaterThan(385);
    expect(dist).toBeLessThan(415);
    expect(hang).toBeGreaterThan(5);
    expect(hang).toBeLessThan(6.5);
  });

  it("matches Statcast-ish carry across the launch window", () => {
    // Typical Statcast distances (approx): 95/25 ≈ 360, 105/30 ≈ 425, 90/15 line drive ≈ 260
    expect(carry(95, 25, 2200).dist).toBeGreaterThan(335);
    expect(carry(95, 25, 2200).dist).toBeLessThan(380);
    expect(carry(105, 30, 2000).dist).toBeGreaterThan(410);
    expect(carry(105, 30, 2000).dist).toBeLessThan(450);
    expect(carry(90, 12, 1500).dist).toBeGreaterThan(200);
    expect(carry(90, 12, 1500).dist).toBeLessThan(275);
  });

  it("carries ~5–10% farther at Coors Field elevation", () => {
    const sea = carry(100, 28, 2000).dist;
    const coors = carry(100, 28, 2000, makeAir(5200, 72)).dist;
    expect(coors / sea).toBeGreaterThan(1.04);
    expect(coors / sea).toBeLessThan(1.11);
  });

  it("more backspin carries farther (up to a point) and drag shortens vs vacuum", () => {
    expect(carry(100, 28, 2500).dist).toBeGreaterThan(carry(100, 28, 1000).dist);
    const vacuum = ((100 * MPH_TO_FPS) ** 2 * Math.sin(56 * Math.PI / 180)) / 32.174;
    expect(carry(100, 28, 2000).dist).toBeLessThan(vacuum * 0.85);
  });
});

describe("bat–ball collision", () => {
  const pitch = v3(0, -1.5, -90 * MPH_TO_FPS * 0.92); // ~83 mph at the plate, slight downward
  const base = { batSpeedMph: 72, attackAngleDeg: 10, pathSprayDeg: 0, verticalOffsetFt: 0, alongBarrelFt: 0 };

  it("square sweet-spot contact gives ~100 mph exit velocity", () => {
    const r = resolveContact(pitch, v3(0, 2.5, 1.5), base);
    expect(r.contact).toBe(true);
    expect(r.exitSpeedMph!).toBeGreaterThan(94);
    expect(r.exitSpeedMph!).toBeLessThan(106);
  });

  it("undercutting makes fly balls with backspin; topping makes grounders", () => {
    const under = resolveContact(pitch, v3(0, 2.5, 1.5), { ...base, verticalOffsetFt: 0.09 });
    const over = resolveContact(pitch, v3(0, 2.5, 1.5), { ...base, verticalOffsetFt: -0.09 });
    expect(under.launchAngleDeg!).toBeGreaterThan(20);
    expect(under.backspinRpm!).toBeGreaterThan(1200);
    expect(over.launchAngleDeg!).toBeLessThan(0);
    expect(over.backspinRpm!).toBeLessThan(0);
  });

  it("misses when the barrel is more than r_ball + r_bat away", () => {
    expect(resolveContact(pitch, v3(0, 2.5, 1.5), { ...base, verticalOffsetFt: 0.25 }).contact).toBe(false);
  });

  it("off the end of the bat loses exit velocity", () => {
    const sweet = resolveContact(pitch, v3(0, 2.5, 1.5), base).exitSpeedMph!;
    const end = resolveContact(pitch, v3(0, 2.5, 1.5), { ...base, alongBarrelFt: 0.4 }).exitSpeedMph!;
    const jammed = resolveContact(pitch, v3(0, 2.5, 1.5), { ...base, alongBarrelFt: -0.9 }).exitSpeedMph!;
    expect(end).toBeLessThan(sweet - 5);
    expect(jammed).toBeLessThan(sweet - 15);
  });

  it("early swings pull the ball, late swings go the other way", () => {
    expect(resolveContact(pitch, v3(0, 2.5, 1.5), { ...base, pathSprayDeg: -25 }).sprayDeg!).toBeLessThan(-15);
    expect(resolveContact(pitch, v3(0, 2.5, 1.5), { ...base, pathSprayDeg: 25 }).sprayDeg!).toBeGreaterThan(15);
  });
});
