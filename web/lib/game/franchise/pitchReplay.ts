/**
 * Pitch-by-pitch (Statcast) logs for simmed franchise games.
 *
 * The franchise sim settles each plate appearance as a whole: its result and how many
 * pitches it took. This replays every one pitch by pitch, consistent with both: a
 * strikeout ends on strike three, a walk on ball four, a ball in play on the last pitch,
 * and the count never ends the at-bat early. Each pitch comes from the pitcher's real
 * arsenal (Statcast velocity, spin, extension and movement from its kinematics, mixed by
 * count and handedness, fading with fatigue); each batted ball gets an exit velocity,
 * launch angle and distance that fit the hit and the hitter.
 *
 * It is a pure function of the game log (its own seeded stream), so nothing is stored:
 * the same game always replays the same pitches, and the sim's dice never move.
 */
import type { ArsenalPitch, RosterPlayer, StatcastKinematics } from "@/lib/game/types";
import { isBarrel, type PitchRecord } from "@/lib/game/stats/pitchLog";
import type { PitchResultKind } from "@/lib/game/engine/atBat";
import type { GameLog, Play, PlayCode } from "./gamelog";
import { FRng, hash32 } from "./rng";
import type { Player } from "./types";

/** What the replay needs to know about a player. */
export interface PitchLogPlayer {
  name: string;
  throws: "L" | "R";
  bats: "L" | "R" | "S";
  /** Real arsenal (rosters.json); a generic one is made up without it. */
  arsenal?: ArsenalPitch[];
  /** Pitches before fatigue sets in. */
  stamina?: number;
  /** Batter's strike zone, ft: [bottom, top]. */
  zone?: [number | null, number | null];
  evMean?: number | null;
  laMean?: number | null;
}

/**
 * Who's who for the replay: franchise players (current hand, physics template) with
 * rosters.json data where there is any; `names` (the game's own) win for display.
 */
export function pitchLogPlayers(players: Record<number, Player>, idx: Map<number, RosterPlayer> | null, names?: Record<number, string>): (id: number) => PitchLogPlayer {
  const cache = new Map<number, PitchLogPlayer>();
  return (id) => {
    let r = cache.get(id);
    if (r) return r;
    const p = players[id];
    const t = p ? ((p.template != null ? idx?.get(p.template) : undefined) ?? idx?.get(p.id)) : idx?.get(id);
    r = {
      name: names?.[id] ?? p?.name ?? t?.name ?? `#${id}`,
      throws: p?.throws ?? t?.throws ?? "R",
      bats: p?.bats ?? t?.bats ?? "R",
      arsenal: t?.pitch?.arsenal,
      stamina: t?.pitch?.stamina,
      zone: t?.zone,
      evMean: t?.bat?.evMean,
      laMean: t?.bat?.laMean,
    };
    cache.set(id, r);
    return r;
  };
}

export interface GamePitchLog {
  pitches: PitchRecord[];
  /** Plate appearance number (PitchRecord.pa) for each play in `log.plays`; null for steals and pitching changes. */
  paOfPlay: Array<number | null>;
}

const FASTBALLS = new Set(["FF", "FA", "SI", "FC"]);
const OFFSPEED = new Set(["CH", "FS", "FO", "SC"]);
const SWEEPY = new Set(["SL", "ST", "SV"]);
const LOW = new Set(["CH", "FS", "FO", "SC", "CU", "KC", "CS", "SL", "ST", "SV", "KN"]);
/** Plate half-width plus a ball radius, ft (the rulebook zone a pitch must touch). */
const ZONE_HALF = 0.83;
const LG_EV = 88.5;
const LG_LA = 12;

const PA_RESULT: Partial<Record<PlayCode, string>> = {
  K: "Strikeout",
  BB: "Walk",
  HBP: "Hit by pitch",
  "1B": "Single",
  "2B": "Double",
  "3B": "Triple",
  HR: "Home run",
  E: "Reached on error",
  DP: "Double play",
  FC: "Fielder's choice",
  SF: "Sac fly",
  GO: "Out",
  FO: "Out",
};

