import { describe, expect, it } from "vitest";
import { battedBallFromLaunch } from "@/lib/game/physics/batBall";
import { simulateBattedBall } from "@/lib/game/physics/battedBall";
import { buildPark } from "@/lib/game/physics/park";
import { resolvePlay, type PlayEvent, type PlayInput, type PlayResult, type RunnerIn } from "@/lib/game/play/resolvePlay";
import { planThrow, throwRange, legTime, maxCarry } from "@/lib/game/play/throws";
import { BASE_POS } from "@/lib/game/play/movement";
import type { Fielder } from "@/lib/game/play/defense";
import { newGame } from "@/lib/game/__fixtures/teams";
import { horizDist, Rng, sprayDir, scale, type V3 } from "@/lib/game/math";
import type { FieldPos } from "@/lib/game/types";

const park = buildPark(null);

function fieldersWith(arms: Partial<Record<FieldPos, number>>): Fielder[] {
  return newGame()
    .fielders()
    .map((f) => (arms[f.pos] != null ? { ...f, arm: arms[f.pos]! } : f));
}

/** Perpendicular distance (ft) of `p` from the segment a→b, and how far along it is (0–1). */
function offLine(p: V3, a: V3, b: V3): { d: number; u: number } {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const l2 = dx * dx + dz * dz;
  const u = ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2;
  const qx = a.x + u * dx;
  const qz = a.z + u * dz;
  return { d: Math.hypot(p.x - qx, p.z - qz), u };
}

const at = (dist: number, spray: number): V3 => scale(sprayDir(spray), dist);

describe("arm strength → throwing range", () => {
  it("maps a weak, average and cannon arm to ~190 / 250 / 310 ft", () => {
    expect(throwRange(78)).toBeCloseTo(190, 0);
    expect(throwRange(88)).toBeCloseTo(250, 0);
    expect(throwRange(98)).toBeCloseTo(310, 0);
  });

  it("a throw past the range dies: each extra foot costs more than one inside it", () => {
    const inside = legTime(180, 80) - legTime(170, 80);
    const beyond = legTime(260, 80) - legTime(250, 80);
    expect(beyond).toBeGreaterThan(inside * 1.6);
  });
});

describe("relay and cutoff decisions", () => {
  it("weak-armed left fielder on a ball off the wall hits the shortstop relay, not home", () => {
    const fl = fieldersWith({ LF: 78 });
    const lf = fl.find((f) => f.pos === "LF")!;
    const ball = at(325, -30);
    expect(horizDist(ball, BASE_POS[4])).toBeGreaterThan(maxCarry(78));
    const plan = planThrow(lf, ball, 5, 4, { fielders: fl });
    expect(plan.kind).toBe("relay");
    expect(plan.legs.map((l) => [l.pos, l.receiver])).toEqual([
      ["LF", "SS"],
      ["SS", "C"],
    ]);
    // The relay man is in line between the ball and the plate, out on the grass.
    const spot = plan.legs[0].to;
    const { d, u } = offLine(spot, ball, BASE_POS[4]);
    expect(d).toBeLessThan(0.5);
    expect(u).toBeGreaterThan(0.3);
    expect(u).toBeLessThan(0.75);
    expect(horizDist(spot)).toBeGreaterThan(120);
    // Timing: each leg is a real throw, the turn takes 0.6–0.9 s, the whole relay ~3.5–5 s.
    const turn = plan.legs[1].t - plan.legs[0].arriveT;
    expect(turn).toBeGreaterThanOrEqual(0.6);
    expect(turn).toBeLessThanOrEqual(0.9);
    expect(plan.arriveT - 5).toBeGreaterThan(3.2);
    expect(plan.arriveT - 5).toBeLessThan(5.2);
    // Nobody throws past their range in the relay.
    expect(plan.legs[0].dist).toBeLessThan(throwRange(78) * 1.1);
  });

  it("right side of the field: the second baseman is the relay man", () => {
    const fl = fieldersWith({ RF: 80 });
    const rf = fl.find((f) => f.pos === "RF")!;
    const plan = planThrow(rf, at(330, 32), 5, 3, { fielders: fl });
    expect(plan.kind).toBe("relay");
    expect(plan.legs[0].receiver).toBe("2B");
    expect(plan.legs[1].receiver).toBe("3B");
  });

  it("cannon-armed right fielder on a medium fly throws home directly, through the cutoff", () => {
    const fl = fieldersWith({ RF: 99 });
    const rf = fl.find((f) => f.pos === "RF")!;
    const plan = planThrow(rf, at(265, 25), 3, 4, { fielders: fl });
    expect(plan.kind).toBe("direct");
    expect(plan.legs).toHaveLength(1);
    expect(plan.cutoffMan?.pos).toBe("1B");
    expect(offLine(plan.cutoffMan!.p, at(265, 25), BASE_POS[4]).d).toBeLessThan(0.5);
  });

  it("the same throw is a relay for a weak arm, and the cannon still beats it home", () => {
    const strong = fieldersWith({ RF: 99 });
    const weak = fieldersWith({ RF: 77 });
    const p = at(290, 25);
    const s = planThrow(strong.find((f) => f.pos === "RF")!, p, 3, 4, { fielders: strong });
    const w = planThrow(weak.find((f) => f.pos === "RF")!, p, 3, 4, { fielders: weak });
    expect(s.kind).toBe("direct");
    expect(w.kind).toBe("relay");
    expect(s.arriveT).toBeLessThan(w.arriveT - 0.3);
  });

  it("relays can be switched off (pre-relay model)", () => {
    const fl = fieldersWith({ LF: 78 });
    const plan = planThrow(fl.find((f) => f.pos === "LF")!, at(325, -30), 5, 4, { fielders: fl, relays: false });
    expect(plan.kind).toBe("direct");
  });
});

