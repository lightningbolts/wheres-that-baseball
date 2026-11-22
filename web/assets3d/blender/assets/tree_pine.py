"""
Conifer (spruce / fir), ~47 ft tall from the origin: a tapering trunk carrying tiers of
boughs. Each tier is a star-shaped skirt — its points are the bough tips, drooping and
uneven in reach, the notches between them cut deep and held higher — over a dark
underside, so tiers shadow one another and the outline is ragged the way branch tips make
it. Tiers crowd together and tilt upward toward the leader, sag near the ground, and none
is centred or sized quite like its neighbours. Instanced with per-tree scale and tint.
"""
import math

import numpy as np

from wtbb3d import kit, materials

SPEC = {
    "name": "tree_pine",
    "description": "Conifer, ~47 ft, base at the origin (instanced with scale and tint)",
    "lods": [1800, 420],
    "max_texture": 16,
    "closed": False,
    "preview_tint": (1.0, 1.0, 1.0),
}

BARK = np.array([0.13, 0.09, 0.07])
NEEDLE_DARK = np.array([0.012, 0.032, 0.022])
NEEDLE = np.array([0.036, 0.082, 0.044])
NEEDLE_TIP = np.array([0.095, 0.175, 0.078])
TOP = 47.0


def reach(t: float) -> float:
    """Crown radius at height fraction t of the foliage (0 = lowest tier): widest a little way up."""
    return 1.0 + 10.5 * (1 - t) ** 0.9 * (0.8 + 0.2 * min(1.0, t / 0.12))


def build_lod(detailed: bool):
    k = kit.Kit()
    rng = np.random.default_rng(23)
    lean = np.array([0.5, 0.3])  # the leader is never quite plumb
    axis = lambda z: np.array([lean[0] * (z / TOP) ** 2, lean[1] * (z / TOP) ** 2, z])  # noqa: E731
    zs = [-0.5, 1.0, 4.0, 20.0, 40.0, TOP] if detailed else [-0.5, 2.0, 40.0, TOP]
    rs = [1.5, 1.0, 0.85, 0.6, 0.2, 0.03] if detailed else [1.4, 0.9, 0.2, 0.03]
    k.tube([axis(z) for z in zs], rs, 7 if detailed else 4, lambda i, a, p: BARK * (0.8 + 0.25 * math.sin(a * 2 + p[2])))

    tiers = 17 if detailed else 7
    for w in range(tiers):
        t = w / (tiers - 1)
        # Tiers bunch up toward the top.
        z0 = 5.0 + 37.5 * (1 - (1 - t) ** 1.25) + rng.uniform(-0.5, 0.5) * (1 - t)
        r = reach(t) * rng.uniform(0.88, 1.1)
        hh = (8.5 - 4.5 * t) * (1.0 if detailed else 1.5)
        boughs = int(round((11 - 5 * t) if detailed else (6 - 2 * t))) + int(rng.integers(0, 2))
        phase = rng.uniform(0, 2 * math.pi)
        centre = axis(z0) + np.array([*rng.uniform(-0.35, 0.35, 2) * (1 - t), 0])
        apex = axis(min(z0 + hh, TOP - 0.8))
        sag = 2.2 * (1 - t) ** 1.5 - 0.8 * t  # low boughs hang, top ones reach up
        shade = 0.72 + 0.28 * t  # lower tiers sit in the shadow of those above
        seg = boughs * 2
        rim, mid, under, rim_cols, mid_cols = [], [], [], [], []
        angles = phase + (np.arange(seg) + rng.uniform(-0.28, 0.28, seg)) * 2 * math.pi / seg
        for j, a in enumerate(angles):
            tip = j % 2 == 0
            rr = r * (rng.uniform(0.78, 1.15) if tip else rng.uniform(0.42, 0.6))
            drop = sag * (1.0 if tip else 0.35) + (rng.uniform(0.0, 1.2) if tip else -rng.uniform(0.3, 1.0))
            d = np.array([math.cos(a), math.sin(a), 0.0])
            rim.append(centre + d * rr - np.array([0, 0, drop]))
            mid.append(centre + d * rr * 0.5 + np.array([0, 0, hh * (0.40 if tip else 0.46)]))
            under.append(centre + d * rr * 0.22 + np.array([0, 0, hh * 0.10]))
            fresh = rng.uniform(0.75, 1.15)
            rim_cols.append((NEEDLE_TIP * fresh if tip else NEEDLE * 0.8) * shade)
            mid_cols.append(NEEDLE * (1.05 if tip else 0.7) * shade * rng.uniform(0.85, 1.15))
        verts = [apex] + mid + rim + under
        cols = [NEEDLE * shade] + mid_cols + rim_cols + [NEEDLE_DARK] * seg
        faces = []
        for j in range(seg):
            jn = (j + 1) % seg
            faces.append((0, 1 + j, 1 + jn))
            faces.append((1 + j, 1 + seg + j, 1 + seg + jn, 1 + jn))
            # Underside, facing down and in.
            faces.append((1 + seg + jn, 1 + seg + j, 1 + 2 * seg + j, 1 + 2 * seg + jn))
        k.add(verts, faces, cols)
    # The leader: a short spire of this year's growth above the last tier.
    tipz = TOP + 0.6
    base = axis(TOP - 4.5)
    n = 5 if detailed else 4
    ring = [base + np.array([1.1 * math.cos(2 * math.pi * j / n), 1.1 * math.sin(2 * math.pi * j / n), 0]) for j in range(n)]
    k.add([axis(tipz)] + ring, [(0, 1 + j, 1 + (j + 1) % n) for j in range(n)], [NEEDLE_TIP] + [NEEDLE] * n)
    return k


def build():
    mat = materials.pbr("tree_pine", roughness=0.92)
    objs = []
    for i, detailed in enumerate([True, False]):
        ob = build_lod(detailed).object(f"tree_pine_LOD{i}", smooth=True)
        materials.assign(ob, mat)
        objs.append(ob)
    return objs
