# 3D assets (Blender pipeline)

Source for the models the game scene loads. Every asset is a Python script run in
headless Blender, so assets are reviewable diffs, rebuild deterministically and never
depend on a hand-edited `.blend` file.

```
assets3d/
  blender/
    build_asset.py      entry point Blender runs: build → validate → export GLB → report → preview
    wtbb3d/             shared helpers (mesh from arrays, lathe, UV sphere, glTF materials,
                        Cycles baking, export, preview render)
    assets/<name>.py    one module per asset: SPEC + build()
  manifest.json         what was built from which sources (written by the build)
  previews/             PNG of every LOD, for review (gitignored)

scripts/build-assets.mjs                          the orchestrator (npm run assets)
public/models/<name>.<hash>.glb                   built, optimised, immutable output
components/game/scene/assets/manifest.generated.ts typed manifest the app imports
components/game/scene/assets/models.ts            runtime loader (useModel / loadModel)
```

## Commands

```bash
npm run assets               # build what changed (needs Blender)
npm run assets -- bat        # just these assets
npm run assets -- --force    # rebuild even if unchanged
npm run assets:check         # no Blender needed: fail if any source changed since its build
```

Blender is found from `$BLENDER`, then `/Applications/Blender.app`, then `blender` on
`PATH`. Built with Blender 5.3.

A build is skipped when the asset's source hash (its module, `wtbb3d/`, `build_asset.py`
and the script's `PIPELINE_VERSION`) matches `manifest.json`. Output is deterministic, so
a forced rebuild of unchanged sources gives byte-identical files.

## Conventions

- **Units:** 1 Blender unit = 1 foot, like the scene.
- **Axes:** author Z-up; the exporter writes Y-up (Blender +Z → three.js +Y, Blender
  +Y → three.js −Z).
- **LODs:** one object per level, named `<asset>_LOD<n>`, LOD0 finest. Each must be
  coarser than the last and within its triangle budget in `SPEC["lods"]`.
- **Closed meshes:** consistent outward winding (checked; set `SPEC["closed"] = False` for
  open shells such as decals).
- **Materials:** Principled BSDF in the layouts `wtbb3d/materials.py` builds — base colour
  image, metallic-roughness image (G = roughness, B = metal), normal map. Procedural node
  looks are baked to images first (`wtbb3d/bake.py`). Textures are exported as WebP and
  capped at `SPEC["max_texture"]` px.
- **Vertex colours:** linear floats in a `Color` attribute; they multiply the base colour
  (glTF `COLOR_0`), and an `InstancedMesh`'s instance colour multiplies on top.

A build that breaks any of these fails with the reason and writes nothing to `public/`.

## Adding an asset

1. Create `blender/assets/<name>.py` (lower_snake_case) with:
   ```python
   SPEC = {"name": "<name>", "description": "...", "lods": [tri_budget_lod0, ...],
           "max_texture": 1024, "preview_tint": (r, g, b)}  # tint optional, preview only
   def build() -> list[bpy.types.Object]: ...           # LOD0 first
   ```
2. `npm run assets -- <name>` and look at `assets3d/previews/<name>.png`.
3. In the scene: `const model = useModel("<name>")`, then swap `modelLod(model, lod)`'s
   `geometry` / `material` into your mesh when it arrives. Keep a procedural stand-in for
   the moment before it loads (and in case it fails).
   Park props go through `parks/placements.ts` instead: in the prop builder, draw the
   procedural version into `c.models.proxy("<name>")` and record each instance with
   `c.models.place(...)`; `PlacedModels` draws the proxy until the GLB loads, then one
   InstancedMesh (add the name to `PLACED_MODELS`).
4. Commit the asset module, `manifest.json`, `manifest.generated.ts` and the new GLB.

## Surface sets

`turf` and `dirt` are *material* assets: `wtbb3d/surface.py` models real detail over one
square tile (grass blades over thatch; clay with drag streaks, cleat prints and pebbles),
wrapped at the edges so it tiles, and Cycles bakes it onto a flat plane — albedo (as
brightness variation around 0.5, so the park keeps its own grass and dirt colour), a
tangent-space normal map and roughness. `parks/surfaces.ts` samples the maps in world
space at two scales (the second rotated and larger, so the repeat never shows) in the
grass and marks shaders; on the marks layer only warm (dirt) vertex colours take it, so
chalk and rubber stay clean.

## Current assets

| Asset | LOD tris | Replaces |
| --- | --- | --- |
| `bat` | 2064 / 504 | the lathe in `character/bat.ts` (instanced; LOD1 on the Low tier) |
| `baseball` | 1680 / 288 | the plain sphere in `SceneParts.tsx`'s `Ball` |
| `turf` | surface set, 3 ft tile | procedural detail noise on the grass (`parks/surfaces.ts`) |
| `dirt` | surface set, 6 ft tile | procedural detail noise on infield / track dirt |
| `light_mast` | see manifest | the beam lattice in `props.ts` `lightBanks` (scaled in height per tower) |
| `luminaire` | see manifest | the flat LED lamp quads on every lamp rack (lenses glow at night) |
| `foul_pole` | see manifest | the cylinder-and-box poles in `props.ts` `foulPoles` (park paint as instance colour) |
| `tree_round`, `tree_pine`, `tree_palm` | see manifest | the sphere / cone / quad trees in park features (cherry blossoms stay procedural) |
| `crowd` | 1 quad + 1024² atlas | the canvas-painted fan sprites in `parks/textures.ts` `crowdAtlas` (48 modelled fans rendered in Cycles, same cell layout and grey-cloth / magenta-trim conventions; the painted atlas shows until it loads) |
