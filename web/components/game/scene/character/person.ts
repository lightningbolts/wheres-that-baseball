/**
 * One drawable person: a skinned mesh whose bone matrices are written straight from
 * the rig solver, wearing a texture painted for whoever currently occupies the slot.
 * Browser only (it owns a canvas).
 */
import * as THREE from "three";
import type { ActorDraw, ActorKind, RigOut } from "@/components/game/scene/rig";
import { ATLAS } from "@/components/game/scene/character/atlas";
import { buildBody, outfitFor, outfitKey, type Outfit } from "@/components/game/scene/character/body";
import type { MeshData } from "@/components/game/scene/character/mesh";
import { hash01, paintFinish, paintLook, type Look } from "@/components/game/scene/character/paint";
import { identity, rosterVersion } from "@/components/game/scene/character/roster";
import { BONE_COUNT, writeSkinMatrices } from "@/components/game/scene/character/skeleton";

export function toGeometry(d: MeshData): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(d.position, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(d.normal, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(d.uv, 2));
  g.setAttribute("color", new THREE.BufferAttribute(d.color, 3));
  g.setAttribute("skinIndex", new THREE.BufferAttribute(d.skinIndex, 4));
  g.setAttribute("skinWeight", new THREE.BufferAttribute(d.skinWeight, 4));
  g.setIndex(new THREE.BufferAttribute(d.index, 1));
  return g;
}

function canvas2d(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = ATLAS;
  canvas.height = ATLAS;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  return { canvas, ctx };
}

/** Meshes (per outfit and level of detail) and the surface-finish texture, shared by all people. */
export class Wardrobe {
  private geos = new Map<string, THREE.BufferGeometry>();
  readonly finish: THREE.CanvasTexture;

  constructor() {
    const { canvas, ctx } = canvas2d();
    paintFinish(ctx);
    this.finish = new THREE.CanvasTexture(canvas);
    this.finish.colorSpace = THREE.NoColorSpace;
  }

  body(o: Outfit, lod: 0 | 1): THREE.BufferGeometry {
    const key = `${outfitKey(o)}/${lod}`;
    let g = this.geos.get(key);
    if (!g) {
      g = toGeometry(buildBody(o, lod));
      this.geos.set(key, g);
    }
    return g;
  }

  dispose(): void {
    for (const g of this.geos.values()) g.dispose();
    this.geos.clear();
    this.finish.dispose();
  }
}

const IDENTITY = new THREE.Matrix4();
/** Generous: the pelvis to an outstretched glove or foot, plus slack. */
const BOUND_R = 5.5;

export class Person {
  readonly mesh: THREE.SkinnedMesh;
  /** Actor key occupying this slot, and the last frame it was drawn. */
  key = "";
  seen = -1;
  lod: 0 | 1 = 0;
  girth = 1;

  private skeleton: THREE.Skeleton;
  private material: THREE.MeshStandardMaterial;
  private texture: THREE.CanvasTexture;
  private ctx: CanvasRenderingContext2D;
  private look: Look = { kind: "fielder", id: -1, seed: 0, jersey: -1, accent: -1, skin: -1, name: "", num: "" };
  private painted = false;
  private version = -1;
  private outfit = "";
  private hand: "L" | "R" = "R";
  private kind: ActorKind | "" = "";
  private shownLod = -1;

  constructor(private wardrobe: Wardrobe) {
    const { canvas, ctx } = canvas2d();
    this.ctx = ctx;
    this.texture = new THREE.CanvasTexture(canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.material = new THREE.MeshStandardMaterial({
      map: this.texture,
      roughnessMap: wardrobe.finish,
      metalnessMap: wardrobe.finish,
      roughness: 1,
      metalness: 1,
      vertexColors: true,
    });
    this.mesh = new THREE.SkinnedMesh(new THREE.BufferGeometry(), this.material);
    const bones = Array.from({ length: BONE_COUNT }, () => new THREE.Bone());
    this.skeleton = new THREE.Skeleton(
      bones,
      bones.map(() => new THREE.Matrix4()),
    );
    // The solver produces finished world matrices: nothing for three to derive from a bone hierarchy.
    this.skeleton.update = () => {};
    this.skeleton.computeBoneTexture();
    this.mesh.bindMode = THREE.DetachedBindMode;
    this.mesh.bind(this.skeleton, IDENTITY);
    this.mesh.matrixAutoUpdate = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = false;
    this.mesh.visible = false;
    this.mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(), BOUND_R);
  }

  /** Does the slot need repainting for this actor? 0 no · 1 refresh (roster arrived) · 2 a different person. */
  stale(a: ActorDraw): 0 | 1 | 2 {
    const l = this.look;
    if (!this.painted || l.kind !== a.kind || l.id !== (a.id ?? 0) || l.jersey !== a.jersey.getHex() || l.accent !== a.accent.getHex() || l.skin !== a.skin.getHex()) return 2;
    if (l.id === 0 && l.seed !== a.key.length * 131 + a.key.charCodeAt(a.key.length - 1)) return 2;
    return this.version !== rosterVersion() ? 1 : 0;
  }

  paint(a: ActorDraw): void {
    const l = this.look;
    l.kind = a.kind;
    l.id = a.id ?? 0;
    l.seed = a.key.length * 131 + a.key.charCodeAt(a.key.length - 1);
    l.jersey = a.jersey.getHex();
    l.accent = a.accent.getHex();
    l.skin = a.skin.getHex();
    if (a.kind === "umpire") {
      l.name = "";
      l.num = "";
      this.girth = 1.08;
    } else if (l.id) {
      const who = identity(l.id);
      l.name = who.name;
      l.num = who.num;
      this.girth = who.girth;
    } else {
      l.name = "";
      l.num = String(40 + Math.floor(hash01(l.seed, 9) * 50));
      this.girth = 1.07;
    }
    paintLook(this.ctx, l);
    this.texture.needsUpdate = true;
    this.painted = true;
    this.version = rosterVersion();
  }

  /** Pick the mesh for the actor's role and the level of detail. */
  dress(a: ActorDraw, lod: 0 | 1): void {
    if (a.kind !== this.kind || a.hand !== this.hand || lod !== this.shownLod) {
      const o = outfitFor(a.kind, a.hand);
      const k = outfitKey(o);
      if (k !== this.outfit || lod !== this.shownLod) this.mesh.geometry = this.wardrobe.body(o, lod);
      this.outfit = k;
      this.kind = a.kind;
      this.hand = a.hand;
      this.shownLod = lod;
    }
    this.lod = lod;
  }

  pose(rig: RigOut): void {
    const sk = this.skeleton;
    if (!sk.boneTexture || !sk.boneMatrices) sk.computeBoneTexture();
    if (sk.boneMatrices) writeSkinMatrices(sk.boneMatrices, rig.bones, this.girth);
    if (sk.boneTexture) sk.boneTexture.needsUpdate = true;
    this.mesh.boundingSphere?.center.copy(rig.center);
  }

  dispose(): void {
    this.texture.dispose();
    this.material.dispose();
    this.skeleton.dispose();
  }
}