const isPa = (code: PlayCode) => code !== "SB" && code !== "CS" && code !== "PC";

/** Typical pitches per plate appearance (older logs that didn't record them). */
const TYPICAL_PITCHES: Partial<Record<PlayCode, number>> = { K: 4.8, BB: 5.7, HBP: 3.4, HR: 3.4, DP: 3.1 };

// ------------------------------------------------------------------ movement

/** Time for a Statcast-kinematics pitch (released toward −y) to reach `y`, s. */
function timeTo(k: StatcastKinematics, y: number): number {
  const a = 0.5 * k.aY;
  const b = k.vY0;
  const c = k.y0 - y;
  if (Math.abs(a) < 1e-6) return -c / b;
  const disc = Math.max(0, b * b - 4 * a * c);
  return (-b - Math.sqrt(disc)) / (2 * a);
}

/**
 * Induced break (in) versus a spinless ball over the whole flight, release to plate, like
 * Savant's IVB / HB and Play Ball's pitch log. +x toward first base.
 */
export function pfxFromKinematics(k: StatcastKinematics, extFt: number | null): { ivb: number; hb: number } {
  const t = timeTo(k, 17 / 12) - timeTo(k, 60.5 - (extFt ?? 6.3));
  return { hb: 0.5 * k.aX * t * t * 12, ivb: 0.5 * (k.aZ + 32.174) * t * t * 12 };
}

interface Pitch {
  type: string;
  usage: number;
  speed: number;
  speedSd: number;
  spin: number;
  ext: number | null;
  ivb: number;
  hb: number;
}

const DEFAULT_SPIN: Record<string, number> = { FF: 2300, SI: 2150, FC: 2350, SL: 2450, ST: 2600, SV: 2500, CU: 2550, KC: 2400, CH: 1750, FS: 1350, FO: 1100, SC: 2000, KN: 300 };

function realPitches(arsenal: ArsenalPitch[]): Pitch[] {
  return arsenal
    .filter((a) => a.usage > 0 && Number.isFinite(a.speed))
    .map((a) => {
      const mv = a.kin ? pfxFromKinematics(a.kin, a.ext) : { ivb: 0, hb: 0 };
      return {
        type: a.type,
        usage: a.usage,
        speed: a.speed,
        speedSd: a.speedSd ?? 1,
        spin: a.spin ?? DEFAULT_SPIN[a.type] ?? 2200,
        ext: a.ext,
        ivb: mv.ivb,
        hb: mv.hb,
      };
    });
}

/** A plausible three-pitch mix for a pitcher without tracking data, varied by his id. */
function genericPitches(id: number, throws: "L" | "R"): Pitch[] {
  const h = hash32(id, "arsenal");
  const velo = 91 + (h % 60) / 10;
  const arm = throws === "R" ? -1 : 1;
  const breaking = h & 1 ? "SL" : "CU";
  return [
    { type: "FF", usage: 0.52, speed: velo, speedSd: 1, spin: 2200 + ((h >>> 8) % 300), ext: 6.3, ivb: 15, hb: 7 * arm },
    breaking === "SL"
      ? { type: "SL", usage: 0.3, speed: velo - 8, speedSd: 1.2, spin: 2450, ext: 6.2, ivb: 2, hb: -4 * arm }
      : { type: "CU", usage: 0.3, speed: velo - 12, speedSd: 1.3, spin: 2550, ext: 6.1, ivb: -9, hb: -7 * arm },
    { type: "CH", usage: 0.18, speed: velo - 8.5, speedSd: 1.2, spin: 1750, ext: 6.3, ivb: 6, hb: 13 * arm },
  ];
}

// ------------------------------------------------------------------ the count

