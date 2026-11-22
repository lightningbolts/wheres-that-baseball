/**
 * How a player stands in and swings, and how a pitcher winds up: a stable, per-player
 * style drawn from his MLB id (and his build, once the roster is in), always inside the
 * range real hitters and pitchers actually use. A handful of famous stances are written
 * out by hand. Everything here is right-handed; the rig mirrors lefties.
 */
import { identity, rosterVersion } from "@/components/game/scene/character/roster";

export type StrideKind = "kick" | "tap" | "none";

export interface BatStyle {
  /** Feet apart (ft, heel to heel across the box): 2.1 narrow … 3.0 very wide. */
  width: number;
  /** −1 open (front foot pulled away from the plate) … 0 square … 1 closed. */
  open: number;
  /** 0 tall … 1 deep crouch. */
  crouch: number;
  /** Hands above (+) or below (−) the usual spot by the back shoulder, ft. */
  hands: number;
  /** Hands pushed out away from the body (+) or held in tight (−), ft. */
  depth: number;
  /** Bat angle above horizontal at rest, rad: 0.5 flat … 1.3 nearly upright. */
  angle: number;
  /** Bat tip: −0.3 wrapped back behind the head … +0.3 tipped toward the pitcher. */
  tip: number;
  /** Back elbow: 0 tucked down … 1 high (the chicken wing). */
  elbow: number;
  /** Bat waggle size (rad) and pace (rad/s) while he waits; a little bounce in the knees. */
  waggle: number;
  tempo: number;
  bounce: number;
  /** Timing step: a leg kick, a toe tap, or no stride at all. */
  stride: StrideKind;
  /** How high the front foot comes up (ft) and how far it strides forward (ft). */
  lift: number;
  reach: number;
  /** The top hand comes off the bat in the follow-through. */
  oneHand: boolean;
  /** Finish: −1 low and around … 1 high over the shoulder. */
  finish: number;
}

export interface PitchStyle {
  /** Leg lift height, as a scale of the default (knee to the belt ≈ 1). */
  lift: number;
  /** Hands at the set: above (+) or below (−) the chest, ft. */
  set: number;
  /** How far he tucks the knee back toward second (0 … 1). */
  coil: number;
}

