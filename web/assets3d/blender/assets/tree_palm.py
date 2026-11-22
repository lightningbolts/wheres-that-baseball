"""
Palm (date-palm type), ~46 ft from the origin: a gently curving ringed trunk flaring at
the foot, a boss of old leaf bases under the crown, and a full head of pinnate fronds —
young ones standing nearly upright in the middle, the rest arching over and the oldest
hanging below level — each a rachis carrying separate leaflets down both sides, so the
outline is feathered rather than a blade. A few dead fronds hang against the trunk.
Everything leafy is a single surface: the scene draws this model double-sided.
"""
import math

import numpy as np

from wtbb3d import kit, materials

SPEC = {
    "name": "tree_palm",
    "description": "Palm tree, ~46 ft, base at the origin (instanced with scale and tint; double-sided)",
    "lods": [2400, 560],
    "max_texture": 16,
    "closed": False,
    "preview_tint": (1.0, 1.0, 1.0),
}

H = 44.0  # trunk; the crown stands another ~6 ft above it
LEAN = 3.0
TRUNK = np.array([0.30, 0.25, 0.19])
BOOT = np.array([0.20, 0.14, 0.08])
FROND_BASE = np.array([0.035, 0.085, 0.028])
FROND_TIP = np.array([0.13, 0.25, 0.075])
RACHIS = np.array([0.22, 0.26, 0.09])
DEAD = np.array([0.30, 0.21, 0.10])
GOLDEN = math.pi * (3 - math.sqrt(5))


def spine(t: float) -> np.ndarray:
    return np.array([LEAN * t * t, 0.0, H * t])


def frond(k: kit.Kit, rng, root, azimuth: float, rise: float, bend: float, length: float, steps: int, pairs: int, age: float, dead: bool) -> None:
    """
    One frond from ``root``: the rachis leaves at ``rise`` radians above level and bends over
    by ``bend`` along its length; ``pairs`` leaflets a side, longest in the middle, raised in
    a V near the base of the frond and hanging toward its tip. ``age`` 0 (new) … 1 (old).
    """
    d = np.array([math.cos(azimuth), math.sin(azimuth), 0.0])
    side = np.array([-math.sin(azimuth), math.cos(azimuth), 0.0])
    z = np.array([0.0, 0.0, 1.0])
    pts, tans, ups = [np.asarray(root, float)], [], []
    for s in range(steps + 1):
        t = s / steps
        phi = rise - bend * t**1.35
        tan = d * math.cos(phi) + z * math.sin(phi)
        tans.append(tan)
        ups.append(-d * math.sin(phi) + z * math.cos(phi))
        if s < steps:
            pts.append(pts[-1] + tan * length / steps)
    pts, tans, ups = np.array(pts), np.array(tans), np.array(ups)

    def at(t: float):
        x = min(max(t, 0.0), 1.0) * steps
        i = min(int(x), steps - 1)
        f = x - i
        return pts[i] * (1 - f) + pts[i + 1] * f, tans[i] * (1 - f) + tans[i + 1] * f, ups[i] * (1 - f) + ups[i + 1] * f

    green = (1.0 - 0.25 * age) * np.array([1 + 0.25 * age, 1.0, 1 - 0.2 * age])  # old fronds dull and yellow a little
    stem = DEAD * 0.8 if dead else RACHIS * (1 - 0.2 * age)
    # Rachis: a narrow strip, wider at the petiole.
    wid = [0.22 * (1 - 0.75 * s / steps) + 0.03 for s in range(steps + 1)]
    lift = ups * 0.07  # proud of the leaflet bases, which meet on the same line
    k.ribbon([p + side * w + o for p, w, o in zip(pts, wid, lift)], [p - side * w + o for p, w, o in zip(pts, wid, lift)], [stem] * (steps + 1))
    t0 = 0.10  # bare petiole
    pitch = (1 - t0) / pairs
    lmax = (2.3 if dead else 3.3) * (length / 13.0) ** 0.5 * (1.0 if pairs > 8 else 1.3)  # fewer leaflets: bigger, for the same mass
    for i in range(pairs):
        t = t0 + (i + 0.5) * pitch
        p, tan, up = at(t)
        ln = lmax * (0.35 + 0.65 * math.sin(math.pi * min(1.0, 0.08 + 0.9 * t)) ** 0.8)
        half = pitch * length * (0.62 if pairs > 8 else 0.68)
        vee = math.radians(-50 if dead else 38 - 30 * t - 22 * age)
        for sgn in (1, -1):
            l = ln * rng.uniform(0.85, 1.12)
            tip = p + side * sgn * l * math.cos(vee) + up * l * math.sin(vee) + tan * l * 0.45 - z * l * (0.10 + 0.25 * t + 0.15 * age)
            if dead:
                cols = [DEAD * 0.7, DEAD * 0.7, DEAD * rng.uniform(0.8, 1.2)]
            else:
                cols = [FROND_BASE * green, FROND_BASE * green, FROND_TIP * green * rng.uniform(0.8, 1.15)]
            k.add([p - tan * half, p + tan * half, tip], [(0, 1, 2)], cols)
    # Terminal leaflet.
    p, tan, _ = at(1.0)
    k.add([p + side * 0.3 - tan * 0.6, p - side * 0.3 - tan * 0.6, p + tan * lmax * 0.45 - z * 0.3], [(0, 1, 2)], [DEAD * 0.7 if dead else FROND_BASE * green] * 2 + [DEAD if dead else FROND_TIP * green])


