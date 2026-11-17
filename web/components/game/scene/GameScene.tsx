"use client";

import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import type { Park } from "@/lib/game/physics/park";
import { Ballpark } from "@/components/game/scene/Ballpark";
import { Players } from "@/components/game/scene/Players";
import { Ball, CameraRig, ContactFx, Director, PlateOverlay } from "@/components/game/scene/SceneParts";
import { Environment } from "@/components/game/scene/parks/Environment";
import type { Playback } from "@/components/game/scene/playback";

export interface GameSceneProps {
  park: Park;
  pb: Playback;
  homeColor: string;
  awayColor?: string;
  onAim: (px: number, pz: number) => void;
  onPrimary: () => void;
}

export default function GameScene({ park, pb, homeColor, awayColor, onAim, onPrimary }: GameSceneProps) {
  return (
    <Canvas
      shadows="soft"
      dpr={[1, 1.5]}
      // The scene runs from a foot in front of the lens to a skyline a mile out, mostly through
      // long telephoto lenses: a linear depth buffer leaves only fractions of an inch of
      // precision at the infield from center field, and layered surfaces (chalk, dirt,
      // ad panels, stands) fight over pixels and shimmer. Logarithmic depth keeps them apart.
      gl={{ antialias: true, powerPreference: "high-performance", logarithmicDepthBuffer: true }}
      camera={{ position: [9, 22, 340], fov: 6, near: 0.3, far: 6000 }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
      }}
      style={{ touchAction: "none" }}
    >
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
