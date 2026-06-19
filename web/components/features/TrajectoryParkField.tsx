"use client";

import { Line } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";

import { useFieldChartColors } from "@/hooks/useFieldChartColors";
import {
  buildChartBackgroundGeometry,
  buildParkFieldGeometry,
  getParkSceneMapper,
  type FieldLineData,
  type FieldMeshData,
} from "@/lib/mlb/ballparkScene";

export function TrajectoryParkField({ venueId }: { venueId?: number | null }) {
  const { chartBg, segmentStyles } = useFieldChartColors();
  const mapper = useMemo(() => getParkSceneMapper(venueId), [venueId]);

  const { meshes, lines, background } = useMemo(() => {
    const field = buildParkFieldGeometry(venueId, mapper, segmentStyles);
    return {
      ...field,
      background: buildChartBackgroundGeometry(mapper),
    };
  }, [mapper, segmentStyles, venueId]);

  return (
    <group>
      <mesh geometry={background}>
        <meshStandardMaterial color={chartBg} />
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
