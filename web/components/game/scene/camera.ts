/**
 * The game camera, as pure state stepped once a frame (no React, no renderer): the plate
 * shots, the high-home "follow" shot that covers a ball in play, and the moves between
 * them. Shots on the same side of the field ease into one another; shots from opposite
 * ends (center field ↔ behind the plate) are cuts, which the controller covers with a
 * quick dip to black.
 */
import * as THREE from "three";
import { plateCam } from "@/components/game/scene/view";
import { MAX_FRAME_DT, type CamMode, type Playback } from "@/components/game/scene/playback";

const DEG = Math.PI / 180;

/** Which end of the park a shot is taken from. */
const SIDE: Record<CamMode, "cf" | "home"> = { broadcast: "cf", pitcher: "cf", batter: "home", follow: "home", overview: "home" };

/** A change between these two shots is a cut (they look at the field from opposite ends); otherwise the camera moves. */
export function camCut(from: CamMode, to: CamMode): boolean {
  return from !== to && SIDE[from] !== SIDE[to];
}

/** Critically damped spring toward a target (frame-rate independent, no overshoot). */
export function springTo(cur: THREE.Vector3, vel: THREE.Vector3, to: THREE.Vector3, smoothTime: number, dt: number) {
  const omega = 2 / smoothTime;
  const x = omega * dt;
  const e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const cx = cur.x - to.x;
  const cy = cur.y - to.y;
  const cz = cur.z - to.z;
  const tx = (vel.x + omega * cx) * dt;
  const ty = (vel.y + omega * cy) * dt;
  const tz = (vel.z + omega * cz) * dt;
  vel.set((vel.x - omega * tx) * e, (vel.y - omega * ty) * e, (vel.z - omega * tz) * e);
  cur.set(to.x + (cx + tx) * e, to.y + (cy + ty) * e, to.z + (cz + tz) * e);
}

export interface CamState {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  vPos: THREE.Vector3;
  vLook: THREE.Vector3;
  fov: number;
  near: number;
  toPos: THREE.Vector3;
  toLook: THREE.Vector3;
  /** What the follow shot is framing (smoothed), and the spot it is easing toward. */
  focus: THREE.Vector3;
  vFocus: THREE.Vector3;
  goal: THREE.Vector3;
  aim: THREE.Vector3;
  focusInit: boolean;
  /** Height of the patch of field the follow shot frames (ft). */
  frameH: number;
  tl: Playback["timeline"];
  mode: CamMode | "";
  /** Seconds since the camera started moving to a new shot. */
  glide: number;
  /** The half-inning opening this camera last pushed in for. */
  introAt: number;
  /** Seconds since that push-in began. */
  intro: number;
  /** The controller's cut counter as last seen: when it moves, the next change of shot is a cut. */
  cutSeq: number;
  /** Frames on which the picture jumped (a cut), for tests and frame-pacing checks. */
  cuts: number;
}

export function newCamState(): CamState {
  return {
    pos: new THREE.Vector3(9, 22, 340),
    look: new THREE.Vector3(0, 3.4, 0),
    vPos: new THREE.Vector3(),
    vLook: new THREE.Vector3(),
    fov: 6,
    near: 0.3,
    toPos: new THREE.Vector3(),
    toLook: new THREE.Vector3(),
    focus: new THREE.Vector3(0, 3, 30),
    vFocus: new THREE.Vector3(),
    goal: new THREE.Vector3(0, 3, 30),
    aim: new THREE.Vector3(0, 3, 30),
    focusInit: false,
    frameH: 0,
    tl: null,
    mode: "",
    glide: 10,
    introAt: -1,
    intro: 10,
    cutSeq: 0,
    cuts: 0,
  };
}

