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
  1: [[-45, 5], [-41, 8], [41, 5]], // Angel Stadium: 8 ft (RF lowered from 18 in 2018), 5 ft in the corners
  2: [[-45, 8], [-24, 7], [22, 21]], // Camden Yards (2025 LF wall: 8 ft at the corner, under 7 by the pens), 21 ft RF scoreboard wall
  3: [[-45, 37.2], [-9.5, 17], [12, 5], [33, 3]], // Fenway: 37 ft 2 in Monster, 17 ft CF wall, 5 ft bullpens, 3 ft by Pesky's Pole
  5: [[-45, 19], [-12, 9]], // Progressive Field: 19 ft LF wall
  7: [[-45, 8.5]], // Kauffman: lowered to 8 ft 6 in with the 2026 fences
  14: [[-45, 14.3], [-38, 11.2], [-25, 12.75], [-9, 8], [9, 10.75], [25, 14.3], [40, 12.6]], // Rogers Centre's 2023 walls, section by section
  15: [[-45, 8], [-5, 25], [5, 8]], // Chase Field: 8 ft, 25 ft CF batter's-eye wall
  17: [[-45, 15], [-41, 11.5], [41, 15]], // Wrigley: brick & ivy, taller in the corners
  19: [[-45, 13], [-33, 8], [8, 16.5]], // Coors (2016): 13 ft LF corner, 16.5 ft from the RCF bullpens to the RF corner
  22: [[-45, 4], [-36, 8], [36, 4]], // Dodger Stadium: 8 ft, 4 ft down the lines
  31: [[-45, 6], [-22, 10], [8, 21]], // PNC Park: 21 ft Clemente Wall
  2392: [[-45, 19], [-12, 9], [20, 7]], // Daikin Park: 19 ft Crawford Boxes scoreboard wall
  2395: [[-45, 8], [-12, 7], [-3, 10], [3, 7], [11, 20], [18.5, 24]], // Oracle Park: 8 LF, 7 CF, 10 dead center, 20 RCF, 24 ft brick arcade in RF
  2602: [[-45, 12], [-20, 8]], // Great American: LF wall
  2680: [[-45, 8]], // Petco: RF wall lowered from 11 to 8 ft in 2012
  2681: [[-45, 10.5], [-14, 12.7], [-9, 19], [-3, 6], [18, 13.25]], // Citizens Bank (Ballpark Digest): 10'6" LF, Monty's Angle 12'8"-19', 6 ft CF over the pens, 13'3" RF
  3309: [[-45, 8], [-13, 12]], // Nationals Park: 8 ft in left, 12 ft from center to the RF scoreboard wall
  3312: [[-45, 8], [20, 23]], // Target Field: RF overhang wall
  4: [[-45, 8]], // Rate Field
  12: [[-45, 11], [-12, 9], [12, 11]], // Tropicana Field: 11 ft, 9 ft in center
  2394: [[-45, 7]], // Comerica: walls lowered to 7 ft in 2023
  3313: [[-45, 8.4], [21, 8]], // Yankee Stadium: 8 ft 5 in from the left pole to the RF bullpen, 8 ft to the right pole
  4169: [[-45, 8], [-8, 11.5], [8, 8]], // loanDepot: taller CF
  4705: [[-45, 6], [-40, 8.7], [14, 16]], // Truist Park: 6 ft at the LF pole, 8 ft 8 in, 16 ft RF brick wall
  5325: [[-45, 8]], // Globe Life Field: 8 ft all around
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
  7: 856, // Kauffman
  3312: 830, // Target Field
  5325: 550, // Globe Life Field
  2602: 490, // Great American
  31: 730, // PNC
  4169: 10, // loanDepot
  // MLB Stats API venue elevations.
  2: 33, // Camden Yards
  3: 21, // Fenway
  3313: 55, // Yankee Stadium
  12: 15, // Tropicana Field
  14: 270, // Rogers Centre
  4: 595, // Rate Field
  5: 653, // Progressive Field
  2394: 600, // Comerica
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

/**
 * Current official distances where the wall outline (GeomMLBStadiums, last updated 2023) or
 * the Stats API numbers predate a moved fence: `[spray, ft]` anchors the outline is warped
 * through (cosine-eased between anchors, untouched at the poles unless anchored there).
 * `null` pins the outline as is at that angle. Anchors with a distance get a painted sign.
 */
