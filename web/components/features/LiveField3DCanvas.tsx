"use client";

import { Html, Line } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { useMemo } from "react";
import * as THREE from "three";

import {
  TRAJECTORY_CONTROLS_HINT,
  TrajectoryOrbitControls,
} from "@/components/features/TrajectoryOrbitControls";
import { TrajectoryParkField } from "@/components/features/TrajectoryParkField";
import { useFieldChartColors } from "@/hooks/useFieldChartColors";
import { useLiveFieldMotion } from "@/hooks/useLiveFieldMotion";
import type { FieldDefender } from "@/lib/mlb/fieldDefense";
import {
  baseSlotToScene,
  getMapper,
  type LiveActorState,
  type LiveBallState,
  type LiveFieldTargets,
} from "@/lib/mlb/liveFieldAnimation";
import { playerLastName } from "@/lib/mlb/situationFormat";
import { cn } from "@/lib/utils";
import type { BaseRunner, PlayPitch } from "@/types/mlb-live";
import type { Vec3 } from "@/lib/mlb/ballTrajectory";

const ACCENT_LIGHT = "#2d6a4f";
const BALL = "#f5f0e4";

function BallMesh({ ball }: { ball: LiveBallState }) {
  if (ball.phase === "idle") return null;
  return (
    <group>
      {ball.trail.length > 1 ? (
        <Line
          points={ball.trail}
          color={ball.phase === "hit" ? "#c4a35a" : "#e8e2d4"}
          lineWidth={ball.phase === "hit" ? 2.2 : 1.4}
          transparent
          opacity={0.85}
        />
      ) : null}
      <mesh position={ball.position}>
        <sphereGeometry args={[0.07, 16, 16]} />
        <meshStandardMaterial
          color={BALL}
          emissive={ball.phase === "hit" ? "#8b6914" : "#4a5c52"}
          emissiveIntensity={0.35}
        />
      </mesh>
    </group>
  );
}

function ActorMarker({ actor }: { actor: LiveActorState }) {
  const isBatter = actor.kind === "batter";
  const isRunner = actor.kind === "runner";
  const color = isBatter || isRunner ? ACCENT_LIGHT : "#e8e2d4";
  const radius = isBatter ? 0.11 : isRunner ? 0.1 : 0.085;
  const label = isBatter || isRunner ? playerLastName(actor.label) : actor.label;

  return (
    <group position={actor.position}>
      <mesh position={[0, 0.02, 0]}>
        <cylinderGeometry args={[radius, radius * 0.85, 0.22, 12]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh position={[0, 0.16, 0]}>
        <sphereGeometry args={[radius * 0.7, 12, 12]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <Html
        center
        distanceFactor={8}
        style={{ pointerEvents: "none", userSelect: "none" }}
        position={[0, 0.38, 0]}
      >
        <div
          className={cn(
            "whitespace-nowrap border border-border bg-surface-elevated px-1 py-0.5 text-[9px] font-semibold leading-none text-foreground shadow-sm",
            (isBatter || isRunner) && "border-transparent bg-[#1b4332] text-[#f5f0e4]",
          )}
        >
          {label}
        </div>
      </Html>
    </group>
  );
}

function BaseMarkers({ venueId }: { venueId?: number | null }) {
  const mapper = useMemo(() => getMapper(venueId), [venueId]);
  const bases = useMemo(
    () =>
      (["first", "second", "third", "home"] as const).map((slot) => ({
        slot,
        pos: baseSlotToScene(mapper, slot, 0.02),
      })),
    [mapper],
  );

  return (
    <group>
      {bases.map(({ slot, pos }) => (
        <mesh key={slot} position={pos} rotation={[-Math.PI / 2, 0, Math.PI / 4]}>
          <planeGeometry args={[slot === "home" ? 0.18 : 0.16, slot === "home" ? 0.18 : 0.16]} />
          <meshStandardMaterial color="#e8e2d4" side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  );
}

function LiveFieldScene({
  venueId,
  pitches,
  targets,
}: {
  venueId?: number | null;
  pitches: PlayPitch[];
  targets: LiveFieldTargets;
}) {
  const { canvasBg } = useFieldChartColors();
  const { ball, actors } = useLiveFieldMotion(venueId, pitches, targets);
  const cameraTarget: Vec3 = [0, 0.4, 2.2];

  return (
    <>
      <color attach="background" args={[canvasBg]} />
      <ambientLight intensity={0.6} />
      <directionalLight position={[8, 14, 6]} intensity={0.95} />
      <directionalLight position={[-6, 8, -4]} intensity={0.28} />
      <TrajectoryParkField venueId={venueId} />
      <BaseMarkers venueId={venueId} />
      {actors.map((actor) => (
        <ActorMarker key={actor.id} actor={actor} />
      ))}
      <BallMesh ball={ball} />
      <TrajectoryOrbitControls
        target={cameraTarget}
        boundsRadius={7}
        maxDistance={18}
      />
    </>
  );
}

export interface LiveField3DCanvasProps {
  venueId?: number | null;
  pitches: PlayPitch[];
  defense: FieldDefender[];
  batterName?: string | null;
  showBatter?: boolean;
  runnerFirst?: BaseRunner | null;
  runnerSecond?: BaseRunner | null;
  runnerThird?: BaseRunner | null;
  className?: string;
}

/** Client-only R3F live field canvas (import via LiveField3D dynamic wrapper). */
export function LiveField3DCanvas({
  venueId,
  pitches,
  defense,
  batterName,
  showBatter = true,
  runnerFirst,
  runnerSecond,
  runnerThird,
  className,
}: LiveField3DCanvasProps) {
  const targets: LiveFieldTargets = useMemo(
    () => ({
      defense,
      batterName: batterName ?? null,
      showBatter,
      runnerFirst: runnerFirst ?? null,
      runnerSecond: runnerSecond ?? null,
      runnerThird: runnerThird ?? null,
    }),
    [defense, batterName, showBatter, runnerFirst, runnerSecond, runnerThird],
  );

  return (
    <div className={cn("flex min-h-0 w-full flex-1 flex-col", className)}>
      <div className="min-h-[280px] flex-1 overflow-hidden border border-border bg-field-chart-canvas sm:min-h-[360px]">
        <Canvas
          camera={{
            position: [0.2, 5.8, -7.2],
            fov: 42,
            near: 0.1,
            far: 500,
          }}
          gl={{ antialias: true }}
          style={{ height: "100%", width: "100%", touchAction: "none" }}
        >
          <LiveFieldScene venueId={venueId} pitches={pitches} targets={targets} />
        </Canvas>
      </div>
      <p className="mt-1.5 text-center text-[10px] text-subtle">
        Live field · pitches &amp; hits animate from feed events · {TRAJECTORY_CONTROLS_HINT}
      </p>
    </div>
  );
}
