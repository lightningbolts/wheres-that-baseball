/**
 * One drawable person: a skinned mesh whose bone matrices are written straight from
 * the rig solver, wearing a texture painted for whoever currently occupies the slot.
 * Browser only (it owns a canvas).
 */
import * as THREE from "three";
import type { ActorDraw, ActorKind, RigOut } from "@/components/game/scene/rig";
import { ATLAS } from "@/components/game/scene/character/atlas";
import { buildBody, outfitFor, outfitKey, styleOf, type GloveShape, type GloveShapes, type Lod, type Outfit } from "@/components/game/scene/character/body";
import type { MeshData } from "@/components/game/scene/character/mesh";
import { hash01, paintFinish, paintLook, type Look } from "@/components/game/scene/character/paint";
import { identity, rosterVersion } from "@/components/game/scene/character/roster";
import { capLogoVersion } from "@/components/game/scene/character/uniforms";
import { SKIN_COUNT, scaleSkinMatrices, writeSkinMatrices } from "@/components/game/scene/character/skeleton";
import { getQuality } from "@/components/game/scene/quality";

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

/**
 * Texels per atlas unit: 1024² textures, or 512² on small / low-memory devices and below the
 * High graphics tier (24 people × 1024² is ~130 MB of mipmapped texture, and each repaint
 * uploads 4 MB).
 */
function atlasScale(): number {
  if (typeof window === "undefined") return 1;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const small = Math.min(window.screen?.width ?? 2000, window.screen?.height ?? 2000) < 600;
  return small || (mem !== undefined && mem < 4) ? 1 : getQuality().boot.atlasScale;
}

function canvas2d(scale: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = ATLAS * scale;
  canvas.height = ATLAS * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  return { canvas, ctx };
}

/**
 * Stylised shading on top of the standard PBR material: a soft sky-tinted rim that lifts
 * the silhouette off the grass (most of what you can see of a distant fielder) and a touch
 * of wrapped fill so the side away from the lights never goes flat.
 */
function stylise(m: THREE.MeshStandardMaterial): void {
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <opaque_fragment>",
      `{
        vec3 rimN = normalize( normal );
        vec3 rimV = normalize( vViewPosition );
        float rimF = 1.0 - clamp( dot( rimN, rimV ), 0.0, 1.0 );
        float rimUp = 0.55 + 0.45 * dot( rimN, normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz ) );
        float rim = rimF * rimF * rimF * rimUp;
        outgoingLight += ( diffuseColor.rgb * 0.5 + vec3( 0.07, 0.08, 0.1 ) ) * rim * 0.9;
        outgoingLight += diffuseColor.rgb * 0.035;
      }
      #include <opaque_fragment>`,
    );
  };
  m.customProgramCacheKey = () => "playball-person-1";
}

/** Meshes (per outfit and level of detail) and the surface-finish texture, shared by all people. */
export class Wardrobe {
  private geos = new Map<string, THREE.BufferGeometry>();
  readonly finish: THREE.CanvasTexture;

  constructor() {
    const { canvas, ctx } = canvas2d(1);
    paintFinish(ctx);
    this.finish = new THREE.CanvasTexture(canvas);
    this.finish.colorSpace = THREE.NoColorSpace;
  }

  private gloves: GloveShapes | undefined;
  /** Bumped whenever the bodies change (the modelled gloves arriving), so people re-dress. */
  version = 0;

  body(o: Outfit, lod: Lod): THREE.BufferGeometry {
    const key = `${outfitKey(o)}/${lod}`;
    let g = this.geos.get(key);
    if (!g) {
      g = toGeometry(buildBody(o, lod, this.gloves));
      this.geos.set(key, g);
    }
    return g;
  }

