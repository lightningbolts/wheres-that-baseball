"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { newRigOut, poseFor, solveRig, type RigOut } from "@/components/game/scene/rig";
import { actorsAt, type Playback } from "@/components/game/scene/playback";

const MAX = 20;
const STRIDE_FT = 8.5;

type PartKey = "torso" | "pelvis" | "head" | "cap" | "upperArm" | "foreArm" | "thigh" | "shin" | "foot" | "glove" | "bat";
const PAIRED = ["upperArm", "foreArm", "thigh", "shin", "foot"] as const;
const isPaired = (k: PartKey) => (PAIRED as readonly string[]).includes(k);

function buildGeometries(): Record<PartKey, THREE.BufferGeometry> {
  const torso = new THREE.CylinderGeometry(0.64, 0.5, 1.85, 12, 1);
  torso.scale(1, 1, 0.62);
  const pelvis = new THREE.CylinderGeometry(0.52, 0.46, 0.6, 12, 1);
  pelvis.scale(1, 1, 0.7);
  const head = new THREE.SphereGeometry(0.36, 14, 10);
  const dome = new THREE.SphereGeometry(0.39, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2);
  dome.translate(0, 0.04, 0);
  const brim = new THREE.CylinderGeometry(0.3, 0.3, 0.04, 14, 1);
  brim.scale(1, 1, 1.15);
  brim.translate(0, 0.05, 0.3);
  const cap = mergeGeometries([dome.toNonIndexed(), brim.toNonIndexed()]) ?? dome;
  dome.dispose();
  brim.dispose();
  const upperArm = new THREE.CylinderGeometry(0.17, 0.14, 1.0, 8, 1);
  const foreArm = new THREE.CylinderGeometry(0.13, 0.1, 0.98, 8, 1);
  const thigh = new THREE.CylinderGeometry(0.25, 0.18, 1.48, 8, 1);
  const shin = new THREE.CylinderGeometry(0.17, 0.12, 1.45, 8, 1);
  const foot = new THREE.BoxGeometry(0.34, 0.2, 0.78);
  foot.translate(0, -0.03, 0.2);
  const glove = new THREE.SphereGeometry(0.3, 8, 6);
  glove.scale(1, 1.2, 0.55);
  const bat = new THREE.CylinderGeometry(0.11, 0.045, 2.8, 8, 1);
  bat.translate(0, 1.0, 0);
  return { torso, pelvis, head, cap, upperArm, foreArm, thigh, shin, foot, glove, bat };
}

const SHOE = new THREE.Color("#141414");
const GLOVE = new THREE.Color("#7a4a22");
const BAT = new THREE.Color("#c9a26a");
const PANTS_DARKEN = 0.92;

/**
 * Every on-field person, drawn as instanced body parts. One InstancedMesh per part
 * type (11 draw calls total, plus shadows).
 */
export function Players({ pb }: { pb: Playback }) {
  const geos = useMemo(() => buildGeometries(), []);
  const mats = useMemo(() => {
    const m = () => new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0 });
    return { body: m(), skin: m(), dark: m() };
  }, []);
  useEffect(
    () => () => {
      Object.values(geos).forEach((g) => g.dispose());
      Object.values(mats).forEach((m) => m.dispose());
    },
    [geos, mats],
  );

  const refs = useRef<Partial<Record<PartKey, THREE.InstancedMesh | null>>>({});
  const rigs = useMemo(() => Array.from({ length: MAX }, () => newRigOut()), []);
  const phases = useRef(new Map<string, number>());
  const lastT = useRef(0);
  const color = useMemo(() => new THREE.Color(), []);
  const hide = useMemo(() => new THREE.Matrix4().makeScale(0, 0, 0), []);

  useFrame((state) => {
    const time = state.clock.elapsedTime;
    const actors = actorsAt(pb, time);
    const dT = Math.max(0, Math.min(0.2, pb.T - lastT.current));
    lastT.current = pb.T;
    const r = refs.current;
    const n = Math.min(MAX, actors.length);
    for (let i = 0; i < n; i += 1) {
      const a = actors[i];
      const ph = (phases.current.get(a.key) ?? 0) + (a.state.speed * dT * Math.PI * 2) / STRIDE_FT;
      phases.current.set(a.key, ph);
      const pose = poseFor(a, ph, time);
      const out: RigOut = rigs[i];
      solveRig(a, pose, out);
      r.torso?.setMatrixAt(i, out.torso);
      r.pelvis?.setMatrixAt(i, out.pelvis);
      r.head?.setMatrixAt(i, out.head);
      r.cap?.setMatrixAt(i, out.head);
      r.glove?.setMatrixAt(i, a.kind === "fielder" || a.kind === "pitcher" || a.kind === "catcher" ? out.glove : hide);
      r.bat?.setMatrixAt(i, out.hasBat ? out.bat : hide);
      for (const k of PAIRED) {
        r[k]?.setMatrixAt(i * 2, out[k][0]);
        r[k]?.setMatrixAt(i * 2 + 1, out[k][1]);
      }
      // Colors: jersey top, slightly darker pants, team-color socks & cap.
      r.torso?.setColorAt(i, a.jersey);
      r.pelvis?.setColorAt(i, color.copy(a.jersey).multiplyScalar(PANTS_DARKEN));
      r.head?.setColorAt(i, a.skin);
      r.cap?.setColorAt(i, a.accent);
      r.glove?.setColorAt(i, GLOVE);
      r.bat?.setColorAt(i, BAT);
      for (let s = 0; s < 2; s += 1) {
        r.upperArm?.setColorAt(i * 2 + s, a.jersey);
        r.foreArm?.setColorAt(i * 2 + s, a.kind === "umpire" ? a.jersey : a.skin);
        r.thigh?.setColorAt(i * 2 + s, color.copy(a.jersey).multiplyScalar(PANTS_DARKEN));
        r.shin?.setColorAt(i * 2 + s, a.accent);
        r.foot?.setColorAt(i * 2 + s, SHOE);
      }
    }
    for (const k of Object.keys(r) as PartKey[]) {
      const mesh = r[k];
      if (!mesh) continue;
      const per = isPaired(k) ? 2 : 1;
      mesh.count = n * per;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  });

  const part = (k: PartKey, mat: THREE.Material, shadow = true) => {
    const per = isPaired(k) ? 2 : 1;
    return (
      <instancedMesh
        key={k}
        ref={(m) => {
          refs.current[k] = m;
          if (m && !m.instanceColor) {
            m.setColorAt(0, new THREE.Color(1, 1, 1));
          }
        }}
        args={[geos[k], mat, MAX * per]}
        castShadow={shadow}
        frustumCulled={false}
      />
    );
  };

  return (
    <group>
      {part("torso", mats.body)}
      {part("pelvis", mats.body)}
      {part("upperArm", mats.body)}
      {part("thigh", mats.body)}
      {part("shin", mats.body)}
      {part("head", mats.skin)}
      {part("foreArm", mats.skin)}
      {part("cap", mats.dark, false)}
      {part("foot", mats.dark, false)}
      {part("glove", mats.dark, false)}
      {part("bat", mats.dark)}
    </group>
  );
}
