/**
 * MLB home-plate umpires (the full-time staff as of the 2025–26 seasons) with a hidden
 * zone profile each. The profile only moves the edges of the zone a little:
 *
 *  - `sd`   multiplier on the umpire's scatter at the zone edge (1 = league average;
 *           lower = sharper). This is what accuracy and consistency mostly follow.
 *  - `zone` ft added to every edge (+ = calls a slightly bigger zone, − = smaller).
 *  - `hi`   ft the zone is shifted up (+ = gives the high strike, takes the low one).
 *
 * Reputations are loosely based on public scorecard reputations, deliberately modest:
 * the best umpire is ~15% sharper than average and the worst ~25% looser. Everyone
 * else gets a small deterministic wobble around average.
 */

export interface UmpTendency {
  sd: number;
  zone: number;
  hi: number;
}

export interface Umpire extends UmpTendency {
  id: number;
  name: string;
  /** Crew chief (anchors a crew). */
  chief?: boolean;
}

type Row = [
  name: string,
  chief: 0 | 1,
  sd?: number,
  zone?: number,
  hi?: number,
];

// Explicit tendencies only for the umpires whose reputation is well known; the rest wobble.
const ROWS: Row[] = [
  // Crew chiefs
  ["Alan Porter", 1, 0.88],
  ["Dan Bellino", 1, 0.9],
  ["Mark Carlson", 1, 0.97],
  ["Chad Fairchild", 1, 1.0, 0.004],
  ["Dan Iassogna", 1, 0.98],
  ["Marvin Hudson", 1, 1.12, 0.006],
  ["Adrian Johnson", 1, 1.04],
  ["Mark Wegner", 1, 1.05, 0, 0.012],
  ["Hunter Wendelstedt", 1, 1.1, 0.012],
  ["Todd Tichenor", 1, 0.96],
  ["Chris Guccione", 1, 0.92],
  ["Vic Carapazza", 1, 1.0, 0.006],
  ["Will Little", 1, 0.93],
  ["Lance Barrett", 1, 0.95],
  ["James Hoye", 1, 0.99],
  ["Cory Blaser", 1, 0.97],
  ["Tripp Gibson", 1, 0.84],
  ["Alfonso Márquez", 1, 0.98],
  ["Laz Díaz", 1, 1.2, -0.004, -0.01],
  // Staff
  ["Lance Barksdale", 0, 1.15, 0.015],
  ["Quinn Wolcott", 0, 0.88],
  ["Chris Segal", 0, 0.97],
  ["Mark Ripperger", 0, 0.88],
  ["Ramon De Jesus", 0, 0.95],
  ["John Tumpane", 0, 0.85],
  ["Jansen Visconti", 0, 0.9],
  ["Ryan Additon", 0],
  ["Nic Lentz", 0],
  ["Ben May", 0, 0.9],
  ["Jeremie Rehak", 0],
  ["Brian O'Nora", 0, 1.12, 0.008],
  ["Ron Kulpa", 0, 1.15, 0, 0.012],
  ["CB Bucknor", 0, 1.25, 0.01],
  ["Gabe Morales", 0],
  ["Stu Scheurwater", 0],
  ["Edwin Moscoso", 0],
  ["Carlos Torres", 0],
  ["Manny Gonzalez", 0, 1.06],
  ["Chris Conroy", 0],
  ["David Rackley", 0],
  ["Junior Valentine", 0, 0.94],
  ["Brennan Miller", 0],
  ["Alex Tosi", 0],
  ["Adam Beck", 0],
  ["Erich Bacchus", 0],
  ["Nestor Ceja", 0],
  ["Shane Livensparger", 0],
  ["Dan Merzel", 0],
  ["Ryan Blakney", 0, 0.92],
  ["Ryan Wills", 0],
  ["D.J. Reyburn", 0],
  ["Malachi Moore", 0],
  ["John Bacon", 0],
  ["Jeremy Riggs", 0],
  ["Sean Barber", 0],
  ["Chad Whitson", 0],
  ["Clint Vondrak", 0],
  ["Derek Thomas", 0],
  ["Brock Ballou", 0],
  ["Emil Jimenez", 0],
  ["Hal Gibson III", 0],
  ["Jose Navas", 0],
  ["John Libka", 0],
  ["Adam Hamari", 0],
  ["Nick Mahrley", 0],
  ["Roberto Ortiz", 0],
  ["Andy Fletcher", 0, 1.03],
  ["Jordan Baker", 0, 0.96],
  ["Mike Muchlinski", 0, 1.02],
  ["Mike Estabrook", 0, 1.06],
  ["Brian Walsh", 0],
  ["Jim Wolf", 0, 1.04],
  ["Nate Tomlinson", 0],
  ["David Arrieta", 0],
  ["Jen Pawol", 0],
];

/** Small stable noise in [-1, 1) from a name. */
function wobble(name: string, salt: number): number {
  let h = (2166136261 ^ salt) >>> 0;
  for (let i = 0; i < name.length; i += 1) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995) >>> 0;
  h ^= h >>> 15;
  return (h >>> 0) / 2147483648 - 1;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

export const UMPIRES: Umpire[] = ROWS.map(([name, chief, sd, zone, hi], i) => ({
  id: i + 1,
  name,
  chief: chief === 1 || undefined,
  sd: r3(sd ?? 1 + wobble(name, 1) * 0.07),
  zone: r3(zone ?? wobble(name, 2) * 0.008),
  hi: r3(hi ?? wobble(name, 3) * 0.01),
}));

const BY_ID = new Map(UMPIRES.map((u) => [u.id, u]));

export function umpById(id: number | undefined | null): Umpire | undefined {
  return id == null ? undefined : BY_ID.get(id);
}

/** League-average umpire (the engine's original zone). */
export const AVERAGE_UMP: UmpTendency = { sd: 1, zone: 0, hi: 0 };
