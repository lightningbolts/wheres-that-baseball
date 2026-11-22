"""
The fielder's glove and the catcher's mitt, sculpted from metaballs so the leather blends
the way a stitched, stuffed glove does: finger stalls that swell out of the back and curl
toward the pocket, a thumb lobe, a padded heel and wrist cuff, a pocket pressed into the
front; the mitt is a round pad with a thick rolled rim. Leather webbing (an I-web on the
glove, a laced bar web on the mitt) and rawhide lacing are modelled on top, and
occlusion is ray-traced in Blender and baked into the vertices.

Both gloves live in each LOD mesh (they share an origin); the runtime splits them by
vertex colour and skins them into the player's body (character/body.ts ``glove``):

- frame: three.js axes, feet, origin at the centre of the hand; fingers along −Y, pocket
  facing +Z, thumb on +X (a left-hand glove; the body mirrors it for the other hand);
- UV: (s, t) inside the atlas's glove panel (character/atlas.ts PANEL.glove): the back
  on the left half, the pocket on the right, s across from little finger to thumb, t
  down from the fingertips to the wrist — the layout paint.ts paints the leather for;
- colour: R = baked occlusion, G = 1 for dark trim (web, laces), B = 1 for the mitt.
"""
import math

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

from wtbb3d import kit, materials, scene

SPEC = {
    "name": "glove",
    "description": "Fielder's glove + catcher's mitt (split by vertex colour B), hand-centred, feet",
    "lods": [5400, 2000],
    "max_texture": 16,
    "closed": False,
    "preview_tint": (0.42, 0.22, 0.09),
}

IN = 1 / 12  # modelled in inches
STIFF = 2.0
THRESH = 0.6
# A lone ball's surface sits at this fraction of its field radius (s(1 − r²/R²)³ = threshold).
SURF = math.sqrt(1 - (THRESH / STIFF) ** (1 / 3))


def to_bl(p) -> Vector:
    """three.js-frame inches → Blender feet (x, −z, y)."""
    x, y, z = p
    return Vector((x * IN, -z * IN, y * IN))


class Balls:
    """One metaball family, authored in the glove frame (inches), surface sizes not field radii."""

    def __init__(self, name: str, res: float) -> None:
        self.mb = bpy.data.metaballs.new(name)
        self.mb.resolution = res * IN
        self.mb.render_resolution = res * IN
        self.mb.threshold = THRESH
        self.ob = bpy.data.objects.new(name, self.mb)
        bpy.context.scene.collection.objects.link(self.ob)

    def ellipsoid(self, c, r, neg: bool = False, stiff: float = STIFF) -> None:
        e = self.mb.elements.new(type="ELLIPSOID")
        e.co = to_bl(c)
        base = max(r)
        e.radius = base * IN / SURF
        # Blender's ellipsoid size scales the field per axis (here: x, −z, y).
        e.size_x, e.size_y, e.size_z = r[0] / base, r[2] / base, r[1] / base
        e.stiffness = stiff
        e.use_negative = neg

    def capsule(self, a, b, r: float, stiff: float = STIFF) -> None:
        a, b = to_bl(a), to_bl(b)
        e = self.mb.elements.new(type="CAPSULE")
        e.co = (a + b) / 2
        d = b - a
        e.size_x = d.length / 2
        e.rotation = Vector((1, 0, 0)).rotation_difference(d.normalized())
        e.radius = r * IN / SURF
        e.stiffness = stiff

    def chain(self, pts, radii) -> None:
        for (a, b), (ra, rb) in zip(zip(pts[:-1], pts[1:]), zip(radii[:-1], radii[1:])):
            self.capsule(a, b, (ra + rb) / 2)

    def mesh(self, target_tris: int) -> tuple[np.ndarray, np.ndarray]:
        """The surface as (verts in Blender feet, triangles), decimated to about ``target_tris``."""
        dg = bpy.context.evaluated_depsgraph_get()
        me = bpy.data.meshes.new_from_object(self.ob.evaluated_get(dg))
        tmp = bpy.data.objects.new(self.ob.name + "_tmp", me)
        bpy.context.scene.collection.objects.link(tmp)
        me.calc_loop_triangles()
        n = len(me.loop_triangles)
        if n > target_tris:
            mod = tmp.modifiers.new("decimate", "DECIMATE")
            mod.ratio = target_tris / n
            mod.use_collapse_triangulate = True
            dg = bpy.context.evaluated_depsgraph_get()
            out = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg))
        else:
            out = me.copy()
        out.calc_loop_triangles()
        v = np.empty(len(out.vertices) * 3)
        out.vertices.foreach_get("co", v)
        t = np.empty(len(out.loop_triangles) * 3, dtype=np.int64)
        out.loop_triangles.foreach_get("vertices", t)
        for o in (tmp, self.ob):
            bpy.data.objects.remove(o)
        for m in (me, out):
            bpy.data.meshes.remove(m)
        bpy.data.metaballs.remove(self.mb)
        return v.reshape(-1, 3), t.reshape(-1, 3)


