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
  estimateApexSceneHeight,
  getParkSceneMapper,
  trajectorySceneBounds,
} from "@/lib/mlb/ballparkScene";
import type { HitData } from "@/types/mlb-live";
import type { Vec3 } from "@/lib/mlb/ballTrajectory";

function TrajectoryPath({ hit, venueId }: { hit: HitData; venueId?: number | null }) {
  const { points, landing } = useMemo(() => {
    const mapper = getParkSceneMapper(venueId);
    const scenePoints = computeSceneTrajectoryPoints(hit, mapper);
    const end = mapper.hitCoordToScene(hit.coordX, hit.coordY, 0);
    return { points: scenePoints, landing: end };
  }, [hit, venueId]);

  return (
    <group>
      <Line points={points} color="#fbbf24" lineWidth={2.5} />
      <mesh position={landing}>
        <sphereGeometry args={[0.1, 16, 16]} />
        <meshStandardMaterial color="#fbbf24" emissive="#b45309" emissiveIntensity={0.35} />
      </mesh>
    </group>
  );
}

function Scene({ hit, venueId }: { hit: HitData; venueId?: number | null }) {
  const { canvasBg } = useFieldChartColors();
  const bounds = useMemo(() => {
    const mapper = getParkSceneMapper(venueId);
    const scenePoints = computeSceneTrajectoryPoints(hit, mapper);
    return trajectorySceneBounds(scenePoints);
  }, [hit, venueId]);

  return (
    <>
      <color attach="background" args={[canvasBg]} />
      <ambientLight intensity={0.55} />
      <directionalLight position={[8, 14, 6]} intensity={0.9} />
      <directionalLight position={[-6, 8, -4]} intensity={0.25} />
      <TrajectoryParkField venueId={venueId} />
      <TrajectoryPath hit={hit} venueId={venueId} />
      <TrajectoryOrbitControls
        target={bounds.center}
        boundsRadius={bounds.radius}
        maxDistance={bounds.radius * 3}
      />
    </>
  );
}

interface BallTrajectory3DProps {
  hit: HitData;
  venueId?: number | null;
  className?: string;
}

export function BallTrajectory3D({ hit, venueId, className }: BallTrajectory3DProps) {
  const cameraPosition = useMemo((): Vec3 => {
    const mapper = getParkSceneMapper(venueId);
    const landing = mapper.hitCoordToScene(hit.coordX, hit.coordY, 0);
    const horiz = Math.hypot(landing[0], landing[2]);
    const peak = hit.launchAngle >= 5 ? estimateApexSceneHeight(hit, horiz) : 0.15;
    const target: Vec3 = [landing[0] * 0.45, peak * 0.45, landing[2] * 0.45];
    const pullBack = Math.max(horiz * 1.15, 4.5);
    return [target[0] * 0.15, pullBack * 0.5, target[2] * 0.15 - pullBack];
  }, [hit, venueId]);

  return (
    <div className={className}>
      <div className="overflow-hidden rounded border border-border bg-field-chart-canvas">
        <Canvas
          camera={{
            position: cameraPosition,
            fov: 48,
            near: 0.1,
            far: 500,
          }}
          gl={{ antialias: true }}
          style={{ height: 280, width: "100%", touchAction: "none" }}
        >
          <Scene hit={hit} venueId={venueId} />
        </Canvas>
      </div>
      <p className="mt-1.5 text-center text-[10px] text-subtle">
        {TRAJECTORY_CONTROLS_HINT} · estimated path from launch angle &amp; distance
      </p>
    </div>
  );
}
