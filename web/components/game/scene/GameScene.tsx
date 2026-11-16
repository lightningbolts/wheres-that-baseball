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
      gl={{ antialias: true, powerPreference: "high-performance" }}
      camera={{ position: [9, 22, 340], fov: 6, near: 0.3, far: 6000 }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
      }}
      style={{ touchAction: "none" }}
    >
      <Director pb={pb} />
      <Environment park={park} />
      <Ballpark park={park} homeColor={homeColor} awayColor={awayColor} />
      <Players pb={pb} />
      <Ball pb={pb} />
      <ContactFx pb={pb} />
      <PlateOverlay pb={pb} onAim={onAim} onClick={onPrimary} />
      <CameraRig pb={pb} />
    </Canvas>
  );
}
