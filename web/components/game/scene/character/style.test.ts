import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { batStyle, clampBat, DEFAULT_BAT, drawBatStyle, drawPitchStyle, pitchStyle } from "@/components/game/scene/character/style";
import { newPose, newPoseCtx, poseInto, shoulderAt, type ActorDraw } from "@/components/game/scene/rig";

const WHITE = new THREE.Color(1, 1, 1);
function batter(id: number | undefined, actionT: number, hand: "L" | "R" = "R"): ActorDraw {
  return {
    key: "b",
    id,
    state: { p: { x: 0, y: 0, z: 0 }, yaw: 0, speed: 0, action: "stance", actionT },
    kind: "batter",
    jersey: WHITE,
    accent: WHITE,
    skin: WHITE,
    hand,
    helmet: false,
    pos: null,
  };
}

const IDS = Array.from({ length: 400 }, (_, i) => 600000 + i * 977);

describe("player styles", () => {
  it("are stable per player and differ between players", () => {
    expect(drawBatStyle(660271, 0.6)).toEqual(drawBatStyle(660271, 0.6));
    expect(drawPitchStyle(543037)).toEqual(drawPitchStyle(543037));
    expect(batStyle(123456)).toBe(batStyle(123456));
    const widths = new Set(IDS.map((id) => drawBatStyle(id, 0.5).width.toFixed(2)));
    expect(widths.size).toBeGreaterThan(25);
    const strides = new Set(IDS.map((id) => drawBatStyle(id, 0.5).stride));
    expect(strides).toEqual(new Set(["kick", "tap", "none"]));
  });

  it("stay inside a real stance for every id and build", () => {
    for (const id of IDS) {
      for (const power of [0, 0.5, 1]) {
        const s = drawBatStyle(id, power);
        expect(s).toEqual(clampBat(s));
        expect(s.width).toBeGreaterThanOrEqual(2.1);
        expect(s.width).toBeLessThanOrEqual(3.0);
        if (s.stride === "none") expect(s.lift).toBeLessThan(0.1);
        if (s.stride === "kick") expect(s.lift).toBeGreaterThan(0.7);
      }
      const p = drawPitchStyle(id);
      expect(p.lift).toBeGreaterThanOrEqual(0.75);
      expect(p.lift).toBeLessThanOrEqual(1.25);
      expect(Math.abs(p.set)).toBeLessThanOrEqual(0.35);
      expect(p.coil).toBeGreaterThanOrEqual(0);
      expect(p.coil).toBeLessThanOrEqual(1);
    }
  });

  it("bigger hitters kick and stand wide more often", () => {
    const kicks = (power: number) => IDS.filter((id) => drawBatStyle(id, power).stride === "kick").length;
    const width = (power: number) => IDS.reduce((s, id) => s + drawBatStyle(id, power).width, 0) / IDS.length;
    expect(kicks(1)).toBeGreaterThan(kicks(0));
    expect(width(1)).toBeGreaterThan(width(0) + 0.1);
  });

  it("write the famous stances over the draw", () => {
    expect(drawBatStyle(514888, 0.2)).toMatchObject({ stride: "kick", lift: 1.15 }); // Altuve
    expect(drawBatStyle(592450, 0.9)).toMatchObject({ stride: "tap", angle: 1.25 }); // Judge
    expect(drawBatStyle(660271, 0.9)).toMatchObject({ width: 2.85, oneHand: true }); // Ohtani
  });

  it("fall back to a plain stance and windup without an id", () => {
    expect(batStyle(undefined)).toBe(DEFAULT_BAT);
    expect(pitchStyle(undefined)).toEqual({ lift: 1, set: 0, coil: 0.5 });
  });
});

describe("batting stance", () => {
  it("holds the hands in front of the back shoulder, near its height, for every style and side", () => {
    const sh = new THREE.Vector3();
    for (const id of [undefined, ...IDS.slice(0, 60), 514888, 592450, 660271]) {
      for (const hand of ["R", "L"] as const) {
        for (const tau of [-10, -0.2, 0.2]) {
          const p = poseInto(newPose(), batter(id, tau, hand), "bat", newPoseCtx());
          // Back shoulder: a righty's right (−X); the pose comes back mirrored for a lefty, so his left.
          const back = hand === "R" ? -1 : 1;
          shoulderAt(sh, p, back);
          for (const h of [p.handR, p.handL]) {
            const label = `${id} ${hand} tau=${tau}`;
            // In front of the shoulders, toward the plate — never folded back behind the body.
            expect(h.z, label).toBeGreaterThan(sh.z + 0.1);
            expect(Math.abs(h.y - sh.y), label).toBeLessThan(0.9);
          }
        }
      }
    }
  });
});
