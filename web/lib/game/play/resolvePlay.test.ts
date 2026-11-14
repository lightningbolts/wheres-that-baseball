import { describe, expect, it } from "vitest";
import { battedBallFromLaunch } from "@/lib/game/physics/batBall";
import { simulateBattedBall } from "@/lib/game/physics/battedBall";
import { buildPark } from "@/lib/game/physics/park";
import { resolvePlay, type PlayInput, type PlayResult } from "@/lib/game/play/resolvePlay";
import { newGame } from "@/lib/game/__fixtures/teams";
import { Rng } from "@/lib/game/math";

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
