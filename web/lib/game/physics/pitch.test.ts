import { describe, expect, it } from "vitest";
import rosters from "@/data/game/rosters.json";
import { calibratePitch, statcastPlateCrossing, throwPitch } from "@/lib/game/physics/pitch";
import { Rng, v3 } from "@/lib/game/math";
import { ballAccel, SEA_LEVEL_AIR } from "@/lib/game/physics/ballFlight";
import type { RosterFile } from "@/lib/game/types";

const file = rosters as unknown as RosterFile;
const arsenal = Object.values(file.teams)
  .flatMap((t) => [...t.rotation, ...t.bullpen])
  .flatMap((p) => p.pitch?.arsenal ?? []);

describe("pitch physics from real Statcast arsenals", () => {
  it("has a real arsenal sample to test against", () => {
    expect(arsenal.length).toBeGreaterThan(800);
  });

  it("Magnus-calibrated flight reproduces each pitch's measured plate location (median < 1 in)", () => {
    const errs: number[] = [];
    for (const entry of arsenal) {
      const cal = calibratePitch(entry);
      const ref = statcastPlateCrossing(entry.kin);
      errs.push(Math.hypot(-cal.avgPlate.x - ref.px, cal.avgPlate.y - ref.pz) * 12);
    }
    errs.sort((a, b) => a - b);
    const median = errs[Math.floor(errs.length / 2)];
    const p95 = errs[Math.floor(errs.length * 0.95)];
    expect(median).toBeLessThan(1.0);
    expect(p95).toBeLessThan(3.0);
  });

  it("a 95+ mph fastball reaches the plate in ~0.40–0.44 s from release", () => {
    const ff = arsenal.find((a) => a.type === "FF" && a.speed > 95 && a.speed < 96)!;
    const cal = calibratePitch(ff);
    const flight = throwPitch(cal, { targetPx: 0, targetPz: 2.5, commandMult: 0 }, new Rng(1));
    // y=50 → plate, plus release (~54 ft) → y=50 at ~140 ft/s
    const fromRelease = flight.cross.t + (60.5 - (ff.ext ?? 6.3) - 50) / 140;
    expect(fromRelease).toBeGreaterThan(0.37);
    expect(fromRelease).toBeLessThan(0.45);
  });

  it("aims accurately with zero command error, and spreads realistically with it", () => {
    const sl = calibratePitch(arsenal.find((a) => a.type === "SL")!);
    const exact = throwPitch(sl, { targetPx: 0.5, targetPz: 1.8, commandMult: 0 }, new Rng(2));
    expect(Math.abs(exact.px - 0.5)).toBeLessThan(0.02);
    expect(Math.abs(exact.pz - 1.8)).toBeLessThan(0.02);
    const rng = new Rng(3);
    const miss: number[] = [];
    for (let i = 0; i < 200; i += 1) {
      const f = throwPitch(sl, { targetPx: 0, targetPz: 2.5 }, rng);
      miss.push(Math.hypot(f.px, f.pz - 2.5) * 12);
    }
    const mean = miss.reduce((a, b) => a + b, 0) / miss.length;
    // MLB average miss distance from catcher target is roughly 6–9 inches.
    expect(mean).toBeGreaterThan(4);
    expect(mean).toBeLessThan(12);
  });

  it("breaking balls drop more than fastballs (spin direction is physical)", () => {
    const pitcher = Object.values(file.teams)
      .flatMap((t) => t.rotation)
      .find((p) => p.pitch!.arsenal.some((a) => a.type === "CU") && p.pitch!.arsenal.some((a) => a.type === "FF"))!;
    const ff = calibratePitch(pitcher.pitch!.arsenal.find((a) => a.type === "FF")!);
    const cu = calibratePitch(pitcher.pitch!.arsenal.find((a) => a.type === "CU")!);
    // Magnus lift: fastball backspin rises vs. a spinless ball, curveball topspin dives.
    const magnusY = (c: typeof ff) =>
      ballAccel(c.v0, c.spin, SEA_LEVEL_AIR).y - ballAccel(c.v0, v3(), SEA_LEVEL_AIR).y;
    expect(magnusY(ff)).toBeGreaterThan(8);
    expect(magnusY(cu)).toBeLessThan(-5);
    expect(cu.speedMph).toBeLessThan(ff.speedMph - 8);
  });
});
