/**
 * Park geometry in the game's world frame (feet): fence distance & wall height by
 * spray angle, playing surfaces, foul territory, and elevation (for air density).
 * Fence distances come from the MLB fieldInfo already shipped in data/ballparks.
 */
import ballparkIndex from "@/data/ballparks/index.json";
import { makeAir, type Air } from "@/lib/game/physics/ballFlight";
import { clamp, horizDist, sprayAngleDeg, type V3 } from "@/lib/game/math";
import type { BallparkIndex } from "@/types/ballpark";

const index = ballparkIndex as BallparkIndex;

export type Surface = "grass" | "dirt" | "track" | "turf";

export interface SurfaceProps {
  /** Vertical coefficient of restitution on a bounce. */
  e: number;
  /** Horizontal speed retained through a bounce. */
  keep: number;
  /** Rolling deceleration, ft/s². */
  roll: number;
}

export const SURFACES: Record<Surface, SurfaceProps> = {
  grass: { e: 0.36, keep: 0.7, roll: 10 },
  dirt: { e: 0.42, keep: 0.76, roll: 8 },
  track: { e: 0.32, keep: 0.65, roll: 12 },
  turf: { e: 0.48, keep: 0.8, roll: 6 },
};

/** Hand-authored wall heights (ft) where they differ from a standard ~8 ft fence. */
const WALL_OVERRIDES: Record<number, (spray: number) => number> = {
  3: (a) => (a < -12 ? 37 : a > 30 ? 5 : 17), // Fenway: Monster, Pesky's pole, bullpens
  2395: (a) => (a > 20 ? 25 : 8), // Oracle Park: RF brick wall
  2392: (a) => (a < -20 ? 19 : 9), // Houston: LF short porch wall
  31: (a) => (a > 25 ? 21 : 6), // PNC Park: Clemente Wall
  3312: (a) => (a > 20 ? 23 : 8), // Target Field: RF overhang wall
  17: () => 11.5, // Wrigley: brick & ivy
  19: () => 13, // Coors
  2: (a) => (a < -20 ? 13 : 7), // Camden Yards: raised LF wall
  22: () => 8, // Dodger Stadium
};

/** Approximate field elevations (ft); default near sea level. */
const ELEVATION_FT: Record<number, number> = {
  19: 5200, // Coors
  15: 1080, // Chase Field
  4705: 1050, // Truist Park
  7: 750, // Kauffman
  3312: 830, // Target Field
  5325: 550, // Globe Life Field
  2602: 490, // Great American
  31: 730, // PNC
  4169: 10, // loanDepot
};

/** Stats API fieldInfo label → spray angle (deg, + toward RF). */
const FIELD_INFO_ANGLES: Array<[keyof FenceInfo, number]> = [
  ["leftLine", -45],
  ["left", -32],
  ["leftCenter", -18],
  ["center", 0],
  ["rightCenter", 18],
  ["right", 32],
  ["rightLine", 45],
];

interface FenceInfo {
  leftLine: number;
  left: number;
  leftCenter: number;
  center: number;
  rightCenter: number;
  right: number;
  rightLine: number;
}

const DEFAULT_FENCE: FenceInfo = {
  leftLine: 330,
  left: 365,
  leftCenter: 385,
  center: 400,
  rightCenter: 385,
  right: 365,
  rightLine: 330,
};

export interface Park {
  venueId: number;
  name: string;
  teamId: number | null;
  elevationFt: number;
  turf: boolean;
  roof: string | null;
  air: Air;
  /** Fence distance (ft) at a spray angle in degrees (±45 = foul poles). */
  fence(sprayDeg: number): number;
  wallHeight(sprayDeg: number): number;
  /** Perpendicular distance from each foul line to the stands, ft. */
  foulSpace: number;
  /** Distance from home plate to the backstop, ft. */
  backstop: number;
  surfaceAt(p: V3): Surface;
}

export const BASES = {
  home: { x: 0, y: 0, z: 0 },
  first: { x: -63.64, y: 0, z: 63.64 },
  second: { x: 0, y: 0, z: 127.28 },
  third: { x: 63.64, y: 0, z: 63.64 },
} as const;
export const MOUND = { x: 0, y: 0, z: 60.5 } as const;