type Step = "B" | "S" | "F2";

/**
 * The pitches before the last one: balls, strikes (called, swinging or foul) and fouls
 * with two strikes, ordered so the at-bat only ends on its final pitch.
 */
function countPath(code: PlayCode, n: number, rng: FRng): Step[] {
  const pre = Math.max(0, n - 1);
  let balls: number;
  let strikes: number;
  if (code === "K") {
    strikes = 2;
    const room = Math.max(0, pre - 2);
    balls = Math.min(3, room);
    if (balls > 0 && rng.chance(0.35)) balls -= 1;
  } else if (code === "BB") {
    balls = 3;
    strikes = Math.min(2, Math.max(0, pre - 3));
  } else if (pre > 5) {
    balls = 3;
    strikes = 2;
  } else {
    // Any split of the earlier pitches with at most three balls and two strikes.
    const opts: Array<[number, number]> = [];
    for (let b = 0; b <= 3; b += 1) if (pre - b >= 0 && pre - b <= 2) opts.push([b, pre - b]);
    [balls, strikes] = opts.length ? rng.pick(opts) : [Math.min(3, pre), 0];
  }
  balls = Math.min(balls, pre);
  strikes = Math.min(strikes, pre - balls);
  const fouls = Math.max(0, pre - balls - strikes);
  const seq: Step[] = rng.shuffle([...Array<Step>(balls).fill("B"), ...Array<Step>(strikes).fill("S")]);
  if (fouls) {
    // Two-strike fouls go anywhere after the second strike.
    let after = 0;
    let seen = 0;
    for (let i = 0; i < seq.length; i += 1) {
      if (seq[i] === "S" && ++seen === 2) {
        after = i + 1;
        break;
      }
    }
    for (let f = 0; f < fouls; f += 1) seq.splice(after + rng.int(seq.length - after + 1), 0, "F2");
  }
  return seq;
}

// ------------------------------------------------------------------ batted balls

interface Bip {
  ev: number;
  la: number;
  dist: number;
}

function distance(ev: number, la: number, rng: FRng): number {
  if (la < 8) return Math.max(5, 55 + ev * 0.6 + rng.gauss(0, 18));
  if (la > 50) return Math.max(60, 95 + (ev - 60) * 2.2 + rng.gauss(0, 15));
  const f = Math.sin(2 * Math.min(45, la) * (Math.PI / 180)) ** 0.7;
  return 0.0425 * ev * ev * f + rng.gauss(0, 10);
}

function battedBall(code: PlayCode, bat: PitchLogPlayer, rng: FRng): Bip {
  const evAdj = ((bat.evMean ?? LG_EV) - LG_EV) * 0.7;
  const laAdj = ((bat.laMean ?? LG_LA) - LG_LA) * 0.25;
  const g = (m: number, sd: number) => rng.gauss(m, sd);
  let ev: number;
  let la: number;
  let lo = 0;
  let hi = 500;
  const kind = rng.next();
  switch (code) {
    case "HR":
      ev = Math.max(96, g(104 + evAdj * 0.5, 3.5));
      la = Math.min(42, Math.max(19, g(28, 4.5)));
      lo = 335;
      hi = 490;
      break;
    case "2B":
    case "3B":
      ev = g(98 + evAdj, 7);
      la = g(16 + laAdj, 9);
      lo = code === "3B" ? 300 : 150;
      break;
    case "1B":
      if (kind < 0.45) [ev, la] = [g(91 + evAdj, 10), g(-1 + laAdj, 6)];
      else if (kind < 0.85) [ev, la] = [g(96 + evAdj, 8), g(12 + laAdj, 4)];
      else [ev, la] = [g(76, 8), g(32, 7)];
      break;
    case "GO":
    case "DP":
    case "FC":
    case "E":
      ev = g(85 + evAdj, 12);
      la = Math.min(9, g(-6 + laAdj, 8));
      hi = 160;
      break;
    case "SF":
      ev = g(92 + evAdj, 5);
      la = g(35, 6);
      lo = 270;
      hi = 400;
      break;
    default:
      // Fly, line or pop out.
      if (kind < 0.6) [ev, la] = [g(91 + evAdj, 9), g(36 + laAdj, 8)];
      else if (kind < 0.8) [ev, la] = [g(94 + evAdj, 8), g(14, 4)];
      else [ev, la] = [g(72, 8), g(58, 8)];
      hi = la > 40 ? 385 : 405;
  }
  // Soft ceiling: the hardest balls of a season land in the high 110s, not stacked at a cap.
  if (ev > EV_KNEE) ev = EV_KNEE + EV_ROOM * (1 - Math.exp(-(ev - EV_KNEE) / EV_ROOM));
  ev = Math.max(40, ev);
  la = Math.min(80, Math.max(-60, la));
  let d = distance(ev, la, rng);
  // Long home runs taper off (median ~400 ft, a season's longest ~470-490) instead of stacking at the cap.
  if (code === "HR" && d > HR_KNEE) d = HR_KNEE + HR_ROOM * (1 - Math.exp(-(d - HR_KNEE) / HR_ROOM));
  const dist = Math.min(hi, Math.max(lo, d));
  return { ev: Math.round(ev * 10) / 10, la: Math.round(la), dist: Math.round(dist) };
}

