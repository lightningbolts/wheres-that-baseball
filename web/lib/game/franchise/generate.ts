/** Synthetic players: minor-league depth, prospects, draft picks and veteran free agents. */
import { FIRST_NAMES, LAST_NAMES, LG, MIN_SALARY } from "./data";
import { clamp, GRADE, gradeRole, gradeScale, overall } from "./ratings";
import type { FRng } from "./rng";
import type { BatSkill, PitSkill, Player, Pos } from "./types";

export type GenRole = "bat" | "SP" | "RP";

export interface GenOpts {
  id: number;
  role: GenRole;
  age: number;
  /** Target current overall (20–80). */
  ovr: number;
  pot: number;
  pos?: Pos;
  template?: number;
  team: number;
  /** Real identity (Pipeline prospects): name, handedness and tool-driven style. */
  name?: string;
  bats?: Player["bats"];
  throws?: Player["throws"];
  style?: number[];
}

const POS_WEIGHTS: Array<[Pos, number]> = [
  ["C", 15],
  ["SS", 14],
  ["2B", 12],
  ["3B", 12],
  ["CF", 12],
  ["LF", 10],
  ["RF", 12],
  ["1B", 13],
];

export function randomPos(rng: FRng): Pos {
  const total = POS_WEIGHTS.reduce((s, [, w]) => s + w, 0);
  let r = rng.next() * total;
  for (const [p, w] of POS_WEIGHTS) {
    r -= w;
    if (r <= 0) return p;
  }
  return "1B";
}

export function randomName(rng: FRng): string {
  return `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
}

function batFrom(z: number, style: number[], pos: Pos): BatSkill {
  const [kS, pwS, spS, dS] = style;
  const spd = clamp(27 + spS * 1.3 + (pos === "CF" || pos === "SS" ? 0.8 : 0) - (pos === "C" || pos === "1B" ? 1 : 0), 23, 30.5);
  return {
    k: clamp(LG.k - 0.03 * z + kS * 0.035, 0.1, 0.38),
    bb: clamp(LG.bb + 0.011 * z + kS * 0.008, 0.035, 0.17),
    hr: clamp(LG.hr + 0.008 * z + pwS * 0.009 + kS * 0.004, 0.004, 0.075),
    babip: clamp(LG.babip + 0.008 * z + (spd - 27) * 0.003, 0.25, 0.335),
    xbh: clamp(LG.xbh + 0.02 * z + pwS * 0.02, 0.15, 0.4),
    spd,
    sbA: clamp(0.012 + (spd - 27) * 0.012, 0.002, 0.1),
    sbS: clamp(0.74 + (spd - 27) * 0.03, 0.55, 0.9),
    def: clamp(dS * 5 + (z > 0 ? 1 : 0), -12, 14),
  };
}

function pitFrom(z: number, style: number[], sp: boolean): PitSkill {
  const [kS, cS] = style;
  return {
    k: clamp(LG.k + 0.035 * z + kS * 0.03, 0.12, 0.38),
    bb: clamp(LG.bb - 0.01 * z + kS * 0.01 - cS * 0.012, 0.035, 0.15),
    hr: clamp(LG.hr - 0.005 * z, 0.015, 0.05),
    babip: clamp(LG.babip - 0.004 * z, 0.27, 0.31),
    stam: sp ? clamp(88 + style[2] * 6, 70, 105) : clamp(25 + style[2] * 4, 16, 40),
  };
}

/** Find the talent level that produces the requested overall (bisection on z). */
export function generatePlayer(rng: FRng, o: GenOpts): Player {
  const pitcher = o.role !== "bat";
  const pos: Pos = pitcher ? (o.role as Pos) : (o.pos ?? randomPos(rng));
  const style = o.style ?? [rng.gauss(0, 1), rng.gauss(0, 1), rng.gauss(0, 1), rng.gauss(0, 1)];
  const throws: "L" | "R" = o.throws ?? (rng.chance(pitcher ? 0.28 : 0.12) && pos !== "C" && pos !== "SS" && pos !== "2B" && pos !== "3B" ? "L" : "R");
  const bats: "L" | "R" | "S" = o.bats ?? (pitcher ? throws : rng.chance(0.1) ? "S" : throws === "L" || rng.chance(0.3) ? "L" : "R");
  const p: Player = {
    id: o.id,
    name: o.name ?? randomName(rng),
    age: o.age,
    bats,
    throws,
    pos,
    pitcher,
    ovr: 0,
    pot: 0,
    service: 0,
    options: 3,
    contract: { aav: MIN_SALARY, years: 1, kind: "minor", signed: 0 },
    team: o.team,
    status: "minors",
    on40: false,
    real: false,
    template: o.template,
    mlbDays: 0,
    stats: {},
  };
  // Profiles are in hitters' grades (same WAR, same grade); pitchers grade on a wider scale.
  const k = gradeScale(p);
  const base = GRADE[gradeRole(p)].base;
  const target = base + (o.ovr - base) * k;
  let lo = -5;
  let hi = 5;
  for (let i = 0; i < 24; i += 1) {
    const z = (lo + hi) / 2;
    if (pitcher) p.pit = pitFrom(z, style, o.role === "SP");
    else p.bat = batFrom(z, style, pos);
    if (overall(p) < target) lo = z;
    else hi = z;
  }
  const z = (lo + hi) / 2;
  if (pitcher) p.pit = pitFrom(z, style, o.role === "SP");
  else p.bat = batFrom(z, style, pos);
  p.ovr = overall(p);
  p.pot = Math.max(p.ovr, Math.round(Math.min(80, base + (o.pot - base) * k)));
  return p;
}

/** A prospect profile for an organization's depth: age, current and potential grades. */
export function prospectProfile(rng: FRng, tier: "depth" | "prospect" | "top" | "draft"): { age: number; ovr: number; pot: number } {
  switch (tier) {
    case "top": {
      const age = 19 + rng.int(4);
      const pot = clamp(Math.round(rng.range(58, 72)), 50, 80);
      return { age, ovr: Math.round(clamp(pot - (25 - age) * 4 - rng.range(4, 10), 30, pot)), pot };
    }
    case "prospect": {
      const age = 19 + rng.int(6);
      const pot = Math.round(rng.range(46, 60));
      return { age, ovr: Math.round(clamp(pot - Math.max(0, 26 - age) * 3 - rng.range(3, 9), 28, pot)), pot };
    }
    case "draft": {
      const age = 18 + rng.int(5);
      const pot = Math.round(clamp(rng.gauss(50, 7), 38, 75));
      return { age, ovr: Math.round(clamp(pot - (26 - age) * 3.5 - rng.range(2, 8), 22, pot)), pot };
    }
    default: {
      const age = 24 + rng.int(8);
      const ovr = Math.round(rng.range(34, 46));
      return { age, ovr, pot: ovr + (age < 27 ? rng.int(5) : 0) };
    }
  }
}