function fenceFrom(info: FenceInfo): (spray: number) => number {
  const pts = FIELD_INFO_ANGLES.map(([k, a]) => [a, info[k] || DEFAULT_FENCE[k]] as const);
  return (spray: number) => {
    const a = clamp(spray, -45, 45);
    for (let i = 1; i < pts.length; i += 1) {
      const [a0, d0] = pts[i - 1];
      const [a1, d1] = pts[i];
      if (a <= a1) {
        // Cosine easing gives the rounded alleys real walls have, not straight chords.
        const f = (a - a0) / (a1 - a0);
        const s = (1 - Math.cos(f * Math.PI)) / 2;
        return d0 + (d1 - d0) * s;
      }
    }
    return pts[pts.length - 1][1];
  };
}

export function buildPark(venueId: number | null | undefined, tempF = 72): Park {
  const data = venueId != null ? index.parks[String(venueId)] : undefined;
  const fi = data?.fieldInfo;
  const info: FenceInfo = {
    leftLine: fi?.leftLine ?? DEFAULT_FENCE.leftLine,
    left: fi?.left ?? DEFAULT_FENCE.left,
    leftCenter: fi?.leftCenter ?? DEFAULT_FENCE.leftCenter,
    center: fi?.center ?? DEFAULT_FENCE.center,
    rightCenter: fi?.rightCenter ?? DEFAULT_FENCE.rightCenter,
    right: fi?.right ?? DEFAULT_FENCE.right,
    rightLine: fi?.rightLine ?? DEFAULT_FENCE.rightLine,
  };
  const id = data?.venueId ?? venueId ?? 0;
  const fence = fenceFrom(info);
  const wall = WALL_OVERRIDES[id] ?? (() => 8);
  const turf = /turf|artificial/i.test(fi?.turfType ?? "");
  const elevationFt = ELEVATION_FT[id] ?? 300;
  const roof = fi?.roofType ?? null;

  const surfaceAt = (p: V3): Surface => {
    const r = horizDist(p);
    const a = sprayAngleDeg(p);
    if (Math.abs(a) <= 45 && r >= fence(a) - 15) return turf ? "turf" : "track";
    const dMound = Math.hypot(p.x - MOUND.x, p.z - MOUND.z);
    if (dMound <= 9 || r <= 13) return turf ? "turf" : "dirt";
    // Infield skin: arc of 95 ft around the rubber, minus the grass square inside the bases.
    if (dMound <= 95 && p.z > 0) {
      // Rotate into diamond coordinates (u toward 1B, w toward 3B), each base path = 90 ft.
      const u = (-p.x + p.z) / Math.SQRT2;
      const w = (p.x + p.z) / Math.SQRT2;
      const insideGrass = u > 4 && w > 4 && u < 86 && w < 86;
      if (!insideGrass) return turf ? "turf" : "dirt";
    }
    return turf ? "turf" : "grass";
  };

  return {
    venueId: id,
    name: data?.venueName ?? "Generic Park",
    teamId: data?.teamId ?? null,
    elevationFt,
    turf,
    roof,
    air: makeAir(elevationFt, roof && /dome|closed/i.test(roof) ? 72 : tempF),
    fence,
    wallHeight: wall,
    foulSpace: 45,
    backstop: 60,
    surfaceAt,
  };
}

/** Home venue for a team (falls back to a generic park). */
export function homeVenueForTeam(teamId: number): number | null {
  for (const p of Object.values(index.parks)) if (p.teamId === teamId) return p.venueId;
  return null;
}

/** Fair territory test (on or inside the foul lines), horizontal position only. */
export function isFairPosition(p: V3): boolean {
  return p.z >= 0 && Math.abs(sprayAngleDeg(p)) <= 45;
}

/** Past first or third base along the line (where fair/foul is judged by first landing). */
export function isBeyondBases(p: V3): boolean {
  const u = (-p.x + p.z) / Math.SQRT2; // along 1B line
  const w = (p.x + p.z) / Math.SQRT2; // along 3B line
  return u > 90 || w > 90;
}
