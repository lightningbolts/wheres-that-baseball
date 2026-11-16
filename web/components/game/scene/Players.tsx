"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { newRigOut, type RigOut } from "@/components/game/scene/rig";
import { MAX_FRAME_DT, actorsAt, type Playback } from "@/components/game/scene/playback";
import { Person, Wardrobe } from "@/components/game/scene/character/person";
import { Animator, type AnimEnv } from "@/components/game/scene/character/animator";
import { hash01 } from "@/components/game/scene/character/paint";
import { identity } from "@/components/game/scene/character/roster";
import { BAT_COLORS, batGeometry, batMaterial } from "@/components/game/scene/character/bat";
import { loadRoster } from "@/components/game/scene/character/roster";
import { loadScriptFont } from "@/components/game/scene/character/scriptFont";

const MAX = 24;
const env: AnimEnv = { tl: null, ball: null, T: 0, dA: 0, now: 0, frame: 0, cut: false, callAge: -1 };
const _at = new THREE.Vector3();

/** Screen-height fractions at which a person switches between the close-up, mid-field and distant models (with hysteresis). */
const LOD_NEAR = 0.12;
const LOD_FAR = 0.09;
const LOD_MID = 0.036;
const LOD_TINY = 0.028;
/** Below this screen-height fraction a person is drawn a little larger than life, so far fielders stay readable. */
const BIG_BELOW = 0.07;
const BIG_MAX = 1.4;
const _big = new THREE.Matrix4();
/** Uniform repaints per frame (each is a canvas redraw and a texture upload). */
const PAINTS_PER_FRAME = 2;

/**
 * Every on-field person: one smooth-skinned mesh each (one draw call, plus its shadow),
 * posed by the rig solver, and one instanced mesh for the bats.
 */
