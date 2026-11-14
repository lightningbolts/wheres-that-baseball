import { describe, expect, it } from "vitest";
import * as THREE from "three";
import rosters from "@/data/game/rosters.json";
import { GameSession, teamsFromRosters, type GameSetup } from "@/lib/game/session/session";
import type { RosterFile } from "@/lib/game/types";
import { buildTimeline, type Timeline } from "@/lib/game/anim/timeline";
import { PLATE_FRONT_Z } from "@/lib/game/physics/pitch";
import { actorsAt, createPlayback } from "@/components/game/scene/playback";
import { GameController } from "@/components/game/controller";
import { plateCam, zoneBox } from "@/components/game/scene/view";

const teams = teamsFromRosters(rosters as unknown as RosterFile);
const ids = [...teams.keys()];
const setup: GameSetup = { awayTeamId: ids[3], homeTeamId: ids[11], human: "away", innings: 3, difficulty: "pro", seed: 4242, awayStarter: 0, homeStarter: 0 };

// Landscape desktop, tablet, square, portrait phone, tall phone.
const ASPECTS = [21 / 9, 16 / 9, 4 / 3, 1, 9 / 16, 9 / 19.5];

function camera(mode: "batter" | "pitcher", aspect: number): THREE.PerspectiveCamera {
  const c = plateCam(mode, aspect);
  const cam = new THREE.PerspectiveCamera(c.fov, aspect, c.near, 3000);
  cam.position.set(...c.pos);
  cam.lookAt(...c.look);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  return cam;
}

const ndc = (cam: THREE.Camera, x: number, y: number, z: number) => new THREE.Vector3(x, y, z).project(cam);
const inFrame = (v: THREE.Vector3, margin = 1) => Math.abs(v.x) <= margin && Math.abs(v.y) <= margin && v.z > -1 && v.z < 1;

/** A few dozen real pitches (both teams' pitchers) as animation timelines. */
function pitches(): Timeline[] {
  const s = new GameSession({ ...setup, human: "none" }, teams);
  const out: Timeline[] = [];
  while (!s.game.final && out.length < 60) out.push(buildTimeline(s.autoPitch()));
  return out;
}

