import { describe, expect, it } from "vitest";
import { umpireCall } from "@/lib/game/engine/atBat";
import { PLATE_HALF_WIDTH, type PitchFlight } from "@/lib/game/physics/pitch";
import { BALL_RADIUS_FT } from "@/lib/game/physics/ballFlight";
import { Rng } from "@/lib/game/math";

const BOT = 1.6;
const TOP = 3.4;
const fake = (px: number, pz: number) => ({ px, pz, cross: { t: 0.4, p: { x: -px, y: pz, z: 17 / 12 }, v: { x: 0, y: 0, z: -130 } }, samples: [] }) as unknown as PitchFlight;

function strikeRate(px: number, pz: number, count = { balls: 1, strikes: 1 }) {
  const rng = new Rng(3);
  const f = fake(px, pz);
  const inZone = Math.abs(px) <= PLATE_HALF_WIDTH + BALL_RADIUS_FT && pz >= BOT - BALL_RADIUS_FT && pz <= TOP + BALL_RADIUS_FT;
  let k = 0;
  for (let i = 0; i < 4000; i += 1) if (umpireCall(f, BOT, TOP, inZone, count, rng.gauss(0, 1), rng.gauss(0, 1))) k += 1;
  return k / 4000;
}

describe("umpire zone", () => {
  const edge = PLATE_HALF_WIDTH + BALL_RADIUS_FT;
  it("never misses the obvious ones", () => {
    expect(strikeRate(0, 2.5)).toBe(1);
    expect(strikeRate(edge + 0.5, 2.5)).toBe(0);
    expect(strikeRate(0, TOP + BALL_RADIUS_FT + 0.6)).toBe(0);
  });
  it("is a coin flip right on the edge and leans with the count", () => {
    const r = strikeRate(edge - 0.005, 2.5);
    expect(r).toBeGreaterThan(0.35);
    expect(r).toBeLessThan(0.65);
    // An inch off the corner is sometimes a strike, an inch inside sometimes a ball.
    expect(strikeRate(edge + 1 / 12, 2.5)).toBeGreaterThan(0.05);
    expect(strikeRate(edge - 1 / 12, 2.5)).toBeLessThan(0.95);
    expect(strikeRate(edge + 0.02, 2.5, { balls: 3, strikes: 0 })).toBeGreaterThan(strikeRate(edge + 0.02, 2.5, { balls: 0, strikes: 2 }));
  });
  it("is fuzzier at the knees than on the corners", () => {
    const low = strikeRate(0, BOT - BALL_RADIUS_FT - 0.1);
    const wide = strikeRate(edge + 0.1, 2.5);
    expect(low).toBeGreaterThan(wide);
  });
});

describe("umpire profiles", () => {
  const edge = PLATE_HALF_WIDTH + BALL_RADIUS_FT;
  const rate = (px: number, pz: number, ump?: { sd: number; zone: number; hi: number }) => {
    const rng = new Rng(9);
    const f = fake(px, pz);
    const inZone = Math.abs(px) <= edge && pz >= BOT - BALL_RADIUS_FT && pz <= TOP + BALL_RADIUS_FT;
    let k = 0;
    for (let i = 0; i < 4000; i += 1) if (umpireCall(f, BOT, TOP, inZone, { balls: 1, strikes: 1 }, rng.gauss(0, 1), rng.gauss(0, 1), ump)) k += 1;
    return k / 4000;
  };
  it("an average profile calls exactly like no profile", () => {
    for (const [px, pz] of [[edge - 0.03, 2.5], [edge + 0.04, 2.5], [0, BOT - 0.1], [0.3, TOP + 0.05]]) {
      expect(rate(px, pz, { sd: 1, zone: 0, hi: 0 })).toBe(rate(px, pz));
    }
  });
  it("a sharp umpire misses less near the edge than a loose one", () => {
    const miss = (ump: { sd: number; zone: number; hi: number }) => 1 - rate(edge - 0.06, 2.5, ump) + rate(edge + 0.06, 2.5, ump);
    expect(miss({ sd: 0.85, zone: 0, hi: 0 })).toBeLessThan(miss({ sd: 1.25, zone: 0, hi: 0 }));
  });
  it("a big zone gives the corner, a high zone gives the letters and takes the knees", () => {
    expect(rate(edge + 0.02, 2.5, { sd: 1, zone: 0.015, hi: 0 })).toBeGreaterThan(rate(edge + 0.02, 2.5));
    const hiUmp = { sd: 1, zone: 0, hi: 0.02 };
    expect(rate(0, TOP + BALL_RADIUS_FT + 0.01, hiUmp)).toBeGreaterThan(rate(0, TOP + BALL_RADIUS_FT + 0.01));
    expect(rate(0, BOT - BALL_RADIUS_FT + 0.01, hiUmp)).toBeLessThan(rate(0, BOT - BALL_RADIUS_FT + 0.01));
  });
});