  /** Swap the Blender-built gloves in (or back out, with undefined): the gloved bodies are rebuilt as people next dress. */
  setGloves(gloves: GloveShapes | undefined): void {
    if (gloves === this.gloves) return;
    this.gloves = gloves;
    // A one-off: drop every cached body (only the gloved ones change, but the rest rebuild in moments).
    for (const g of this.geos.values()) g.dispose();
    this.geos.clear();
    this.version += 1;
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
  lod: Lod = 0;
  girth = 1;
  private who = -1;

  private skeleton: THREE.Skeleton;
  private material: THREE.MeshStandardMaterial;
  private texture: THREE.CanvasTexture;
  private ctx: CanvasRenderingContext2D;
  private look: Look = { kind: "fielder", id: -1, seed: 0, jersey: -1, accent: -1, skin: -1, name: "", num: "", team: "", teamId: 0, cap: -1, letter: -1, stripe: -1, kit: null };
  private painted = false;
  private version = -1;
  private outfit = "";
  private dressed = -1;
  private hand: "L" | "R" = "R";
  private kind: ActorKind | "" = "";
  private shownLod = -1;

  constructor(private wardrobe: Wardrobe) {
    const { canvas, ctx } = canvas2d(atlasScale());
    this.ctx = ctx;
    this.texture = new THREE.CanvasTexture(canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
    this.material = new THREE.MeshStandardMaterial({
      map: this.texture,
      roughnessMap: wardrobe.finish,
      metalnessMap: wardrobe.finish,
      roughness: 1,
      metalness: 1,
      vertexColors: true,
    });
    stylise(this.material);
    this.mesh = new THREE.SkinnedMesh(new THREE.BufferGeometry(), this.material);
    const bones = Array.from({ length: SKIN_COUNT }, () => new THREE.Bone());
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
    if (!this.painted || l.kind !== a.kind || l.id !== (a.id ?? 0) || l.jersey !== a.jersey.getHex() || l.accent !== a.accent.getHex() || l.skin !== a.skin.getHex() || l.teamId !== (a.uni?.teamId ?? 0)) return 2;
    if (l.id === 0 && l.seed !== a.key.length * 131 + a.key.charCodeAt(a.key.length - 1)) return 2;
    return this.version !== rosterVersion() + capLogoVersion() * 4096 ? 1 : 0;
  }

  paint(a: ActorDraw): void {
    const l = this.look;
    l.kind = a.kind;
    l.id = a.id ?? 0;
    l.seed = a.key.length * 131 + a.key.charCodeAt(a.key.length - 1);
    l.jersey = a.jersey.getHex();
    l.accent = a.accent.getHex();
    l.skin = a.skin.getHex();
    l.teamId = a.uni?.teamId ?? 0;
    l.cap = a.uni?.cap ?? -1;
    l.letter = a.uni?.letter ?? -1;
    l.stripe = a.uni?.stripe ?? -1;
    l.kit = a.uni?.kit ?? null;
    if (a.kind === "umpire") {
      l.name = "";
      l.num = "";
      l.team = "";
      this.girth = 1.08;
    } else if (l.id) {
      const who = identity(l.id);
      l.name = who.name;
      l.num = who.num;
      l.team = who.team;
      this.girth = who.girth;
    } else {
      l.name = "";
      l.team = "";
      l.num = String(40 + Math.floor(hash01(l.seed, 9) * 50));
      this.girth = 1.07;
    }
    paintLook(this.ctx, l);
    this.texture.needsUpdate = true;
    this.painted = true;
    this.version = rosterVersion() + capLogoVersion() * 4096;
  }

  /** Pick the mesh for the actor's role and the level of detail. */
  dress(a: ActorDraw, lod: Lod): void {
    const who = a.id ?? 0;
    if (a.kind !== this.kind || a.hand !== this.hand || lod !== this.shownLod || who !== this.who || this.dressed !== this.wardrobe.version) {
      // Players wear their trousers and helmets their own way; umpires and coaches by the book.
      const o = outfitFor(a.kind, a.hand, who ? styleOf(who) : undefined);
      this.who = who;
      const k = outfitKey(o);
      if (k !== this.outfit || lod !== this.shownLod || this.dressed !== this.wardrobe.version) this.mesh.geometry = this.wardrobe.body(o, lod);
      this.dressed = this.wardrobe.version;
      this.outfit = k;
      this.kind = a.kind;
      this.hand = a.hand;
      this.shownLod = lod;
    }
    this.lod = lod;
  }

  /** Pose the mesh; `scale` enlarges the figure about the point on the ground under it (x, y, z). */
  pose(rig: RigOut, scale = 1, x = 0, y = 0, z = 0): void {
    const sk = this.skeleton;
    if (!sk.boneTexture || !sk.boneMatrices) sk.computeBoneTexture();
    if (sk.boneMatrices) {
      writeSkinMatrices(sk.boneMatrices, rig.bones, this.girth);
      if (scale !== 1) scaleSkinMatrices(sk.boneMatrices, scale, x, y, z);
    }
    if (sk.boneTexture) sk.boneTexture.needsUpdate = true;
    this.mesh.boundingSphere?.center.copy(rig.center);
  }

  dispose(): void {
    this.texture.dispose();
    this.material.dispose();
    this.skeleton.dispose();
  }
}

/**
 * The Blender glove model (assets3d/blender/assets/glove.py) as glove shapes for the body
 * builder: each level of detail holds both gloves, told apart by vertex colour (B = 1 for
 * the catcher's mitt); R is the baked occlusion and G marks the dark trim.
 */
export function gloveShapes(lods: readonly THREE.BufferGeometry[]): GloveShapes {
  const out: GloveShapes = { glove: [], mitt: [] };
  for (const geo of lods) {
    const pos = geo.getAttribute("position");
    const uv = geo.getAttribute("uv");
    const col = geo.getAttribute("color");
    const idx = geo.index;
    if (!pos || !uv || !col || !idx) return { glove: [], mitt: [] };
    for (const mitt of [false, true]) {
      const remap = new Int32Array(pos.count).fill(-1);
      let n = 0;
      for (let i = 0; i < pos.count; i += 1) if (col.getZ(i) > 0.5 === mitt) remap[i] = n++;
      const shape: GloveShape = {
        position: new Float32Array(n * 3),
        uv: new Float32Array(n * 2),
        shade: new Float32Array(n),
        dark: new Uint8Array(n),
        index: new Uint32Array(0),
      };
      for (let i = 0; i < pos.count; i += 1) {
        const j = remap[i];
        if (j < 0) continue;
        shape.position.set([pos.getX(i), pos.getY(i), pos.getZ(i)], j * 3);
        shape.uv.set([uv.getX(i), uv.getY(i)], j * 2);
        shape.shade[j] = col.getX(i);
        shape.dark[j] = col.getY(i) > 0.5 ? 1 : 0;
      }
      const tris: number[] = [];
      for (let k = 0; k + 2 < idx.count; k += 3) {
        const a = remap[idx.getX(k)];
        if (a < 0) continue;
        tris.push(a, remap[idx.getX(k + 1)], remap[idx.getX(k + 2)]);
      }
      shape.index = new Uint32Array(tris);
      (mitt ? out.mitt : out.glove).push(shape);
    }
  }
  return out;
}
