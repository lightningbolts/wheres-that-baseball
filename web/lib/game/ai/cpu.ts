/**
 * CPU pitcher and batter. The CPU only makes *decisions* (pitch, target, swing,
 * timing/aim error drawn from the player's real plate-discipline and contact
 * profile); the outcome of every pitch is still decided by the physics.
 */
import type { Controller, PitchContext, PitchDecision, SwingDecision } from "@/lib/game/engine/atBat";
import { distanceOutsideZone } from "@/lib/game/engine/atBat";
import type { PitchFlight } from "@/lib/game/physics/pitch";
import { isStrike } from "@/lib/game/physics/pitch";
import { clamp, type Rng } from "@/lib/game/math";

export const FASTBALLS = new Set(["FF", "SI", "FC"]);
export const BREAKING = new Set(["SL", "ST", "CU", "KC", "SV", "CS", "KN"]);
export const OFFSPEED = new Set(["CH", "FS", "FO", "SC"]);
/** Share of non-whiff swings that only glance the ball (MLB: lots of foul-backs / weak contact). */
const GLANCE_SHARE = 0.26;

export function cpuChoosePitch(ctx: PitchContext, rng: Rng): PitchDecision {
  const { pitcher, batter, count, side } = ctx;
  const ahead = count.strikes > count.balls;
  const behind = count.balls > count.strikes;
  const sameHand = side === pitcher.throws;
  const weights = pitcher.arsenal.map((p) => {
    let w = p.usage;
    if (ahead && !FASTBALLS.has(p.type)) w *= 1.35;
    if (behind && FASTBALLS.has(p.type)) w *= count.balls === 3 ? 1.9 : 1.4;
    if (!sameHand && OFFSPEED.has(p.type)) w *= 1.3;
    if (sameHand && (p.type === "SL" || p.type === "ST")) w *= 1.2;
    return w;
  });
  const idx = rng.pickWeighted(
    weights.map((w, i) => ({ w, i })),
    (x) => x.w,
  ).i;
  const type = pitcher.arsenal[idx].type;

  let zoneP = pitcher.zoneRate + 0.06;
  const key = `${count.balls}-${count.strikes}`;
  zoneP += ({ "3-0": 0.3, "3-1": 0.22, "2-0": 0.13, "3-2": 0.14, "2-1": 0.06, "0-2": -0.22, "1-2": -0.13, "2-2": -0.05 } as Record<string, number>)[key] ?? 0;
  if (!FASTBALLS.has(type)) zoneP -= 0.07;
  zoneP = clamp(zoneP, 0.15, 0.92);

  const zb = batter.zoneBottom;
  const zt = batter.zoneTop;
  let tx: number;
  let tz: number;
  if (rng.chance(zoneP)) {
    // Work the edges: most in-zone targets are a few inches inside the black.
    const sx = rng.chance(0.5) ? 1 : -1;
    tx = sx * rng.range(0.15, 0.62);
    tz = rng.range(zb + 0.25, zt - 0.25);
  } else if (BREAKING.has(type) || OFFSPEED.has(type)) {
    tx = rng.range(-0.9, 0.9);
    tz = zb - rng.range(0.15, 0.7);
  } else if (rng.chance(0.4)) {
    tx = rng.range(-0.6, 0.6);
    tz = zt + rng.range(0.1, 0.5); // elevated fastball
  } else {
    tx = (rng.chance(0.5) ? 1 : -1) * rng.range(0.95, 1.35);
    tz = rng.range(zb, zt);
  }
  return { pitchIdx: idx, targetPx: tx, targetPz: tz, commandMult: 1 };
}

/**
 * Squares to bunt before the pitch: sacrifices with a runner on and nobody out (mostly
 * weak hitters, more late in close games) and the occasional drag bunt by a burner.
 */
