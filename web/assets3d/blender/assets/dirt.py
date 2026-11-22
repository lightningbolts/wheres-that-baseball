"""
Infield dirt surface set: a 6 ft tileable patch of groomed clay — a displaced heightfield
with drag-mat streaks, scuffed cleat prints and a few thousand modelled pebbles — baked
flat with Cycles into albedo (brightness variation around 0.5, multiplied ×2 over the
park's own dirt colour), a tangent-space normal map and AO / roughness. The ballpark's
dirt (infield, mound, circles, warning track) samples it in world space (parks/surfaces.ts).
"""
import bmesh
import numpy as np

from wtbb3d import surface

SPEC = {
    "name": "dirt",
    "description": "Tileable infield-clay surface set (6 ft tile): albedo variation, normal, AO/roughness",
    "lods": [2],
    "max_texture": 1024,
    "closed": False,
    "preview_tint": (0.62, 0.40, 0.25),
}

TILE = 6.0
N = 512
SIZE = 1024
PEBBLES = 2600
PRINTS = 22


def _wrap(d: np.ndarray) -> np.ndarray:
    return (d + TILE / 2) % TILE - TILE / 2


def ground() -> "surface.bpy.types.Object":
    rng = np.random.default_rng(5)
    xs = np.arange(N) / N * TILE
    gx, gy = np.meshgrid(xs, xs, indexing="ij")

    h = 0.006 * surface.periodic_noise(N, 3.0, seed=1)
    h += 0.0015 * surface.periodic_noise(N, 1.2, seed=2)
    # Drag-mat streaks: noise smeared along Y.
    streak = surface.periodic_noise(N, 1.0, seed=3)
    k = 24
    streak = sum(np.roll(streak, s, axis=1) for s in range(-k, k + 1)) / (2 * k + 1)
    streak /= streak.std()
    h += 0.0022 * streak
    # Small clods.
    clod = np.maximum(surface.periodic_noise(N, 0.6, seed=4) - 2.2, 0)
    h += 0.004 * clod

    # Cleat prints: a shallow oval scuff, the sole's studs pressed deeper, a ridge of
    # pushed-up clay round the toe.
    scuff = np.zeros_like(h)
    for _ in range(PRINTS):
        cx, cy = rng.uniform(0, TILE, 2)
        ang = rng.uniform(0, 2 * np.pi)
        ca, sa = np.cos(ang), np.sin(ang)
        dx, dy = _wrap(gx - cx), _wrap(gy - cy)
        u = dx * ca + dy * sa
        v = -dx * sa + dy * ca
        depth = rng.uniform(0.008, 0.018)
        sole = np.exp(-((u / 0.42) ** 2 + (v / 0.15) ** 2) ** 2)
        scuff -= depth * sole
        toe = np.exp(-(((u - 0.45) / 0.08) ** 2 + (v / 0.16) ** 2))
        scuff += depth * 0.6 * toe
        for su, sv in [(0.28, -0.07), (0.28, 0.07), (0.16, -0.09), (0.16, 0.09), (0.05, 0.0), (-0.22, -0.06), (-0.22, 0.06), (-0.32, 0.0)]:
            r2 = ((u - su) ** 2 + (v - sv) ** 2) / 0.018**2
            scuff -= depth * 0.9 * np.exp(-r2)
    h += scuff

    # Colour: drier and paler on crests and scuffed ridges, darker and damper in hollows
    # and stud holes, mottled at a few scales.
    tone = 0.6 * surface.periodic_noise(N, 2.6, seed=6) + 0.4 * surface.periodic_noise(N, 1.5, seed=7)
    rel = (h - h.mean()) / h.std()
    bright = 1 + 0.16 * tone + 0.14 * np.tanh(rel) - 1.6 * np.minimum(scuff, 0) / 0.01 * 0.05
    base = np.array([0.42, 0.24, 0.13])
    col = base[None, None, :] * bright[..., None]
    col[..., 2] *= 1 + 0.06 * surface.periodic_noise(N, 2.0, seed=8)
    ob = surface.heightfield("clay", TILE, h, colors=col)
    ob.data.materials.append(surface.vertex_color_material("clay", 0.92))
    ob["_h"] = float(np.abs(h).max())
    return ob, h


def pebbles(h: np.ndarray) -> "surface.bpy.types.Object":
    rng = np.random.default_rng(9)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1.0)
    tv = np.array([v.co[:] for v in bm.verts])
    tf = [[v.index for v in f.verts] for f in bm.faces]
    bm.free()

    pos = np.zeros((PEBBLES, 3))
    pos[:, :2] = rng.uniform(0, TILE, (PEBBLES, 2))
    pos[:, 2] = surface.sample_periodic(h, pos[:, 0], pos[:, 1], TILE)
    size = np.exp(rng.normal(np.log(0.008), 0.5, PEBBLES)).clip(0.003, 0.028)
    squash = rng.uniform(0.35, 0.7, PEBBLES)
    kind = rng.random(PEBBLES)
    cols = np.where(
        (kind < 0.5)[:, None],
        np.array([0.30, 0.27, 0.23]),
        np.where((kind < 0.8)[:, None], np.array([0.46, 0.33, 0.21]), np.array([0.20, 0.11, 0.07])),
    ) * rng.uniform(0.7, 1.3, (PEBBLES, 1))

    verts, faces, vcols = [], [], []
    for q, k in surface.wrapped(pos, TILE, 0.05):
        a = rng.uniform(0, 2 * np.pi)
        rot = np.array([[np.cos(a), -np.sin(a), 0], [np.sin(a), np.cos(a), 0], [0, 0, 1]])
        jitter = 1 + 0.18 * rng.normal(size=tv.shape)
        v = (tv * jitter) * np.array([size[k], size[k] * rng.uniform(0.6, 1.0), size[k] * squash[k]])
        v = v @ rot.T + q + np.array([0, 0, -0.25 * size[k] * squash[k]])
        base = len(verts)
        verts.extend(v)
        faces.extend([[base + i for i in f] for f in tf])
        vcols.extend([cols[k]] * len(v))
    ob = surface.scene.mesh_object("pebbles", np.array(verts), faces, colors=np.array(vcols), smooth=True)
    ob.data.materials.append(surface.vertex_color_material("pebbles", 0.6))
    return ob


def build():
    clay, h = ground()
    stones = pebbles(h)
    # Roughness follows the relief: loose clay in the hollows and stud holes is matt,
    # pebble tops and packed crests a little smoother. Same mean as before.
    rough = lambda ao: np.clip(0.9 + 0.3 * (ao.mean() - ao), 0.72, 0.98)  # noqa: E731
    plane = surface.bake_set(
        "dirt",
        TILE,
        [clay, stones],
        size=SIZE,
        extrusion=0.08,
        ray=0.16,
        ao_strength=0.7,
        roughness=rough,
        normalise_albedo=True,
        hue_keep=0.5,
        samples=24,
    )
    return [plane]
