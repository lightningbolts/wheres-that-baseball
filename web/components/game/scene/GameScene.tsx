"use client";

import { memo } from "react";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import { PerformanceMonitor } from "@react-three/drei";
import type { Park } from "@/lib/game/physics/park";
import { Ballpark } from "@/components/game/scene/Ballpark";
import { Players } from "@/components/game/scene/Players";
import { Ball, CameraRig, ContactFx, Director, PlateOverlay } from "@/components/game/scene/SceneParts";
import { Environment } from "@/components/game/scene/parks/Environment";
import type { Playback } from "@/components/game/scene/playback";
import { stepAutoTier, useQuality } from "@/components/game/scene/quality";

export interface GameSceneProps {
  park: Park;
  pb: Playback;
  homeColor: string;
  awayColor?: string;
  onAim: (px: number, pz: number) => void;
  onPrimary: () => void;
}

/** Frame-rate bounds for Auto's monitor: step down under 75% of the display rate, back up above 95%. */
const fpsBounds = (refresh: number): [number, number] => [refresh * 0.75, refresh * 0.95];

/**
 * The 3D view. Memoized: the HUD re-renders on every game event, and without it each one
 * re-reconciled the whole scene tree inside the canvas.
 */
function GameScene({ park, pb, homeColor, awayColor, onAim, onPrimary }: GameSceneProps) {
  const q = useQuality();
  const { boot, live } = q;
  return (
    <Canvas
      // Boot settings (context attributes, texture sizes) only take effect on a fresh context.
      key={boot.tier}
      // PCF (PCFSoftShadowMap is deprecated in three r18x and silently mapped to this).
      shadows="percentage"
      dpr={live.dpr}
      // The scene runs from a foot in front of the lens to a skyline a mile out, mostly through
      // long telephoto lenses: a linear depth buffer leaves only fractions of an inch of
      // precision at the infield from center field, and layered surfaces (chalk, dirt,
      // ad panels, stands) fight over pixels and shimmer. Logarithmic depth keeps them apart.
      // Low drops it (it disables early depth rejection on every pixel); the camera then
      // keeps its near plane at least a foot out instead (see CameraRig).
      gl={{ antialias: boot.antialias, powerPreference: "high-performance", logarithmicDepthBuffer: boot.logDepth }}
      camera={{ position: [9, 22, 340], fov: 6, near: 0.3, far: 6000 }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
      }}
      style={{ touchAction: "none" }}
    >
      {q.setting === "auto" && boot.tier !== "low" && (
        <PerformanceMonitor bounds={fpsBounds} flipflops={3} onDecline={() => stepAutoTier(-1)} onIncline={() => stepAutoTier(1)} />
      )}
      <Director pb={pb} />
      {/* The camera moves before anything reads it: the shadow box, the players' on-screen size
          scaling and the ball's cut detection all use this frame's camera. Mounted last, they
          saw the previous frame's, so on every hard cut one frame drew with shadows fitted
          to the old view and players scaled for the old distance: a one-frame flash. */}
      <CameraRig pb={pb} />
      <Environment park={park} />
      <Ballpark park={park} homeColor={homeColor} awayColor={awayColor} />
      <Players pb={pb} />
      <Ball pb={pb} />
      <ContactFx pb={pb} />
      <PlateOverlay pb={pb} onAim={onAim} onClick={onPrimary} />
    </Canvas>
  );
}

export default memo(GameScene);
