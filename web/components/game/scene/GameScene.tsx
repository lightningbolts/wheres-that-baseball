"use client";

import { memo, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";
import type { Park } from "@/lib/game/physics/park";
import { Ballpark } from "@/components/game/scene/Ballpark";
import { Players } from "@/components/game/scene/Players";
import { Ball, CameraRig, ContactFx, Director, PlateOverlay } from "@/components/game/scene/SceneParts";
import { Environment } from "@/components/game/scene/parks/Environment";
import type { Playback } from "@/components/game/scene/playback";
import { FpsGovernor, stepAutoTierDown, useQuality } from "@/components/game/scene/quality";

export interface GameSceneProps {
  park: Park;
  pb: Playback;
  homeColor: string;
  awayColor?: string;
  /** Club ids, for the fans' merch. */
  homeTeam?: number;
  awayTeam?: number;
  onAim: (px: number, pz: number) => void;
  onPrimary: () => void;
}

/**
 * Auto: watches the frame rate and steps the live tier down. A step resizes the canvas and
 * rebuilds the shadow map, so it waits for the picture to be covered (a broadcast cut, the
 * inning bumper) and happens out of sight.
 */
function AutoQuality({ pb }: { pb: Playback }) {
  const [st] = useState(() => ({ gov: new FpsGovernor(), pending: false }));
  useFrame(() => {
    const now = performance.now();
    if (!st.pending) st.pending = st.gov.frame(now);
    if (st.pending && pb.curtain === 1) {
      st.pending = false;
      stepAutoTierDown();
      st.gov.stepped(now);
    }
  });
  return null;
}

/**
 * The 3D view. Memoized: the HUD re-renders on every game event, and without it each one
 * re-reconciled the whole scene tree inside the canvas.
 */
function GameScene({ park, pb, homeColor, awayColor, homeTeam, awayTeam, onAim, onPrimary }: GameSceneProps) {
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
        <AutoQuality pb={pb} />
      )}
      <Director pb={pb} />
      {/* The camera moves before anything reads it: the shadow box, the players' on-screen size
          scaling and the ball's cut detection all use this frame's camera. Mounted last, they
          saw the previous frame's, so on every hard cut one frame drew with shadows fitted
          to the old view and players scaled for the old distance: a one-frame flash. */}
      <CameraRig pb={pb} />
      <Environment park={park} />
      <Ballpark park={park} homeColor={homeColor} awayColor={awayColor} homeTeam={homeTeam} awayTeam={awayTeam} />
      <Players pb={pb} />
      <Ball pb={pb} />
      <ContactFx pb={pb} />
      <PlateOverlay pb={pb} onAim={onAim} onClick={onPrimary} />
    </Canvas>
  );
}

export default memo(GameScene);