def build_lod(detailed: bool):
    k = kit.Kit()
    rng = np.random.default_rng(31)
    # Trunk: rings along the curved spine — leaf-scar ridges, a flare at the foot, a slight
    # swell under the crown.
    seg = 8 if detailed else 5
    rows = 24 if detailed else 7
    verts, cols, faces = [], [], []
    for i in range(rows + 1):
        t = i / rows
        c = spine(t)
        r = 1.0 - 0.28 * t + 0.45 * math.exp(-t * 28) + 0.18 * math.exp(-((1 - t) * 9) ** 2) + (0.07 if (detailed and i % 2) else 0.0)
        for j in range(seg):
            a = 2 * math.pi * j / seg + (0.4 if i % 2 else 0.0)
            verts.append(c + np.array([r * math.cos(a), r * math.sin(a), 0 if i else -0.5]))
            cols.append(TRUNK * (0.78 + 0.26 * (i % 2)) * (0.88 + 0.12 * math.cos(a)) * (0.85 + 0.15 * min(1.0, t * 6)))
    for i in range(rows):
        for j in range(seg):
            a, b = i * seg + j, i * seg + (j + 1) % seg
            faces.append((a, b, b + seg, a + seg))
    k.add(verts, faces, cols)
    top = spine(1.0)
    # Boots: a rough boss of cut leaf bases under the crown.
    k.blob(top + np.array([0, 0, -0.9]), 1.75, lambda p, n: BOOT * (0.75 + 0.35 * n[2]) * rng.uniform(0.8, 1.2), rng, subdiv=1 if detailed else 0, rough=0.3, squash=(1, 1, 1.7))

    fronds = 30 if detailed else 17
    steps = 7 if detailed else 4
    pairs = 14 if detailed else 6
    for f in range(fronds):
        u = (f + 0.5) / fronds  # 0 = newest (centre of the crown), 1 = oldest (lowest)
        a = GOLDEN * f + rng.uniform(-0.2, 0.2)
        rise = math.radians(70 - 92 * u**0.85 + rng.uniform(-6, 6))
        bend = math.radians(42 + 26 * u + rng.uniform(-8, 10))
        length = (7.5 + 6.0 * min(1.0, u * 3.5)) * rng.uniform(0.92, 1.08)
        root = top + np.array([0.5 * math.cos(a), 0.5 * math.sin(a), 0.6 - 1.4 * u])
        frond(k, rng, root, a, rise, bend, length, steps, pairs, u, False)
    for f in range(5 if detailed else 2):
        a = GOLDEN * (f + 0.37) * 2.1 + rng.uniform(-0.3, 0.3)
        root = top + np.array([0.9 * math.cos(a), 0.9 * math.sin(a), -1.6])
        frond(k, rng, root, a, math.radians(rng.uniform(-62, -48)), math.radians(rng.uniform(22, 34)), rng.uniform(7.5, 10), 4 if detailed else 3, 7 if detailed else 4, 1.0, True)
    return k


def build():
    mat = materials.pbr("tree_palm", roughness=0.85)
    objs = []
    for i, detailed in enumerate([True, False]):
        ob = build_lod(detailed).object(f"tree_palm_LOD{i}", smooth=True)
        materials.assign(ob, mat)
        objs.append(ob)
    return objs