// ---------- Whole plays ----------

const R = (id: number, sprint = 27, going = false): RunnerIn => ({ playerId: id, sprint, going });

function play(
  ev: number,
  la: number,
  spray: number,
  o: {
    runners?: [RunnerIn | null, RunnerIn | null, RunnerIn | null];
    outs?: number;
    seed?: number;
    arms?: Partial<Record<FieldPos, number>>;
    chooseThrow?: PlayInput["chooseThrow"];
  } = {},
): PlayResult {
  return resolvePlay({
    path: simulateBattedBall(battedBallFromLaunch(ev, la, spray, la > 10 ? 2200 : 800), park),
    park,
    fielders: fieldersWith(o.arms ?? {}),
    runners: o.runners ?? [null, null, null],
    batter: { playerId: 99, sprint: 27, bats: "R" },
    outs: o.outs ?? 0,
    rng: new Rng(o.seed ?? 1),
    chooseThrow: o.chooseThrow,
    launch: { ev, la },
  });
}

const throwsOf = (r: PlayResult): PlayEvent[] => r.events.filter((e) => e.type === "throw");

function share(n: number, f: (seed: number) => PlayResult, pred: (r: PlayResult) => boolean): number {
  let k = 0;
  for (let s = 1; s <= n; s++) if (pred(f(s))) k++;
  return k / n;
}

describe("relays in a live play", () => {
  it("a throw home on a ball off the left-field wall goes LF → SS (in line) → C", () => {
    const r = play(100, 18, -28, { runners: [R(1), null, null], outs: 2, arms: { LF: 78 }, chooseThrow: () => 4 });
    expect(r.fieldedBy).toBe("LF");
    const th = throwsOf(r);
    expect(th).toHaveLength(2);
    expect(th[0]).toMatchObject({ pos: "LF", receiver: "SS", cutoff: true, base: 4 });
    expect(th[1]).toMatchObject({ pos: "SS", receiver: "C", base: 4 });
    expect(th[1].from).toEqual(th[0].to);
    expect(offLine(th[0].to!, th[0].from!, BASE_POS[4]).d).toBeLessThan(0.5);
    // He catches it, turns, and throws: the second leg leaves after the first arrives.
    expect(th[1].t).toBeGreaterThan(th[0].arriveT! + 0.55);
    expect(r.endT).toBeGreaterThanOrEqual(th[1].arriveT!);
  });

  it("no play: the ball comes back in to the relay man", () => {
    const r = play(100, 18, -28, { runners: [null, null, null] });
    const th = throwsOf(r);
    expect(th.length).toBeGreaterThan(0);
    expect(th[0]).toMatchObject({ pos: "LF", receiver: "SS", cutoff: true });
  });
});

