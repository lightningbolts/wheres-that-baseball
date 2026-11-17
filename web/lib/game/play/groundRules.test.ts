import { describe, expect, it } from "vitest";
import { battedBallFromLaunch } from "@/lib/game/physics/batBall";
import { judgeFair, simulateBattedBall, type BattedBallPath } from "@/lib/game/physics/battedBall";
import { buildPark, type Park } from "@/lib/game/physics/park";
import { resolvePlay, type PlayResult } from "@/lib/game/play/resolvePlay";
import { newGame } from "@/lib/game/__fixtures/teams";
import { Rng } from "@/lib/game/math";

const FENWAY = buildPark(3);
const WRIGLEY = buildPark(17);
const TROP = buildPark(12);

function run(path: BattedBallPath, park: Park, seed: number): PlayResult {
  return resolvePlay({
    path,
    park,
    fielders: newGame().fielders(),
    runners: [null, null, null],
    batter: { playerId: 99, sprint: 27, bats: "R" },
    outs: 0,
    rng: new Rng(seed),
    launch: { ev: 0, la: 0 },
  });
}

function* grid(evs: number[], las: number[], sprays: number[], spin = 2200) {
  for (const ev of evs) for (const la of las) for (const sp of sprays) yield battedBallFromLaunch(ev, la, sp, spin);
}
const range = (a: number, b: number, step: number) => Array.from({ length: Math.floor((b - a) / step) + 1 }, (_, i) => a + i * step);

describe("ground rules", () => {
  it("Fenway: a fly off the Green Monster is a live ball, never a catch", () => {
    let caroms = 0;
    let offWall = 0;
    for (const ball of grid(range(88, 108, 2), range(16, 32, 2), [-40, -32, -24, -16])) {
      const path = simulateBattedBall(ball, FENWAY);
      if (path.homeRun || path.wallT == null || (path.firstLanding && path.firstLanding.t < path.wallT)) continue;
      // Comes back off the wall at a height an outfielder could glove it.
      if (!path.samples.some((s) => s.t > path.wallT! && s.phase === "air" && s.p.y < 9)) continue;
      caroms += 1;
      expect(judgeFair(path, null)).toBe(true);
      for (let seed = 1; seed <= 3; seed += 1) {
        const r = run(path, FENWAY, seed);
        // Only a ball gloved before it reaches the wall can be a catch.
        const grab = r.events.find((e) => e.type === "catch" || e.type === "dive");
        if (r.caught) expect(grab!.t, "caught off the wall").toBeLessThan(path.wallT!);
        else offWall += 1;
        expect(r.foul).toBe(false);
      }
    }
    expect(caroms).toBeGreaterThan(20);
    expect(offWall).toBeGreaterThan(caroms * 2);
  });

  it("a fly that hits the wall and still clears it is a home run, not a ground-rule double", () => {
    const path = simulateBattedBall(battedBallFromLaunch(105, 28, -38, 2200), FENWAY);
    if (path.wallT == null) expect(path.groundRuleDouble).toBe(false);
    for (const ball of grid(range(95, 112, 1), range(18, 40, 2), range(-44, 44, 4))) {
      const p = simulateBattedBall(ball, FENWAY);
      if (p.groundRuleDouble) expect(p.firstLanding).not.toBeNull();
    }
  });

  it("Wrigley: balls sometimes die in the ivy for a ground-rule double; elsewhere never", () => {
    let wall = 0;
    let lodged = 0;
    let grd = 0;
    for (const ball of grid(range(80, 110, 2), range(5, 30, 2), [-30, -10, 10, 30])) {
      const path = simulateBattedBall(ball, WRIGLEY);
      if (path.hitWall) wall += 1;
      if (!path.lodged) continue;
      lodged += 1;
      const r = run(path, WRIGLEY, 7);
      if (r.scoring === "2B (GR, ivy)") {
        grd += 1;
        expect(r.hit).toBe(2);
        expect(r.runners.find((x) => x.playerId === 99)?.to).toBe(2);
      }
      expect(simulateBattedBall(ball, buildPark(null)).lodged).toBe(false);
    }
    expect(lodged).toBeGreaterThan(0);
    expect(lodged / wall).toBeLessThan(0.12);
    expect(grd).toBeGreaterThan(0);
  });

  it("Tropicana Field: A/B catwalks are in play, C/D are a homer fair and dead foul", () => {
    const seen = { ab: 0, abCaught: 0, cdHR: 0, cdFoul: 0 };
    for (const ball of grid(range(70, 112, 3), range(30, 80, 3), [-60, -40, -20, 0, 20, 40, 60], 2400)) {
      const path = simulateBattedBall(ball, TROP);
      if (!path.catwalk) continue;
      const { ring } = path.catwalk;
      if (ring === "A" || ring === "B") {
        seen.ab += 1;
        expect(path.homeRun).toBe(false);
        if (run(path, TROP, 3).caught) seen.abCaught += 1;
      } else if (path.homeRun) {
        seen.cdHR += 1;
        expect(run(path, TROP, 3).hit).toBe(4);
      } else {
        expect(path.outOfPlayFoul).toBe(true);
        expect(run(path, TROP, 3).foul).toBe(true);
        seen.cdFoul += 1;
      }
    }
    expect(seen.ab).toBeGreaterThan(0);
    expect(seen.abCaught).toBeGreaterThan(0);
    expect(seen.cdHR).toBeGreaterThan(0);
    expect(seen.cdFoul).toBeGreaterThan(0);
    // Open-air parks have no roof to hit.
    expect(simulateBattedBall(battedBallFromLaunch(100, 75, 0, 2400), FENWAY).catwalk).toBeNull();
  });
});
