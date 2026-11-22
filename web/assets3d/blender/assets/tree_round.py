"""
Broadleaf shade tree (oak / maple type), ~33 ft tall from the origin: a flared, slightly
swaying trunk that forks into limbs, each limb carrying its own lobe of the crown — a
cluster of ragged foliage clumps round a dark core — so the silhouette is a few uneven
masses with notches between them rather than a ball. The clumps' hidden inner faces are
dropped, and their shading normals are bent toward "outward from the crown" so the whole
canopy lights as one mass; vertex colours carry the rest (dark in the core and underneath,
light on the crown, clump-to-clump hue drift, leaf-scale mottling). The scene instances it
with a per-tree scale and tint.
"""
import math

import numpy as np

from wtbb3d import kit, materials

SPEC = {
    "name": "tree_round",
    "description": "Broadleaf tree, ~33 ft, base at the origin (instanced with scale and tint)",
    "lods": [3000, 640],
    "max_texture": 16,
    "closed": False,
    "preview_tint": (1.0, 1.0, 1.0),
}

BARK = np.array([0.16, 0.12, 0.09])
LEAF_LO = np.array([0.022, 0.058, 0.022])
LEAF_HI = np.array([0.15, 0.27, 0.07])
CENTRE = np.array([0.0, 0.0, 21.5])
RADII = np.array([13.0, 13.0, 11.0])
FORK = np.array([0.35, -0.2, 11.2])
SUN = np.array([0.35, -0.3, 0.89])
CULL = 0.80  # faces deeper than this fraction of a lobe radius are hidden: dropped


def lobes() -> list[tuple[np.ndarray, float]]:
    """The crown's masses: a top lobe on the leader and side lobes on the limbs (same for every LOD)."""
    rng = np.random.default_rng(17)
    out = [(np.array([0.6, -0.4, 25.2]), 7.4)]
    m = 5
    for i in range(m):
        a = 2 * math.pi * i / m + 0.5 + rng.uniform(-0.22, 0.22)
        d = rng.uniform(6.2, 7.8)
        out.append((np.array([d * math.cos(a), d * math.sin(a), rng.uniform(17.2, 21.0)]), rng.uniform(5.4, 6.7)))
    return out


def depth(p: np.ndarray, lobe_list, skip: int = -1) -> float:
    """How far out of the nearest lobe a point is: <1 inside, 1 on its surface."""
    return min(float(np.linalg.norm(p - c)) / r for i, (c, r) in enumerate(lobe_list) if i != skip)


def bark(i: int, a: float, p: np.ndarray) -> np.ndarray:
    return BARK * (0.82 + 0.2 * math.sin(a * 3 + p[2] * 0.9)) * (1.0 - 0.3 * min(1.0, max(0.0, p[2] - 2) / 14))


def bezier(p0, p1, p2, n: int) -> np.ndarray:
    t = np.linspace(0, 1, n)[:, None]
    return (1 - t) ** 2 * p0 + 2 * t * (1 - t) * p1 + t * t * p2


