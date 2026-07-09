"use client";

import { Html, Line } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
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

function useIsCompact(): boolean {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 767px)");
    const apply = () => setCompact(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return compact;
}

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
        <sphereGeometry args={[0.07, 12, 12]} />
        <meshStandardMaterial
          color={BALL}
          emissive={ball.phase === "hit" ? "#8b6914" : "#4a5c52"}
          emissiveIntensity={0.35}
        />
      </mesh>
    </group>
  );
}

function ActorMarker({
  actor,
  showLabels,
  compact,
}: {
  actor: LiveActorState;
  showLabels: boolean;
  compact: boolean;
}) {
  const isBatter = actor.kind === "batter";
  const isRunner = actor.kind === "runner";
  const color = isBatter || isRunner ? ACCENT_LIGHT : "#e8e2d4";
  const radius = isBatter ? 0.11 : isRunner ? 0.1 : 0.085;
  const label = isBatter || isRunner ? playerLastName(actor.label) : actor.label;

  return (
    <group position={actor.position}>
      <mesh position={[0, 0.02, 0]}>
        <cylinderGeometry args={[radius, radius * 0.85, 0.22, compact ? 8 : 12]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh position={[0, 0.16, 0]}>
        <sphereGeometry args={[radius * 0.7, compact ? 8 : 12, compact ? 8 : 12]} />
        <meshStandardMaterial color={color} />
      </mesh>
      {showLabels ? (
        <Html
          center
          distanceFactor={compact ? 10 : 8}
          style={{ pointerEvents: "none", userSelect: "none" }}
          position={[0, 0.38, 0]}
          zIndexRange={[10, 0]}
        >
          <div
            className={cn(
              "whitespace-nowrap border border-border bg-surface-elevated px-1 py-0.5 font-semibold leading-none text-foreground shadow-sm",
              compact ? "text-[8px]" : "text-[9px]",
              (isBatter || isRunner) && "border-transparent bg-[#1b4332] text-[#f5f0e4]",
            )}
          >
            {label}
          </div>
        </Html>
      ) : null}
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
  compact,
}: {
  venueId?: number | null;
  pitches: PlayPitch[];
  targets: LiveFieldTargets;
  compact: boolean;
}) {
  const { canvasBg } = useFieldChartColors();
  const { ball, actors } = useLiveFieldMotion(venueId, pitches, targets);
  const cameraTarget: Vec3 = compact ? [0, 0.35, 2.4] : [0, 0.4, 2.2];
  // On small screens, only label batter/runners to keep HTML overlays light.
  const showLabel = (actor: LiveActorState) =>
    !compact || actor.kind === "batter" || actor.kind === "runner" || actor.kind === "fielder";

  return (
    <>
      <color attach="background" args={[canvasBg]} />
      <ambientLight intensity={0.6} />
      <directionalLight position={[8, 14, 6]} intensity={0.95} />
      <directionalLight position={[-6, 8, -4]} intensity={0.28} />
      <TrajectoryParkField venueId={venueId} />
      <BaseMarkers venueId={venueId} />
      {actors.map((actor) => (
        <ActorMarker
          key={actor.id}
          actor={actor}
          showLabels={showLabel(actor)}
          compact={compact}
        />
      ))}
      <BallMesh ball={ball} />
      <TrajectoryOrbitControls
        target={cameraTarget}
        boundsRadius={compact ? 8 : 7}
        maxDistance={compact ? 22 : 18}
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
  const compact = useIsCompact();
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

  const cameraPosition: Vec3 = compact ? [0.15, 7.2, -8.4] : [0.2, 5.8, -7.2];

  return (
    <div className={cn("flex min-h-0 w-full flex-1 flex-col", className)}>
      <div
        className={cn(
          "flex-1 overflow-hidden border border-border bg-field-chart-canvas",
          "min-h-[min(58dvh,420px)] sm:min-h-[360px]",
        )}
      >
        <Canvas
          camera={{
            position: cameraPosition,
            fov: compact ? 46 : 42,
            near: 0.1,
            far: 500,
          }}
          dpr={compact ? [1, 1.5] : [1, 2]}
          gl={{ antialias: !compact, powerPreference: "high-performance" }}
          style={{ height: "100%", width: "100%", touchAction: "none" }}
        >
          <LiveFieldScene
            venueId={venueId}
            pitches={pitches}
            targets={targets}
            compact={compact}
          />
        </Canvas>
      </div>
      <p className="mt-1.5 px-1 text-center text-[10px] text-subtle">
        <span className="sm:hidden">Drag to rotate · pinch to zoom · live pitch/hit paths</span>
        <span className="hidden sm:inline">
          Live field · Statcast pitch physics when available · {TRAJECTORY_CONTROLS_HINT}
        </span>
      </p>
    </div>
  );
}
