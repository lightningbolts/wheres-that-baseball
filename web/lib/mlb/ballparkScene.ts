import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import {
  FIELD_SEGMENT_ORDER,
  FIELD_SEGMENT_STYLES,
  GENERIC_FIELD_SEGMENTS,
  GENERIC_TRANSFORM,
  getBallparkByVenueId,
  mapHitToSvg,
  type FieldSegmentStyle,
} from "@/lib/mlb/ballparkPaths";
import type { BallparkTransform } from "@/types/ballpark";
import type { HitData } from "@/types/mlb-live";
import type { Vec3 } from "@/lib/mlb/ballTrajectory";

/** MLBAM home plate in hc_x / hc_y space. */
export const HOME_COORD_X = 125;
export const HOME_COORD_Y = 200;

/** SVG chart units → Three.js horizontal units. */
export const SVG_SCENE_SCALE = 0.14;

const GRAVITY_FT_S2 = 32.174;
const MPH_TO_FPS = 1.467;
/** ~130 ft apex at typical horizontal scale — keeps arcs inside the stadium. */
const MAX_SCENE_APEX = 3.5;

export interface BallparkSceneMapper {
  home: { x: number; y: number };
  svgToScene(sx: number, sy: number, height?: number): Vec3;
  hitCoordToScene(coordX: number, coordY: number, height?: number): Vec3;
}

export function createBallparkSceneMapper(transform: BallparkTransform): BallparkSceneMapper {
  const home = mapHitToSvg(HOME_COORD_X, HOME_COORD_Y, transform);

  const svgToScene = (sx: number, sy: number, height = 0): Vec3 => {
    const s = SVG_SCENE_SCALE;
    // Negate X so the catcher's view (+Z) matches the spray chart: SVG right (RF) → screen right.
    return [(home.x - sx) * s, height, (home.y - sy) * s];
  };

  const hitCoordToScene = (coordX: number, coordY: number, height = 0): Vec3 => {
    const { x: sx, y: sy } = mapHitToSvg(coordX, coordY, transform);
    return svgToScene(sx, sy, height);
  };

  return { home, svgToScene, hitCoordToScene };
}

export function getParkSegments(venueId?: number | null): Record<string, string> {
  const park = getBallparkByVenueId(venueId);
  return park?.segments ?? GENERIC_FIELD_SEGMENTS;
}

export function getParkSceneMapper(venueId?: number | null): BallparkSceneMapper {
  const park = getBallparkByVenueId(venueId);
  return createBallparkSceneMapper(park?.transform ?? GENERIC_TRANSFORM);
}

const FILLED_SEGMENTS = new Set(["outfield_outer", "infield_outer", "home_plate"]);

function parseSvgPath(d: string) {
  const loader = new SVGLoader();
  return loader.parse(`<svg xmlns="http://www.w3.org/2000/svg"><path d="${d}"/></svg>`).paths;
}

