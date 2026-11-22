"""
Shared Blender helpers for the WTBB 3D asset pipeline.

Conventions every asset follows (the web scene relies on them):
- 1 Blender unit = 1 foot. The scene's units are left at their defaults; nothing is scaled
  on export.
- Author Z-up (Blender's native axes). The glTF exporter converts to Y-up, so Blender +Z
  becomes three.js +Y and Blender +Y becomes three.js -Z.
- Each level of detail is its own object named ``<asset>_LOD<n>`` (LOD0 is the finest),
  with transforms applied, so the exported mesh nodes all carry an identity transform.
- Vertex colours are linear floats in a colour attribute called ``Color`` and multiply the
  base colour (as glTF's COLOR_0 always does).
"""