def build_lod(detailed: bool):
    k = kit.Kit()
    rng = np.random.default_rng(29)
    lobe_list = lobes()

    # Trunk: root flare, a slight sway, up to the fork.
    seg = 8 if detailed else 5
    zs = [-0.5, 0.5, 1.8, 5.0, 8.5, 11.6] if detailed else [-0.5, 1.2, 6.0, 11.6]
    rs = [2.2, 1.5, 1.2, 1.05, 0.98, 1.0] if detailed else [2.1, 1.3, 1.05, 1.0]
    pts = [np.array([FORK[0] * (z / 11.6) ** 2 + 0.25 * math.sin(z * 0.45), FORK[1] * (z / 11.6) ** 2, z]) if z > 0 else np.array([0, 0, z]) for z in zs]
    k.tube(pts, rs, seg, bark)
    # Limbs: the leader up into the top lobe, one limb arching out into each side lobe.
    for li, (c, r) in enumerate(lobe_list):
        end = c - np.array([0, 0, 0.25 * r]) if li else c + np.array([0, 0, 0.2 * r])
        out = end - FORK
        ctrl = FORK + np.array([out[0] * 0.3, out[1] * 0.3, out[2] * 0.75]) if li else FORK + out * 0.5 + np.array([-0.7, 0.5, 0])
        path = bezier(FORK, ctrl, end, 5 if detailed else 3)
        r0 = 0.72 if li else 0.85
        k.tube(path, np.linspace(r0, 0.16, len(path)), 6 if detailed else 3, bark)
        if detailed:
            # Boughs off the limb toward the lobe's flanks: what shows through the gaps.
            for b in range(2):
                a = rng.uniform(0, 2 * math.pi)
                tip = c + np.array([math.cos(a), math.sin(a), rng.uniform(-0.5, 0.1)]) * r * 0.8
                k.beam(path[2], tip, 0.42, bark(0, a, path[2]), sides=3, cap=False, w1=0.1)

    def clump(pos, radius, li, subdiv, rough, tone, squash=(1.0, 1.0, 0.82), core=False, spiky=0.0):
        warm = rng.uniform(-1, 1)  # clump-to-clump hue drift: yellower / bluer green
        tint = np.array([1 + 0.18 * warm, 1 + 0.03 * warm, 1 - 0.15 * warm]) * tone

        def colour(p, n):
            d = depth(p, lobe_list)
            ao = float(np.clip((d - 0.78) / 0.5, 0, 1))
            crown = (p - CENTRE) / RADII
            h = float(np.clip((p[2] - 13.0) / 20.0, 0, 1))
            cn = crown / max(np.linalg.norm(crown), 1e-6)
            up = 0.5 + 0.5 * float(0.6 * n[2] + 0.4 * cn[2])
            sun = max(0.0, float(cn @ SUN))
            t = 0.02 + 0.26 * ao + 0.38 * up * up * (0.3 + 0.7 * h) + 0.12 * h + 0.16 * sun * ao
            t *= rng.uniform(0.62, 1.3)  # leaf-scale mottling
            return (LEAF_LO + (LEAF_HI - LEAF_LO) * float(np.clip(t, 0, 1))) * tint

        keep = lambda fc, fn: depth(fc, lobe_list, skip=li if core else -1) > CULL  # noqa: E731
        base, verts, n = k.blob(pos, radius, colour, rng, subdiv=subdiv, rough=rough, squash=squash, keep=keep, rot=kit.rot_z(rng.uniform(0, 6.28)) @ kit.rot_x(rng.uniform(0, 6.28)))
        if len(verts):
            if spiky:
                # Sprays: push a share of the vertices well out, so the outline is ragged.
                for i in np.flatnonzero(rng.random(len(verts)) < 0.3):
                    verts[i] = pos + (verts[i] - pos) * (1 + spiky * rng.uniform(0.5, 1.0))
                    k.v[base + i] = verts[i]
            c, r = lobe_list[li]
            crown = (verts - CENTRE) / RADII
            crown /= np.linalg.norm(crown, axis=1, keepdims=True)
            lobe = verts - c
            lobe /= np.linalg.norm(lobe, axis=1, keepdims=True)
            k.set_normals(base, 0.40 * crown + 0.32 * lobe + 0.28 * n)

    for li, (c, r) in enumerate(lobe_list):
        if detailed:
            # Dark core: fills the lobe behind the clumps (its faces inside other lobes are dropped).
            clump(c, r * (CULL + 0.06), li, 1, 0.05, 0.75, squash=(1, 1, 0.97), core=True)
        else:
            clump(c, r * 0.98, li, 2, 0.26, 1.0, squash=(1, 1, 0.9), core=True, spiky=0.2)
        n = (15 if li == 0 else 12) if detailed else (5 if li == 0 else 4)
        for i in range(n):
            y = 1 - 2 * (i + 0.5) / n
            rad = math.sqrt(1 - y * y)
            th = math.pi * (3 - math.sqrt(5)) * i + li * 1.3
            d = np.array([rad * math.cos(th), rad * math.sin(th), y])
            jit = rng.uniform(size=4)
            if d[2] < (-0.62 if detailed else -0.1):
                continue
            pos = c + d * r * (0.70 + 0.2 * jit[0])
            if depth(pos, lobe_list, skip=li) < 0.7:
                continue
            if detailed:
                clump(pos, r * (0.36 + 0.16 * jit[1]), li, 2, 0.36, 0.9 + 0.2 * jit[2], spiky=0.32)
            elif i % 2 == 0:
                clump(pos + d * r * 0.12, r * (0.36 + 0.1 * jit[1]), li, 1, 0.3, 0.9 + 0.2 * jit[2], spiky=0.35)
    return k


def build():
    mat = materials.pbr("tree_round", roughness=0.9)
    objs = []
    for i, detailed in enumerate([True, False]):
        ob = build_lod(detailed).object(f"tree_round_LOD{i}", smooth=True)
        materials.assign(ob, mat)
        objs.append(ob)
    return objs
