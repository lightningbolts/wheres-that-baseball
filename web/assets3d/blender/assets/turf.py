"""
Turf surface set: a 3 ft tileable patch of mown grass, modelled blade by blade (tens of
thousands of tapered blades leaning roughly with the mow over a dark thatch layer) and
baked flat with Cycles into albedo (normalised to a mean of 0.5, so the scene multiplies
it ×2 over its own mow-stripe colour), a tangent-space normal map and AO / roughness.
The ballpark grass samples it in world space at two scales (parks/surfaces.ts).
"""
import numpy as np

from wtbb3d import surface

SPEC = {
    "name": "turf",
    "description": "Tileable mown-grass surface set (3 ft tile): albedo variation, normal, AO/roughness",
    "lods": [2],
    "max_texture": 1024,
    "closed": False,
    "preview_tint": (0.30, 0.52, 0.22),
}

TILE = 3.0
BLADES = 56000
SIZE = 1024


def thatch() -> "surface.bpy.types.Object":
    n = 192
    h = 0.006 * surface.periodic_noise(n, 2.6, seed=11) + 0.002 * surface.periodic_noise(n, 1.4, seed=12)
    tone = surface.periodic_noise(n, 2.2, seed=13)
    col = np.empty((n, n, 3))
    col[..., 0] = 0.040 + 0.012 * tone
    col[..., 1] = 0.055 + 0.014 * tone
    col[..., 2] = 0.022 + 0.006 * tone
    ob = surface.heightfield("thatch", TILE, h - 0.004, colors=col)
    ob.data.materials.append(surface.vertex_color_material("thatch", 0.95))
    return ob


def blades() -> "surface.bpy.types.Object":
    rng = np.random.default_rng(7)
    base = np.zeros((BLADES, 3))
    base[:, :2] = rng.uniform(0, TILE, size=(BLADES, 2))
    # Clumping and patchy colour from tileable fields, so the tile has structure at more
    # than one scale (individual blades, hand-sized clumps, a few feet of patchiness).
    clump = surface.periodic_noise(256, 2.8, seed=21)
    patch = surface.periodic_noise(128, 3.2, seed=22)
    lean_field = surface.periodic_noise(128, 3.0, seed=23)
    c = surface.sample_periodic(clump, base[:, 0], base[:, 1], TILE)
    p = surface.sample_periodic(patch, base[:, 0], base[:, 1], TILE)
    lf = surface.sample_periodic(lean_field, base[:, 0], base[:, 1], TILE)

    length = rng.uniform(0.045, 0.085, BLADES) * (1 + 0.15 * c)
    width = rng.uniform(0.008, 0.014, BLADES)
    # Mown grass leans: mostly along +Y (the mow direction), with a broad spread.
    heading = np.pi / 2 + 0.55 * lf + rng.normal(0, 0.7, BLADES)
    tilt = np.clip(rng.normal(0.95, 0.25, BLADES), 0.3, 1.35)  # radians from vertical
    tip_dir = np.stack([np.cos(heading) * np.sin(tilt), np.sin(heading) * np.sin(tilt), np.cos(tilt)], axis=1)
    side = np.stack([-np.sin(heading), np.cos(heading), np.zeros(BLADES)], axis=1)

    # Colour: tips lighter and yellower, bases dark; patches shift hue; a few dead blades.
    g = 0.5 + 0.5 * np.tanh(0.8 * p)
    hue = np.stack([0.060 + 0.030 * g, 0.150 + 0.050 * g, 0.030 + 0.006 * g], axis=1)
    hue *= rng.uniform(0.75, 1.25, (BLADES, 1))
    dead = rng.random(BLADES) < 0.025
    hue[dead] = np.array([0.22, 0.17, 0.06]) * rng.uniform(0.7, 1.1, (dead.sum(), 1))
    tip_col = np.minimum(hue * np.array([1.35, 1.25, 1.1]), 1.0)
    base_col = hue * 0.35

    verts, faces, cols = [], [], []
    for q, k in surface.wrapped(base, TILE, 0.12):
        b0 = q - side[k] * width[k] / 2
        b1 = q + side[k] * width[k] / 2
        mid = q + tip_dir[k] * length[k] * 0.55 + side[k] * width[k] * 0.02
        # A slight droop: the tip bends further over than the base.
        bend = tip_dir[k].copy()
        bend[2] *= 0.6
        tip = mid + bend / np.linalg.norm(bend) * length[k] * 0.45
        m0 = mid - side[k] * width[k] * 0.35
        m1 = mid + side[k] * width[k] * 0.35
        i = len(verts)
        verts += [b0, b1, m1, m0, tip]
        faces += [(i, i + 1, i + 2, i + 3), (i + 3, i + 2, i + 4)]
        mc = (base_col[k] + tip_col[k]) / 2
        cols += [base_col[k], base_col[k], mc, mc, tip_col[k]]
    ob = surface.scene.mesh_object("blades", np.array(verts), faces, colors=np.array(cols), smooth=True)
    ob.data.materials.append(surface.vertex_color_material("blades", 0.7))
    return ob


def build():
    # Roughness follows the relief: blades standing in the light are waxy, the thatch
    # between them matt. Same mean as the flat value the scene was tuned against.
    rough = lambda ao: np.clip(0.78 + 0.55 * (ao.mean() - ao), 0.55, 0.96)  # noqa: E731
    plane = surface.bake_set(
        "turf",
        TILE,
        [thatch(), blades()],
        size=SIZE,
        extrusion=0.12,
        ray=0.2,
        ao_strength=0.85,
        roughness=rough,
        normalise_albedo=True,
        samples=24,
    )
    return [plane]
