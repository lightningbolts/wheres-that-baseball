"use client";

import { Line, OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { useMemo } from "react";
import * as THREE from "three";
import {
  buildChartBackgroundGeometry,
  buildParkFieldGeometry,
  computeSceneTrajectoryPoints,
  getParkSceneMapper,
  trajectorySceneBounds,
  type FieldLineData,
  type FieldMeshData,
} from "@/lib/mlb/ballparkScene";
import type { GameHit } from "@/lib/mlb/gameHits";
import type { Vec3 } from "@/lib/mlb/ballTrajectory";

function ParkField({ venueId }: { venueId?: number | null }) {
  const mapper = useMemo(() => getParkSceneMapper(venueId), [venueId]);

  const { meshes, lines, background } = useMemo(() => {
    const field = buildParkFieldGeometry(venueId, mapper);
    return {
      ...field,
      background: buildChartBackgroundGeometry(mapper),
    };
  }, [mapper, venueId]);

  return (
    <group>
      <mesh geometry={background}>
        <meshStandardMaterial color="#1a2e1a" />
      </mesh>
      {meshes.map((mesh: FieldMeshData) => (
        <mesh key={mesh.key} geometry={mesh.geometry}>
          <meshStandardMaterial
            color={mesh.color}
            transparent={mesh.opacity != null && mesh.opacity < 1}
            opacity={mesh.opacity ?? 1}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
      {lines.map((line: FieldLineData) => (
        <Line
          key={line.key}
          points={line.points}
          color={line.color}
          lineWidth={1}
          transparent={line.opacity != null && line.opacity < 1}
          opacity={line.opacity ?? 1}
        />
      ))}
    </group>
  );
}

function TrajectoryPath({
  gameHit,
  venueId,
  selected,
}: {
  gameHit: GameHit;
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

function combinedBounds(hits: GameHit[], venueId?: number | null) {
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
}: {
  hits: GameHit[];
  venueId?: number | null;
  selectedAtBatIndex?: number | null;
}) {
  const bounds = useMemo(() => combinedBounds(hits, venueId), [hits, venueId]);

  return (
    <>
      <color attach="background" args={["#0f1a12"]} />
      <ambientLight intensity={0.55} />
      <directionalLight position={[8, 14, 6]} intensity={0.9} />
      <directionalLight position={[-6, 8, -4]} intensity={0.25} />
      <ParkField venueId={venueId} />
      {hits.map((gameHit) => (
        <TrajectoryPath
          key={gameHit.atBatIndex}
          gameHit={gameHit}
          venueId={venueId}
          selected={
            selectedAtBatIndex == null || selectedAtBatIndex === gameHit.atBatIndex
          }
        />
      ))}
      <OrbitControls
        makeDefault
        target={bounds.center}
        enablePan={false}
        minDistance={bounds.radius * 0.45}
        maxDistance={bounds.radius * 3.2}
        maxPolarAngle={Math.PI / 2.05}
      />
    </>
  );
}

interface GameHitsTrajectory3DProps {
  hits: GameHit[];
  venueId?: number | null;
  selectedAtBatIndex?: number | null;
  className?: string;
  height?: number;
}

export function GameHitsTrajectory3D({
  hits,
  venueId,
  selectedAtBatIndex = null,
  className,
  height = 360,
}: GameHitsTrajectory3DProps) {
  const cameraPosition = useMemo((): Vec3 => {
    const bounds = combinedBounds(hits, venueId);
    const [cx, cy, cz] = bounds.center;
    const pullBack = Math.max(bounds.radius * 1.35, 5.5);
    return [cx * 0.2, pullBack * 0.55, cz * 0.2 - pullBack];
  }, [hits, venueId]);

  if (hits.length === 0) {
    return (
      <div
        className={className}
        style={{ height }}
      >
        <div className="flex h-full items-center justify-center rounded border border-border bg-[#0f1a12] text-xs text-subtle">
          No batted-ball trajectories yet
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="overflow-hidden rounded border border-border bg-[#0f1a12]">
        <Canvas
          camera={{
            position: cameraPosition,
            fov: 48,
            near: 0.1,
            far: 500,
          }}
          gl={{ antialias: true }}
          style={{ height, width: "100%", touchAction: "none" }}
        >
          <Scene
            hits={hits}
            venueId={venueId}
            selectedAtBatIndex={selectedAtBatIndex}
          />
        </Canvas>
      </div>
      <p className="mt-1.5 text-center text-[10px] text-subtle">
        Drag to rotate · scroll to zoom · estimated paths from launch angle &amp; distance
      </p>
    </div>
  );
}