describe("plate cameras", () => {
  const tls = pitches();

  it.each(ASPECTS)("catcher cam frames the whole zone, the bat's reach and the pitch (aspect %f)", (aspect) => {
    const cam = camera("batter", aspect);
    // Tallest and shortest zones, plus everywhere the coverage box can usefully sit.
    for (const [bottom, top] of [
      [1.3, 3.2],
      [1.9, 4.0],
    ]) {
      const b = zoneBox(bottom, top);
      for (const x of [b.x0 - 0.6, b.x1 + 0.6]) for (const y of [b.y0 - 0.5, b.y1 + 0.5]) expect(inFrame(ndc(cam, x, y, PLATE_FRONT_Z), 0.95)).toBe(true);
    }
    for (const tl of tls) {
      expect(inFrame(ndc(cam, tl.releaseP.x, tl.releaseP.y, tl.releaseP.z), 0.97)).toBe(true);
      const end = Math.min(tl.contactT ?? Infinity, tl.receive.t);
      for (let i = 0; i <= 20; i += 1) {
        const p = tl.ball(tl.releaseT + ((end - tl.releaseT) * i) / 20).p;
        // In front of the plate the ball is always on screen (pitches in the dirt included).
        if (p.z >= PLATE_FRONT_Z) expect(inFrame(ndc(cam, p.x, p.y, p.z))).toBe(true);
      }
    }
  });

  it.each(ASPECTS)("pitcher cam frames the zone and the target's range (aspect %f)", (aspect) => {
    const cam = camera("pitcher", aspect);
    const b = zoneBox(1.3, 4.0);
    for (const x of [b.x0 - 1, b.x1 + 1]) for (const y of [0.3, b.y1 + 0.8]) expect(inFrame(ndc(cam, x, y, PLATE_FRONT_Z), 0.95)).toBe(true);
    // The zone is big enough to aim at (as a share of the picture's height, or of its width on a phone).
    const h = (ndc(cam, 0, 3.5, PLATE_FRONT_Z).y - ndc(cam, 0, 1.6, PLATE_FRONT_Z).y) / 2;
    const w = (ndc(cam, -0.83, 2.5, PLATE_FRONT_Z).x - ndc(cam, 0.83, 2.5, PLATE_FRONT_Z).x) / 2;
    expect(Math.max(h, Math.abs(w))).toBeGreaterThan(0.08);
  });

  it("the zone is large in the catcher cam", () => {
    for (const aspect of ASPECTS) {
      const cam = camera("batter", aspect);
      const h = (ndc(cam, 0, 3.5, PLATE_FRONT_Z).y - ndc(cam, 0, 1.6, PLATE_FRONT_Z).y) / 2;
      const w = (ndc(cam, -0.83, 2.5, PLATE_FRONT_Z).x - ndc(cam, 0.83, 2.5, PLATE_FRONT_Z).x) / 2;
      expect(h).toBeGreaterThan(0.15);
      expect(w).toBeGreaterThan(0.12);
      expect(Math.max(h, w)).toBeGreaterThan(0.25);
    }
  });

  it("nothing stands between the catcher cam and the zone: the umpire is behind the lens, the catcher is not drawn", () => {
    const pb = createPlayback();
    const ctl = new GameController(setup, teams, pb);
    const ump = actorsAt(pb).find((a) => a.kind === "umpire");
    expect(ump).toBeDefined();
    const { x: ux, z: uz } = ump!.state.p;
    for (const aspect of ASPECTS) {
      const cam = camera("batter", aspect);
      const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
      // Everything the crouching umpire can occupy, arms and strike call included.
      const v = new THREE.Vector3();
      for (let i = 0; i <= 8; i += 1)
        for (let j = 0; j <= 8; j += 1)
          for (let k = 0; k <= 8; k += 1) {
            v.set(ux - 1.2 + (2.4 * i) / 8, (6.5 * j) / 8, uz - 1.5 + (3.4 * k) / 8);
            expect(frustum.containsPoint(v)).toBe(false);
          }
    }
    // The camera sits in front of the umpire, behind the plate.
    const c = plateCam("batter", 16 / 9);
    expect(c.pos[2]).toBeGreaterThan(uz);
    expect(c.pos[2]).toBeLessThan(0);
    ctl.dispose();
  });

  it("the batter stands on his own side of the picture", () => {
    for (const aspect of ASPECTS) {
      const cam = camera("batter", aspect);
      // A right-handed batter's box is at world x = +2.7: screen-left from behind the plate.
      expect(ndc(cam, 2.7, 3, 0.5).x).toBeLessThan(-0.3);
      expect(ndc(cam, -2.7, 3, 0.5).x).toBeGreaterThan(0.3);
    }
    // On a widescreen he is in the picture, not cut off by its edge.
    expect(Math.abs(ndc(camera("batter", 16 / 9), 2.7, 3, 0.5).x)).toBeLessThan(0.9);
  });

  it("a pointer on the screen maps to the plate location drawn under it", () => {
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -PLATE_FRONT_Z);
    const ray = new THREE.Raycaster();
    const hit = new THREE.Vector3();
    for (const mode of ["batter", "pitcher"] as const) {
      for (const aspect of ASPECTS) {
        const cam = camera(mode, aspect);
        for (const [px, pz] of [
          [0, 2.5],
          [0.8, 1.5],
          [-0.8, 3.6],
          [1.4, 0.6],
        ]) {
          // Statcast px grows toward first base: world −x.
          const s = ndc(cam, -px, pz, PLATE_FRONT_Z);
          ray.setFromCamera(new THREE.Vector2(s.x, s.y), cam);
          expect(ray.ray.intersectPlane(plane, hit)).not.toBeNull();
          expect(-hit.x).toBeCloseTo(px, 4);
          expect(hit.y).toBeCloseTo(pz, 4);
          // +px is screen-right for the hitter and screen-left from behind the mound.
          if (px !== 0) expect(Math.sign(s.x)).toBe(mode === "batter" ? Math.sign(px) : -Math.sign(px));
        }
      }
    }
  });
});