function shapeToGroundGeometry(shape: THREE.Shape, mapper: BallparkSceneMapper, y: number): THREE.ShapeGeometry {
  const geometry = new THREE.ShapeGeometry(shape);
  const { home } = mapper;
  const s = SVG_SCENE_SCALE;
  const position = geometry.attributes.position;

  for (let i = 0; i < position.count; i += 1) {
    const px = position.getX(i);
    const py = position.getY(i);
    position.setXYZ(i, (home.x - px) * s, y, (home.y - py) * s);
  }

  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

export interface FieldMeshData {
  key: string;
  geometry: THREE.ShapeGeometry;
  color: string;
  opacity?: number;
}

export interface FieldLineData {
  key: string;
  points: Vec3[];
  color: string;
  opacity?: number;
}

export function buildParkFieldGeometry(
  venueId: number | null | undefined,
  mapper: BallparkSceneMapper,
  segmentStyles: Record<string, FieldSegmentStyle> = FIELD_SEGMENT_STYLES,
): { meshes: FieldMeshData[]; lines: FieldLineData[] } {
  const segments = getParkSegments(venueId);
  const meshes: FieldMeshData[] = [];
  const lines: FieldLineData[] = [];

  const yBySegment: Record<string, number> = {
    outfield_outer: 0.008,
    infield_outer: 0.012,
    home_plate: 0.018,
  };

  for (const segment of FIELD_SEGMENT_ORDER) {
    const d = segments[segment];
    if (!d) continue;

    const style = segmentStyles[segment] ?? segmentStyles.outfield_outer ?? FIELD_SEGMENT_STYLES.outfield_outer;
    const paths = parseSvgPath(d);

    if (FILLED_SEGMENTS.has(segment)) {
      for (const path of paths) {
        for (const shape of SVGLoader.createShapes(path)) {
          meshes.push({
            key: `${segment}-${meshes.length}`,
            geometry: shapeToGroundGeometry(shape, mapper, yBySegment[segment] ?? 0.01),
            color: style.fill,
            opacity: style.opacity,
          });
        }
      }
      continue;
    }

    for (const path of paths) {
      for (const subPath of path.subPaths) {
        const points = subPath.getPoints(48).map((p) => mapper.svgToScene(p.x, p.y, 0.014));
        if (points.length < 2) continue;
        lines.push({
          key: `${segment}-${lines.length}`,
          points,
          color: style.stroke,
          opacity: style.opacity,
        });
      }
    }
  }

  return { meshes, lines };
}

/** Background chart area matching the SVG viewBox. */
export function buildChartBackgroundGeometry(mapper: BallparkSceneMapper): THREE.BufferGeometry {
  const corners = [
    mapper.svgToScene(0, 0, 0.005),
    mapper.svgToScene(100, 0, 0.005),
    mapper.svgToScene(100, 100, 0.005),
    mapper.svgToScene(0, 100, 0.005),
  ];

  const geometry = new THREE.BufferGeometry();
  const vertices = new Float32Array([
    ...corners[0],
    ...corners[1],
    ...corners[2],
    ...corners[0],
    ...corners[2],
    ...corners[3],
  ]);
  geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  return geometry;
}

export function trajectorySceneBounds(scenePoints: Vec3[]): {
  center: Vec3;
  radius: number;
} {
  if (scenePoints.length === 0) {
    return { center: [0, 1, 3], radius: 6 };
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (const [x, y, z] of scenePoints) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }

  const center: Vec3 = [
    (minX + maxX) / 2,
    (minY + maxY) / 2,
    (minZ + maxZ) / 2,
  ];
  const radius = Math.max(maxX - minX, maxZ - minZ, maxY - minY, 4);

  return { center, radius };
}

function isGroundBall(hit: HitData): boolean {
  const traj = hit.trajectory.toLowerCase();
  return traj.includes("ground") || traj.includes("bunt") || hit.launchAngle < 5;
}

/** Apex height in feet from launch data (capped for high-angle outliers). */
function estimateApexFeet(hit: HitData): number {
  const angleRad = (Math.max(hit.launchAngle, 0) * Math.PI) / 180;
  const distance = Math.max(hit.totalDistance, 1);
  const sinA = Math.sin(angleRad);
  const geometric = (distance / 2) * Math.tan(angleRad);

  let apex = geometric;

  if (hit.launchSpeed > 0) {
    const v0 = hit.launchSpeed * MPH_TO_FPS;
    const physics = (v0 * sinA) ** 2 / (2 * GRAVITY_FT_S2);
    apex = Math.min(geometric, physics);
  }

  // tan(angle) explodes for pop-ups; loft scales with distance, not chart span
  if (hit.launchAngle > 45) {
    apex = Math.min(apex, distance * sinA * 0.65);
  }

  return apex;
}

/**
 * Convert a feet-based apex to scene Y using the hit's horizontal scale
 * (spray-chart span vs Statcast totalDistance).
 */
export function estimateApexSceneHeight(hit: HitData, horizDist: number): number {
  if (horizDist < 0.001) return 0.15;

  const distance = Math.max(hit.totalDistance, 1);
  const apexFeet = estimateApexFeet(hit);
  const heightScale = horizDist / distance;

  let apex = apexFeet * heightScale;
  apex = Math.min(apex, horizDist * 0.7, MAX_SCENE_APEX);

  if (hit.launchAngle >= 5) {
    apex = Math.max(apex, 0.08);
  }

  return apex;
}

/**
 * Build the arc entirely in scene space (home → landing on the spray chart).
 * MLB hc_x/hc_y are not 1:1 with feet, so we must not add foot distances to raw coords.
 */
export function computeSceneTrajectoryPoints(
  hit: HitData,
  mapper: BallparkSceneMapper,
  segments = 72,
): Vec3[] {
  const landing = mapper.hitCoordToScene(hit.coordX, hit.coordY, 0);
  const endX = landing[0];
  const endZ = landing[2];
  const horizDist = Math.hypot(endX, endZ);

  if (horizDist < 0.001) {
    return [[0, 0, 0], landing];
  }

  if (isGroundBall(hit)) {
    const hopT = 0.14;
    const hopHeight = Math.min(Math.max(hit.launchAngle * 0.015, 0.06), 0.3);
    const points: Vec3[] = [];

    for (let i = 0; i <= segments; i += 1) {
      const t = i / segments;
      const x = endX * t;
      const z = endZ * t;
      const y =
        t <= hopT
          ? hopHeight * 4 * (t / hopT) * (1 - t / hopT)
          : 0;
      points.push([x, y, z]);
    }
    return points;
  }

  const peakHeight = estimateApexSceneHeight(hit, horizDist);
  const points: Vec3[] = [];

  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    points.push([endX * t, peakHeight * 4 * t * (1 - t), endZ * t]);
  }

  return points;
}
