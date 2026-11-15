/**
 * Park geometry in the game's world frame (feet): fence distance & wall height by
 * spray angle, playing surfaces, foul territory, and elevation (for air density).
 * The fence follows each park's real wall outline (data/ballparks), calibrated to the
 * published MLB fieldInfo distances — see parkOutline.ts.
 */
import ballparkIndex from "@/data/ballparks/index.json";
import { makeAir, type Air } from "@/lib/game/physics/ballFlight";
import { clamp, horizDist, sprayAngleDeg, type V3 } from "@/lib/game/math";
import { buildOutline, FIELD_INFO_ANGLES, sampleFence, type FenceMarker, type ParkOutline } from "@/lib/game/physics/parkOutline";
import type { BallparkIndex } from "@/types/ballpark";
import { buildWallLoop, type WallLoop } from "@/lib/game/physics/wallLoop";

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

/**
 * Wall heights (ft) by spray angle: `[fromDeg, height]` steps, each running from its angle
 * toward right field until the next step. Parks not listed have a standard 8 ft fence.
 */
const WALL_STEPS: Record<number, Array<[number, number]>> = {
  1: [[-45, 8], [22, 18]], // Angel Stadium: tall RF scoreboard wall
  2: [[-45, 11], [-20, 7], [22, 21]], // Camden Yards: raised LF wall, RF scoreboard
  3: [[-45, 37], [-9.5, 17], [12, 5]], // Fenway: Green Monster, CF wall, bullpens & Pesky's Pole
  5: [[-45, 19], [-12, 9]], // Progressive Field: 19 ft LF wall
  7: [[-45, 9]], // Kauffman
  14: [[-45, 10]], // Rogers Centre
  15: [[-45, 7.5], [-5, 25], [5, 7.5]], // Chase Field: 25 ft CF batter's-eye wall
  17: [[-45, 15], [-41, 11.5], [41, 15]], // Wrigley: brick & ivy, taller in the corners
  19: [[-45, 13], [-33, 8], [20, 17]], // Coors: RF out-of-town scoreboard
  22: [[-45, 8]], // Dodger Stadium
  31: [[-45, 6], [-22, 10], [8, 21]], // PNC Park: 21 ft Clemente Wall
  2392: [[-45, 21], [-12, 9], [20, 7]], // Daikin Park: Crawford Boxes scoreboard wall
  2395: [[-45, 8], [18.5, 24]], // Oracle Park: 24 ft brick arcade in RF
  2602: [[-45, 12], [-20, 8]], // Great American: LF wall
  2680: [[-45, 8], [26, 10]], // Petco
  2681: [[-45, 10.5], [-12, 6], [18, 13]], // Citizens Bank: RF scoreboard wall
  3309: [[-45, 8], [20, 14]], // Nationals Park: RF scoreboard wall
  3312: [[-45, 8], [20, 23]], // Target Field: RF overhang wall
  4169: [[-45, 8], [-8, 11.5], [8, 8]], // loanDepot: taller CF
  4705: [[-45, 8.5], [14, 16]], // Truist Park: RF brick wall
  5325: [[-45, 14], [-25, 8]], // Globe Life: LF wall
};
const DEFAULT_WALL: Array<[number, number]> = [[-45, 8]];

function wallFrom(steps: Array<[number, number]>): (spray: number) => number {
  return (spray: number) => {
    let h = steps[0][1];
    for (let i = 1; i < steps.length; i += 1) {
      if (spray >= steps[i][0]) h = steps[i][1];
      else break;
    }
    return h;
  };
}

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
  /** Spray angles where the wall height steps (for crisp rendered edges). */
  wallBreaks: number[];
  /** Published distances and where they sit on the wall (painted signs). */
  fenceMarkers: FenceMarker[];
  /** Seating capacity (drives crowd size). */
  capacity: number;
  /** Perpendicular distance from each foul line to the stands, ft. */
  foulSpace: number;
  /** Distance from home plate to the backstop, ft. */
  backstop: number;
  /**
   * Horizontal distance from home to the wall loop at a bearing (deg, 0 = CF, + toward
   * RF, ±180 = straight back): the fence in fair ground, the stands' wall in foul ground
   * and the backstop. The same loop the renderer draws.
   */
  wallDist(bearingDeg: number): number;
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

const outlineCache = new Map<number, ParkOutline | null>();
function outlineFor(id: number, data: BallparkIndex["parks"][string]): ParkOutline | null {
  let o = outlineCache.get(id);
  if (o === undefined) {
    o = buildOutline(data);
    outlineCache.set(id, o);
  }
  return o;
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
  const outline = data ? outlineFor(id, data) : null;
  const table = outline?.fence;
  const fence = table ? (spray: number) => sampleFence(table, spray) : fenceFrom(info);
  const steps = WALL_STEPS[id] ?? DEFAULT_WALL;
  const wall = wallFrom(steps);
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

  const park: Park = {
    venueId: id,
    name: data?.venueName ?? "Generic Park",
    teamId: data?.teamId ?? null,
    elevationFt,
    turf,
    roof,
    air: makeAir(elevationFt, roof && /dome|closed/i.test(roof) ? 72 : tempF),
    fence,
    wallHeight: wall,
    wallBreaks: steps.slice(1).map((st) => st[0]),
    fenceMarkers:
      outline?.markers ??
      FIELD_INFO_ANGLES.filter(([k]) => fi?.[k] != null || !data).map(([k, a]) => ({ deg: a, ft: info[k] })),
    capacity: fi?.capacity ?? 40000,
    foulSpace: outline?.foulSpace ?? 45,
    backstop: outline?.backstop ?? 60,
    surfaceAt,
    wallDist: () => 0,
  };
  park.wallDist = wallDistTable(buildWallLoop(park));
  return park;
}

const WALL_STEP = 0.5;
function wallDistTable(loop: WallLoop): (bearingDeg: number) => number {
  const n = Math.round(360 / WALL_STEP) + 1;
  const t = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const w = loop.atBeta(-180 + i * WALL_STEP);
    t[i] = Math.hypot(w.x, w.z);
  }
  return (b: number) => {
    const u = (clamp(b, -180, 180) + 180) / WALL_STEP;
    const i = Math.min(n - 2, Math.floor(u));
    const f = u - i;
    return t[i] + (t[i + 1] - t[i]) * f;
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