describe("tagging up", () => {
  it("a deep fly to right moves a fast runner from second to third", () => {
    const adv = share(
      30,
      (seed) => play(94, 32, 28, { runners: [null, R(2, 29.5), null], seed }),
      (r) => r.caught && r.runners.some((x) => x.playerId === 2 && x.to === 3 && !x.out),
    );
    expect(adv).toBeGreaterThan(0.75);
  });

  it("the tagging runner goes back to the bag, holds until the catch, then takes off", () => {
    const r = play(94, 32, 28, { runners: [null, R(2, 29.5), null], seed: 3 });
    const ro = r.runners.find((x) => x.playerId === 2)!;
    const catchT = r.events.find((e) => e.type === "catch")!.t;
    expect(ro.to).toBe(3);
    expect(ro.path?.length).toBeGreaterThan(0);
    const onBag = ro.path!.filter((w) => w.s === 180);
    expect(Math.min(...onBag.map((w) => w.t))).toBeLessThan(catchT);
    expect(Math.max(...onBag.map((w) => w.t))).toBeGreaterThanOrEqual(catchT);
    expect(ro.t).toBeGreaterThan(catchT + 3);
  });

  it("a shallow fly holds the runner at second", () => {
    const held = share(
      30,
      (seed) => play(66, 40, 5, { runners: [null, R(2, 29.5), null], seed }),
      (r) => r.caught && r.runners.some((x) => x.playerId === 2 && x.to === 2 && !x.out),
    );
    expect(held).toBeGreaterThan(0.9);
  });

  it("a runner on third challenges a weak arm more than a cannon on a medium fly", () => {
    const scored = (arm: number) =>
      share(
        60,
        (seed) => play(74, 32, 25, { runners: [null, null, R(3, 27)], outs: 1, seed, arms: { RF: arm } }),
        (r) => r.caught && r.runners.some((x) => x.playerId === 3 && x.to === 4),
      );
    const weak = scored(76);
    const cannon = scored(100);
    expect(weak).toBeGreaterThan(cannon + 0.25);
  });

  it("a runner tagging into a strong throw can be cut down for a double play", () => {
    const dp = [...Array(300)]
      .map((_, i) => play(78, 32, 25, { runners: [null, null, R(3, 27)], outs: 0, arms: { RF: 100 }, seed: i + 1 }))
      .find((r) => r.caught && r.outs === 2);
    expect(dp).toBeDefined();
    expect(dp!.doublePlay).toBe(true);
    expect(dp!.runs).toHaveLength(0);
    const ro = dp!.runners.find((x) => x.playerId === 3)!;
    expect(ro).toMatchObject({ to: 4, out: true });
    expect(dp!.events.some((e) => e.type === "tag_out" && e.base === 4)).toBe(true);
  });

  it("a runner going on the pitch is doubled off on a line drive caught by an infielder", () => {
    const doubled = share(
      20,
      (seed) => play(95, 12, -10, { runners: [null, R(2, 27, true), null], seed }),
      (r) => r.caught && r.runners.some((x) => x.playerId === 2 && x.out && x.to === 2),
    );
    expect(doubled).toBeGreaterThan(0.5);
  });

  it("a runner frozen in his lead on a liner usually gets back", () => {
    const back = share(
      20,
      (seed) => play(95, 12, -10, { runners: [null, R(2, 27), null], seed }),
      (r) => r.caught && r.runners.some((x) => x.playerId === 2 && !x.out && x.to === 2),
    );
    expect(back).toBeGreaterThan(0.7);
  });

  it("no tag-ups with the third out made on the catch", () => {
    const r = play(94, 32, 28, { runners: [null, R(2, 30), R(3, 30)], outs: 2 });
    expect(r.caught).toBe(true);
    expect(r.runs).toHaveLength(0);
    expect(throwsOf(r)).toHaveLength(0);
  });
});
