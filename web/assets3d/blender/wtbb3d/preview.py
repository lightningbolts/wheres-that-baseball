"""
A turntable-style still of every LOD side by side, for reviewing an asset without opening
Blender. Rendered with Eevee; falls back to Workbench where Eevee cannot start (no GPU).
"""
import math

import bpy
from mathutils import Vector


def _runtime_look(objs: list[bpy.types.Object], tint) -> None:
    """
    Shade the preview the way the web scene does: base colour × vertex colour (glTF
    COLOR_0) × an optional tint standing in for a runtime instance colour. Runs after
    export, so the GLB's own node layout is untouched.
    """
    done = set()
    for o in objs:
        for mat in o.data.materials:
            if not mat or mat.name in done:
                continue
            done.add(mat.name)
            nt = mat.node_tree
            bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
            sock = bsdf.inputs["Base Color"]
            src = sock.links[0].from_socket if sock.links else None
            out = src
            if "Color" in o.data.color_attributes:
                attr = nt.nodes.new("ShaderNodeVertexColor")
                attr.layer_name = "Color"
                mul = nt.nodes.new("ShaderNodeMix")
                mul.data_type = "RGBA"
                mul.blend_type = "MULTIPLY"
                mul.inputs["Factor"].default_value = 1.0
                if src is not None:
                    nt.links.new(src, mul.inputs["A"])
                else:
                    mul.inputs["A"].default_value = sock.default_value
                nt.links.new(attr.outputs["Color"], mul.inputs["B"])
                out = mul.outputs["Result"]
            if tint is not None:
                t = nt.nodes.new("ShaderNodeMix")
                t.data_type = "RGBA"
                t.blend_type = "MULTIPLY"
                t.inputs["Factor"].default_value = 1.0
                if out is not None:
                    nt.links.new(out, t.inputs["A"])
                else:
                    t.inputs["A"].default_value = sock.default_value
                t.inputs["B"].default_value = (*tint, 1.0)
                out = t.outputs["Result"]
            if out is not None:
                nt.links.new(out, sock)


def render_preview(objs: list[bpy.types.Object], path: str, size: int = 640, tint=None) -> str:
    scene = bpy.context.scene
    _runtime_look(objs, tint)
    # Lay the LODs out along X, finest on the left.
    spans = [o.dimensions for o in objs]
    gap = max(max(d.x, d.y) for d in spans) * 0.6
    x = 0.0
    for o, d in zip(objs, spans):
        o.location.x = x + d.x / 2
        x += d.x + gap
    bpy.context.view_layer.update()

    lo = Vector((math.inf,) * 3)
    hi = Vector((-math.inf,) * 3)
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
    centre = (lo + hi) / 2
    extent = hi - lo

    cam_data = bpy.data.cameras.new("_preview")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = max(extent.x, extent.z) * 1.2
    cam = bpy.data.objects.new("_preview", cam_data)
    scene.collection.objects.link(cam)
    direction = Vector((0.35, -1.0, 0.3)).normalized()
    cam.location = centre + direction * (extent.length * 3 + 1)
    cam.rotation_euler = (-direction).to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam

    sun_data = bpy.data.lights.new("_preview", type="SUN")
    sun_data.energy = 2.2
    sun = bpy.data.objects.new("_preview", sun_data)
    sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(30))
    scene.collection.objects.link(sun)

    world = bpy.data.worlds.new("_preview")
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (0.32, 0.36, 0.42, 1.0)
    bg.inputs["Strength"].default_value = 0.6
    scene.world = world

    scene.render.resolution_x = size
    scene.render.resolution_y = size
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    scene.view_settings.view_transform = "AgX"
    scene.render.filepath = path
    for engine in ("BLENDER_EEVEE", "BLENDER_WORKBENCH"):
        try:
            scene.render.engine = engine
            if engine == "BLENDER_WORKBENCH":
                scene.display.shading.color_type = "TEXTURE"
            bpy.ops.render.render(write_still=True)
            return engine
        except RuntimeError:
            continue
    raise RuntimeError("no render engine could draw the preview")
