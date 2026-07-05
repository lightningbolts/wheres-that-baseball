"use client";

import { Line } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { useMemo } from "react";

import {
  TRAJECTORY_CONTROLS_HINT,
  TrajectoryOrbitControls,
} from "@/components/features/TrajectoryOrbitControls";
import { TrajectoryParkField } from "@/components/features/TrajectoryParkField";
import { useFieldChartColors } from "@/hooks/useFieldChartColors";
import {
  computeSceneTrajectoryPoints,
  getParkSceneMapper,
  trajectorySceneBounds,
} from "@/lib/mlb/ballparkScene";
import type { GameHit, SprayChartHit } from "@/lib/mlb/gameHits";
import type { Vec3 } from "@/lib/mlb/ballTrajectory";
import { cn } from "@/lib/utils";

function TrajectoryPath({
  gameHit,
  venueId,
  selected,
}: {
  gameHit: SprayChartHit;
  venueId?: number | null;
  selected: boolean;
}) {
  const { points, landing } = useMemo(() => {
    const mapper = getParkSceneMapper(venueId);
    const scenePoints = computeSceneTrajectoryPoints(gameHit.hit, mapper);
    const end = mapper.hitCoordToScene(gameHit.hit.coordX, gameHit.hit.coordY, 0);
    return { points: scenePoints, landing: end };
  }, [gameHit.hit, venueId]);

  const opacity = selected ? 1 : 0.55;
  const lineWidth = selected ? 2.8 : 1.6;
  const sphereRadius = selected ? 0.12 : 0.08;

  return (
    <group>
      <Line
        points={points}
        color={gameHit.color}
        lineWidth={lineWidth}
        transparent={opacity < 1}
        opacity={opacity}
      />
      <mesh position={landing}>
        <sphereGeometry args={[sphereRadius, 16, 16]} />
        <meshStandardMaterial
          color={gameHit.color}
          emissive={gameHit.color}
          emissiveIntensity={selected ? 0.4 : 0.2}
          transparent={opacity < 1}
          opacity={opacity}
        />
      </mesh>
    </group>
  );
}

function combinedBounds(hits: SprayChartHit[], venueId?: number | null) {
  const mapper = getParkSceneMapper(venueId);
  const allPoints: Vec3[] = [[0, 0, 0]];

  for (const gameHit of hits) {
    allPoints.push(...computeSceneTrajectoryPoints(gameHit.hit, mapper));
  }

  return trajectorySceneBounds(allPoints);
}

function Scene({
  hits,
  venueId,
  selectedAtBatIndex,
  getHitKey,
  selectedHitKey,
}: {
  hits: SprayChartHit[];
  venueId?: number | null;
  selectedAtBatIndex?: number | null;
  getHitKey?: (hit: SprayChartHit) => string | number;
  selectedHitKey?: string | number | null;
}) {
  const { canvasBg } = useFieldChartColors();
  const bounds = useMemo(() => combinedBounds(hits, venueId), [hits, venueId]);
  const resolveKey = getHitKey ?? ((hit: SprayChartHit) => hit.atBatIndex);
  const activeKey = selectedHitKey ?? selectedAtBatIndex;

  return (
    <>
      <color attach="background" args={[canvasBg]} />
      <ambientLight intensity={0.55} />
      <directionalLight position={[8, 14, 6]} intensity={0.9} />
      <directionalLight position={[-6, 8, -4]} intensity={0.25} />
      <TrajectoryParkField venueId={venueId} />
      {hits.map((gameHit) => (
        <TrajectoryPath
          key={resolveKey(gameHit)}
          gameHit={gameHit}
          venueId={venueId}
          selected={activeKey == null || activeKey === resolveKey(gameHit)}
        />
      ))}
      <TrajectoryOrbitControls
        target={bounds.center}
        boundsRadius={bounds.radius}
        maxDistance={bounds.radius * 3.2}
      />
    </>
  );
}

interface GameHitsTrajectory3DProps {
  hits: SprayChartHit[];
  venueId?: number | null;
  selectedAtBatIndex?: number | null;
  getHitKey?: (hit: SprayChartHit) => string | number;
  selectedHitKey?: string | number | null;
  className?: string;
}

const TRAJECTORY_CANVAS_CLASS =
  "h-[min(56vh,520px)] overflow-hidden rounded border border-border bg-field-chart-canvas sm:h-[min(62vh,580px)] xl:h-[min(68vh,640px)]";

export function GameHitsTrajectory3D({
  hits,
  venueId,
  selectedAtBatIndex = null,
  getHitKey,
  selectedHitKey = null,
  className,
}: GameHitsTrajectory3DProps) {
  const cameraPosition = useMemo((): Vec3 => {
    const bounds = combinedBounds(hits, venueId);
    const [cx, cy, cz] = bounds.center;
    const pullBack = Math.max(bounds.radius * 1.35, 5.5);
    return [cx * 0.2, pullBack * 0.55, cz * 0.2 - pullBack];
  }, [hits, venueId]);

  if (hits.length === 0) {
    return (
      <div className={cn(className)}>
        <div
          className={cn(
            "flex items-center justify-center text-xs text-subtle",
            TRAJECTORY_CANVAS_CLASS,
          )}
        >
          No batted-ball trajectories yet
        </div>
      </div>
    );
  }

  return (
    <div className={cn(className)}>
      <div className={TRAJECTORY_CANVAS_CLASS}>
        <Canvas
          camera={{
            position: cameraPosition,
            fov: 48,
            near: 0.1,
            far: 500,
          }}
          gl={{ antialias: true }}
          style={{ height: "100%", width: "100%", touchAction: "none" }}
        >
          <Scene
            hits={hits}
            venueId={venueId}
            selectedAtBatIndex={selectedAtBatIndex}
            getHitKey={getHitKey}
            selectedHitKey={selectedHitKey}
          />
        </Canvas>
      </div>
      <p className="mt-1.5 text-center text-[10px] text-subtle">
        <span className="sm:hidden">Drag to rotate · pinch to zoom</span>
        <span className="hidden sm:inline">
          {TRAJECTORY_CONTROLS_HINT} · estimated paths from launch angle &amp; distance
        </span>
        <span className="sm:hidden"> · estimated paths</span>
      </p>
    </div>
  );
}