def snap(v: np.ndarray, t: np.ndarray, pts, direction, lift: float = 0.08):
    """Drop points (glove frame, inches) onto the surface along ``direction``; each lands ``lift`` in. above the leather."""
    tree = BVHTree.FromPolygons([Vector(p) for p in v], t.tolist())
    d = to_bl(direction).normalized()
    out = []
    for p in pts:
        o = to_bl(p) - d * (6 * IN)
        hit, normal, _, _ = tree.ray_cast(o, d, 12 * IN)
        out.append(np.array(hit + normal * (lift * IN)) if hit is not None else np.array(to_bl(p)))
    return out


def two_sided(k: kit.Kit, left, right, thick: float, color) -> None:
    """A thin leather panel between two polylines (glove frame, inches): both faces, ``thick`` apart in z."""
    for dz, flip in ((thick / 2, False), (-thick / 2, True)):
        l = [to_bl((x, y, z + dz)) for x, y, z in left]
        r = [to_bl((x, y, z + dz)) for x, y, z in right]
        k.ribbon(r, l, [color] * len(l)) if flip else k.ribbon(l, r, [color] * len(l))


DARK = np.array([0.0, 1.0, 0.0])


def lace(i, a, p):
    return DARK


def fielder(res: float, tris: int):
    b = Balls("fielder_mb", res)
    # Back and palm, padded heel, the cuff round the wrist.
    b.ellipsoid((-0.1, -1.0, 0.2), (2.7, 2.4, 1.0))
    b.ellipsoid((0.3, 1.0, 0.1), (2.3, 1.7, 1.15))
    b.ellipsoid((0.0, 2.4, -0.15), (1.9, 0.8, 1.25))
    # Finger stalls: long, fanned a little, curling forward to make the pocket.
    tips = []
    for x, l in zip((1.2, -0.05, -1.3, -2.4), (5.2, 5.6, 5.3, 4.5)):
        f = 0.14 * x
        pts = [(x, -1.4, 0.25), (x + 0.3 * f, -2.2 - 0.45 * l, 0.4), (x + 0.7 * f, -2.2 - 0.8 * l, 1.0), (x + f, -2.2 - l, 1.9)]
        b.chain(pts, (0.72, 0.66, 0.6, 0.52))
        d = np.subtract(pts[-1], pts[-2])
        tips.append(np.add(pts[-1], d / np.linalg.norm(d) * 0.55))
    # Thumb, splayed out so the web has room.
    b.chain([(2.3, -0.3, 0.3), (3.4, -1.9, 0.6), (4.0, -3.9, 1.2), (4.1, -5.4, 1.9)], (0.9, 0.8, 0.7, 0.58))
    # The palm leather runs unbroken up the inside of the stalls (only the back shows the
    # fingers), following their curl, and the pocket is pressed into it.
    b.ellipsoid((0.1, -2.6, 0.85), (2.75, 1.9, 0.55))
    b.ellipsoid((0.0, -4.8, 1.15), (2.6, 1.9, 0.5))
    b.ellipsoid((-0.2, -6.6, 1.8), (2.3, 1.3, 0.45))
    b.ellipsoid((0.5, -3.3, 1.75), (2.0, 2.7, 0.8), neg=True, stiff=4.0)
    v, t = b.mesh(tris)

    k = kit.Kit()
    # Closed web between the thumb and the forefinger, laced to both.
    left = [(1.95, -2.6, 0.9), (2.0, -4.0, 1.1), (2.05, -5.4, 1.45), (2.1, -6.7, 1.95)]
    right = [(3.3, -2.4, 0.9), (3.65, -3.8, 1.15), (3.8, -5.0, 1.5), (3.85, -5.9, 1.95)]
    two_sided(k, left, right, 0.22, DARK)
    for (lx, ly, lz), (rx, ry, rz) in zip(left[1:], right[1:]):
        k.tube([to_bl((lx - 0.2, ly, lz + 0.12)), to_bl(((lx + rx) / 2, (ly + ry) / 2, (lz + rz) / 2 + 0.2)), to_bl((rx + 0.2, ry, rz + 0.12))], 0.11 * IN, 4, lace, cap=True)
    # Rawhide lacing over the tips of the stalls, dipping into the seams between them...
    run = []
    for i, p in enumerate(tips):
        run.append(p)
        if i + 1 < len(tips):
            m = (p + tips[i + 1]) / 2
            run.append(m + np.array([0, 0.9, 0.0]))
    k.tube([to_bl(p) for p in run], 0.13 * IN, 4, lace, cap=True)
    # ...and down the little-finger side to the heel.
    side = snap(v, t, [(-5, y, 0.3) for y in (-6.4, -5.0, -3.6, -2.2, -0.8, 0.6)], (1, 0, 0))
    k.tube(side, 0.13 * IN, 4, lace, cap=True)
    return v, t, k, None, (4.0, -8.3, 3.0)