/** Velocity noise (in SDs) with a soft top near +2.5: max-effort pitches, never 7 mph above his norm. */
const veloZ = (z: number): number => (z > 1.5 ? 1.5 + (1 - Math.exp(-(z - 1.5))) : Math.max(-3.5, z));

const EV_KNEE = 108;
const HR_KNEE = 405;
const HR_ROOM = 85;
const EV_ROOM = 13;

// ------------------------------------------------------------------ the replay

const pick = (rng: FRng, ws: number[]): number => {
  const tot = ws.reduce((a, w) => a + w, 0);
  let r = rng.next() * tot;
  for (let i = 0; i < ws.length; i += 1) {
    r -= ws[i];
    if (r <= 0) return i;
  }
  return ws.length - 1;
};

/** Plate location for a pitch whose result needs it in (or out of) the zone. */
function location(rng: FRng, type: string, inZone: boolean, zone: [number, number], near: boolean): { px: number; pz: number } {
  const [bot, top] = zone;
  const mid = (bot + top) / 2 + (LOW.has(type) ? -0.45 : FASTBALLS.has(type) ? 0.2 : 0);
  const inside = (px: number, pz: number) => Math.abs(px) <= ZONE_HALF && pz >= bot && pz <= top;
  for (let i = 0; i < 40; i += 1) {
    const px = rng.gauss(0, inZone ? 0.45 : 0.75);
    const pz = rng.gauss(mid, inZone ? 0.5 : 0.85);
    if (pz < 0.1) continue;
    if (inside(px, pz) !== inZone) continue;
    if (!inZone && near && (Math.abs(px) > ZONE_HALF + 0.55 || pz < bot - 0.6 || pz > top + 0.6)) continue;
    return { px, pz };
  }
  return inZone ? { px: rng.range(-0.6, 0.6), pz: rng.range(bot + 0.15, top - 0.15) } : { px: (rng.chance(0.5) ? 1 : -1) * rng.range(0.95, 1.3), pz: mid };
}

const minPitches = (code: PlayCode) => (code === "K" ? 3 : code === "BB" ? 4 : 1);

/**
 * Pitches per play for logs saved before the sim recorded them: typical counts, then
 * nudged one pitch at a time so each pitcher's total matches his box-score pitch count.
 */
