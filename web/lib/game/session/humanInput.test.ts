import { describe, expect, it } from "vitest";
import { contactScale, humanSwing, meterAt, meterToCommand, pciHalfSize, powerScale, SWING_LEAD_S } from "@/lib/game/session/humanInput";
import { idealContactTime, resolveSwingPhase, throwPitchPhase } from "@/lib/game/engine/atBat";
import { newGame } from "@/lib/game/__fixtures/teams";
import { Rng } from "@/lib/game/math";

describe("human input mapping", () => {
  it("meter: center paints, edges spray", () => {
    expect(meterToCommand(0.5, "pro")).toBeCloseTo(0.6);
    expect(meterToCommand(0, "pro")).toBeCloseTo(2.2);
    expect(meterAt(0)).toBe(0);
    expect(meterAt(0.5 / 1.15)).toBeCloseTo(0.5);
  });

  it("a well-timed, well-aimed swing squares up the ball; a wild one misses", () => {
    const g = newGame();
    const ctx = g.pitchContext();
    const rng = new Rng(3);
    let hardHit = 0, whiff = 0;
    for (let i = 0; i < 40; i++) {
      const flight = throwPitchPhase(ctx, { pitchIdx: 0, targetPx: 0, targetPz: 2.5, commandMult: 1 }, rng);
      const good = humanSwing({ pressT: idealContactTime(flight) - SWING_LEAD_S, pciPx: flight.px, pciPz: flight.pz, power: false }, flight, ctx.batter, ctx.side, "pro", rng);
      const r = resolveSwingPhase(ctx, { pitchIdx: 0, targetPx: 0, targetPz: 2.5, commandMult: 1 }, flight, good, rng);
      if (r.contact?.contact && (r.contact.exitSpeedMph ?? 0) > 88) hardHit++;
      const bad = humanSwing({ pressT: idealContactTime(flight) - SWING_LEAD_S, pciPx: flight.px + 1.5, pciPz: flight.pz, power: false }, flight, ctx.batter, ctx.side, "pro", rng);
      if (resolveSwingPhase(ctx, { pitchIdx: 0, targetPx: 0, targetPz: 2.5, commandMult: 1 }, flight, bad, rng).kind === "swinging_strike") whiff++;
    }
    expect(hardHit).toBeGreaterThan(20);
    expect(whiff).toBe(40);
  });

  it("a press after the ball is by the hitter is a late whiff", () => {
    const g = newGame();
    const ctx = g.pitchContext();
    const rng = new Rng(5);
    const decision = { pitchIdx: 0, targetPx: 0, targetPz: 2.5, commandMult: 1 };
    for (let i = 0; i < 20; i++) {
      const flight = throwPitchPhase(ctx, decision, rng);
      const late = humanSwing({ pressT: idealContactTime(flight) + 0.03, pciPx: flight.px, pciPz: flight.pz, power: false }, flight, ctx.batter, ctx.side, "pro", rng);
      expect(late.swing).toBe(true);
      expect(resolveSwingPhase(ctx, decision, flight, late, rng).kind).toBe("swinging_strike");
    }
  });
});

describe("per-batter plate coverage", () => {
  const avg = { zContact: 0.83, oContact: 0.57, batSpeedMph: 71 };
  const slap = { zContact: 0.93, oContact: 0.72, batSpeedMph: 64 };
  const slugger = { zContact: 0.74, oContact: 0.45, batSpeedMph: 78 };

  it("sizes the box by contact skill", () => {
    const a = pciHalfSize(false, "pro", avg).w;
    expect(pciHalfSize(false, "pro", slap).w).toBeGreaterThan(a * 1.15);
    expect(pciHalfSize(false, "pro", slugger).w).toBeLessThan(a * 0.85);
  });

  it("lets big power give up less box on a power swing", () => {
    const keep = (b: typeof avg) => pciHalfSize(true, "pro", b).w / pciHalfSize(false, "pro", b).w;
    expect(keep(slugger)).toBeGreaterThan(keep(slap));
    expect(powerScale(slugger)).toBe(1);
    expect(powerScale(slap)).toBe(0);
    expect(contactScale(undefined)).toBe(1);
  });
});
