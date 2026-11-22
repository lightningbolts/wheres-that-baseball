"""
A small hard-surface kit for building props from parts: accumulate vertices, faces and
per-vertex linear colours from primitives (beams between two points, boxes, lathed
solids, displaced blobs, ribbons), then turn the lot into one mesh object.

Coordinates are Blender's (Z up, feet). The web scene's "front" (three.js +Z, toward home
plate for park props) is Blender −Y.
"""
import math

import bmesh
import numpy as np

from wtbb3d import scene


def _frame(d: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Two unit vectors perpendicular to ``d`` (and to each other)."""
    d = d / np.linalg.norm(d)
    ref = np.array([0.0, 0.0, 1.0]) if abs(d[2]) < 0.9 else np.array([1.0, 0.0, 0.0])
    u = np.cross(d, ref)
    u /= np.linalg.norm(u)
    return u, np.cross(d, u)


class Kit:
    def __init__(self) -> None:
        self.v: list = []
        self.f: list = []
        self.c: list = []
        # Optional shading-normal overrides, vertex index → unit vector (see set_normals).
        self.n: dict = {}

    # -- raw ------------------------------------------------------------------------------
    def add(self, verts, faces, color) -> int:
        """Append geometry; ``color`` is one RGB for all or one per vertex. Returns the base index."""
        base = len(self.v)
        verts = np.asarray(verts, dtype=np.float64)
        self.v.extend(verts)
        self.f.extend([[base + i for i in face] for face in faces])
        col = np.asarray(color, dtype=np.float64)
        if col.ndim == 1:
            col = np.tile(col, (len(verts), 1))
        self.c.extend(col)
        return base

    @property
    def triangles(self) -> int:
        return sum(len(f) - 2 for f in self.f)

    # -- primitives -----------------------------------------------------------------------
    def beam(self, p0, p1, w: float, color, h: float | None = None, sides: int = 4, cap: bool = True, w1: float | None = None, color1=None) -> None:
        """
        A prism from ``p0`` to ``p1``: square (sides=4, ``w`` × ``h``) or round (radius w/2).
        ``color1`` (optional) is the colour at the ``p1`` end, for a gradient along the beam.
        """
        p0 = np.asarray(p0, float)
        p1 = np.asarray(p1, float)
        u, v = _frame(p1 - p0)
        h = w if h is None else h
        w1 = w if w1 is None else w1
        ring = []
        for k in range(sides):
            a = 2 * math.pi * (k + 0.5) / sides
            ring.append((math.cos(a), math.sin(a)))
        verts = []
        for p, s in ((p0, 1.0), (p1, w1 / w)):
            for cx, cy in ring:
                verts.append(p + u * cx * w / 2 * s * (1.414 if sides == 4 else 1) + v * cy * h / 2 * s * (1.414 if sides == 4 else 1))
        faces = [(k, (k + 1) % sides, sides + (k + 1) % sides, sides + k) for k in range(sides)]
        if cap:
            faces.append(tuple(reversed(range(sides))))
            faces.append(tuple(sides + k for k in range(sides)))
        if color1 is not None:
            color = [np.asarray(color, float)] * sides + [np.asarray(color1, float)] * sides
        self.add(verts, faces, color)

    def tube(self, points, radii, sides: int, color_fn, cap: bool = False, twist: float = 0.0) -> int:
        """
        A round tube swept along a polyline (trunks, limbs, bent pipe): one ring of ``sides``
        vertices per point, radius from ``radii`` (a number or one per point), on a frame
        carried along the path so it does not twist. ``color_fn(i, angle, pos)`` gives each
        vertex's colour. Returns the base index.
        """
        pts = np.asarray(points, float)
        n = len(pts)
        rad = np.full(n, radii, float) if np.ndim(radii) == 0 else np.asarray(radii, float)
        tang = np.gradient(pts, axis=0)
        tang /= np.linalg.norm(tang, axis=1, keepdims=True)
        u, _ = _frame(tang[0])
        verts, cols = [], []
        for i in range(n):
            t = tang[i]
            u = u - t * (u @ t)
            u /= np.linalg.norm(u)
            w = np.cross(t, u)
            for j in range(sides):
                a = 2 * math.pi * j / sides + twist
                p = pts[i] + (u * math.cos(a) + w * math.sin(a)) * rad[i]
                verts.append(p)
                cols.append(color_fn(i, a, p))
        faces = []
        for i in range(n - 1):
            for j in range(sides):
                a, b = i * sides + j, i * sides + (j + 1) % sides
                faces.append((a, b, b + sides, a + sides))
        if cap:
            faces.append(tuple(reversed(range(sides))))
            faces.append(tuple((n - 1) * sides + j for j in range(sides)))
        return self.add(verts, faces, cols)

    def plate(self, pts, color) -> None:
        """A flat polygon visible from both sides (two faces, opposite winding): gussets, straps, visors."""
        m = len(pts)
        self.add(pts, [tuple(range(m))], color)
        self.add(pts, [tuple(reversed(range(m)))], color)

    def set_normals(self, base: int, normals) -> None:
        """Override the shading normals of the vertices from ``base`` on (foliage shaded as one mass)."""
        for i, nn in enumerate(np.asarray(normals, float)):
            self.n[base + i] = nn / max(np.linalg.norm(nn), 1e-9)

    def box(self, centre, size, color, yaw: float = 0.0, shade_top: float = 1.0) -> None:
        cx, cy, cz = centre
        sx, sy, sz = (s / 2 for s in size)
        c, s = math.cos(yaw), math.sin(yaw)
        pts = []
        for z in (-sz, sz):
            for x, y in ((-sx, -sy), (sx, -sy), (sx, sy), (-sx, sy)):
                pts.append((cx + x * c - y * s, cy + x * s + y * c, cz + z))
        faces = [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
        col = np.asarray(color, float)
        cols = [col] * 4 + [col * shade_top] * 4
        self.add(pts, faces, cols)

    def lathe(self, profile, segments: int, color_fn, origin=(0, 0, 0), axis_rot=None, cap_ends: bool = True, phase: float = 0.0) -> None:
        """
        Revolve [(r, z)] about local +Z, then rotate by the 3×3 ``axis_rot`` and move to
        ``origin``. ``color_fn(r, z, angle)`` gives each vertex's colour.
        """
        verts, cols, faces = [], [], []
        rows = len(profile)
        for i, (r, z) in enumerate(profile):
            for j in range(segments):
                a = 2 * math.pi * j / segments + phase
                verts.append((r * math.cos(a), r * math.sin(a), z))
                cols.append(color_fn(r, z, a))
        for i in range(rows - 1):
            for j in range(segments):
                a, b = i * segments + j, i * segments + (j + 1) % segments
                faces.append((a, b, b + segments, a + segments))
        if cap_ends:
            if profile[0][0] > 0:
                faces.append(tuple(reversed(range(segments))))
            if profile[-1][0] > 0:
                faces.append(tuple((rows - 1) * segments + j for j in range(segments)))
        verts = np.array(verts)
        if axis_rot is not None:
            verts = verts @ np.asarray(axis_rot).T
        verts = verts + np.asarray(origin)
        self.add(verts, faces, cols)

    def blob(self, centre, radius, color_fn, rng: np.random.Generator, subdiv: int = 1, rough: float = 0.25, squash=(1.0, 1.0, 1.0), keep=None, rot=None):
        """
        A lumpy icosphere (foliage clumps, rocks). ``color_fn(world_pos, normal)``.
        ``keep(face_centre, face_normal) -> bool`` drops faces nobody can see (their unused
        vertices go too); ``rot`` is an optional 3×3 rotation applied before the squash.
        Returns (base index, vertex positions, unit sphere normals) of what was added.
        """
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)
        tv = np.array([v.co[:] for v in bm.verts])
        tf = [[v.index for v in f.verts] for f in bm.faces]
        bm.free()
        n = tv / np.linalg.norm(tv, axis=1, keepdims=True)
        if rot is not None:
            n = n @ np.asarray(rot).T
        bump = 1 + rough * rng.uniform(-1, 1, len(tv))
        verts = n * bump[:, None] * radius * np.asarray(squash) + np.asarray(centre)
        if keep is not None:
            tf = [f for f in tf if keep(verts[f].mean(axis=0), n[f].mean(axis=0))]
            used = sorted({i for f in tf for i in f})
            remap = {old: new for new, old in enumerate(used)}
            tf = [[remap[i] for i in f] for f in tf]
            verts, n = verts[used], n[used]
        cols = [color_fn(p, nn) for p, nn in zip(verts, n)]
        base = self.add(verts, tf, cols) if len(verts) else len(self.v)
        return base, verts, n

    def ribbon(self, left, right, colors) -> None:
        """A strip between two polylines of equal length (single-sided; the scene draws it double-sided)."""
        n = len(left)
        verts = list(left) + list(right)
        faces = [(i, i + 1, n + i + 1, n + i) for i in range(n - 1)]
        cols = list(colors) + list(colors)
        self.add(verts, faces, cols)

    # -- output ---------------------------------------------------------------------------
    def object(self, name: str, smooth: bool = False):
        ob = scene.mesh_object(name, np.array(self.v), self.f, colors=np.array(self.c), smooth=smooth)
        if self.n:
            me = ob.data
            if len(me.vertices) != len(self.v):
                raise RuntimeError(f"{name}: vertex count changed in validation; normal overrides no longer line up")
            normals = np.empty(len(me.vertices) * 3, dtype=np.float32)
            me.vertices.foreach_get("normal", normals)
            normals = normals.reshape(-1, 3)
            for i, nn in self.n.items():
                normals[i] = nn
            me.normals_split_custom_set_from_vertices(normals.tolist())
        return ob


def rot_x(a: float) -> np.ndarray:
    c, s = math.cos(a), math.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])


def rot_z(a: float) -> np.ndarray:
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])