/** How far ahead of the play the follow shot looks (s): it frames where the ball is and where it is going. */
const LOOK_AHEAD_S = 0.45;
/** A ball lower than this does not tilt the camera: hops, tosses and throws across the infield stay level. */
const LEVEL_BELOW_FT = 7;
/** The framed spot may drift this fraction of the frame's height before the camera pans after it. */
const DEADZONE = 0.1;
/** Home, first, second, third (world x/z). */
const BAGS: Array<[number, number]> = [
  [0, 0],
  [-63.64, 63.64],
  [0, 127.28],
  [63.64, 63.64],
];
const BASE_VIEW_FT = 38;

const smooth01 = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

function snapTo(st: CamState, fov: number) {
  st.pos.copy(st.toPos);
  st.look.copy(st.toLook);
  st.vPos.set(0, 0, 0);
  st.vLook.set(0, 0, 0);
  st.fov = fov;
  st.glide = 10;
  st.cuts += 1;
}

/**
 * Advance the camera one frame toward the shot `pb.cam` asks for. Leaves the camera's
 * position, look-at point, field of view and near plane in `st`.
 */
export function stepCamera(st: CamState, pb: Playback, rawDt: number, aspect: number): void {
  const dt = Math.min(Math.max(rawDt, 0), MAX_FRAME_DT);
  const wide = aspect < 1 ? 1.45 : 1;
  let fov: number;
  let near = 0.3;
  let cut = false;
  const called = st.cutSeq !== pb.cutSeq;
  if (st.mode !== pb.cam || st.tl !== pb.timeline) {
    // New shot or new play: the follow state starts over.
    st.focusInit = false;
    st.frameH = 0;
    st.tl = pb.timeline;
  }
  switch (pb.cam) {
    case "batter":
    case "pitcher": {
      const c = plateCam(pb.cam, aspect);
      st.toPos.set(c.pos[0], c.pos[1], c.pos[2]);
      st.toLook.set(c.look[0], c.look[1], c.look[2]);
      fov = c.fov;
      near = c.near;
      break;
    }
    case "overview":
      st.toPos.set(-40, 230, -170);
      st.toLook.set(0, 0, 170);
      fov = 50 * wide;
      break;
    case "follow": {
      const tl = pb.timeline;
      let span = 0;
      let high = 0;
      let baseView = false;
      if (tl) {
        // Frame where the play is and where it is about to be: the fielder and the base he
        // is throwing to share the shot, and the camera is already easing over before the ball gets there.
        const f = tl.focus(pb.T);
        const a = tl.focus(pb.T + LOOK_AHEAD_S);
        span = Math.hypot(a.x - f.x, a.z - f.z);
        high = Math.max(f.y, a.y);
        st.aim.set((f.x + a.x) / 2, Math.max(0, (f.y + a.y) / 2 - LEVEL_BELOW_FT), (f.z + a.z) / 2);
        // A play at a base: once the ball is in a glove at the bag, hold a tighter shot on the bag itself.
        if (span < 8 && f.y < 8 && tl.ball(pb.T).held) {
          for (const [bx, bz] of BAGS) {
            if (Math.hypot(f.x - bx, f.z - bz) < 11) {
              st.aim.set(bx, 0, bz);
              baseView = true;
              break;
            }
          }
        }
      }
      // When the story moves somewhere else (ball gone into the seats, now the trot),
      // cut to it like a TV director instead of whipping the camera across the park.
      if (st.focusInit && st.aim.distanceTo(st.focus) > 110) cut = true;
      if (!st.focusInit || cut) {
        st.goal.copy(st.aim);
        st.focus.copy(st.aim);
        st.vFocus.set(0, 0, 0);
        st.focusInit = true;
      } else {
        // Deadzone: the framed spot wanders a little inside the shot without the camera chasing it.
        const r = DEADZONE * Math.max(40, st.frameH);
        const dx = st.aim.x - st.goal.x;
        const dy = st.aim.y - st.goal.y;
        const dz = st.aim.z - st.goal.z;
        const d = Math.hypot(dx, dy, dz);
        if (baseView) st.goal.copy(st.aim);
        else if (d > r) {
          const k = 1 - r / d;
          st.goal.set(st.goal.x + dx * k, st.goal.y + dy * k, st.goal.z + dz * k);
        }
        springTo(st.focus, st.vFocus, st.goal, baseView ? 0.45 : 0.3, dt);
      }
      const fx = st.focus.x;
      const fy = st.focus.y;
      const fz = Math.max(30, st.focus.z);
      const dist = Math.hypot(fx, fz);
      st.toPos.set(fx * 0.22, 32 + dist * 0.16 + fy * 0.25, -38 + fz * 0.18);
      st.toLook.set(fx, fy * 0.7, st.focus.z);
      // Zoom like a TV camera: frame a patch of field around the play, wide enough to hold
      // where the ball is going. Open up promptly, tighten only once the play has clearly
      // settled, and then slowly, so the lens is not breathing with every hop and throw.
      const camDist = Math.hypot(st.toLook.x - st.toPos.x, st.toLook.y - st.toPos.y, st.toLook.z - st.toPos.z);
      const want = baseView ? BASE_VIEW_FT : Math.min(150, Math.max(42, 34 + 0.16 * dist + 0.95 * span + 0.5 * Math.max(0, high - LEVEL_BELOW_FT)));
      if (cut || st.frameH <= 0) st.frameH = want;
      else if (want > st.frameH) st.frameH += (want - st.frameH) * (1 - Math.exp(-dt / 0.3));
      else if (want < st.frameH * 0.86) st.frameH += (want / 0.86 - st.frameH) * (1 - Math.exp(-dt / 1.1));
      fov = Math.min(50, ((2 * Math.atan(st.frameH / 2 / Math.max(1, camDist))) / DEG) * wide);
      break;
    }
    case "broadcast":
    default:
      st.toPos.set(9, 22, 340);
      st.toLook.set(0, 3.4, 0);
      fov = 5.4 * wide;
  }
  if (cut && st.mode === pb.cam) {
    snapTo(st, fov);
    pb.cutSeq += 1;
  }
  st.cutSeq = pb.cutSeq;
  if (st.mode !== pb.cam) {
    // Same end of the park: crane / push from one shot to the other. Opposite ends: cut.
    if (st.mode === "" || called || camCut(st.mode, pb.cam)) snapTo(st, fov);
    else st.glide = 0;
    st.mode = pb.cam;
  }
  if (st.introAt !== pb.introAt) {
    // A new half-inning opens wide and pushes in to the pitch shot.
    st.introAt = pb.introAt;
    if (pb.cam === "broadcast") {
      st.pos.set(st.toPos.x + 5, st.toPos.y + 13, st.toPos.z);
      st.fov = fov * 2.3;
    } else if (pb.cam === "pitcher") {
      st.pos.set(st.toPos.x - 5, st.toPos.y + 11, st.toPos.z + 24);
      st.fov = fov * 1.5;
    } else if (pb.cam === "batter") {
      st.pos.set(st.toPos.x, st.toPos.y + 16, st.toPos.z - 24);
      st.fov = fov * 1.12;
    }
    st.vPos.set(0, 0, 0);
    st.intro = 0;
  }
  st.glide += dt;
  st.intro += dt;
  const follow = pb.cam === "follow";
  // A move between shots starts gently and tightens up once the camera is in position.
  const ease = smooth01(st.glide / 1.1) * smooth01(st.intro / 1.4);
  const moving = ease < 1;
  springTo(st.pos, st.vPos, st.toPos, (follow ? 0.5 : 0.25) + (follow ? 0.25 : 0.35) * (1 - ease), dt);
  springTo(st.look, st.vLook, st.toLook, (follow ? 0.15 : 0.25) + 0.12 * (1 - ease), dt);
  // Field of view eases in log space, so a zoom reads as one steady move at any focal length.
  const k = 1 - Math.exp(-dt / (moving ? 0.34 : follow ? 0.3 : 0.12));
  st.fov = Math.exp(Math.log(st.fov) + (Math.log(fov) - Math.log(st.fov)) * k);
  st.near = near;
}