export function Players({ pb }: { pb: Playback }) {
  const kit = useMemo(() => {
    const wardrobe = new Wardrobe();
    const people = Array.from({ length: MAX }, () => new Person(wardrobe));
    const group = new THREE.Group();
    for (const p of people) group.add(p.mesh);
    const batGeo = batGeometry();
    const batMat = batMaterial();
    const bats = new THREE.InstancedMesh(batGeo, batMat, MAX);
    bats.castShadow = true;
    bats.frustumCulled = false;
    bats.count = 0;
    bats.setColorAt(0, BAT_COLORS[0]);
    group.add(bats);
    return { wardrobe, people, group, bats, batGeo, batMat };
  }, []);
  useEffect(() => {
    loadRoster();
    loadScriptFont();
    return () => {
      for (const p of kit.people) p.dispose();
      kit.wardrobe.dispose();
      kit.batGeo.dispose();
      kit.batMat.dispose();
      kit.bats.dispose();
    };
  }, [kit]);

  const slots = useRef(new Map<string, number>());
  const rigs = useMemo(() => Array.from({ length: MAX }, () => newRigOut()), []);
  const anims = useRef(new Map<string, Animator>());
  const lastCut = useRef(-1);
  const slotOf = useMemo(() => new Int32Array(MAX), []);

  useFrame((state, rawDt) => {
    const tl = pb.timeline;
    // Animation clock: timeline time while a pitch is playing (so slow-mo, hit-stop and
    // pauses apply to bodies too), real time between pitches.
    const dA = tl ? pb.dT : Math.min(Math.max(rawDt, 0), MAX_FRAME_DT);
    const actors = actorsAt(pb);
    const ball = tl ? tl.ball(pb.T) : null;
    const cut = lastCut.current !== pb.cutSeq;
    lastCut.current = pb.cutSeq;
    const frame = pb.frame;
    const map = anims.current;
    const n = Math.min(MAX, actors.length);
    const { people, bats } = kit;
    const cam = state.camera;
    const tanHalf = Math.tan((((cam as THREE.PerspectiveCamera).fov ?? 50) * Math.PI) / 360);
    let paints = 0;
    let nBats = 0;
    // Slots: an actor keeps his mesh from frame to frame; newcomers take the longest-idle one.
    const slotMap = slots.current;
    for (let i = 0; i < n; i += 1) {
      const s = slotMap.get(actors[i].key);
      slotOf[i] = s ?? -1;
      if (s !== undefined) people[s].seen = frame;
    }
    for (let i = 0; i < n; i += 1) {
      if (slotOf[i] >= 0) continue;
      let best = 0;
      for (let k = 1; k < MAX; k += 1) if (people[k].seen < people[best].seen) best = k;
      const p = people[best];
      if (p.key) slotMap.delete(p.key);
      p.key = actors[i].key;
      p.seen = frame;
      slotMap.set(p.key, best);
      slotOf[i] = best;
    }
    env.tl = tl;
    env.ball = ball;
    env.T = pb.T;
    env.dA = dA;
    env.now = pb.now;
    env.frame = frame;
    env.cut = cut;
    env.callAge = pb.fx.umpCallAt < 0 ? -1 : pb.now - pb.fx.umpCallAt;
    for (let i = 0; i < n; i += 1) {
      const a = actors[i];
      const out: RigOut = rigs[i];
      let an = map.get(a.key);
      if (!an) {
        an = new Animator(a.key);
        map.set(a.key, an);
      }
      // Size on screen picks the level of detail; distant people also grow smoothly up to
      // BIG_MAX about the spot they stand on. Known before posing, so reaches account for it.
      const frac = 6 / (2 * Math.max(1, cam.position.distanceTo(_at.set(a.state.p.x, 3, a.state.p.z))) * tanHalf);
      // ...and everybody stands his own height.
      const big = Math.min(BIG_MAX, Math.max(1, BIG_BELOW / frac)) * (a.id && a.kind !== "umpire" ? identity(a.id).stature : 1.02);
      let h = pb.hands.get(a.key);
      if (!h) {
        if (pb.hands.size > 200) pb.hands.clear();
        h = { ballP: new THREE.Vector3(), frame: -1 };
        pb.hands.set(a.key, h);
      }
      an.step(a, env, big, out, h.ballP);
      if (!out.hidden) h.frame = frame;
      if (an.hasDrop && nBats < MAX) {
        bats.setMatrixAt(nBats, an.dropBat);
        bats.setColorAt(nBats, BAT_COLORS[Math.floor(hash01(a.id ?? 0, 11) * BAT_COLORS.length)]);
        nBats += 1;
      }
      // Draw: the slot's mesh, dressed for the role, at the level of detail its size on screen calls for.
      const person = people[slotOf[i]];
      if (out.hidden) {
        person.mesh.visible = false;
      } else {
        const was = person.lod;
        const lod = frac > LOD_NEAR ? 0 : frac > LOD_FAR ? (was === 0 ? 0 : 1) : frac > LOD_MID ? 1 : frac > LOD_TINY ? (was === 2 ? 2 : 1) : 2;
        const fx = an.x;
        const fz = an.z;
        person.dress(a, lod);
        if (person.stale(a) && paints < PAINTS_PER_FRAME) {
          person.paint(a);
          paints += 1;
        }
        // Never show a uniform that was painted for somebody else.
        const ready = person.stale(a) !== 2;
        person.mesh.visible = ready;
        if (ready) person.pose(out, big, fx, an.gy, fz);
        if (ready && out.hasBat && nBats < MAX) {
          if (big !== 1) {
            _big.makeScale(big, big, big).setPosition(fx * (1 - big), an.gy * (1 - big), fz * (1 - big));
            out.bat.premultiply(_big);
          }
          bats.setMatrixAt(nBats, out.bat);
          bats.setColorAt(nBats, BAT_COLORS[Math.floor(hash01(a.id ?? 0, 11) * BAT_COLORS.length)]);
          nBats += 1;
        }
      }
    }
    for (let i = 0; i < MAX; i += 1) if (people[i].seen !== frame) people[i].mesh.visible = false;
    if (map.size > 120) for (const [k, an] of map) if (an.seen < frame - 600) map.delete(k);
    bats.count = nBats;
    bats.instanceMatrix.needsUpdate = true;
    if (bats.instanceColor) bats.instanceColor.needsUpdate = true;
  });

  return <primitive object={kit.group} />;
}