function fitCounts(log: GameLog, plays: Play[], rng: FRng): number[] {
  const counts = plays.map((p) => (isPa(p[1]) ? Math.max(minPitches(p[1]), Math.round((TYPICAL_PITCHES[p[1]] ?? 3.3) + rng.gauss(0, 1.3))) : 0));
  const target = new Map<number, number>();
  for (const side of log.box) for (const pit of side.pit) target.set(pit[0], pit[8]);
  const mine = new Map<number, number[]>();
  plays.forEach((p, i) => {
    if (isPa(p[1])) mine.set(p[3], [...(mine.get(p[3]) ?? []), i]);
  });
  for (const [pid, idxs] of mine) {
    const want = target.get(pid);
    if (want == null) continue;
    let diff = want - idxs.reduce((a, i) => a + counts[i], 0);
    // Every plate appearance can take more; only those above their minimum can give one back.
    for (let guard = 0; diff !== 0 && guard < 2000; guard += 1) {
      const pool = diff > 0 ? idxs : idxs.filter((i) => counts[i] > minPitches(plays[i][1]));
      if (!pool.length) break;
      const i = pool[rng.int(pool.length)];
      counts[i] += diff > 0 ? 1 : -1;
      diff += diff > 0 ? -1 : 1;
    }
  }
  return counts;
}