def mitt(res: float, tris: int):
    b = Balls("mitt_mb", res)
    # A round pad, the heel and cuff below it.
    b.ellipsoid((0.0, -1.9, 0.0), (3.45, 3.9, 1.3))
    b.ellipsoid((0.2, 1.0, 0.1), (2.7, 1.7, 1.35))
    b.ellipsoid((0.0, 2.45, -0.15), (2.0, 0.85, 1.35))
    # The rolled, padded rim round the top and sides; thickest on the thumb side.
    n = 22
    for i in range(n):
        # 0 = the thumb side, 90° = the top: from the thumb-side heel, over the top, to the little-finger heel.
        a = math.radians(-30 + 240 * i / (n - 1))
        x, y = 3.25 * math.cos(a), -1.9 - 3.65 * math.sin(a)
        r = 0.95 + 0.25 * max(0.0, math.cos(a))
        b.ellipsoid((x, y, 0.65), (r, r, r * 0.95))
    # Thumb lobe.
    b.chain([(2.4, -0.2, 0.3), (3.4, -2.0, 0.5), (3.3, -3.9, 0.8)], (1.1, 1.0, 0.9))
    b.ellipsoid((0.2, -2.1, 2.0), (2.55, 2.85, 1.15), neg=True)
    v, t = b.mesh(tris)

    k = kit.Kit()
    # Lacing along the crown of the rim, and the web's lacing across the rim on the thumb side.
    rim = [(3.25 * math.cos(a), -1.9 - 3.65 * math.sin(a), 0) for a in np.radians(np.linspace(-15, 195, 26))]
    k.tube(snap(v, t, [(x, y, 6) for x, y, _ in rim], (0, 0, -1)), 0.13 * IN, 4, lace, cap=True)
    for a in np.radians(np.linspace(30, 70, 5)):
        c, s_ = math.cos(a), math.sin(a)
        pts = [(r * 3.25 * c, -1.9 - r * 3.65 * s_, 6) for r in (0.62, 0.8, 1.0, 1.2, 1.34)]
        k.tube(snap(v, t, pts, (0, 0, -1)), 0.12 * IN, 4, lace, cap=True)

    def web(p: np.ndarray) -> float:
        """The mitt's web: the dark leather at the top of the thumb side."""
        x, y = p[0] / IN, p[2] / IN
        a = math.degrees(math.atan2(-(y + 1.9) / 3.65, x / 3.25))
        rr = math.hypot(x / 3.25, (y + 1.9) / 3.65)
        return 1.0 if 28 <= a <= 72 and rr > 0.55 else 0.0

    return v, t, k, web, (3.9, -6.4, 3.0)


