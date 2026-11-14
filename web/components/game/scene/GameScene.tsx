"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { Canvas, useThree } from "@react-three/fiber";
import type { Park } from "@/lib/game/physics/park";
import { Ballpark } from "@/components/game/scene/Ballpark";
import { Players } from "@/components/game/scene/Players";
import { Ball, CameraRig, Director, PlateOverlay, SkyDome } from "@/components/game/scene/SceneParts";
import type { Playback } from "@/components/game/scene/playback";

function Lights() {
  const light = useMemo(() => {
    const l = new THREE.DirectionalLight("#fff4e0", 2.4);
    l.position.set(170, 320, -90);
    l.target.position.set(0, 0, 150);
    l.castShadow = true;
    l.shadow.mapSize.set(2048, 2048);
    const c = l.shadow.camera;
    c.left = -230;
    c.right = 230;
    c.top = 260;
    c.bottom = -200;
    c.near = 50;
    c.far = 900;
    l.shadow.bias = -0.0004;
    l.shadow.normalBias = 0.6;
    return l;
  }, []);
  useEffect(() => () => light.dispose(), [light]);
  return (
    <>
      <hemisphereLight args={["#cfe3ff", "#3c5a2c", 0.95]} />
      <primitive object={light} />
      <primitive object={light.target} />
    </>
  );
}

function Fog() {
  const { scene } = useThree();
  useEffect(() => {
    scene.fog = new THREE.Fog("#cfe2f3", 1100, 2900);
    return () => {
      scene.fog = null;
    };
  }, [scene]);
  return null;
}

export interface GameSceneProps {
  park: Park;
  pb: Playback;
  homeColor: string;
  onAim: (px: number, pz: number) => void;
  onPrimary: () => void;
}

export default function GameScene({ park, pb, homeColor, onAim, onPrimary }: GameSceneProps) {
  return (
    <Canvas
      shadows
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
      <Fog />
      <SkyDome />
      <Lights />
      <Ballpark park={park} homeColor={homeColor} />
      <Players pb={pb} />
      <Ball pb={pb} />
      <PlateOverlay pb={pb} onAim={onAim} onClick={onPrimary} />
      <CameraRig pb={pb} />
    </Canvas>
  );
}