/** A small, fast PRNG seeded from the player id: the same player always draws the same style. */
function stream(seed: number): () => number {
  let s = (seed ^ 0x9e3779b9) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Well-known stances, written over the drawn style. */
const KNOWN_BATS: Record<number, Partial<BatStyle>> = {
  // Shohei Ohtani: wide and quiet, hands high, no stride — a small toe tap.
  660271: { width: 2.85, open: 0.1, stride: "tap", lift: 0.2, reach: 0.25, hands: 0.15, angle: 1.0, waggle: 0.04, oneHand: true },
  // Aaron Judge: tall, hands high, bat nearly upright, a short toe tap.
  592450: { width: 2.6, crouch: 0.15, hands: 0.25, angle: 1.25, stride: "tap", lift: 0.25, reach: 0.3, waggle: 0.05, oneHand: false },
  // José Altuve: hands high, bat tipped back, a big leg kick.
  514888: { width: 2.4, hands: 0.3, angle: 1.15, stride: "kick", lift: 1.15, reach: 0.45, elbow: 0.7, waggle: 0.14 },
  // Mike Trout: wide, deep crouch, hands quiet and low, a small leg lift.
  545361: { width: 2.9, crouch: 0.75, hands: -0.1, angle: 0.95, stride: "tap", lift: 0.3, reach: 0.25, waggle: 0.03, oneHand: true },
  // Mookie Betts: high leg kick, hands set high and back.
  605141: { stride: "kick", lift: 1.1, hands: 0.2, angle: 1.05, crouch: 0.35, width: 2.4 },
  // Juan Soto: crouched and closed, bat waggling, a slide step.
  665742: { crouch: 0.7, open: 0.4, waggle: 0.18, tempo: 2.6, stride: "tap", lift: 0.25, reach: 0.4 },
  // Bryce Harper: open, hands high, waggle, a leg kick.
  547180: { open: -0.45, hands: 0.25, waggle: 0.16, stride: "kick", lift: 0.9, reach: 0.4, oneHand: true },
  // José Ramírez: big leg kick.
  608070: { stride: "kick", lift: 1.25, reach: 0.5, crouch: 0.3, width: 2.35, oneHand: true },
};

const bats = new Map<string, BatStyle>();
const pitches = new Map<number, PitchStyle>();

/** Power, from build: 0 slight … 1 big. Neutral until the roster is in. */
function powerOf(id: number): number {
  if (!id || !rosterVersion()) return 0.5;
  const g = identity(id).girth;
  return clamp((g - 0.9) / 0.24, 0, 1);
}

/** Pure: the style for a player id and a power figure (0..1). */
export function drawBatStyle(id: number, power: number): BatStyle {
  const r = stream(id * 2654435761 + 17);
  const p = clamp(power, 0, 1);
  // Bigger hitters stand wider, kick more and stride longer.
  const k = r();
  const stride: StrideKind = k < 0.3 + 0.2 * p ? "kick" : k < 0.82 ? "tap" : "none";
  const lift = stride === "kick" ? lerp(0.75, 1.3, r()) : stride === "tap" ? lerp(0.15, 0.32, r()) : 0.04;
  const out: BatStyle = {
    width: lerp(2.15, 2.75, (r() + p) / 2 + 0.1 * (stride === "none" ? 1 : 0)),
    open: clamp((r() - 0.55) * 1.6, -0.8, 0.6),
    crouch: Math.pow(r(), 1.4),
    hands: (r() - 0.45) * 0.45,
    depth: (r() - 0.5) * 0.3,
    angle: lerp(0.6, 1.25, r()),
    tip: (r() - 0.5) * 0.45,
    elbow: Math.pow(r(), 1.6) * 0.8,
    waggle: lerp(0.02, 0.18, r()),
    tempo: lerp(1.8, 3.2, r()),
    bounce: r(),
    stride,
    lift,
    reach: stride === "none" ? lerp(0.05, 0.15, r()) : lerp(0.25, 0.55, r()),
    oneHand: r() < 0.3 + 0.25 * p,
    finish: (r() - 0.4) * 1.4,
  };
  return clampBat({ ...out, ...KNOWN_BATS[id] });
}

/** Keep every field inside what a real stance looks like. */
export function clampBat(s: BatStyle): BatStyle {
  return {
    ...s,
    width: clamp(s.width, 2.1, 3.0),
    open: clamp(s.open, -1, 1),
    crouch: clamp(s.crouch, 0, 1),
    hands: clamp(s.hands, -0.3, 0.35),
    depth: clamp(s.depth, -0.2, 0.2),
    angle: clamp(s.angle, 0.5, 1.3),
    tip: clamp(s.tip, -0.3, 0.3),
    elbow: clamp(s.elbow, 0, 1),
    waggle: clamp(s.waggle, 0, 0.22),
    tempo: clamp(s.tempo, 1.5, 3.5),
    bounce: clamp(s.bounce, 0, 1),
    lift: clamp(s.lift, 0.03, 1.35),
    reach: clamp(s.reach, 0.05, 0.6),
    finish: clamp(s.finish, -1, 1),
  };
}

/** The batting style of the player with this MLB id (0: a plain, middle-of-the-road stance). */
export function batStyle(id: number | undefined): BatStyle {
  const key = `${id ?? 0}:${rosterVersion() ? 1 : 0}`;
  let s = bats.get(key);
  if (!s) {
    s = id ? drawBatStyle(id, powerOf(id)) : DEFAULT_BAT;
    if (bats.size > 2000) bats.clear();
    bats.set(key, s);
  }
  return s;
}

export const DEFAULT_BAT: BatStyle = {
  width: 2.45, open: 0, crouch: 0.35, hands: 0, depth: 0, angle: 0.95, tip: 0, elbow: 0.3, waggle: 0.08, tempo: 2.4, bounce: 0.5,
  stride: "tap", lift: 0.22, reach: 0.35, oneHand: false, finish: 0,
};

/** Pure: a pitcher's windup from his id. */
export function drawPitchStyle(id: number): PitchStyle {
  const r = stream(id * 40503 + 91);
  return { lift: lerp(0.75, 1.25, r()), set: (r() - 0.5) * 0.7, coil: r() };
}

export function pitchStyle(id: number | undefined): PitchStyle {
  if (!id) return { lift: 1, set: 0, coil: 0.5 };
  let s = pitches.get(id);
  if (!s) {
    s = drawPitchStyle(id);
    if (pitches.size > 2000) pitches.clear();
    pitches.set(id, s);
  }
  return s;
}
