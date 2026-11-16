import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildBody, outfitFor, outfitKey } from "@/components/game/scene/character/body";
import { BONE, BONE_COUNT, DIM, REST, SKIN_COUNT, writeSkinMatrices } from "@/components/game/scene/character/skeleton";
import { jerseyName, girthOf, fallbackNumber, nickname } from "@/components/game/scene/character/roster";
import type { ActorKind } from "@/components/game/scene/rig";
import { ATLAS, PANEL } from "@/components/game/scene/character/atlas";

const KINDS: ActorKind[] = ["fielder", "pitcher", "catcher", "batter", "runner", "umpire", "coach"];

/** Linear-blend skinning on the CPU, as the vertex shader does it. */
function skinned(d: ReturnType<typeof buildBody>, mats: Float32Array, i: number, out: THREE.Vector3): THREE.Vector3 {
  const x = d.position[i * 3];
  const y = d.position[i * 3 + 1];
  const z = d.position[i * 3 + 2];
  out.set(0, 0, 0);
  for (let k = 0; k < 2; k += 1) {
    const w = d.skinWeight[i * 4 + k];
    const o = d.skinIndex[i * 4 + k] * 16;
    out.x += w * (mats[o] * x + mats[o + 4] * y + mats[o + 8] * z + mats[o + 12]);
    out.y += w * (mats[o + 1] * x + mats[o + 5] * y + mats[o + 9] * z + mats[o + 13]);
    out.z += w * (mats[o + 2] * x + mats[o + 6] * y + mats[o + 10] * z + mats[o + 14]);
  }
  return out;
}

function restBones(): THREE.Matrix4[] {
  return Array.from({ length: BONE_COUNT }, (_, b) => new THREE.Matrix4().makeTranslation(REST[b * 3], REST[b * 3 + 1], REST[b * 3 + 2]));
}

describe("character mesh", () => {
  it("builds every outfit within its triangle budget at every level of detail", () => {
    for (const kind of KINDS) {
      for (const hand of ["L", "R"] as const) {
        const o = outfitFor(kind, hand);
        const hi = buildBody(o, 0);
        const lo = buildBody(o, 1);
        const far = buildBody(o, 2);
        const triHi = hi.index.length / 3;
        const triLo = lo.index.length / 3;
        const triFar = far.index.length / 3;
        expect(triFar, `${kind} LOD2`).toBeGreaterThan(500);
        expect(triFar, `${kind} LOD2`).toBeLessThan(2400);
        expect(triFar).toBeLessThan(triLo * 0.75);
        expect(triHi, `${kind} LOD0`).toBeGreaterThan(3500);
        expect(triHi, `${kind} LOD0`).toBeLessThan(12000);
        expect(triLo, `${kind} LOD1`).toBeGreaterThan(1500);
        expect(triLo, `${kind} LOD1`).toBeLessThan(4200);
        expect(triLo).toBeLessThan(triHi * 0.45);
      }
    }
  });

  it("is a person-sized figure standing on its feet", () => {
    const d = buildBody(outfitFor("fielder", "R"), 0);
    const box = new THREE.Box3().setFromBufferAttribute(new THREE.BufferAttribute(d.position, 3));
    // Rest pose: soles a little under the ankle joints, the cap about 6 ft above them.
    expect(box.max.y - box.min.y).toBeGreaterThan(5.8);
    expect(box.max.y - box.min.y).toBeLessThan(6.5);
    expect(box.max.x).toBeLessThan(1.0);
    expect(box.min.x).toBeGreaterThan(-1.0);
    expect(box.max.z).toBeLessThan(0.9);
    expect(box.min.z).toBeGreaterThan(-0.5);
    expect(box.min.y).toBeCloseTo(DIM.hip + DIM.hipY - DIM.thigh - DIM.shin - DIM.ankle, 2);
  });

  it("has finite attributes, atlas UVs, unit normals and normalized weights on valid bones", () => {
    for (const kind of KINDS) {
      const d = buildBody(outfitFor(kind, "R"), 0);
      const n = d.position.length / 3;
      let bad = 0;
      for (let i = 0; i < n; i += 1) {
        const finite = Number.isFinite(d.position[i * 3]) && Number.isFinite(d.position[i * 3 + 1]) && Number.isFinite(d.position[i * 3 + 2]);
        const u = d.uv[i * 2];
        const v = d.uv[i * 2 + 1];
        const nl = Math.hypot(d.normal[i * 3], d.normal[i * 3 + 1], d.normal[i * 3 + 2]);
        const w = d.skinWeight[i * 4] + d.skinWeight[i * 4 + 1];
        const ok =
          finite &&
          u >= 0 &&
          u <= 1 &&
          v >= 0 &&
          v <= 1 &&
          Math.abs(nl - 1) < 1e-3 &&
          Math.abs(w - 1) < 1e-5 &&
          d.skinIndex[i * 4] < SKIN_COUNT &&
          d.skinIndex[i * 4 + 1] < SKIN_COUNT &&
          d.color[i * 3] > 0.3 &&
          d.color[i * 3] <= 1;
        if (!ok) bad += 1;
      }
      expect(bad, kind).toBe(0);
      let maxIndex = 0;
      for (let i = 0; i < d.index.length; i += 1) maxIndex = Math.max(maxIndex, d.index[i]);
      expect(maxIndex).toBeLessThan(n);
    }
  });

  it("faces outward: the surface encloses a body's worth of volume", () => {
    const d = buildBody(outfitFor("coach", "R"), 0);
    let vol = 0;
    const p = d.position;
    for (let k = 0; k < d.index.length; k += 3) {
      const a = d.index[k] * 3;
      const b = d.index[k + 1] * 3;
      const c = d.index[k + 2] * 3;
      vol += (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) + p[a + 1] * (p[b + 2] * p[c] - p[b] * p[c + 2]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) / 6;
    }
    // A 200 lb man is about 3.2 cubic feet; shells (hair, helmet) and overlaps add some.
    expect(vol).toBeGreaterThan(2.6);
    expect(vol).toBeLessThan(5);
  });

  it("is left unchanged by the rest pose and moves rigidly with the whole skeleton", () => {
    const d = buildBody(outfitFor("catcher", "R"), 0);
    const mats = new Float32Array(SKIN_COUNT * 16);
    writeSkinMatrices(mats, restBones());
    const v = new THREE.Vector3();
    const n = d.position.length / 3;
    for (let i = 0; i < n; i += 37) {
      skinned(d, mats, i, v);
      expect(v.x).toBeCloseTo(d.position[i * 3], 5);
      expect(v.y).toBeCloseTo(d.position[i * 3 + 1], 5);
      expect(v.z).toBeCloseTo(d.position[i * 3 + 2], 5);
    }
    const move = new THREE.Matrix4().makeRotationY(0.7).setPosition(10, 2, -4);
    writeSkinMatrices(
      mats,
      restBones().map((m) => m.premultiply(move)),
    );
    const want = new THREE.Vector3();
    for (let i = 0; i < n; i += 37) {
      skinned(d, mats, i, v);
      want.fromArray(d.position, i * 3).applyMatrix4(move);
      expect(v.distanceTo(want)).toBeLessThan(1e-4);
    }
  });

  it("attaches each part to the bone that should carry it", () => {
    const d = buildBody(outfitFor("fielder", "R"), 0);
    const n = d.position.length / 3;
    const handY = DIM.hip + DIM.shoulderY - DIM.upperArm - DIM.foreArm;
    let glove = 0;
    let head = 0;
    for (let i = 0; i < n; i += 1) {
      const x = d.position[i * 3];
      const y = d.position[i * 3 + 1];
      const b0 = d.skinIndex[i * 4];
      // Everything above the chin rides the head bone; the glove (left hand of a right-hander) rides the left hand.
      if (y > DIM.hip + 2.45) {
        expect(b0).toBe(BONE.head);
        head += 1;
      }
      if (x > 0.6 && y < handY - 0.2 && y > handY - 0.5) {
        expect(b0).toBe(BONE.handL);
        glove += 1;
      }
      // Feet.
      if (y < 0.0) expect(b0 === BONE.footL || b0 === BONE.footR).toBe(true);
    }
    expect(head).toBeGreaterThan(500);
    expect(glove).toBeGreaterThan(30);
  });

  it("shares meshes between people dressed alike", () => {
    expect(outfitKey(outfitFor("fielder", "R"))).toBe(outfitKey(outfitFor("pitcher", "R")));
    expect(outfitKey(outfitFor("umpire", "L"))).toBe(outfitKey(outfitFor("umpire", "R")));
    expect(outfitKey(outfitFor("batter", "L"))).not.toBe(outfitKey(outfitFor("batter", "R")));
    expect(outfitKey(outfitFor("batter", "R"))).toBe(outfitKey(outfitFor("runner", "R")));
  });
});

