"""glTF export and the build report the Node side reads."""
import bpy
import numpy as np


def triangles(ob: bpy.types.Object) -> int:
    me = ob.data
    me.calc_loop_triangles()
    return len(me.loop_triangles)


def bounds_yup(ob: bpy.types.Object) -> dict:
    """Axis-aligned bounds in the exported (three.js, Y-up) frame, feet."""
    me = ob.data
    co = np.empty(len(me.vertices) * 3, dtype=np.float64)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    m = np.asarray(ob.matrix_world)
    co = co @ m[:3, :3].T + m[:3, 3]
    yup = np.stack([co[:, 0], co[:, 2], -co[:, 1]], axis=1)
    return {"min": yup.min(axis=0).round(4).tolist(), "max": yup.max(axis=0).round(4).tolist()}


def image_info(ob: bpy.types.Object) -> list[dict]:
    seen = []
    for mat in ob.data.materials:
        if not mat or not mat.use_nodes:
            continue
        for n in mat.node_tree.nodes:
            if n.type == "TEX_IMAGE" and n.image:
                seen.append({"name": n.image.name, "size": list(n.image.size), "colorspace": n.image.colorspace_settings.name})
    return seen


def apply_transforms(objs: list[bpy.types.Object]) -> None:
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def export_glb(objs: list[bpy.types.Object], path: str) -> None:
    """Export exactly ``objs`` (with their materials and images) to a binary glTF."""
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_normals=True,
        export_texcoords=True,
        export_tangents=False,
        export_materials="EXPORT",
        export_vertex_color="ACTIVE",
        export_all_vertex_colors=False,
        export_image_format="WEBP",
        export_image_quality=90,
        export_extras=True,
        export_cameras=False,
        export_lights=False,
        export_animations=False,
    )


def winding(ob: bpy.types.Object) -> dict:
    """
    Orientation checks for a closed mesh: ``flipped_edges`` counts edges whose two faces
    run them the same way (a face wound backwards next to its neighbour), and ``volume``
    is the signed volume, negative when the whole shell faces inward.
    """
    import bmesh

    bm = bmesh.new()
    bm.from_mesh(ob.data)
    flipped = 0
    for e in bm.edges:
        loops = list(e.link_loops)
        if len(loops) == 2 and loops[0].vert == loops[1].vert:
            flipped += 1
    bm.faces.ensure_lookup_table()
    tris = bm.calc_loop_triangles()
    vol = 0.0
    for a, b, c in tris:
        vol += a.vert.co.dot(b.vert.co.cross(c.vert.co)) / 6.0
    bm.free()
    return {"flipped_edges": flipped, "volume": round(vol, 6)}
