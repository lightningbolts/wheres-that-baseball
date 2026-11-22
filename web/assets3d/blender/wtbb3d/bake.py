"""
Baking procedural shader networks to images with Cycles, so looks built from Blender's
noise / wave / voronoi nodes survive export (glTF only carries image textures).
"""
import bpy
import numpy as np


def bake_emission(ob: bpy.types.Object, build_nodes, width: int, height: int, samples: int = 8, margin: int = 8) -> np.ndarray:
    """
    Bake a procedural value onto ``ob``'s active UV map.

    ``build_nodes(node_tree)`` adds nodes to a scratch material and returns the socket whose
    colour should be baked. The result is an H×W×4 linear float array (row 0 at the bottom).
    The object's own materials are restored afterwards.
    """
    scene = bpy.context.scene
    prev_engine = scene.render.engine
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    scene.render.bake.margin = margin
    scene.render.bake.use_clear = True

    target = bpy.data.images.new(f"_bake_{ob.name}", width=width, height=height, alpha=False, float_buffer=True)
    target.colorspace_settings.name = "Non-Color"

    mat = bpy.data.materials.new(f"_bake_{ob.name}")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    emit = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(build_nodes(nt), emit.inputs["Color"])
    nt.links.new(emit.outputs["Emission"], out.inputs["Surface"])
    img_node = nt.nodes.new("ShaderNodeTexImage")
    img_node.image = target
    nt.nodes.active = img_node

    saved = list(ob.data.materials)
    ob.data.materials.clear()
    ob.data.materials.append(mat)
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.bake(type="EMIT")

    px = np.empty(width * height * 4, dtype=np.float32)
    target.pixels.foreach_get(px)
    ob.data.materials.clear()
    for m in saved:
        ob.data.materials.append(m)
    bpy.data.materials.remove(mat)
    bpy.data.images.remove(target)
    scene.render.engine = prev_engine
    return px.reshape(height, width, 4)
