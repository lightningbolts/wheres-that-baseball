import { describe, expect, it } from "vitest";
import * as THREE from "three";
import rosters from "@/data/game/rosters.json";
import { GameSession, teamsFromRosters } from "@/lib/game/session/session";
import { buildTimeline, type ActorState, type Timeline } from "@/lib/game/anim/timeline";
import { FIELD_POSITIONS, type FieldPos, type RosterFile } from "@/lib/game/types";
import { newRigOut, type ActorDraw, type ActorKind } from "@/components/game/scene/rig";
import { Animator, seedOf, type AnimEnv } from "@/components/game/scene/character/animator";
import { BONE } from "@/components/game/scene/character/skeleton";

const WHITE = new THREE.Color(1, 1, 1);
const teams = teamsFromRosters(rosters as unknown as RosterFile);
const ids = [...teams.keys()];

function timelines(seed: number, count: number, want: (tl: Timeline) => boolean): Timeline[] {
  const s = new GameSession({ awayTeamId: ids[seed % ids.length], homeTeamId: ids[(seed * 7 + 5) % ids.length], human: "none", innings: 9, seed, difficulty: "pro", awayStarter: 0, homeStarter: 0 }, teams);
  const out: Timeline[] = [];
  for (let n = 0; n < 400 && out.length < count && !s.game.final; n += 1) {
    const tl = buildTimeline(s.autoPitch());
    if (want(tl)) out.push(tl);
  }
  return out;
}

function draw(key: string, kind: ActorKind, pos: FieldPos | null, state: ActorState): ActorDraw {
  return { key, state, kind, jersey: WHITE, accent: WHITE, skin: WHITE, hand: "R", helmet: false, pos, id: 1 };
}
const kindOf = (pos: FieldPos): ActorKind => (pos === "C" ? "catcher" : pos === "P" ? "pitcher" : "fielder");
const env = (tl: Timeline, T: number, dA: number, frame: number): AnimEnv => ({ tl, ball: tl.ball(T), T, dA, now: 5 + T, frame, cut: frame === 1, callAge: -1 });

