"use client";

import { Line } from "@react-three/drei";
import { Canvas, type ThreeEvent } from "@react-three/fiber";
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
import type { SprayChartHit } from "@/lib/mlb/gameHits";
import type { Vec3 } from "@/lib/mlb/ballTrajectory";
import { cn } from "@/lib/utils";

function TrajectoryPath({
  gameHit,
  venueId,
  selected,
  dimmed,
  onSelect,
}: {
  gameHit: SprayChartHit;
  venueId?: number | null;
  selected: boolean;
  dimmed: boolean;
  onSelect?: () => void;
}) {
  const { points, landing } = useMemo(() => {
    const mapper = getParkSceneMapper(venueId);
    const scenePoints = computeSceneTrajectoryPoints(gameHit.hit, mapper);
    const end = mapper.hitCoordToScene(gameHit.hit.coordX, gameHit.hit.coordY, 0);
    return { points: scenePoints, landing: end };
  }, [gameHit.hit, venueId]);

  const opacity = selected ? 1 : dimmed ? 0.14 : 1;
  const lineWidth = selected ? 4.5 : dimmed ? 1.1 : 2.4;
  const sphereRadius = selected ? 0.2 : dimmed ? 0.05 : 0.09;
  const pickRadius = selected ? 0.42 : 0.34;

  const handlePointerDown = (event: ThreeEvent<PointerEvent>) => {
    if (!onSelect) return;
    event.stopPropagation();
    onSelect();
  };

  return (
    <group>
      <Line
        points={points}
        color={gameHit.color}
        lineWidth={lineWidth}
        transparent={opacity < 1}
        opacity={opacity}
      />
      <mesh
        position={landing}
        onPointerDown={onSelect ? handlePointerDown : undefined}
        onPointerOver={onSelect ? (event) => { event.stopPropagation(); document.body.style.cursor = "pointer"; } : undefined}
        onPointerOut={onSelect ? () => { document.body.style.cursor = ""; } : undefined}
      >
        <sphereGeometry args={[pickRadius, 12, 12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh position={landing}>
        <sphereGeometry args={[sphereRadius, 16, 16]} />
        <meshStandardMaterial
          color={gameHit.color}
          emissive={gameHit.color}
          emissiveIntensity={selected ? 0.95 : dimmed ? 0.08 : 0.35}
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
  onSelectHit,
}: {
  hits: SprayChartHit[];
  venueId?: number | null;
  selectedAtBatIndex?: number | null;
  getHitKey?: (hit: SprayChartHit) => string | number;
  selectedHitKey?: string | number | null;
  onSelectHit?: (hit: SprayChartHit) => void;
}) {
  const { canvasBg } = useFieldChartColors();
  const bounds = useMemo(() => combinedBounds(hits, venueId), [hits, venueId]);
  const resolveKey = getHitKey ?? ((hit: SprayChartHit) => hit.atBatIndex);
  const activeKey = selectedHitKey ?? selectedAtBatIndex;
  const hasSelection = activeKey != null;

  const orderedHits = useMemo(() => {
    if (!hasSelection) return hits;
    const selected = hits.filter((hit) => resolveKey(hit) === activeKey);
    const rest = hits.filter((hit) => resolveKey(hit) !== activeKey);
    return [...rest, ...selected];
  }, [activeKey, hasSelection, hits, resolveKey]);

  return (
    <>
      <color attach="background" args={[canvasBg]} />
      <ambientLight intensity={hasSelection ? 0.45 : 0.55} />
      <directionalLight position={[8, 14, 6]} intensity={hasSelection ? 0.75 : 0.9} />
      <directionalLight position={[-6, 8, -4]} intensity={0.25} />
      <TrajectoryParkField venueId={venueId} />
      {orderedHits.map((gameHit) => {
        const key = resolveKey(gameHit);
        const selected = hasSelection && key === activeKey;
        const dimmed = hasSelection && key !== activeKey;

        return (
          <TrajectoryPath
            key={key}
            gameHit={gameHit}
            venueId={venueId}
            selected={selected}
            dimmed={dimmed}
            onSelect={
              onSelectHit
                ? () => onSelectHit(gameHit)
                : undefined
            }
          />
        );
      })}
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
  onSelectHit?: (hit: SprayChartHit) => void;
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
  onSelectHit,
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
            onSelectHit={onSelectHit}
          />
        </Canvas>
      </div>
      <p className="mt-1.5 text-center text-[10px] text-subtle">
        <span className="sm:hidden">Drag to rotate · pinch to zoom · tap a landing spot to select</span>
        <span className="hidden sm:inline">
          {TRAJECTORY_CONTROLS_HINT} · click a trajectory to select · estimated paths from launch angle &amp; distance
        </span>
        <span className="sm:hidden"> · estimated paths</span>
      </p>
    </div>
  );
}
