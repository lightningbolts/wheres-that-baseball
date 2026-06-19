"use client";

import { OrbitControls } from "@react-three/drei";
import type { Vec3 } from "@/lib/mlb/ballTrajectory";

export const TRAJECTORY_CONTROLS_HINT =
  "Drag to rotate · right-drag to pan · scroll to zoom";

/** Smaller values let the camera get closer to the trajectory. */
export function trajectoryMinDistance(boundsRadius: number): number {
  return Math.max(boundsRadius * 0.04, 0.08);
}

interface TrajectoryOrbitControlsProps {
  target: Vec3;
  boundsRadius: number;
  maxDistance: number;
}

/** Shared orbit controls for batted-ball 3D views — rotate, zoom, and pan on the field plane. */
export function TrajectoryOrbitControls({
  target,
  boundsRadius,
  maxDistance,
}: TrajectoryOrbitControlsProps) {
  return (
    <OrbitControls
      makeDefault
      target={target}
      enablePan
      screenSpacePanning={false}
      minDistance={trajectoryMinDistance(boundsRadius)}
      maxDistance={maxDistance}
      maxPolarAngle={Math.PI / 2.05}
    />
  );
}
