"""
The baseball (replaces the plain sphere in SceneParts' Ball): radius 0.121 ft (BALL_R),
centred on the origin. Equirectangular UVs, and a cover texture painted from the 3D seam
curve: off-white horsehide with faint mottling, the recessed seam and 108 red double
stitches in their chevrons.
"""
import numpy as np
from mathutils import Vector, kdtree

from wtbb3d import materials, scene

SPEC = {
    "name": "baseball",
    "description": "Baseball, radius 0.121 ft, centred on the origin",
    "lods": [1800, 300],
    "max_texture": 1024,
}

RADIUS = 0.121
TEX_W, TEX_H = 1024, 512
# Seam curve on the unit sphere (exactly unit length for a + b = 1): the classic
# two-lobed "tennis ball" curve. B sets how far the lobes reach round the ball.
A, B = 0.7, 0.3
STITCHES = 108
# Widths in unit-sphere radians (a ball is 1.45 in in radius).
GROOVE = 0.018
STITCH_REACH = 0.085
THREAD = 0.016


def seam(t: np.ndarray) -> np.ndarray:
    return np.stack(
        [A * np.cos(t) + B * np.cos(3 * t), A * np.sin(t) - B * np.sin(3 * t), 2 * np.sqrt(A * B) * np.sin(2 * t)],
        axis=-1,
    )


def cover() -> np.ndarray:
    """H×W×4 sRGB-encoded cover texture, row 0 at the bottom (v = 0, the south pole)."""
    n = 4096
    t = np.linspace(0, 2 * np.pi, n, endpoint=False)
    c = seam(t)
    tangent = np.roll(c, -1, axis=0) - np.roll(c, 1, axis=0)
    tangent /= np.linalg.norm(tangent, axis=1, keepdims=True)
    side = np.cross(c, tangent)
    arc = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(c, axis=0), axis=1))])
    length = arc[-1] + np.linalg.norm(c[0] - c[-1])

    tree = kdtree.KDTree(n)
    for i, p in enumerate(c):
        tree.insert(Vector(p), i)
    tree.balance()

    u = (np.arange(TEX_W) + 0.5) / TEX_W
    v = (np.arange(TEX_H) + 0.5) / TEX_H
    lon = 2 * np.pi * u[None, :]
    lat = np.pi * v[:, None] - np.pi / 2
    d = np.stack(np.broadcast_arrays(np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)), axis=-1)
    flat = d.reshape(-1, 3)
    idx = np.fromiter((tree.find(Vector(p))[1] for p in flat), dtype=np.int64, count=len(flat))
    rel = flat - c[idx]
    across = np.einsum("ij,ij->i", rel, side[idx])  # signed, radians-ish
    along = arc[idx] + np.einsum("ij,ij->i", rel, tangent[idx])

    # Leather: warm off-white, faint mottle from a few low-frequency waves.
    mottle = (
        0.02 * np.sin(flat[:, 0] * 13 + flat[:, 1] * 7)
        + 0.015 * np.sin(flat[:, 1] * 19 - flat[:, 2] * 11)
        + 0.01 * np.sin(flat[:, 2] * 31 + flat[:, 0] * 23)
    )
    col = np.empty((len(flat), 3))
    col[:] = (0.93, 0.91, 0.85)
    col *= (1 + mottle)[:, None]

    # The seam: a shaded groove where the two hide pieces meet.
    a = np.abs(across)
    groove = np.clip(1 - a / GROOVE, 0, 1)
    col *= (1 - 0.35 * groove)[:, None]

    # Stitches: each crosses the seam as a chevron, angled back along the seam on both sides.
    pitch = length / STITCHES
    phase = (along / pitch) % 1.0
    lean = 0.45  # stitch slant: how far back along the seam (in pitches) at full reach
    s = (phase - lean * np.clip(a / STITCH_REACH, 0, 1) + 1.0) % 1.0
    centre = np.abs(s - 0.5) * pitch  # distance (radians) from the stitch's centreline
    on_reach = (a > GROOVE * 0.4) & (a < STITCH_REACH)
    thread = np.clip(1 - centre / (THREAD / 2), 0, 1) * on_reach
    # Rounded thread: brighter on its crown, and fading where it dives into the hide.
    fade = np.clip((STITCH_REACH - a) / 0.012, 0, 1)
    k = (thread ** 0.6 * fade)[:, None]
    red = np.array([0.72, 0.1, 0.1]) * (0.75 + 0.35 * thread[:, None])
    col = col * (1 - k) + red * k

    rgba = np.ones((TEX_H, TEX_W, 4))
    rgba[..., :3] = materials.linear_to_srgb(col.reshape(TEX_H, TEX_W, 3) ** 2.2)
    return rgba


def build():
    img = materials.image_from_array("baseball_cover", cover())
    mat = materials.pbr("baseball_leather", roughness=0.55, base_image=img)
    lods = []
    for i, (segs, rings) in enumerate([(40, 22), (16, 10)]):
        verts, faces, uvs = scene.uv_sphere(RADIUS, segs, rings)
        ob = scene.mesh_object(f"baseball_LOD{i}", verts, faces, uvs=uvs)
        materials.assign(ob, mat)
        lods.append(ob)
    return lods
