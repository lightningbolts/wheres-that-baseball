"""Scene setup and mesh construction from plain arrays."""
import bpy
import numpy as np


def reset() -> None:
    """An empty scene: no default cube, camera or light, and nothing orphaned left behind."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "NONE"
    scene.unit_settings.scale_length = 1.0


def mesh_object(
    name: str,
    verts: np.ndarray,
    faces: list,
    uvs: np.ndarray | None = None,
    colors: np.ndarray | None = None,
    smooth: bool = True,
) -> bpy.types.Object:
    """
    An object linked to the scene from vertex positions (N×3, feet, Z-up), polygon index
    lists, optional per-vertex UVs (N×2) and optional per-vertex linear colours (N×3 or N×4).
    UVs are per vertex here, so a UV seam needs its own duplicated vertices.
    """
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts.tolist(), [], faces)
    me.validate(clean_customdata=False)
    if uvs is not None:
        layer = me.uv_layers.new(name="UVMap")
        loop_vi = np.empty(len(me.loops), dtype=np.int64)
        me.loops.foreach_get("vertex_index", loop_vi)
        layer.data.foreach_set("uv", uvs[loop_vi].astype(np.float32).ravel())
    if colors is not None:
        c = np.asarray(colors, dtype=np.float32)
        if c.shape[1] == 3:
            c = np.concatenate([c, np.ones((len(c), 1), np.float32)], axis=1)
        attr = me.color_attributes.new(name="Color", type="FLOAT_COLOR", domain="POINT")
        attr.data.foreach_set("color", np.clip(c, 0.0, 1.0).ravel())
        me.color_attributes.active_color = attr
        me.color_attributes.render_color_index = 0
    me.polygons.foreach_set("use_smooth", [smooth] * len(me.polygons))
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def lathe(
    profile: list[tuple[float, float]],
    segments: int,
    shade=None,
) -> tuple[np.ndarray, list, np.ndarray, np.ndarray]:
    """
    Turn a [radius, height] profile about +Z. Rows whose radius is 0 become a single pole
    vertex (a triangle fan), so the ends have no degenerate triangles. UV u runs around the
    axis (0..1, seam column duplicated), v runs along the profile by arc length (0..1).
    ``shade(r, z, angle)`` returns a linear grey per vertex; white when omitted.
    """
    prof = np.asarray(profile, dtype=np.float64)
    seg_len = np.hypot(np.diff(prof[:, 0]), np.diff(prof[:, 1]))
    arc = np.concatenate([[0.0], np.cumsum(seg_len)])
    arc /= arc[-1]
    verts, uvs, cols, rows = [], [], [], []
    for (r, z), v in zip(prof, arc):
        if r <= 1e-9:
            rows.append([len(verts)])
            verts.append((0.0, 0.0, z))
            uvs.append((0.5, v))
            cols.append(shade(0.0, z, 0.0) if shade else 1.0)
            continue
        row = []
        for j in range(segments + 1):
            a = 2 * np.pi * j / segments
            row.append(len(verts))
            verts.append((r * np.cos(a), r * np.sin(a), z))
            uvs.append((j / segments, v))
            cols.append(shade(r, z, a) if shade else 1.0)
        rows.append(row)
    faces = []
    for lo, hi in zip(rows[:-1], rows[1:]):
        if len(lo) == 1 and len(hi) == 1:
            continue
        if len(lo) == 1:
            faces += [(lo[0], hi[j + 1], hi[j]) for j in range(segments)]
        elif len(hi) == 1:
            faces += [(lo[j], lo[j + 1], hi[0]) for j in range(segments)]
        else:
            faces += [(lo[j], lo[j + 1], hi[j + 1], hi[j]) for j in range(segments)]
    g = np.asarray(cols, dtype=np.float32)
    return np.asarray(verts), faces, np.asarray(uvs), np.stack([g, g, g], axis=1)


def uv_sphere(radius: float, segments: int, rings: int) -> tuple[np.ndarray, list, np.ndarray]:
    """
    A sphere with equirectangular UVs: u = longitude / 2π, v = latitude / π + 0.5, so a
    texture painted from (u, v) → direction maps exactly. Poles are triangle fans.
    """
    verts, uvs, rows = [], [], []
    for i in range(rings + 1):
        lat = -np.pi / 2 + np.pi * i / rings
        v = i / rings
        if i in (0, rings):
            rows.append([len(verts)])
            verts.append((0.0, 0.0, radius * np.sin(lat)))
            uvs.append((0.5, v))
            continue
        row = []
        for j in range(segments + 1):
            lon = 2 * np.pi * j / segments
            row.append(len(verts))
            verts.append((radius * np.cos(lat) * np.cos(lon), radius * np.cos(lat) * np.sin(lon), radius * np.sin(lat)))
            uvs.append((j / segments, v))
        rows.append(row)
    faces = []
    for lo, hi in zip(rows[:-1], rows[1:]):
        if len(lo) == 1:
            faces += [(lo[0], hi[j + 1], hi[j]) for j in range(segments)]
        elif len(hi) == 1:
            faces += [(lo[j], lo[j + 1], hi[0]) for j in range(segments)]
        else:
            faces += [(lo[j], lo[j + 1], hi[j + 1], hi[j]) for j in range(segments)]
    return np.asarray(verts), faces, np.asarray(uvs)
