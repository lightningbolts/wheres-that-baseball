import ballparks from "@/data/ballparks/index.json";
import { describe, expect, it } from "vitest";
import { battedBallFromLaunch } from "@/lib/game/physics/batBall";
import { simulateBattedBall } from "@/lib/game/physics/battedBall";
import { buildPark } from "@/lib/game/physics/park";
import { resolvePlay, type PlayInput, type PlayResult } from "@/lib/game/play/resolvePlay";
import { newGame } from "@/lib/game/__fixtures/teams";
import { Rng, horizDist } from "@/lib/game/math";
import { BASE_POS, runTime } from "@/lib/game/play/movement";
import { PITCHER_TOP_SPEED } from "@/lib/game/play/defense";

const park = buildPark(null);
const R = (id: number, sprint = 27) => ({ playerId: id, sprint });

function play(
  ev: number,
  la: number,
  spray: number,
  opts: { on?: [boolean, boolean, boolean]; outs?: number; seed?: number; spin?: number } = {},
): PlayResult {
  const g = newGame();
  const on = opts.on ?? [false, false, false];
  const ball = battedBallFromLaunch(ev, la, spray, opts.spin ?? (la > 10 ? 2200 : 800));
  const input: PlayInput = {
    path: simulateBattedBall(ball, park),
    park,
    fielders: g.fielders(),
    runners: [on[0] ? R(1) : null, on[1] ? R(2) : null, on[2] ? R(3) : null],
    batter: { ...R(99), bats: "R" },
    outs: opts.outs ?? 0,
    rng: new Rng(opts.seed ?? 1),
    launch: { ev, la },
  };
  return resolvePlay(input);
}

/** Run a scenario over many seeds and return the share satisfying `pred`. */
function share(n: number, f: (seed: number) => PlayResult, pred: (r: PlayResult) => boolean): number {
  let k = 0;
  for (let s = 1; s <= n; s++) if (pred(f(s))) k++;
  return k / n;
}

describe("resolvePlay scenarios", () => {
  it("a no-doubter clears the bases", () => {
    const r = play(108, 29, -5, { on: [true, true, true] });
    expect(r.hit).toBe(4);
    expect(r.runs).toHaveLength(4);
    expect(r.outs).toBe(0);
  });

  it("an infield pop-up is caught and nobody moves", () => {
    const r = play(75, 62, 5, { on: [true, true, false] });
    expect(r.caught).toBe(true);
    expect(r.outs).toBe(1);
    expect(r.runners.filter((x) => x.from > 0).every((x) => x.to === x.from)).toBe(true);
  });

  it("routine grounder at the shortstop with a man on first turns two most of the time", () => {
    const dp = share(40, (seed) => play(92, -4, -14, { on: [true, false, false], seed }), (r) => r.doublePlay);
    expect(dp).toBeGreaterThan(0.6);
  });

  it("double plays are scored with the real pivot man", () => {
    const r = [...Array(30)].map((_, i) => play(92, -4, -14, { on: [true, false, false], seed: i + 1 })).find((x) => x.doublePlay);
    expect(r?.scoring).toBe("6-4-3 DP");
  });

  it("a deep fly with a runner on third and one out is a sacrifice fly", () => {
    const sf = share(30, (seed) => play(96, 34, 0, { on: [false, false, true], outs: 1, seed }), (r) => r.caught && r.sacFly && r.runs.length === 1);
    expect(sf).toBeGreaterThan(0.8);
  });

  it("a runner scoring on a high-angle catch in the outfield is a sacrifice fly too", () => {
    const rs = [...Array(30)].map((_, i) => play(108, 52, 4, { on: [false, false, true], outs: 1, seed: i + 1 }));
    const scored = rs.filter((r) => r.caught && r.runs.length === 1 && r.fieldedBy && ["LF", "CF", "RF"].includes(r.fieldedBy));
    expect(scored.length).toBeGreaterThan(0);
    for (const r of scored) expect(r.sacFly).toBe(true);
  });

  it("no tag-up after the third out", () => {
    const r = play(96, 34, 0, { on: [false, false, true], outs: 2 });
    expect(r.caught).toBe(true);
    expect(r.runs).toHaveLength(0);
  });

  it("a clean single to center scores the runner from second more often than not", () => {
    const scored = share(40, (seed) => play(98, 8, 2, { on: [false, true, false], seed }), (r) => r.hit === 1 && r.runs.length === 1);
    expect(scored).toBeGreaterThan(0.5);
  });

  it("a ball down the line in the gap goes for extra bases", () => {
    const r = play(104, 20, -38);
    expect(r.hit).toBeGreaterThanOrEqual(2);
  });
});