export function cpuWantsBunt(ctx: PitchContext, rng: Rng): boolean {
  const { batter: b, count, outs } = ctx;
  const bases = ctx.bases;
  if (!bases || count.strikes >= 2) return false;
  const xw = b.raw.sav?.xwoba ?? 0.31;
  if (outs === 0 && (bases[0] || bases[1]) && !bases[2]) {
    const weak = clamp((0.3 - xw) / 0.05, 0, 1);
    const p = (ctx.lateClose ? 0.06 + 0.3 * weak : 0.004 + 0.05 * weak) * (0.4 + b.bunt);
    return p > 0.003 && rng.chance(p);
  }
  if (!bases[0] && !bases[1] && !bases[2] && b.sprint >= 29 && b.bunt >= 0.5 && count.balls <= 1) return rng.chance(0.006);
  return false;
}

export function cpuDecideSwing(ctx: PitchContext, flight: PitchFlight, rng: Rng): SwingDecision {
  const { batter: b, count, pitcher, side } = ctx;
  if (cpuWantsBunt(ctx, rng)) {
    const drag = !ctx.bases?.some(Boolean);
    const toFirst = drag && side === "L";
    return { swing: true, bunt: true, buntAimDeg: toFirst ? 24 : side === "R" ? -20 : -18, timingErrMs: 0, verticalErrFt: 0, alongErrFt: 0 };
  }
  const type = flight.type;
  const breaking = !FASTBALLS.has(type);
  // Perception: hitters judge location with error, more so on spin that tunnels off the fastball.
  const noise = breaking ? 0.26 : 0.18;
  const perPx = flight.px + rng.gauss(0, noise);
  const perPz = flight.pz + rng.gauss(0, noise);
  const out = distanceOutsideZone(perPx, perPz, b);
  let pSwing = out <= 0 ? b.zSwing * 1.1 : clamp(b.oSwing * 2.4 * Math.exp(-out / 0.42), 0, 0.95);
  const key = `${count.balls}-${count.strikes}`;
  if (count.strikes === 2) pSwing = out <= 0 ? Math.min(0.97, pSwing + 0.16) : pSwing * 1.35;
  if (key === "3-0") pSwing *= 0.2;
  if (key === "0-0") pSwing *= 0.66;
  if (key === "2-0" || key === "3-1") pSwing *= out <= 0 ? 1.08 : 0.75;
  const swing = rng.chance(clamp(pSwing, 0, 0.98));

  const inZone = isStrike(flight.px, flight.pz, b.zoneBottom, b.zoneTop);
  const c = inZone ? b.zContact : b.oContact;
  // Pitcher stuff (K-rate vs league) shifts the odds of making contact.
  const odds = ((1 - c) / c) * Math.pow(pitcher.stuff, 0.9) * (breaking ? 0.92 : 0.84);
  const cAdj = 1 / (1 + odds);
  const whiffChance = clamp(1 - cAdj, 0, 0.9);

  const speed = flight.releaseSpeedMph;
  const offspeed = OFFSPEED.has(type);
  const timingErrMs = rng.gauss((speed - 94) * 0.45 + (offspeed ? -7 : 0) + (breaking && !offspeed ? -3 : 0), b.timingSdMs);
  const outPenalty = inZone ? 1 : 1.35;
  // Low pitches get topped, high pitches get under.
  const heightBias = (flight.pz - (b.zoneBottom + b.zoneTop) / 2) * 0.025;
  let verticalErrFt = rng.gauss(b.liftOffsetFt + heightBias, b.verticalSdFt * outPenalty);
  // Recognition: a fooled hitter misses entirely, or barely nicks it (foul back / weak contact).
  const roll = rng.next();
  const sign = rng.chance(0.5) ? 1 : -1;
  if (roll < whiffChance) verticalErrFt = sign * 0.6;
  else if (roll < whiffChance + GLANCE_SHARE * (1 - whiffChance)) verticalErrFt = sign * rng.range(0.16, 0.225);
  const bodySide = side === "R" ? -1 : 1;
  const insideAmt = flight.px * bodySide; // + = inside
  const alongErrFt = rng.gauss(-insideAmt * 0.32, 0.33);
  const batSpeedMult = 0.98 + rng.gauss(0, 0.035) - (count.strikes === 2 ? 0.04 : 0);
  return { swing, timingErrMs, verticalErrFt, alongErrFt, batSpeedMult };
}

export const CPU: Controller = {
  choosePitch: cpuChoosePitch,
  decideSwing: cpuDecideSwing,
};