def occlusion(verts: np.ndarray, normals: np.ndarray, tris: np.ndarray, rays: int = 48, reach: float = 2.6 * IN) -> np.ndarray:
    """Ambient occlusion per vertex: the share of a cosine-weighted hemisphere left open within ``reach``."""
    tree = BVHTree.FromPolygons([Vector(p) for p in verts], tris.tolist())
    rng = np.random.default_rng(7)
    u = rng.random((rays, 2))
    r = np.sqrt(u[:, 0])
    phi = 2 * math.pi * u[:, 1]
    local = np.stack([r * np.cos(phi), r * np.sin(phi), np.sqrt(1 - u[:, 0])], axis=1)
    out = np.empty(len(verts))
    for i, (p, n) in enumerate(zip(verts, normals)):
        t1, t2 = kit._frame(n)
        dirs = local[:, :1] * t1 + local[:, 1:2] * t2 + local[:, 2:] * n
        o = Vector(p + n * 0.02 * IN)
        hit = 0
        for d in dirs:
            if tree.ray_cast(o, Vector(d), reach)[0] is not None:
                hit += 1
        out[i] = 1 - hit / rays
    return out


def vertex_normals(v: np.ndarray, t: np.ndarray) -> np.ndarray:
    fn = np.cross(v[t[:, 1]] - v[t[:, 0]], v[t[:, 2]] - v[t[:, 0]])
    n = np.zeros_like(v)
    for c in range(3):
        np.add.at(n, t[:, c], fn)
    return n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)


def assemble(name: str, res: float, tris: int, rays: int):
    parts = []
    for flag, make in ((0.0, fielder), (1.0, mitt)):
        v, t, k, web, ext = make(res, tris)
        kv = np.array(k.v)
        kt = []
        for f in k.f:
            for j in range(1, len(f) - 1):
                kt.append((f[0], f[j], f[j + 1]))
        kt = np.array(kt, dtype=np.int64) + len(v)
        trim = np.array([web(p) for p in v]) if web else np.zeros(len(v))
        dark = np.concatenate([trim, np.array(k.c)[:, 1]])
        parts.append((np.concatenate([v, kv]), np.concatenate([t, kt]), dark, flag, ext))

    verts, faces, cols, uvs = [], [], [], []
    for v, t, dark, flag, (xr, ytip, ywrist) in parts:
        n = vertex_normals(v, t)
        ao = occlusion(v, n, t, rays)
        # Back or pocket by which way each triangle faces (glove frame +Z = Blender −Y).
        fz = -np.cross(v[t[:, 1]] - v[t[:, 0]], v[t[:, 2]] - v[t[:, 0]])[:, 1]
        base = len(verts)
        index = {}
        for tri, z in zip(t, fz):
            half = 0.5 if z > 0 else 0.0
            # Trim is decided per triangle too, so no triangle blends the swatch UV with the panel's.
            trim = 1.0 if dark[tri].sum() >= 2 else 0.0
            out = []
            for vi in tri:
                key = (vi, half, trim)
                j = index.get(key)
                if j is None:
                    j = base + len(index)
                    index[key] = j
                    x, y = v[vi, 0] / IN, v[vi, 2] / IN
                    s = half + 0.02 + 0.46 * (0.5 + 0.5 * max(-1.0, min(1.0, x / xr)))
                    tt = max(0.0, min(1.0, (y - ytip) / (ywrist - ytip)))
                    verts.append(v[vi])
                    uvs.append((s, 1 - tt))  # glTF flips V on export: the runtime sees (s, t)
                    cols.append((0.55 + 0.45 * ao[vi] ** 1.2, trim, flag))
                out.append(j)
            faces.append(tuple(out))
    ob = scene.mesh_object(name, np.array(verts), faces, uvs=np.array(uvs), colors=np.array(cols), smooth=True)
    return ob


def build():
    # The runtime paints the glove from the player's atlas; this 4×4 white image only keeps
    # the exporter from pruning the UVs as unused.
    mat = materials.pbr("glove", roughness=0.55, base_image=materials.image_from_array("glove_uv", np.ones((4, 4, 4), np.float32)))
    objs = []
    for i, (res, tris, rays) in enumerate(((0.2, 2300, 48), (0.42, 640, 24))):
        ob = assemble(f"glove_LOD{i}", res, tris, rays)
        ob.data.materials.append(mat)
        objs.append(ob)
    bpy.context.view_layer.update()
    return objs