/** Replay a simmed game pitch by pitch. Returns null for games without plays (e.g. played in Play Ball). */
export function simPitchLog(log: GameLog, who: (id: number) => PitchLogPlayer): GamePitchLog | null {
  const plays = log.plays;
  if (!plays?.length) return null;
  const rng = new FRng(hash32(log.season, log.id, log.away, log.home, "pitch-log"));
  const arsenals = new Map<number, Pitch[]>();
  const arsenalOf = (id: number, p: PitchLogPlayer) => {
    let a = arsenals.get(id);
    if (!a) {
      a = p.arsenal?.length ? realPitches(p.arsenal) : [];
      if (!a.length) a = genericPitches(id, p.throws);
      arsenals.set(id, a);
    }
    return a;
  };
  const counts = log.pc ?? fitCounts(log, plays, rng);
  const thrownBy = new Map<number, number>();
  const pitches: PitchRecord[] = [];
  const paOfPlay: Array<number | null> = [];
  let pa = 0;
  let outs = 0;
  let half = -1;

  plays.forEach((p: Play, i) => {
    const [h, code, batterId, pitcherId] = p;
    if (h !== half) {
      half = h;
      outs = 0;
    }
    if (!isPa(code)) {
      paOfPlay.push(null);
      outs = p[4];
      return;
    }
    pa += 1;
    paOfPlay.push(pa);
    const pit = who(pitcherId);
    const bat = who(batterId);
    const stand: "L" | "R" = bat.bats === "S" ? (pit.throws === "L" ? "R" : "L") : bat.bats;
    const zone: [number, number] = [bat.zone?.[0] ?? 1.6, bat.zone?.[1] ?? 3.4];
    const ars = arsenalOf(pitcherId, pit);
    const n = Math.max(minPitches(code), counts[i] || 1);
    const path = countPath(code, n, rng);
    let balls = 0;
    let strikes = 0;
    const sameHand = stand === pit.throws;
    for (let k = 0; k < n; k += 1) {
      const last = k === n - 1;
      // Pitch type: fastballs when behind, breaking and offspeed when ahead; changeups and
      // splitters to opposite-handed hitters, sliders to same-handed ones.
      const behind = balls > strikes || (balls === 3 && strikes < 2);
      const ahead = strikes > balls;
      const idx = pick(
        rng,
        ars.map((a) => {
          const fb = FASTBALLS.has(a.type);
          let w = a.usage * (fb ? (behind ? 1.5 : ahead ? 0.75 : 1) : behind ? 0.6 : ahead ? 1.3 : 1);
          if (OFFSPEED.has(a.type)) w *= sameHand ? 0.6 : 1.35;
          if (SWEEPY.has(a.type)) w *= sameHand ? 1.3 : 0.75;
          return w;
        }),
      );
      const a = ars[idx];
      // Result of this pitch.
      let result: PitchResultKind;
      if (last) {
        if (code === "K") result = (["swinging_strike", "called_strike", "foul_tip"] as const)[pick(rng, [0.72, 0.25, 0.03])];
        else if (code === "BB") result = "ball";
        else if (code === "HBP") result = "hbp";
        else result = "in_play";
      } else {
        const s = path[k];
        result = s === "B" ? "ball" : s === "F2" ? "foul" : (["called_strike", "swinging_strike", "foul"] as const)[pick(rng, [0.4, 0.25, 0.35])];
      }
      // Where it crossed the plate.
      let px: number;
      let pz: number;
      if (result === "hbp") {
        px = (stand === "R" ? -1 : 1) * rng.range(1.35, 1.9);
        pz = rng.range(1.2, 4);
      } else {
        const inZone =
          result === "ball"
            ? false
            : result === "called_strike"
              ? rng.chance(0.95)
              : result === "swinging_strike"
                ? rng.chance(0.45)
                : result === "foul" || result === "foul_tip"
                  ? rng.chance(0.72)
                  : rng.chance(0.84);
        ({ px, pz } = location(rng, a.type, inZone, zone, result !== "ball"));
      }
      // Fatigue: velocity fades past his stamina.
      const thrown = (thrownBy.get(pitcherId) ?? 0) + 1;
      thrownBy.set(pitcherId, thrown);
      const fade = Math.max(0, thrown - (pit.stamina ?? 95)) * 0.05;
      // Pitch-to-pitch spread, kept to the band a pitcher really shows (no 107 mph outliers).
      const mph = Math.round((a.speed + veloZ(rng.gauss(0, 1)) * a.speedSd - fade) * 10) / 10;
      const inZone = Math.abs(px) <= ZONE_HALF && pz >= zone[0] && pz <= zone[1];
      const inPlay = result === "in_play";
      const bip = inPlay ? battedBall(code, bat, rng) : null;
      const hit = inPlay ? (({ "1B": 1, "2B": 2, "3B": 3, HR: 4 }) as Partial<Record<PlayCode, 1 | 2 | 3 | 4>>)[code] ?? 0 : 0;
      pitches.push({
        n: pitches.length + 1,
        inning: Math.floor(h / 2),
        top: h % 2 === 0,
        pa,
        paPitch: k + 1,
        balls,
        strikes,
        outs,
        pitcherId,
        pitcherName: pit.name,
        pThrows: pit.throws,
        batterId,
        batterName: bat.name,
        stand,
        type: a.type,
        mph,
        plateMph: Math.round((mph * 0.915 - 0.3) * 10) / 10,
        spinRpm: Math.round(a.spin + rng.gauss(0, 45)),
        ivb: Math.round((a.ivb + rng.gauss(0, 1.4)) * 10) / 10,
        hb: Math.round((a.hb + rng.gauss(0, 1.4)) * 10) / 10,
        ext: a.ext,
        px: Math.round(px * 100) / 100,
        pz: Math.round(pz * 100) / 100,
        inZone,
        result,
        swing: result === "swinging_strike" || result === "foul" || result === "foul_tip" || inPlay,
        whiff: result === "swinging_strike" || result === "foul_tip",
        called: result === "called_strike",
        foul: result === "foul",
        inPlay,
        bunt: false,
        ev: bip?.ev ?? null,
        la: bip?.la ?? null,
        dist: bip?.dist ?? null,
        hit,
        hardHit: !!bip && bip.ev >= 95,
        barrel: !!bip && isBarrel(bip.ev, bip.la),
        paResult: last ? (PA_RESULT[code] ?? "Out") : null,
      });
      if (result === "ball") balls += 1;
      else if (result !== "foul" || strikes < 2) strikes = Math.min(2, strikes + 1);
    }
    outs = p[4];
  });
  return { pitches, paOfPlay };
}
