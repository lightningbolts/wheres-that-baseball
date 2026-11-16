import { afterEach, describe, expect, it, vi } from "vitest";
import rosters from "@/data/game/rosters.json";
import { teamsFromRosters, type GameSetup, type HumanSide } from "@/lib/game/session/session";
import type { RosterFile } from "@/lib/game/types";
import * as THREE from "three";
import { actorsAt, advancePlayback, createPlayback } from "@/components/game/scene/playback";
import { newCamState, stepCamera } from "@/components/game/scene/camera";
import { GameController } from "@/components/game/controller";

const teams = teamsFromRosters(rosters as unknown as RosterFile);
const ids = [...teams.keys()];

/** Farthest anybody may move in one 60 fps frame before it counts as a teleport (ft): 4 ft is 240 ft/s. */
const TELEPORT_FT = 4;

/** Camera moves faster than these in one 60 fps frame read as a jump, not a move. */
const CAM_JUMP_FT = 14;
const CAM_JUMP_FOV = 1.12;

/**
 * Watch a whole game frame by frame, through the game's own camera, and count what the
 * eye would catch between plays: people jumping to a new spot, people popping in or out
 * of the picture, a fielder turning into somebody else where he stands, and the camera
 * jumping. Frames hidden behind the curtain (a broadcast cut's dip to black, the inning
 * bumper) don't count: nobody sees them. Neither does the deliberate cut from the
 * center-field shot to the high-home shot when the ball is put in play.
 */
function watchGame(human: HumanSide, seed: number, turbo = false) {
  const setup: GameSetup = { awayTeamId: ids[seed % ids.length], homeTeamId: ids[(seed + 7) % ids.length], human, innings: 3, difficulty: "pro", seed, awayStarter: 0, homeStarter: 1 };
  const pb = createPlayback();
  const ctl = new GameController(setup, teams, pb);
  ctl.start();
  if (turbo) ctl.toggleTurbo();
  const cam = newCamState();
  const lens = new THREE.PerspectiveCamera(6, 16 / 9, 0.3, 6000);
  const frustum = new THREE.Frustum();
  const m = new THREE.Matrix4();
  const at = new THREE.Vector3();
  const camWas = new THREE.Vector3();
  const last = new Map<string, { x: number; z: number; id: number; frame: number; inView: boolean }>();
  let teleports = 0;
  let pops = 0;
  let swaps = 0;
  let camJumps = 0;
  let contactCuts = 0;
  let covered = 0;
  let wait = 0;
  let halves = 0;
  let wasTop = true;
  let fovWas = 6;
  let modeWas = "";
  for (let frame = 0; frame < 400_000; frame += 1) {
    vi.advanceTimersByTime(16);
    advancePlayback(pb, 1 / 60);
    const snap = ctl.getSnapshot();
    if (snap.top !== wasTop) {
      wasTop = snap.top;
      halves += 1;
    }
    const hidden = pb.curtain === 1;
    if (hidden) covered += 1;
    const actors = actorsAt(pb);
    stepCamera(cam, pb, 1 / 60, 16 / 9);
    lens.position.copy(cam.pos);
    lens.lookAt(cam.look);
    lens.fov = cam.fov;
    lens.updateProjectionMatrix();
    lens.updateMatrixWorld();
    frustum.setFromProjectionMatrix(m.multiplyMatrices(lens.projectionMatrix, lens.matrixWorldInverse));
    const jumped = cam.pos.distanceTo(camWas) > CAM_JUMP_FT || Math.max(cam.fov / fovWas, fovWas / cam.fov) > CAM_JUMP_FOV;
    if (jumped && !hidden && frame > 0) {
      if (pb.cam === "follow" && modeWas !== "follow") contactCuts += 1;
      else if (pb.cam === "follow" && pb.timeline) contactCuts += 1; // the director's cut inside a play (ball gone, now the trot)
      else camJumps += 1;
    }
    camWas.copy(cam.pos);
    fovWas = cam.fov;
    modeWas = pb.cam;
    for (const a of actors) {
      // The plate umpire steps out of the catcher cam's way; coaches never move.
      if (a.key === "ump" || a.kind === "coach") continue;
      if (a.state.action === "gone") continue;
      const was = last.get(a.key);
      const id = a.id ?? 0;
      const inView = frustum.containsPoint(at.set(a.state.p.x, 3, a.state.p.z));
      if (!hidden && !jumped && frame > 0) {
        if (!was || was.frame !== frame - 1) {
          if (inView) pops += 1;
        } else if (inView || was.inView) {
          if (Math.hypot(a.state.p.x - was.x, a.state.p.z - was.z) > TELEPORT_FT) teleports += 1;
          if (was.id !== id) swaps += 1;
        }
      }
      if (was) {
        was.x = a.state.p.x;
        was.z = a.state.p.z;
        was.id = id;
        was.frame = frame;
        was.inView = inView;
      } else last.set(a.key, { x: a.state.p.x, z: a.state.p.z, id, frame, inView });
    }
    // The catcher is left out of the shot taken from his own eyes.
    if (!hidden && !jumped && frame > 0) for (const [k, v] of last) if (v.frame === frame - 1 && v.inView && !k.startsWith("f-C")) pops += 1;
    for (const [k, v] of last) if (v.frame < frame) last.delete(k);
    if (snap.phase === "final") return { teleports, pops, swaps, camJumps, contactCuts, covered, halves, frames: frame };
    if (snap.phase === "aim") {
      ctl.primary();
      vi.advanceTimersByTime(500);
      ctl.primary();
    } else if (snap.phase === "ready" && snap.humanBatting) {
      wait += 1;
      if (wait > 60) {
        ctl.primary();
        wait = 0;
      }
    }
  }
  throw new Error("game did not finish");
}

describe("between-play continuity", () => {
  afterEach(() => vi.useRealTimers());

  it.each<[HumanSide, number]>([
    ["none", 11],
    ["home", 41],
    ["away", 43],
  ])("%s: nobody teleports, pops or changes clothes in view, and the camera never jumps uncovered (seed %i)", (human, seed) => {
    vi.useFakeTimers();
    const r = watchGame(human, seed);
    expect(r.halves).toBeGreaterThanOrEqual(4);
    expect(r).toMatchObject({ teleports: 0, pops: 0, swaps: 0, camJumps: 0 });
    // The dips to black are short: a few frames per cut, not a blackout.
    expect(r.covered / r.frames).toBeLessThan(0.01);
  });

  it("fast-forward plays through without the walking and the bumpers", () => {
    vi.useFakeTimers();
    const slow = watchGame("none", 11);
    const fast = watchGame("none", 11, true);
    expect(fast.covered).toBeLessThan(10);
    expect(fast.frames).toBeLessThan(slow.frames * 0.6);
  });
});