describe("jersey lettering", () => {
  it("uses the surname, keeping particles and suffixes", () => {
    expect(nickname("Boston Red Sox")).toBe("Red Sox");
    expect(nickname("Toronto Blue Jays")).toBe("Blue Jays");
    expect(nickname("Arizona Diamondbacks")).toBe("Diamondbacks");
    expect(jerseyName("Aaron Judge")).toBe("JUDGE");
    expect(jerseyName("Bobby Witt Jr.")).toBe("WITT JR.");
    expect(jerseyName("Michael Harris II")).toBe("HARRIS II");
    expect(jerseyName("Elly De La Cruz")).toBe("DE LA CRUZ");
    expect(jerseyName("José Ramírez")).toBe("RAMÍREZ");
    expect(jerseyName("Ichiro")).toBe("ICHIRO");
    expect(jerseyName("")).toBe("");
  });

  it("derives a number and a build when the roster has none", () => {
    const n = Number(fallbackNumber(660271));
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(99);
    expect(girthOf(null, null)).toBe(1);
    expect(girthOf(73, 207)).toBeCloseTo(1, 2);
    expect(girthOf(70, 280)).toBeLessThanOrEqual(1.14);
    expect(girthOf(78, 160)).toBeGreaterThanOrEqual(0.9);
  });

  it("caps and batting helmets carry the club mark panel on the front of the crown only", () => {
    const inPanel = (u: number, v: number, r: { x: number; y: number; w: number; h: number }) => {
      const px = u * ATLAS;
      const py = (1 - v) * ATLAS;
      return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
    };
    for (const [kind, panel] of [
      ["fielder", PANEL.capFront],
      ["batter", PANEL.helmetFront],
    ] as const) {
      const d = buildBody(outfitFor(kind, "R"), 0);
      let front = 0;
      let centre = 0;
      for (let i = 0; i < d.position.length / 3; i += 1) {
        if (!inPanel(d.uv[i * 2], d.uv[i * 2 + 1], panel)) continue;
        front += 1;
        // Everything painted from that panel faces the pitcher (+Z of the head) or sits on its sides.
        expect(d.position[i * 3 + 2]).toBeGreaterThan(DIM.headCZ - 0.02);
        const s = (d.uv[i * 2] * ATLAS - panel.x) / panel.w;
        if (Math.abs(s - 0.5) < 0.2 && d.position[i * 3 + 1] > DIM.hip + DIM.headCY + 0.2) centre += 1;
      }
      expect(front).toBeGreaterThan(20);
      expect(centre).toBeGreaterThan(2);
    }
  });
});