describe("animator", () => {
  it("gives every actor his own stable seed", () => {
    expect(seedOf("f-SS")).toBe(seedOf("f-SS"));
    expect(seedOf("f-SS")).not.toBe(seedOf("f-2B"));
    expect(seedOf("f-CF")).toBeGreaterThanOrEqual(0);
    expect(seedOf("f-CF")).toBeLessThan(1);
  });

  it("moves every body continuously through whole plays: no pops between clips", () => {
    const DT = 1 / 60;
    const bones = [BONE.chest, BONE.head, BONE.handL, BONE.handR, BONE.footL, BONE.footR];
    const prev = bones.map(() => new THREE.Vector3());
    const cur = new THREE.Vector3();
    let worstTrunk = 0;
    let worstLimb = 0;
    let info1 = "";
    let info2 = "";
    for (const tl of timelines(3, 12, (t) => t.inPlay)) {
      const who: Array<{ key: string; kind: ActorKind; pos: FieldPos | null; get: (T: number) => ActorState | null }> = FIELD_POSITIONS.map((pos) => ({ key: `f-${pos}`, kind: kindOf(pos), pos, get: (T: number) => tl.fielder(pos, T) }));
      who.push({ key: "r-b", kind: "batter", pos: null, get: (T) => tl.batter(T) ?? tl.runner(tl.batterId, T) });
      for (const w of who) {
        const an = new Animator(w.key);
        const out = newRigOut();
        const ballP = new THREE.Vector3();
        let a: ActorDraw | null = null;
        let frame = 0;
        let px = 0;
        let pz = 0;
        for (let T = tl.releaseT - 1; T < tl.endT; T += DT) {
          const st = w.get(T);
          if (!st) break;
          if (!a) a = draw(w.key, w.kind, w.pos, st);
          a.state = st;
          if (w.kind === "batter") a.kind = tl.batter(T) ? "batter" : "runner";
          frame += 1;
          an.step(a, env(tl, T, DT, frame), 1, out, ballP);
          if (out.hidden) break;
          for (let i = 0; i < bones.length; i += 1) {
            cur.setFromMatrixPosition(out.bones[bones[i]]);
            expect(Number.isFinite(cur.x + cur.y + cur.z)).toBe(true);
            if (frame > 1) {
              // Motion of the joint over and above the body's own travel.
              const d = Math.hypot(cur.x - prev[i].x - (an.x - px), cur.y - prev[i].y, cur.z - prev[i].z - (an.z - pz));
              if (i < 2) { if (d > worstTrunk) { worstTrunk = d; info1 = `${w.key} ${st.action} ${st.actionT.toFixed(3)} spd ${st.speed.toFixed(1)} bone ${i}`; } }
              else if (d > worstLimb) { worstLimb = d; info2 = `${w.key} ${st.action} ${st.actionT.toFixed(3)} spd ${st.speed.toFixed(1)} bone ${i}`; }
            }
            prev[i].copy(cur);
          }
          px = an.x;
          pz = an.z;
        }
      }
    }
    // A sixtieth of a second: the trunk never lurches, and no hand or foot outruns a thrower's arm.
    expect(worstTrunk, info1).toBeLessThan(0.75);
    expect(worstLimb, info2).toBeLessThan(1.5);
  });

  it("holds perfectly still while the timeline is paused", () => {
    const [tl] = timelines(5, 1, (t) => t.inPlay);
    const an = new Animator("f-SS");
    const out = newRigOut();
    const ballP = new THREE.Vector3();
    const a = draw("f-SS", "fielder", "SS", tl.fielder("SS", 0)!);
    let frame = 0;
    let T = tl.releaseT;
    for (; T < tl.releaseT + 1.3; T += 1 / 60) {
      a.state = tl.fielder("SS", T)!;
      frame += 1;
      an.step(a, env(tl, T, 1 / 60, frame), 1, out, ballP);
    }
    const held = out.bones.map((m) => m.clone());
    // Paused on the last frame drawn: the clock stops where it was.
    T -= 1 / 60;
    for (let k = 0; k < 30; k += 1) {
      frame += 1;
      an.step(a, { ...env(tl, T, 0, frame), now: 5 + T }, 1, out, ballP);
    }
    for (let b = 0; b < held.length; b += 1) for (let e = 0; e < 16; e += 1) expect(out.bones[b].elements[e]).toBeCloseTo(held[b].elements[e], 5);
  });

  it("puts the glove's pocket on the ball when it is caught, also for enlarged far-away fielders", () => {
    let seen = 0;
    for (const big of [1, 1.4]) {
      for (const tl of timelines(7, 10, (t) => t.inPlay)) {
        // The first fielder to hold the ball, and when.
        let pos: FieldPos | null = null;
        let tc = 0;
        for (let T = (tl.contactT ?? tl.releaseT) + 0.05; T < tl.endT; T += 1 / 120) {
          const b = tl.ball(T);
          if (b.held && b.holder && b.holder !== "P" && b.holder !== "C") {
            pos = b.holder as FieldPos;
            tc = T;
            break;
          }
        }
        if (!pos) continue;
        for (let lo = tc - 1 / 120, i = 0; i < 8; i += 1) {
          const mid = (lo + tc) / 2;
          if (tl.ball(mid).held) tc = mid;
          else lo = mid;
        }
        const an = new Animator(`f-${pos}`);
        const out = newRigOut();
        const ballP = new THREE.Vector3();
        const a = draw(`f-${pos}`, "fielder", pos, tl.fielder(pos, 0)!);
        let frame = 0;
        let T = tc - 3;
        for (; T < tc - 1 / 120; T += 1 / 120) {
          a.state = tl.fielder(pos, T)!;
          frame += 1;
          an.step(a, env(tl, T, 1 / 120, frame), big, out, ballP);
        }
        T = tc - 1e-3;
        a.state = tl.fielder(pos, T)!;
        an.step(a, env(tl, T, 1 / 120, frame + 1), big, out, ballP);
        const ball = tl.ball(T).p;
        // The mesh is drawn scaled by `big` about the actor's feet.
        const gx = an.x + (out.gloveHand.x - an.x) * big;
        const gy = an.gy + (out.gloveHand.y - an.gy) * big;
        const gz = an.z + (out.gloveHand.z - an.z) * big;
        const miss = Math.hypot(gx - ball.x, gy - ball.y, gz - ball.z);
        expect(miss, `${pos} ${a.state.action} ×${big}`).toBeLessThan(0.45);
        seen += 1;
      }
    }
    expect(seen).toBeGreaterThan(6);
  });
});