const FENCE_FIX: Record<number, Array<[number, number | null]>> = {
  // loanDepot park, 2020 move-in (the Stats API still has 407 / 392): 400 center, 387 right-center.
  4169: [[-45, 344], [-18, 386], [-4, 400], [0, 400], [14, 387], [45, 335]],
  // T-Mobile Park, 2013 move-in (the Stats API still has 390 / 405 / 387): 378 / 401 / 381, RF line 326.
  680: [[-45, 331], [-20, 378], [0, 401], [20, 381], [45, 326]],
  // Daikin Park since Tal's Hill went (2017): 409 center, 408 deep right-center; the outline
  // still has the old flagpole notch, so flatten it.
  2392: [[-18, 362], [-6, null], [0, 409], [2.5, 409], [5, 409], [7.5, 408], [10, 408], [18, 373]],
  // Chase Field (MLB figures): 328 / 376 / 412 deep alley / 407 center / 414 / 376 / 335.
  15: [[-45, 328], [-22.5, 376], [-12.5, 412], [0, 407], [12.5, 414], [22.5, 376], [45, 335]],
  // Coors Field: 420 in left-center, 424 at the deep corner right of center.
  19: [[-25, 390], [-17.5, 420], [-14, 420], [-10, 417], [0, 415], [7.5, 424], [15, null]],
  // Dodger Stadium: 330 lines, 360 medium and 375 true alleys, 395 center.
  22: [[-45, 330], [-35, 360], [-22.5, 375], [0, 395], [22.5, 375], [35, 360], [45, 330]],
  // Camden Yards, 2025 (Orioles ground rules): LF corner 373, left-center bullpen 376, 410 at
  // the deep corner beside the batter's eye, 400 straightaway center.
  2: [[-45, 333], [-33, 373], [-24, 374], [-18, 375], [-15, 375], [-12, 376], [-5, 410], [0, 400], [18, 373], [45, 318]],
  // Fenway: 379 where the Monster ends, 390 unmarked center, the 420 Triangle, 380 right-center.
  3: [[-45, 310], [-10, 379], [0, 390], [10, 420], [18, 380], [45, 302]],
  5: [[-45, 325], [-18, 370], [-3.5, 410], [0, 405], [18, 375], [45, 325]],
  12: [[-45, 315], [-23, 370], [-9, 410], [0, 404], [9, 404], [19, 370], [45, 322]],
  // Yankee Stadium: 399 left-center, 408 the deepest point in center, 385 right-center.
  3313: [[-45, 318], [-18, 399], [-8, 408], [0, 408], [13, 385], [45, 314]],
  // Rogers Centre, 2023: 368 left-center, 381 / 372 alleys, 400 center, 359 right-center.
  14: [[-45, 328], [-32, 368], [-18, 381], [0, 400], [18, 372], [32, 359], [45, 328]],
  // Comerica, 2023: LF corner re-measured to 342, center brought in to 412.
  2394: [[-45, 342], [-23, 370], [-14, null], [-8, 412], [0, 412], [9, 412], [23, 365], [45, 330]],
  // Kauffman, 2026: in 8–10 ft from near each pole, alleys 387 → 379, center stays 410.
  7: [[-45, 330], [-40, 347], [-25, 364], [-18, 379], [-6, null], [0, 410], [6, null], [18, 379], [25, 364], [40, 344], [45, 330]],
};

/** Official backstop distances (ft), where published, over the outline's estimate. */
const BACKSTOP_FT: Record<number, number> = {
  1: 60, // Angel Stadium
  15: 55, // Chase Field
  19: 56, // Coors Field
  22: 55, // Dodger Stadium
  2392: 49, // Daikin Park
  2395: 48, // Oracle Park
  2529: 58, // Sutter Health Park
  5325: 42, // Globe Life Field
  2: 45, // Camden Yards (Orioles ground rules)
  12: 50, // Tropicana Field
  14: 60, // Rogers Centre
  5: 60, // Progressive Field
  7: 60, // Kauffman
  17: 55, // Wrigley Field
  31: 51, // PNC Park
  32: 56, // American Family Field
  2681: 50, // Citizens Bank Park
  2889: 52, // Busch Stadium
  3289: 46, // Citi Field
  3309: 45, // Nationals Park
  4169: 47, // loanDepot park
  4705: 53, // Truist Park
};

/**
 * Foul-line-to-stands distance (ft) where the outline is wrong. Sutter Health Park's outline
 * comes from the Oakland Coliseum and carries its vast foul ground; the Sacramento park's
 * box seats and berms sit close to the lines.
 */
const FOUL_SPACE_FT: Record<number, number> = {
  2529: 40, // Sutter Health Park
};

/** Clubs whose index entry is not their current home (the Rays left Steinbrenner Field for the Trop in 2026). */
const HOME_VENUE: Record<number, number> = { 139: 12 };

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

/** Warp a half-degree fence table so it passes through the given anchors. */
function warpFence(t: Float32Array, anchors: Array<[number, number | null]>): Float32Array {
  const knots = anchors.map(([deg, ft]) => [deg, ft == null ? 1 : ft / sampleFence(t, deg)] as [number, number]);
  if (knots[0][0] > -45) knots.unshift([-45, 1]);
  if (knots[knots.length - 1][0] < 45) knots.push([45, 1]);
  const out = new Float32Array(t.length);
  for (let k = 0; k < t.length; k += 1) {
    const a = -45 + (90 * k) / (t.length - 1);
    let r = knots[knots.length - 1][1];
    for (let i = 1; i < knots.length; i += 1) {
      const [a1, r1] = knots[i];
      if (a <= a1) {
        const [a0, r0] = knots[i - 1];
        const f = a1 > a0 ? (a - a0) / (a1 - a0) : 1;
        r = r0 + (r1 - r0) * ((1 - Math.cos(f * Math.PI)) / 2);
        break;
      }
    }
    out[k] = t[k] * r;
  }
  return out;
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
  const fix = FENCE_FIX[id];
  const table = outline ? (fix ? warpFence(outline.fence, fix) : outline.fence) : undefined;
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
      (fix && outline ? fix.filter((f): f is [number, number] => f[1] != null).map(([deg, ft]) => ({ deg, ft })) : null) ??
      outline?.markers ??
      FIELD_INFO_ANGLES.filter(([k]) => fi?.[k] != null || !data).map(([k, a]) => ({ deg: a, ft: info[k] })),
    capacity: fi?.capacity ?? 40000,
    foulSpace: FOUL_SPACE_FT[id] ?? outline?.foulSpace ?? 45,
    backstop: BACKSTOP_FT[id] ?? outline?.backstop ?? 60,
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
  if (HOME_VENUE[teamId] != null && index.parks[String(HOME_VENUE[teamId])]) return HOME_VENUE[teamId];
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
