import { describe, expect, it } from "vitest";
import { UMPIRES, umpById } from "./data";
import {
  consistentCalls,
  describeMiss,
  missFactor,
  simUmpCard,
  UmpTracker,
} from "./scorecard";
import { FRng } from "@/lib/game/franchise/rng";
import { PLATE_HALF_WIDTH, type PitchFlight } from "@/lib/game/physics/pitch";
import { BALL_RADIUS_FT } from "@/lib/game/physics/ballFlight";
import { BaseballGame } from "@/lib/game/rules/game";
import { simulateGame } from "@/lib/game/engine/sim";
import { CPU } from "@/lib/game/ai/cpu";
import { TEAMS } from "@/lib/game/__fixtures/teams";
import { buildPark, homeVenueForTeam } from "@/lib/game/physics/park";
import { Rng } from "@/lib/game/math";

const flight = (px: number, pz: number) =>
  ({
    px,
    pz,
    cross: {
      t: 0.4,
      p: { x: -px, y: pz, z: 17 / 12 },
      v: { x: 0, y: 0, z: -130 },
    },
    samples: [],
  }) as unknown as PitchFlight;
const EDGE = PLATE_HALF_WIDTH + BALL_RADIUS_FT;

describe("umpire roster", () => {
  it("has a full staff of unique names, 19 crew chiefs, modest profiles", () => {
    expect(UMPIRES.length).toBeGreaterThanOrEqual(70);
    expect(UMPIRES.length).toBeLessThanOrEqual(76);
    expect(new Set(UMPIRES.map((u) => u.name)).size).toBe(UMPIRES.length);
    expect(UMPIRES.filter((u) => u.chief).length).toBe(19);
    for (const u of UMPIRES) {
      expect(u.sd).toBeGreaterThanOrEqual(0.8);
      expect(u.sd).toBeLessThanOrEqual(1.3);
      expect(Math.abs(u.zone)).toBeLessThanOrEqual(0.02);
      expect(Math.abs(u.hi)).toBeLessThanOrEqual(0.02);
    }
    expect(umpById(UMPIRES[0].id)?.name).toBe(UMPIRES[0].name);
  });
});

describe("scorecard", () => {
  it("consistency is the best single-threshold fit", () => {
    // A tight zone called perfectly to its own edge: fully consistent though not "accurate".
    expect(
      consistentCalls([
        { m: 0.2, strike: true },
        { m: 0.05, strike: false },
        { m: -0.1, strike: false },
      ]),
    ).toBe(3);
    expect(
      consistentCalls([
        { m: 0.2, strike: false },
        { m: 0.1, strike: true },
        { m: -0.1, strike: true },
        { m: -0.2, strike: false },
      ]),
    ).toBe(3);
    // Two different calls at the same spot: one threshold can explain only one, in either order.
    expect(consistentCalls([{ m: 0.1, strike: false }, { m: 0.1, strike: true }])).toBe(1);
    expect(consistentCalls([{ m: 0.1, strike: true }, { m: 0.1, strike: false }])).toBe(1);
  });

  it("counts correct and missed calls, favor and the biggest miss", () => {
    const t = new UmpTracker();
    const base = {
      zoneBottom: 1.6,
      zoneTop: 3.4,
      balls: 0,
      strikes: 0,
      inning: 1,
    };
    t.record({
      ...base,
      flight: flight(0, 2.5),
      inZone: true,
      strike: true,
      top: true,
    });
    t.record({
      ...base,
      flight: flight(EDGE + 0.5, 2.5),
      inZone: false,
      strike: false,
      top: true,
    });
    // Strike called 2" off the plate in the top: helps the home club.
    t.record({
      ...base,
      flight: flight(EDGE + 2 / 12, 2.5),
      inZone: false,
      strike: true,
      top: true,
      balls: 3,
      strikes: 2,
      inning: 7,
    });
    // Ball called an inch inside in the bottom: helps the home club, which is batting.
    t.record({
      ...base,
      flight: flight(EDGE - 1 / 12, 2.5),
      inZone: true,
      strike: false,
      top: false,
    });
    const c = t.card();
    expect(c.n).toBe(4);
    expect(c.ok).toBe(2);
    expect(c.xa).toBeGreaterThan(2);
    expect(c.xa).toBeLessThan(4);
    expect(c.fav).toBeCloseTo(0.55 + 0.07, 5);
    expect(c.big).toMatchObject({ in: 2, k: 1, c: "3-2", inn: 7, top: 1 });
    expect(describeMiss(c.big!)).toContain("T7");
  });

  it("simmed cards land where played games do, and follow the profile", () => {
    const rng = new FRng(5);
    const sum = (sd: number) => {
      let n = 0;
      let ok = 0;
      let con = 0;
      for (let i = 0; i < 400; i += 1) {
        const c = simUmpCard({ sd, zone: 0, hi: 0 }, 290, 9, rng);
        n += c.n;
        ok += c.ok;
        con += c.con;
        expect(c.con).toBeGreaterThanOrEqual(c.ok);
        expect(c.con).toBeLessThanOrEqual(c.n);
      }
      return { acc: ok / n, cons: con / n, per: n / 400 };
    };
    const avg = sum(1);
    expect(avg.per).toBeGreaterThan(140);
    expect(avg.per).toBeLessThan(165);
    expect(avg.acc).toBeGreaterThan(0.935);
    expect(avg.acc).toBeLessThan(0.955);
    expect(avg.cons).toBeGreaterThan(avg.acc);
    expect(sum(0.85).acc).toBeGreaterThan(sum(1.25).acc);
    expect(missFactor({ sd: 1, zone: 0, hi: 0 })).toBe(1);
  });

  it("a played game keeps the umpire's own calls, before ABS reversals", () => {
    const ump = UMPIRES.find((u) => u.name === "CB Bucknor")!;
    const game = new BaseballGame(
      TEAMS[0],
      TEAMS[1],
      buildPark(homeVenueForTeam(TEAMS[1].teamId)),
      { abs: true, ump },
    );
    expect(game.pitchContext().ump).toBe(ump);
    simulateGame(game, { away: CPU, home: CPU }, new Rng(4));
    const c = game.umpCard.card();
    expect(c.n).toBeGreaterThan(80);
    expect(c.ok).toBeLessThan(c.n);
    expect(c.con).toBeGreaterThanOrEqual(c.ok);
    // Overturned calls stay misses on the umpire's card.
    const overturns = game.log.filter((e) => e.abs?.overturned).length;
    expect(c.n - c.ok).toBeGreaterThanOrEqual(overturns);
    // No umpire: the context carries none (old games replay unchanged).
    expect(
      "ump" in
        new BaseballGame(
          TEAMS[0],
          TEAMS[1],
          buildPark(homeVenueForTeam(TEAMS[1].teamId)),
        ).pitchContext(),
    ).toBe(false);
  });
});