describe("fielders stay on the field", () => {
  const venues = Object.values((ballparks as { parks: Record<string, { venueId: number; teamId: number | null }> }).parks)
    .filter((p) => p.teamId != null)
    .map((p) => p.venueId);
  it.each(venues)("venue %i: no catch or pickup beyond the drawn wall", (venueId) => {
    const pk = buildPark(venueId);
    const g = newGame();
    let caughtFoul = 0;
    let seed = 1;
    for (const side of [1, -1]) {
      for (let spray = 46; spray <= 88; spray += 6) {
        for (const la of [30, 45, 60, 72]) {
          for (const ev of [60, 75, 90]) {
            seed += 1;
            const path = simulateBattedBall(battedBallFromLaunch(ev, la, side * spray, 2600), pk);
            const r = resolvePlay({
              path,
              park: pk,
              fielders: g.fielders(),
              runners: [null, null, null],
              batter: { ...R(99), bats: "R" },
              outs: 0,
              rng: new Rng(seed),
              launch: { ev, la },
            });
            for (const e of r.events) {
              if (!e.to || !e.pos || !["catch", "dive", "drop", "field", "error"].includes(e.type)) continue;
              const bearing = (Math.atan2(-e.to.x, e.to.z) * 180) / Math.PI;
              const fair = e.to.z > 0 && Math.abs(bearing) <= 45;
              const limit = fair ? pk.fence(bearing) + 1.5 : pk.wallDist(bearing) - 1;
              if (Math.hypot(e.to.x, e.to.z) > limit) {
                throw new Error(`${e.type} by ${e.pos} at (${e.to.x.toFixed(1)}, ${e.to.z.toFixed(1)}) beyond the wall (${limit.toFixed(1)} ft) — ev ${ev} la ${la} spray ${side * spray}`);
              }
              if (e.type === "catch" && !fair) caughtFoul += 1;
            }
            // A ball that leaves play in foul ground is never also a hit or an out on the ground.
            if (path.outOfPlayFoul && !r.caught) expect(r.foul).toBe(true);
          }
        }
      }
    }
    // Foul pops near the field are still caught.
    expect(caughtFoul).toBeGreaterThan(5);
  });

  it("leaves a ball that's through the infield to the outfielders", () => {
    // Soft rollers and bloopers that get past the infielders, line to line.
    for (const ev of [60, 70]) {
      for (const la of [5, 7, 9]) {
        for (let spray = -44; spray <= 44; spray += 8) {
          const r = play(ev, la, spray, { spin: 800 });
          const field = r.events.find((e) => e.type === "field" || e.type === "error");
          if (!field?.to || ["LF", "CF", "RF"].includes(r.fieldedBy ?? "")) continue;
          // An infielder only fields what he can cut off, a step or two behind his spot at most.
          expect(Math.hypot(field.to.x, field.to.z), `${ev}/${la}/${spray} ${r.fieldedBy}`).toBeLessThan(165);
        }
      }
    }
  });

  it("a throw never beats the man covering the bag there (the pitcher can't fly to first)", () => {
    const g = newGame();
    const fielders = g.fielders();
    let pitcherCovers = 0;
    let checked = 0;
    for (const spray of [-20, -10, -4, 0, 4, 10, 16, 22, 28, 34, 40]) {
      for (const ev of [55, 70, 85, 100]) {
        for (const la of [-12, -5, 2]) {
          for (const on of [[false, false, false], [true, false, false], [true, true, false]] as Array<[boolean, boolean, boolean]>) {
            const r = play(ev, la, spray, { on, seed: ev + spray * 7 + la });
            for (const e of r.events) {
              if (e.type !== "throw" || !e.receiver || e.cutoff || !e.base) continue;
              const c = fielders.find((x) => x.pos === e.receiver)!;
              const speed = c.pos === "P" ? Math.min(c.sprint, PITCHER_TOP_SPEED) : c.sprint;
              const ready = c.reaction + 0.15 + runTime(Math.max(0, horizDist(c.p, BASE_POS[e.base as 1 | 2 | 3 | 4]) - 2), speed);
              expect(e.arriveT!, `${r.scoring} throw to ${e.base} for ${e.receiver}`).toBeGreaterThanOrEqual(ready + 0.1 - 1e-9);
              checked++;
              if (e.receiver === "P" && e.base === 1) {
                pitcherCovers++;
                const first = r.events.find((x) => x.type === "throw");
                if (first === e && r.outs === 1 && r.runners.find((x) => x.from === 0)?.out) expect(r.scoring).toBe("3-1");
              }
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
    expect(pitcherCovers).toBeGreaterThan(0);
  });

  it("a slow roller the catcher pounces on is a force at first, not a tag", () => {
    let forced = 0;
    for (let seed = 1; seed <= 40; seed++) {
      // Pitcher off the field so the catcher gets to the dribbler.
      const fielders = newGame().fielders().filter((f) => f.pos !== "P");
      const r = resolvePlay({
        path: simulateBattedBall(battedBallFromLaunch(25, -20, seed % 3 === 0 ? -10 : 5, 800), park),
        park,
        fielders,
        runners: [null, null, null],
        batter: { ...R(99), bats: "R" },
        outs: 0,
        rng: new Rng(seed),
        launch: { ev: 25, la: -20 },
      });
      expect(r.fieldedBy).toBe("C");
      expect(r.events.some((e) => e.type === "tag_out")).toBe(false);
      if (r.events.some((e) => e.type === "force_out" && e.base === 1)) {
        forced++;
        expect(r.scoring).toBe("2-3");
      }
    }
    expect(forced).toBeGreaterThan(20);
  });
});
